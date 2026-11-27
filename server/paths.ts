import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve('data');

const RAW_ROOTS = (process.env.DOWNLOAD_ROOTS ||
  (process.platform === 'win32' ? path.resolve('downloads') : '/media'))
  .split(process.platform === 'win32' ? ';' : ':')
  .map((s) => s.trim())
  .filter(Boolean);

export const ROOTS = [...new Set(RAW_ROOTS.map((r) => path.resolve(r)))];

export function ensureBaseDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'parts'), { recursive: true });
  for (const root of ROOTS) {
    try {
      fs.mkdirSync(root, { recursive: true });
    } catch {
      // 容器内挂载目录不可建时忽略，运行时再报错
    }
  }
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 把相对目录安全地拼到某个根目录下，阻止 ../ 逃逸 */
export function resolveInRoot(root: string, rel: string): string {
  const absRoot = ROOTS.find((r) => path.resolve(r) === path.resolve(root));
  if (!absRoot) throw new Error('下载目录不在允许的根目录内');
  const cleaned = (rel || '').replace(/[\\/]+/g, path.sep).replace(/^[\\/]+/, '');
  const target = path.resolve(absRoot, cleaned);
  if (!isInside(absRoot, target)) throw new Error('目录路径非法');
  return target;
}

export function sanitizeName(input: string, fallback = '未命名'): string {
  let name = (input || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  if (!name) name = fallback;
  return name;
}

export function sanitizeSubdir(input: string): string {
  const parts = (input || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .map((p) => sanitizeName(p, ''));
  return parts.filter(Boolean).join('/');
}

export async function uniqueFilePath(dir: string, baseName: string, ext: string): Promise<{ fileName: string; filePath: string }> {
  await fsp.mkdir(dir, { recursive: true });
  const base = sanitizeName(baseName);
  for (let i = 0; i < 500; i++) {
    const fileName = i === 0 ? `${base}${ext}` : `${base} (${i + 1})${ext}`;
    const filePath = path.join(dir, fileName);
    try {
      await fsp.access(filePath);
    } catch {
      return { fileName, filePath };
    }
  }
  throw new Error('同名文件过多');
}

export async function listDirs(root: string, rel: string): Promise<Array<{ name: string; rel: string }>> {
  const abs = resolveInRoot(root, rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({
      name: e.name,
      rel: [sanitizeSubdir(rel), e.name].filter(Boolean).join('/'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function makeDir(root: string, rel: string): Promise<string> {
  const abs = resolveInRoot(root, rel);
  await fsp.mkdir(abs, { recursive: true });
  return abs;
}

export function humanBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}