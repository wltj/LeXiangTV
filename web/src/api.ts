import type { DownloadTask } from '../../shared/types.ts';

const BASE = import.meta.env.BASE_URL || '/';

/** 同时兼容根路径与飞牛统一网关前缀（/app/lexiangtv/） */
export function appUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${BASE.replace(/\/+$/, '')}/${clean}`;
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(appUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : `请求失败 (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function humanBytes(n?: number): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function humanSpeed(speed?: number): string {
  if (!speed || speed <= 0) return '0 KB/s';
  return `${humanBytes(speed)}/s`;
}

export function taskPercent(task: DownloadTask): number {
  if (task.status === 'completed') return 1;
  if (task.kind === 'file') {
    if (!task.totalBytes) return task.bytes > 0 ? 0.999 : 0;
    return Math.min(1, task.bytes / task.totalBytes);
  }
  if (!task.totalSegments) return 0;
  return Math.min(1, task.doneSegments / task.totalSegments);
}

export function taskRemainingTime(task: DownloadTask): string {
  if (task.status === 'merging') return '合并中';
  if (task.status === 'completed') return '已完成';
  if (!task.speed || task.speed <= 0) return '';
  const total = task.kind === 'file' ? task.totalBytes : 0;
  let remain = 0;
  if (task.kind === 'file' && total > 0) {
    remain = total - task.bytes;
  } else if (task.totalSegments > 0 && task.doneSegments > 0 && task.bytes > 0) {
    const perSeg = task.bytes / task.doneSegments;
    remain = perSeg * (task.totalSegments - task.doneSegments);
  }
  if (remain <= 0) return '';
  const sec = remain / task.speed;
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `约 ${Math.ceil(sec)} 秒`;
  if (sec < 3600) return `约 ${Math.ceil(sec / 60)} 分钟`;
  return `约 ${(sec / 3600).toFixed(1)} 小时`;
}

export function sanitizeFileName(input: string): string {
  return (input || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}