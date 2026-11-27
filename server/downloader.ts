import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import type { CreateTaskInput, DownloadTask } from '../shared/types.ts';
import { DATA_DIR, ROOTS, resolveInRoot, sanitizeName, sanitizeSubdir, uniqueFilePath } from './paths.ts';
import { settings, tasks, saveTasks, notifyTasks, clamp } from './store.ts';
import { combineSignals, humanError } from './http.ts';
import {
  allTsPlain,
  buildPlan,
  keyFileName,
  mapFileName,
  probeUrl,
  renderLocalPlaylist,
  segmentFileNames,
} from './hls.ts';
import type { HlsPlan } from './hls.ts';

class PauseError extends Error {
  constructor() {
    super('paused');
    this.name = 'PauseError';
  }
}

interface Runtime {
  controller: AbortController;
  paused: boolean;
  failure: Error | null;
  lastBytes: number;
  lastSpeedAt: number;
}

const active = new Map<string, Runtime>();
let ffmpegInfo: { ok: boolean; version: string } = { ok: false, version: '未检测' };
let tickTimer: NodeJS.Timeout | null = null;

function partsDir(id: string): string {
  return path.join(DATA_DIR, 'parts', id);
}

function planPath(id: string): string {
  return path.join(partsDir(id), 'plan.json');
}

async function savePlan(id: string, plan: HlsPlan): Promise<void> {
  await fsp.mkdir(partsDir(id), { recursive: true });
  await fsp.writeFile(planPath(id), JSON.stringify(plan), 'utf-8');
}

async function loadPlan(id: string): Promise<HlsPlan | null> {
  try {
    const raw = await fsp.readFile(planPath(id), 'utf-8');
    return JSON.parse(raw) as HlsPlan;
  } catch {
    return null;
  }
}

async function clearPlan(id: string): Promise<void> {
  await fsp.rm(partsDir(id), { recursive: true, force: true }).catch(() => undefined);
}

export async function initDownloader(): Promise<void> {
  ffmpegInfo = await checkFfmpeg();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tickSpeeds, 1000);
  tickTimer.unref?.();
  pump();
}

function checkFfmpeg(): Promise<{ ok: boolean; version: string }> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, version: '未安装（将使用 TS 直接拼接）' });
        return;
      }
      const line = String(stdout).split(/\r?\n/)[0] || 'ffmpeg';
      resolve({ ok: true, version: line.replace(/^ffmpeg version\s*/i, '').split(' ')[0] });
    });
  });
}

export function getFfmpegInfo(): { ok: boolean; version: string } {
  return ffmpegInfo;
}

function tickSpeeds(): void {
  let changed = false;
  for (const task of tasks) {
    const rt = active.get(task.id);
    if (!rt) continue;
    const now = Date.now();
    const delta = task.bytes - rt.lastBytes;
    task.speed = Math.max(0, Math.round((delta * 1000) / Math.max(1, now - rt.lastSpeedAt)));
    rt.lastBytes = task.bytes;
    rt.lastSpeedAt = now;
    if (task.status === 'downloading' || task.status === 'merging') changed = true;
  }
  if (changed) notifyTasks();
}

function findTask(id: string): DownloadTask | undefined {
  return tasks.find((t) => t.id === id);
}

function taskHeaders(task: DownloadTask): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': settings.userAgent };
  if (task.referer) headers.Referer = task.referer;
  return headers;
}

export function createTask(input: CreateTaskInput): DownloadTask {
  const url = String(input.url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('下载链接必须是 http/https 地址');
  const root = ROOTS.includes(String(input.root)) ? String(input.root) : settings.defaultRoot;
  if (!root) throw new Error('没有可用的下载根目录');
  const subdir = sanitizeSubdir(input.subdir !== undefined ? input.subdir : settings.defaultSubdir);
  resolveInRoot(root, subdir);
  const name = sanitizeName(String(input.name || guessName(url)), '未命名');
  const task: DownloadTask = {
    id: crypto.randomUUID(),
    url,
    name,
    fileName: sanitizeName(String(input.fileName || name), '未命名'),
    root,
    subdir,
    threads: clamp(Number(input.threads) || settings.defaultThreads, 1, 64),
    referer: String(input.referer || ''),
    siteKey: String(input.siteKey || ''),
    sourceName: String(input.sourceName || ''),
    status: 'queued',
    error: '',
    kind: 'hls',
    variantIndex: Number.isInteger(input.variantIndex) ? Number(input.variantIndex) : -1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalSegments: 0,
    doneSegments: 0,
    bytes: 0,
    totalBytes: 0,
    speed: 0,
    filePath: '',
    keepParts: input.keepParts ?? settings.keepParts,
    outputFormat: input.outputFormat === 'ts' ? 'ts' : settings.outputFormat,
  };
  tasks.push(task);
  notifyTasks();
  saveTasks(true);
  pump();
  return task;
}

export function createTasks(inputs: CreateTaskInput[]): DownloadTask[] {
  return inputs.map((i) => createTask(i));
}

function guessName(url: string): string {
  try {
    const p = decodeURIComponent(new URL(url).pathname);
    const base = path.posix.basename(p);
    const noExt = base.replace(/\.(m3u8|mp4|mkv|flv|ts)$/i, '');
    return noExt || '视频';
  } catch {
    return '视频';
  }
}

export function pauseTask(id: string): void {
  const task = findTask(id);
  if (!task) return;
  if (task.status === 'queued' || task.status === 'downloading') {
    const rt = active.get(id);
    if (rt) {
      rt.paused = true;
      rt.controller.abort();
    }
    task.status = 'paused';
    task.speed = 0;
    task.updatedAt = Date.now();
    saveTasks(true);
    notifyTasks();
  }
}

export function resumeTask(id: string): void {
  const task = findTask(id);
  if (!task) return;
  if (task.status === 'paused' || task.status === 'error') {
    task.status = 'queued';
    task.error = '';
    task.speed = 0;
    task.updatedAt = Date.now();
    notifyTasks();
    pump();
  }
}

export function pauseAll(): void {
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'downloading') pauseTask(task.id);
  }
}

export function resumeAll(): void {
  for (const task of tasks) {
    if (task.status === 'paused' || task.status === 'error') {
      task.status = 'queued';
      task.error = '';
      task.updatedAt = Date.now();
    }
  }
  notifyTasks();
  pump();
}

export async function deleteTask(id: string, deleteFile: boolean): Promise<void> {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const task = tasks[idx];
  const rt = active.get(id);
  if (rt) {
    rt.paused = true;
    rt.controller.abort();
  }
  tasks.splice(idx, 1);
  active.delete(id);
  if (deleteFile && task.filePath) {
    await fsp.rm(task.filePath, { force: true }).catch(() => undefined);
  }
  await clearPlan(id);
  saveTasks(true);
  notifyTasks();
  pump();
}

export async function retryTask(id: string, fresh: boolean): Promise<void> {
  const task = findTask(id);
  if (!task) return;
  if (fresh) {
    await clearPlan(id);
    task.bytes = 0;
    task.doneSegments = 0;
    task.totalSegments = 0;
    task.totalBytes = 0;
  }
  task.status = 'queued';
  task.error = '';
  task.speed = 0;
  task.updatedAt = Date.now();
  notifyTasks();
  pump();
}

function countActive(): number {
  return tasks.filter((t) => t.status === 'downloading' || t.status === 'merging').length;
}

function pump(): void {
  const max = settings.maxConcurrentTasks;
  while (countActive() < max) {
    const next = tasks.find((t) => t.status === 'queued');
    if (!next) return;
    startTask(next);
  }
}

function startTask(task: DownloadTask): void {
  const rt: Runtime = {
    controller: new AbortController(),
    paused: false,
    failure: null,
    lastBytes: task.bytes,
    lastSpeedAt: Date.now(),
  };
  active.set(task.id, rt);
  task.status = 'downloading';
  task.error = '';
  task.updatedAt = Date.now();
  notifyTasks();
  void execute(task, rt).finally(() => {
    active.delete(task.id);
    saveTasks(true);
    notifyTasks();
    pump();
  });
}

async function execute(task: DownloadTask, rt: Runtime): Promise<void> {
  const signal = rt.controller.signal;
  const headers = taskHeaders(task);
  try {
    const probe = await probeUrl(task.url, headers);
    task.kind = probe.kind;
    if (signal.aborted) throw new PauseError();
    if (probe.kind === 'file') {
      await runFile(task, rt, headers);
    } else {
      await runHls(task, rt, headers);
    }
  } catch (err) {
    if (rt.paused || (signal.aborted && !rt.failure)) {
      task.status = 'paused';
      task.error = '';
      task.speed = 0;
    } else {
      const real = rt.failure ?? err;
      task.status = 'error';
      task.speed = 0;
      task.error = humanError(real);
      if (/HTTP 40[13]|403|401/.test(task.error)) {
        task.error += '（链接可能已过期，可点“重新解析”）';
      }
    }
    task.updatedAt = Date.now();
  }
}

async function runHls(task: DownloadTask, rt: Runtime, headers: Record<string, string>): Promise<void> {
  const signal = rt.controller.signal;
  let plan = await loadPlan(task.id);
  if (!plan) {
    plan = await buildPlan(task.url, task.variantIndex, headers);
    await savePlan(task.id, plan);
  }
  task.totalSegments = plan.segments.length;
  task.outputFormat = task.outputFormat === 'ts' ? 'ts' : 'mp4';
  const segFiles = segmentFileNames(plan);
  const dir = partsDir(task.id);
  await fsp.mkdir(dir, { recursive: true });

  const pending: number[] = [];
  let existingBytes = 0;
  for (let i = 0; i < plan.segments.length; i++) {
    const file = path.join(dir, segFiles[i]);
    try {
      const st = await fsp.stat(file);
      if (st.size > 0) {
        existingBytes += st.size;
      } else {
        pending.push(i);
      }
    } catch {
      pending.push(i);
    }
  }
  task.doneSegments = plan.segments.length - pending.length;
  task.bytes = existingBytes;
  if (rt.lastBytes > task.bytes) rt.lastBytes = task.bytes;
  notifyTasks();

  if (signal.aborted) throw new PauseError();

  for (let ki = 0; ki < plan.keys.length; ki++) {
    const key = plan.keys[ki];
    const file = path.join(dir, keyFileName(ki));
    try {
      const st = await fsp.stat(file);
      if (st.size > 0) continue;
    } catch {
      // 需要下载
    }
    const buf = await fetchSmall(key.uri, headers, signal);
    await fsp.writeFile(file, buf);
  }

  const mapFile = mapFileName(plan);
  if (plan.map && mapFile) {
    const file = path.join(dir, mapFile);
    let need = true;
    try {
      const st = await fsp.stat(file);
      need = st.size === 0;
    } catch {
      need = true;
    }
    if (need) {
      const extra: Record<string, string> = { ...headers };
      if (plan.map.byteRange) {
        extra.Range = `bytes=${plan.map.byteRange.offset}-${plan.map.byteRange.offset + plan.map.byteRange.length - 1}`;
      }
      await downloadToFile(plan.map.uri, file, extra, signal);
    }
  }

  if (signal.aborted) throw new PauseError();

  let cursor = 0;
  const workers = Array.from({ length: Math.min(task.threads, pending.length) }, async () => {
    while (true) {
      if (signal.aborted) throw new PauseError();
      if (cursor >= pending.length) return;
      const i = pending[cursor++];
      const seg = plan.segments[i];
      try {
        const extra: Record<string, string> = { ...headers };
        if (seg.byteRange) {
          extra.Range = `bytes=${seg.byteRange.offset}-${seg.byteRange.offset + seg.byteRange.length - 1}`;
        }
        const written = await downloadToFile(seg.url, path.join(dir, segFiles[i]), extra, signal);
        task.bytes += written;
        task.doneSegments = Math.min(task.totalSegments, task.doneSegments + 1);
        task.updatedAt = Date.now();
        notifyTasks();
      } catch (err) {
        if (!rt.failure && !(err instanceof PauseError)) rt.failure = err as Error;
        rt.controller.abort();
        throw err;
      }
    }
  });
  await Promise.all(workers);

  if (signal.aborted) throw new PauseError();
  if (rt.failure) throw rt.failure;

  task.status = 'merging';
  task.speed = 0;
  task.updatedAt = Date.now();
  notifyTasks();

  const playlistText = renderLocalPlaylist(plan, segFiles, mapFile);
  const playlistFile = path.join(dir, 'local.m3u8');
  await fsp.writeFile(playlistFile, playlistText, 'utf-8');

  const outDir = resolveInRoot(task.root, task.subdir);
  let outFmt = task.outputFormat;
  if (!ffmpegInfo.ok) {
    if (!allTsPlain(plan)) {
      throw new Error('系统未安装 ffmpeg，且该流需要转封装（AES 加密或 fMP4），无法合并');
    }
    outFmt = 'ts';
  }
  const ext = outFmt === 'ts' ? '.ts' : '.mp4';
  const { fileName, filePath } = await uniqueFilePath(outDir, sanitizeName(task.fileName, task.name), ext);
  const tempPath = `${filePath}.part`;

  try {
    if (ffmpegInfo.ok) {
      await runFfmpeg(playlistFile, tempPath, outFmt);
    } else {
      await concatFiles(dir, segFiles, tempPath);
    }
    const st = await fsp.stat(tempPath);
    if (!st.size) throw new Error('合并结果为空，可能分片已损坏');
    await fsp.rename(tempPath, filePath);
    task.outputFormat = outFmt;
    task.fileName = fileName;
    task.filePath = filePath;
    task.totalBytes = st.size;
    task.bytes = st.size;
    task.doneSegments = task.totalSegments;
    task.status = 'completed';
    task.error = '';
    task.updatedAt = Date.now();
    if (!task.keepParts) await clearPlan(task.id);
  } catch (err) {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw err instanceof PauseError ? err : new Error(`合并失败：${humanError(err)}`);
  }
}

async function downloadToFile(url: string, file: string, headers: Record<string, string>, signal: AbortSignal): Promise<number> {
  const tmp = `${file}.tmp`;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal.aborted) throw new PauseError();
    try {
      const res = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: combineSignals(60000, signal),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('响应没有内容');
      const fh = await fsp.open(tmp, 'w');
      let written = 0;
      try {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            await fh.write(value);
            written += value.byteLength;
          }
        }
      } finally {
        await fh.close();
      }
      if (written === 0) throw new Error('分片内容为空');
      await fsp.rename(tmp, file);
      return written;
    } catch (err) {
      lastErr = err as Error;
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      if (signal.aborted) throw new PauseError();
      const msg = humanError(err);
      if (/HTTP 40[134]/.test(msg) && attempt >= 2) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastErr ?? new Error('分片下载失败');
}

async function fetchSmall(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(url, { headers, redirect: 'follow', signal: combineSignals(30000, signal) });
  if (!res.ok) throw new Error(`密钥下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('密钥内容为空');
  return buf;
}

async function runFfmpeg(playlistFile: string, outFile: string, format: 'mp4' | 'ts'): Promise<void> {
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-protocol_whitelist',
    'file,crypto,data',
    '-i',
    playlistFile,
    '-c',
    'copy',
  ];
  if (format === 'mp4') {
    args.push('-movflags', '+faststart', '-max_muxing_queue_size', '4096', '-f', 'mp4');
  } else {
    args.push('-f', 'mpegts');
  }
  args.push(outFile);

  await new Promise<void>((resolve, reject) => {
    const child = execFile('ffmpeg', args, { maxBuffer: 4 * 1024 * 1024, timeout: 0 }, (err, _stdout, stderr) => {
      if (err) {
        const tail = String(stderr || '').trim().split('\n').slice(-4).join(' ');
        reject(new Error(tail || err.message));
        return;
      }
      resolve();
    });
    child.on('error', () => reject(new Error('无法启动 ffmpeg')));
  });
}

async function concatFiles(dir: string, segFiles: string[], outFile: string): Promise<void> {
  const out = fs.createWriteStream(outFile);
  try {
    for (const name of segFiles) {
      const data = await fsp.readFile(path.join(dir, name));
      if (!out.write(data)) {
        await new Promise<void>((r) => out.once('drain', () => r()));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on('error', reject);
    });
  }
}

async function runFile(task: DownloadTask, rt: Runtime, headers: Record<string, string>): Promise<void> {
  const signal = rt.controller.signal;
  const dir = partsDir(task.id);
  await fsp.mkdir(dir, { recursive: true });
  const partFile = path.join(dir, 'payload.part');

  let have = 0;
  try {
    const st = await fsp.stat(partFile);
    have = st.size;
  } catch {
    have = 0;
  }

  const reqHeaders: Record<string, string> = { ...headers };
  if (have > 0) reqHeaders.Range = `bytes=${have}-`;

  const res = await fetch(task.url, {
    headers: reqHeaders,
    redirect: 'follow',
    signal: combineSignals(120000, signal),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  let append = have > 0 && res.status === 206;
  if (!append) have = 0;
  const len = Number(res.headers.get('content-length')) || 0;
  task.totalBytes = append ? have + len : len;
  task.bytes = have;
  rt.lastBytes = have;
  notifyTasks();

  const fh = await fsp.open(partFile, append ? 'a' : 'w');
  let written = have;
  try {
    if (!res.body) throw new Error('响应没有内容');
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await fh.write(value);
        written += value.byteLength;
        task.bytes = written;
        task.updatedAt = Date.now();
      }
    }
  } finally {
    await fh.close();
  }

  if (signal.aborted) throw new PauseError();
  const st = await fsp.stat(partFile);
  if (!st.size) throw new Error('下载内容为空');

  const outDir = resolveInRoot(task.root, task.subdir);
  const ext = fileExt(task.url, res.headers.get('content-type') ?? '');
  const { fileName, filePath } = await uniqueFilePath(outDir, sanitizeName(task.fileName, task.name), ext);
  await fsp.rename(partFile, filePath);

  task.fileName = fileName;
  task.filePath = filePath;
  task.totalBytes = st.size;
  task.bytes = st.size;
  task.status = 'completed';
  task.updatedAt = Date.now();
  if (!task.keepParts) await clearPlan(task.id);
}

function fileExt(url: string, contentType: string): string {
  try {
    const p = new URL(url).pathname;
    const m = /\.([a-z0-9]{2,5})$/i.exec(p);
    if (m) return `.${m[1].toLowerCase()}`;
  } catch {
    // ignore
  }
  if (/mp4/i.test(contentType)) return '.mp4';
  if (/matroska/i.test(contentType)) return '.mkv';
  if (/mpegurl/i.test(contentType)) return '.m3u8';
  if (/mpeg/i.test(contentType)) return '.ts';
  return '.mp4';
}

export function getTaskSnapshot(): DownloadTask[] {
  return tasks;
}