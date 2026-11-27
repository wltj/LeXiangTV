export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  method?: string;
  body?: string | URLSearchParams;
}

export function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

function detectEncoding(buf: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return normalizeEncoding(fromHeader);
  const head = buf.subarray(0, 4096).toString('latin1');
  const meta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<\?xml[^>]+encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  return meta ? normalizeEncoding(meta) : 'utf-8';
}

function normalizeEncoding(enc: string): string {
  const e = enc.toLowerCase();
  if (e === 'gb2312' || e === 'gb-2312') return 'gbk';
  return e;
}

export function decodeBuffer(buf: Buffer, contentType = ''): string {
  const enc = detectEncoding(buf, contentType);
  if (enc === 'utf-8' || enc === 'utf8') return buf.toString('utf-8');
  try {
    return new TextDecoder(enc).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

export interface RawResponse {
  status: number;
  finalUrl: string;
  contentType: string;
  buffer: Buffer;
}

export async function fetchRaw(url: string, opts: FetchOptions = {}): Promise<RawResponse> {
  const signal = combineSignals(opts.timeoutMs ?? 20000, opts.signal);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: '*/*',
        ...(opts.headers ?? {}),
      },
      body: opts.body,
      redirect: 'follow',
      signal,
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') throw new Error('请求超时');
    if (e.name === 'AbortError') throw new Error('请求已取消');
    throw new Error(cleanFetchError(e.message));
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return {
    status: res.status,
    finalUrl: res.url || url,
    contentType: res.headers.get('content-type') ?? '',
    buffer,
  };
}

function cleanFetchError(msg: string): string {
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return '域名无法解析';
  if (/ECONNREFUSED/.test(msg)) return '连接被拒绝';
  if (/ECONNRESET|socket hang up/i.test(msg)) return '连接被重置';
  if (/fetch failed/i.test(msg)) return '网络请求失败';
  return msg;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<{ text: string; finalUrl: string; contentType: string }> {
  const res = await fetchRaw(url, opts);
  return {
    text: decodeBuffer(res.buffer, res.contentType),
    finalUrl: res.finalUrl,
    contentType: res.contentType,
  };
}

export function parseLooseJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error('返回内容不是合法 JSON');
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const { text } = await fetchText(url, opts);
  return parseLooseJson<T>(text);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function humanError(err: unknown): string {
  const e = err as Error;
  if (e?.name === 'AbortError') return '已取消';
  return e?.message || String(err);
}