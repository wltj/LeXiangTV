import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { AppSettings, DownloadTask, SourceConfig } from '../shared/types.ts';
import { DATA_DIR, ROOTS, ensureBaseDirs, sanitizeSubdir } from './paths.ts';
import { DEFAULT_UA } from './http.ts';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const configPath = path.join(DATA_DIR, 'config.json');
const tasksPath = path.join(DATA_DIR, 'tasks.json');

const PRESET_SOURCES: SourceConfig[] = [
  { id: 'preset-ffzy', name: '非凡资源', url: 'https://api.ffzyapi.com/api.php/provide/vod', enabled: true },
  { id: 'preset-lzi', name: '量子资源', url: 'https://cj.lziapi.com/api.php/provide/vod', enabled: true },
  { id: 'preset-dytt', name: '电影天堂资源', url: 'https://caiji.dyttzyapi.com/api.php/provide/vod', enabled: true },
  { id: 'preset-guangsu', name: '光速资源', url: 'https://api.guangsuapi.com/api.php/provide/vod', enabled: true },
  { id: 'preset-subo', name: '素博资源', url: 'https://subocaiji.com/api.php/provide/vod', enabled: true },
];

function defaultSettings(): AppSettings {
  return {
    sources: PRESET_SOURCES.map((s) => ({ ...s })),
    defaultRoot: ROOTS[0] ?? '',
    defaultSubdir: '',
    defaultThreads: 16,
    maxConcurrentTasks: 2,
    keepParts: false,
    outputFormat: 'mp4',
    userAgent: DEFAULT_UA,
  };
}

export let settings: AppSettings = defaultSettings();
export const tasks: DownloadTask[] = [];

let tasksDirty = false;
let tasksTimer: NodeJS.Timeout | null = null;
let saveSettingsTimer: NodeJS.Timeout | null = null;

export function initStore(): void {
  ensureBaseDirs();

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    settings = normalizeSettings(parsed);
  } catch {
    settings = defaultSettings();
    writeSettingsNow();
  }

  try {
    const raw = fs.readFileSync(tasksPath, 'utf-8');
    const list = JSON.parse(raw) as DownloadTask[];
    if (Array.isArray(list)) {
      for (const t of list) {
        const task = normalizeTask(t);
        // 容器/进程重启后未完成的任务一律先标记暂停，等待用户继续
        if (task.status === 'downloading' || task.status === 'merging' || task.status === 'queued') {
          task.status = 'paused';
          task.speed = 0;
        }
        tasks.push(task);
      }
    }
  } catch {
    // 首次运行没有任务文件
  }
}

function normalizeSettings(input: Partial<AppSettings> & Record<string, unknown>): AppSettings {
  const base = defaultSettings();
  const sources = Array.isArray(input.sources)
    ? (input.sources as Array<Partial<SourceConfig>>)
        .filter((s) => s && typeof s.url === 'string' && s.url.trim())
        .map((s, i) => ({
          id: String(s.id || `src-${Date.now()}-${i}`),
          name: String(s.name || `接口${i + 1}`).trim() || `接口${i + 1}`,
          url: String(s.url).trim(),
          enabled: s.enabled !== false,
        }))
    : base.sources;

  const root = ROOTS.includes(String(input.defaultRoot)) ? String(input.defaultRoot) : base.defaultRoot;

  return {
    sources,
    defaultRoot: root,
    defaultSubdir: sanitizeSubdir(String(input.defaultSubdir ?? base.defaultSubdir)),
    defaultThreads: clamp(Number(input.defaultThreads) || base.defaultThreads, 1, 64),
    maxConcurrentTasks: clamp(Number(input.maxConcurrentTasks) || base.maxConcurrentTasks, 1, 8),
    keepParts: Boolean(input.keepParts ?? base.keepParts),
    outputFormat: input.outputFormat === 'ts' ? 'ts' : 'mp4',
    userAgent: String(input.userAgent || base.userAgent),
  };
}

function normalizeTask(t: DownloadTask): DownloadTask {
  return {
    ...t,
    status: t.status ?? 'paused',
    error: t.error ?? '',
    threads: clamp(Number(t.threads) || 16, 1, 64),
    totalSegments: Number(t.totalSegments) || 0,
    doneSegments: Number(t.doneSegments) || 0,
    bytes: Number(t.bytes) || 0,
    totalBytes: Number(t.totalBytes) || 0,
    speed: 0,
    referer: t.referer ?? '',
    siteKey: t.siteKey ?? '',
    sourceName: t.sourceName ?? '',
    subdir: sanitizeSubdir(t.subdir ?? ''),
    kind: t.kind === 'file' ? 'file' : 'hls',
    variantIndex: Number(t.variantIndex) >= 0 ? Number(t.variantIndex) : -1,
    filePath: t.filePath ?? '',
    keepParts: Boolean(t.keepParts),
    outputFormat: t.outputFormat === 'ts' ? 'ts' : 'mp4',
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  settings = normalizeSettings({ ...settings, ...patch } as Partial<AppSettings> & Record<string, unknown>);
  if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(writeSettingsNow, 200);
  return settings;
}

function writeSettingsNow(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('[store] 保存配置失败', err);
  }
}

export function saveTasks(immediate = false): void {
  tasksDirty = true;
  if (immediate) {
    if (tasksTimer) clearTimeout(tasksTimer);
    tasksTimer = null;
    writeTasksNow();
    return;
  }
  if (tasksTimer) return;
  tasksTimer = setTimeout(() => {
    tasksTimer = null;
    if (tasksDirty) writeTasksNow();
  }, 800);
}

function writeTasksNow(): void {
  tasksDirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${tasksPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8');
    fs.renameSync(tmp, tasksPath);
  } catch (err) {
    console.error('[store] 保存任务失败', err);
  }
}

export function notifyTasks(): void {
  saveTasks();
  bus.emit('tasks');
}

export function getPresets(): SourceConfig[] {
  return PRESET_SOURCES.map((s) => ({ ...s }));
}