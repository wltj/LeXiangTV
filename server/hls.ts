import type { HlsVariant, ProbeResult } from '../shared/types.ts';
import { fetchText } from './http.ts';

export interface HlsKeyRef {
  uri: string;
  iv?: string;
}

export interface PlanSegment {
  index: number;
  url: string;
  duration: number;
  seq: number;
  byteRange?: { offset: number; length: number };
  keyIndex: number;
  discontinuity: boolean;
}

export interface HlsPlan {
  playlistUrl: string;
  mediaUrl: string;
  variant: HlsVariant | null;
  variants: HlsVariant[];
  segments: PlanSegment[];
  keys: HlsKeyRef[];
  map?: { uri: string; byteRange?: { offset: number; length: number } };
  targetDuration: number;
  mediaSequence: number;
  encrypted: boolean;
}

interface MasterInfo {
  variants: HlsVariant[];
}

interface MediaInfo {
  segments: PlanSegment[];
  keys: HlsKeyRef[];
  map?: { uri: string; byteRange?: { offset: number; length: number } };
  targetDuration: number;
  mediaSequence: number;
  encrypted: boolean;
  isLive: boolean;
}

function parseAttrs(line: string): Record<string, string> {
  const idx = line.indexOf(':');
  const body = idx >= 0 ? line.slice(idx + 1) : '';
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1].toUpperCase()] = v;
  }
  return out;
}

function resolveUrl(uri: string, base: string): string {
  try {
    return new URL(uri, base).href;
  } catch {
    return uri;
  }
}

export function isMasterPlaylist(text: string): boolean {
  return /^#EXT-X-STREAM-INF/m.test(text);
}

export function parseMaster(text: string, baseUrl: string): MasterInfo {
  const lines = text.split(/\r?\n/);
  const variants: HlsVariant[] = [];
  let pending: Record<string, string> | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      pending = parseAttrs(line);
      continue;
    }
    if (line.startsWith('#')) continue;
    if (pending) {
      const bandwidth = Number(pending.BANDWIDTH) || 0;
      const resolution = (pending.RESOLUTION || '').toLowerCase();
      const name = pending.NAME || '';
      const label = name || resolution.replace('x', '×') || (bandwidth ? `${Math.round(bandwidth / 1000)}Kbps` : `线路${variants.length + 1}`);
      variants.push({
        index: variants.length,
        bandwidth,
        resolution,
        label,
        url: resolveUrl(line, baseUrl),
      });
      pending = null;
    }
  }
  if (!variants.length) throw new Error('主播放列表里没有可用的清晰度');
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  variants.forEach((v, i) => (v.index = i));
  return { variants };
}

export function parseMedia(text: string, mediaUrl: string): MediaInfo {
  const lines = text.split(/\r?\n/);
  const segments: PlanSegment[] = [];
  const keys: HlsKeyRef[] = [];
  let map: MediaInfo['map'];
  let targetDuration = 0;
  let mediaSequence = 0;
  let encrypted = false;
  let isVod = /#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text);
  let endList = false;

  let currentKeyIndex = -1;
  let currentDuration = 0;
  let pendingRange: { offset: number; length: number } | null = null;
  let pendingDiscontinuity = false;
  let mapRange: { offset: number; length: number } | null = null;
  const lastEndByUri = new Map<string, number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
      mediaSequence = Number(line.split(':')[1]) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-TARGETDURATION')) {
      targetDuration = Number(line.split(':')[1]) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-ENDLIST')) {
      endList = true;
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE')) {
      const [len, off] = line.split(':')[1].split('@');
      pendingRange = { length: Number(len) || 0, offset: off === undefined ? -1 : Number(off) || 0 };
      if (pendingRange.offset < 0) pendingRange.offset = 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY')) {
      const attrs = parseAttrs(line);
      const method = (attrs.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE') {
        currentKeyIndex = -1;
      } else if (method === 'AES-128') {
        const uri = resolveUrl(attrs.URI || '', mediaUrl);
        if (!uri) throw new Error('加密播放列表缺少密钥地址');
        let existing = keys.findIndex((k) => k.uri === uri && (k.iv || '') === (attrs.IV || ''));
        if (existing < 0) {
          existing = keys.length;
          keys.push({ uri, iv: attrs.IV });
        }
        currentKeyIndex = existing;
        encrypted = true;
      } else {
        throw new Error(`不支持的加密方式：${method}`);
      }
      continue;
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const attrs = parseAttrs(line);
      const uri = resolveUrl(attrs.URI || '', mediaUrl);
      if (uri) {
        map = { uri };
        if (attrs.BYTERANGE) {
          const [len, off] = attrs.BYTERANGE.split('@');
          mapRange = { length: Number(len) || 0, offset: Number(off) || 0 };
          map.byteRange = mapRange;
        }
      }
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const v = line.slice(line.indexOf(':') + 1).split(',')[0];
      currentDuration = Number(v) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      pendingDiscontinuity = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    const url = resolveUrl(line, mediaUrl);
    let range: { offset: number; length: number } | undefined;
    if (pendingRange) {
      let offset = pendingRange.offset;
      if (pendingRange.offset === 0 && pendingRange.length) {
        const last = lastEndByUri.get(url);
        if (last !== undefined) offset = last;
      }
      range = { offset, length: pendingRange.length };
      lastEndByUri.set(url, offset + pendingRange.length);
    }
    segments.push({
      index: segments.length,
      url,
      duration: currentDuration,
      seq: mediaSequence + segments.length,
      byteRange: range,
      keyIndex: currentKeyIndex,
      discontinuity: pendingDiscontinuity,
    });
    pendingRange = null;
    pendingDiscontinuity = false;
    currentDuration = 0;
  }

  const isLive = !endList && !isVod;
  return { segments, keys, map, targetDuration, mediaSequence, encrypted, isLive };
}

async function fetchPlaylist(url: string, headers: Record<string, string>): Promise<{ text: string; finalUrl: string }> {
  const { text, finalUrl } = await fetchText(url, { headers, timeoutMs: 25000 });
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('#EXTM3U')) throw new Error('链接内容不是 m3u8 播放列表');
  return { text, finalUrl };
}

export async function buildPlan(
  url: string,
  variantIndex: number,
  headers: Record<string, string>,
): Promise<HlsPlan> {
  const first = await fetchPlaylist(url, headers);
  let mediaUrl = first.finalUrl;
  let variants: HlsVariant[] = [];
  let variant: HlsVariant | null = null;
  let mediaText = first.text;

  if (isMasterPlaylist(first.text)) {
    const master = parseMaster(first.text, first.finalUrl);
    variants = master.variants;
    const picked =
      variantIndex >= 0 && variantIndex < variants.length ? variants[variantIndex] : variants[0];
    variant = picked;
    const media = await fetchPlaylist(picked.url, headers);
    mediaText = media.text;
    mediaUrl = media.finalUrl;
  }

  const info = parseMedia(mediaText, mediaUrl);
  if (!info.segments.length) throw new Error('播放列表里没有分片');
  if (info.isLive) throw new Error('这是直播流（没有 ENDLIST），暂不支持下载');

  return {
    playlistUrl: first.finalUrl,
    mediaUrl,
    variant,
    variants,
    segments: info.segments,
    keys: info.keys,
    map: info.map,
    targetDuration: info.targetDuration,
    mediaSequence: info.mediaSequence,
    encrypted: info.encrypted,
  };
}

export async function probeUrl(url: string, headers: Record<string, string>): Promise<ProbeResult> {
  const contentType = await sniffContentType(url, headers);
  const looksHls = /\.m3u8(\?|$)/i.test(url) || /mpegurl|x-mpegurl/i.test(contentType);

  if (looksHls) return probeHls(url, headers);

  if (/text\/html/i.test(contentType)) {
    throw new Error('该链接是网页，不是视频地址');
  }
  if (/^image\//i.test(contentType)) {
    throw new Error('该链接是图片，不是视频地址');
  }
  if (/^(video\/|audio\/|application\/(octet-stream|x-mpegurl|vnd\.apple\.mpegurl|mp4|dash\+xml))/i.test(contentType)) {
    return { kind: 'file', isMaster: false, variants: [], duration: null, segments: 0, encrypted: false };
  }
  if (/\.(mp4|mkv|flv|mov|avi|wmv|webm|m4v|mp3|m4a)(\?|$)/i.test(url)) {
    return { kind: 'file', isMaster: false, variants: [], duration: null, segments: 0, encrypted: false };
  }
  // 无扩展名也无法判断时按 HLS 再试一次，失败则报错
  try {
    return await probeHls(url, headers);
  } catch {
    throw new Error('无法识别链接类型，支持 m3u8 与常见视频直链');
  }
}

async function probeHls(url: string, headers: Record<string, string>): Promise<ProbeResult> {
  const first = await fetchPlaylist(url, headers);
  if (isMasterPlaylist(first.text)) {
    const master = parseMaster(first.text, first.finalUrl);
    const top = master.variants[0];
    const media = await fetchPlaylist(top.url, headers);
    const info = parseMedia(media.text, media.finalUrl);
    return {
      kind: 'hls',
      isMaster: true,
      variants: master.variants,
      duration: info.segments.reduce((s, x) => s + x.duration, 0),
      segments: info.segments.length,
      encrypted: info.encrypted,
    };
  }
  const info = parseMedia(first.text, first.finalUrl);
  return {
    kind: 'hls',
    isMaster: false,
    variants: [
      {
        index: 0,
        bandwidth: 0,
        resolution: '',
        label: '原始清晰度',
        url: first.finalUrl,
      },
    ],
    duration: info.segments.reduce((s, x) => s + x.duration, 0),
    segments: info.segments.length,
    encrypted: info.encrypted,
  };
}

async function sniffContentType(url: string, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-4095' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    const reader = res.body?.getReader();
    if (reader) {
      try {
        await reader.read();
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    return ct;
  } finally {
    clearTimeout(timer);
  }
}

function extFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const m = /\.([a-z0-9]{2,5})$/i.exec(pathname);
    if (m) {
      const ext = m[1].toLowerCase();
      if (['ts', 'm4s', 'mp4', 'aac', 'm4a', 'm4v', 'cmfv', 'cmfa', 'key', 'vtt'].includes(ext)) {
        return `.${ext}`;
      }
    }
  } catch {
    // ignore
  }
  return fallback;
}

export function segmentFileNames(plan: HlsPlan): string[] {
  const fallback = plan.map ? '.m4s' : '.ts';
  return plan.segments.map((seg, i) => `s_${String(i + 1).padStart(5, '0')}${extFromUrl(seg.url, fallback)}`);
}

export function keyFileName(index: number): string {
  return `key_${index}.key`;
}

export function mapFileName(plan: HlsPlan): string | null {
  if (!plan.map) return null;
  return `init${extFromUrl(plan.map.uri, '.mp4')}`;
}

export function renderLocalPlaylist(plan: HlsPlan, segFiles: string[], mapFile: string | null): string {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  if (plan.targetDuration > 0) lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(plan.targetDuration)}`);
  lines.push(`#EXT-X-MEDIA-SEQUENCE:${plan.mediaSequence}`);
  if (mapFile) lines.push(`#EXT-X-MAP:URI="${mapFile}"`);

  let lastKey = -2;
  plan.segments.forEach((seg, i) => {
    if (seg.discontinuity && i > 0) lines.push('#EXT-X-DISCONTINUITY');
    if (seg.keyIndex !== lastKey) {
      if (seg.keyIndex >= 0) {
        const key = plan.keys[seg.keyIndex];
        const iv = key.iv ? `,IV=${key.iv}` : '';
        lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${keyFileName(seg.keyIndex)}"${iv}`);
      }
      lastKey = seg.keyIndex;
    }
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
    lines.push(segFiles[i]);
  });
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

export function allTsPlain(plan: HlsPlan): boolean {
  if (plan.encrypted || plan.map) return false;
  return plan.segments.every((s) => !s.byteRange && extFromUrl(s.url, '.ts') === '.ts');
}