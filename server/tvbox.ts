import type {
  Line,
  SearchEvent,
  SearchItem,
  SiteInfo,
  SourceTestResult,
  VodDetail,
} from '../shared/types.ts';
import { fetchJson, fetchText, parseLooseJson } from './http.ts';
import { settings } from './store.ts';

export interface SiteRecord extends SiteInfo {
  timeout?: number;
}

const registry = new Map<string, SiteRecord>();
let cacheKey = '';
let cacheAt = 0;
let cacheResult: { sites: SiteRecord[]; errors: Array<{ sourceId: string; name: string; error: string }> } | null = null;
let loading: Promise<{ sites: SiteRecord[]; errors: Array<{ sourceId: string; name: string; error: string }> }> | null = null;

const CACHE_TTL = 10 * 60 * 1000;

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function normalizeApi(raw: unknown): string {
  const api = String(raw ?? '').trim();
  if (!api) return '';
  if (/^https?:\/\//i.test(api)) return api;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(api)) return `https://${api}`;
  return api;
}

function truthy(v: unknown, fallback = true): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return !(s === '0' || s === 'false' || s === 'no');
}

function extractHeader(raw: Record<string, unknown>): Record<string, string> | undefined {
  const h = raw.header ?? (raw.ext as Record<string, unknown> | undefined)?.header;
  if (!h || typeof h !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

interface ParsedConfig {
  name: string;
  sites: SiteRecord[];
}

function parseSiteList(rawSites: unknown[], source: { id: string; name: string; url: string }): SiteRecord[] {
  const out: SiteRecord[] = [];
  const seen = new Set<string>();
  for (const item of rawSites) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = String(raw.name ?? raw.title ?? '').trim();
    const api = normalizeApi(raw.api ?? raw.url ?? (raw.ext as Record<string, unknown> | undefined)?.api);
    if (!api || !/^https?:\/\//i.test(api)) continue;
    if (!truthy(raw.searchable, true)) continue;
    const key = shortHash(`${source.id}|${api}|${name}`);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: name || key,
      api,
      sourceId: source.id,
      sourceName: source.name,
      searchable: true,
      header: extractHeader(raw),
      timeout: Number(raw.timeout) || undefined,
    });
  }
  return out;
}

function looksLikeCmsPayload(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const j = json as Record<string, unknown>;
  return Array.isArray(j.list) || Array.isArray(j.class) || typeof j.code !== 'undefined';
}

async function parseOneConfig(json: unknown, source: { id: string; name: string; url: string }): Promise<ParsedConfig> {
  if (Array.isArray(json)) {
    return { name: source.name, sites: parseSiteList(json, source) };
  }
  if (json && typeof json === 'object') {
    const j = json as Record<string, unknown>;
    if (Array.isArray(j.sites)) {
      return {
        name: String(j.name ?? source.name),
        sites: parseSiteList(j.sites, source),
      };
    }
    if (looksLikeCmsPayload(json) || /provide\/vod/i.test(source.url)) {
      return {
        name: source.name,
        sites: [
          {
            key: shortHash(`${source.id}|${source.url}|${source.name}`),
            name: source.name,
            api: source.url,
            sourceId: source.id,
            sourceName: source.name,
            searchable: true,
          },
        ],
      };
    }
  }
  throw new Error('没有找到 sites 配置（不像 TVBox 接口 JSON）');
}

async function loadOneSource(source: { id: string; name: string; url: string }): Promise<ParsedConfig> {
  const res = await fetchText(source.url, {
    headers: { 'User-Agent': settings.userAgent },
    timeoutMs: 12000,
  });
  let json: unknown;
  try {
    json = parseLooseJson(res.text);
  } catch {
    // 部分订阅以 base64 编码返回
    const compact = res.text.replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(compact)) {
      try {
        const decoded = Buffer.from(compact, 'base64').toString('utf-8');
        json = parseLooseJson(decoded);
      } catch {
        throw new Error('接口返回的不是 JSON，可能已失效');
      }
    } else {
      throw new Error('接口返回的不是 JSON，可能已失效');
    }
  }
  const first = await parseOneConfig(json, source);
  const multi = json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).urls);
  if (!multi) return first;

  const urls = (json as Record<string, unknown>).urls as unknown[];
  const subs = urls
    .map((u) => {
      if (typeof u === 'string') return { url: u.trim(), name: source.name };
      if (u && typeof u === 'object') {
        const o = u as Record<string, unknown>;
        return { url: String(o.url ?? '').trim(), name: String(o.name ?? source.name) };
      }
      return { url: '', name: source.name };
    })
    .filter((u) => /^https?:\/\//i.test(u.url));

  const results = await Promise.allSettled(
    subs.map((sub, i) =>
      loadSubConfig(sub.url, { id: `${source.id}-${i}`, name: sub.name || source.name, url: sub.url }),
    ),
  );
  const sites: SiteRecord[] = [...first.sites];
  for (const r of results) {
    if (r.status === 'fulfilled') sites.push(...r.value.sites);
  }
  return { name: first.name, sites };
}

async function loadSubConfig(url: string, source: { id: string; name: string; url: string }): Promise<ParsedConfig> {
  const res = await fetchText(url, {
    headers: { 'User-Agent': settings.userAgent },
    timeoutMs: 10000,
  });
  const json = parseLooseJson(res.text);
  return parseOneConfig(json, source);
}

export async function loadSites(force = false): Promise<{
  sites: SiteRecord[];
  errors: Array<{ sourceId: string; name: string; error: string }>;
}> {
  const key = JSON.stringify(settings.sources.filter((s) => s.enabled).map((s) => [s.id, s.url]));
  if (!force && cacheResult && key === cacheKey && Date.now() - cacheAt < CACHE_TTL) return cacheResult;
  if (loading && !force) return loading;

  loading = (async () => {
    const enabled = settings.sources.filter((s) => s.enabled);
    const results = await Promise.allSettled(enabled.map((s) => loadOneSource(s)));
    const sites: SiteRecord[] = [];
    const errors: Array<{ sourceId: string; name: string; error: string }> = [];
    const seen = new Set<string>();
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        for (const site of r.value.sites) {
          if (seen.has(site.key)) continue;
          seen.add(site.key);
          sites.push(site);
          registry.set(site.key, site);
        }
      } else {
        errors.push({
          sourceId: enabled[i].id,
          name: enabled[i].name,
          error: (r.reason as Error)?.message || '加载失败',
        });
      }
    });
    cacheResult = { sites, errors };
    cacheKey = key;
    cacheAt = Date.now();
    return cacheResult;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

export async function getSite(key: string): Promise<SiteRecord | undefined> {
  if (registry.has(key)) return registry.get(key);
  await loadSites();
  return registry.get(key);
}

export function suggestedReferer(site: SiteRecord | undefined): string {
  if (!site) return '';
  const h = site.header ?? {};
  const found = Object.entries(h).find(([k]) => k.toLowerCase() === 'referer');
  if (found) return found[1];
  try {
    return new URL(site.api).origin + '/';
  } catch {
    return '';
  }
}

export function siteHeaders(site: SiteRecord | undefined): Record<string, string> {
  const headers = { 'User-Agent': settings.userAgent, ...(site?.header ?? {}) };
  return headers;
}

interface CmsQuery {
  ac?: string;
  wd?: string;
  pg?: number | string;
  ids?: string;
  t?: string;
}

export function buildCmsUrl(api: string, query: CmsQuery): string {
  let templated = false;
  let url = api;
  const slots: Array<[RegExp, string | undefined]> = [
    [/\{ac\}/g, query.ac],
    [/\{(wd|kw|key|keyword)\}/g, query.wd],
    [/\{(pg|page)\}/g, query.pg === undefined ? undefined : String(query.pg)],
    [/\{(ids|id)\}/g, query.ids],
    [/\{(t|type)\}/g, query.t],
  ];
  for (const [re, value] of slots) {
    if (re.test(url)) {
      templated = true;
      url = url.replace(re, value === undefined ? '' : encodeURIComponent(String(value)));
    }
  }
  if (templated) {
    if (query.ids !== undefined && !/[?&]ids=/.test(url)) {
      const sep = url.includes('?') ? (url.endsWith('?') || url.endsWith('&') ? '' : '&') : '?';
      url = `${url}${sep}ids=${encodeURIComponent(query.ids)}`;
    }
    return url;
  }
  const params = new URLSearchParams();
  if (query.ac) params.set('ac', query.ac);
  if (query.wd !== undefined) params.set('wd', query.wd);
  if (query.pg !== undefined) params.set('pg', String(query.pg));
  if (query.ids !== undefined) params.set('ids', query.ids);
  if (query.t) params.set('t', query.t);
  const qs = params.toString();
  if (!qs) return url;
  const sep = url.includes('?') ? (url.endsWith('?') || url.endsWith('&') ? '' : '&') : '?';
  return `${url}${sep}${qs}`;
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

export function cmsItemToSearchItem(raw: Record<string, unknown>, site: SiteRecord): SearchItem | null {
  const id = str(raw.vod_id ?? raw.id ?? raw.ids);
  const name = str(raw.vod_name ?? raw.name ?? raw.title);
  if (!id || !name) return null;
  return {
    key: site.key,
    siteName: site.name,
    sourceName: site.sourceName,
    vodId: id,
    name,
    pic: str(raw.vod_pic ?? raw.pic ?? ''),
    remarks: str(raw.vod_remarks ?? raw.remarks ?? ''),
    year: str(raw.vod_year ?? raw.year ?? ''),
    area: str(raw.vod_area ?? raw.area ?? ''),
    typeName: str(raw.type_name ?? raw.class ?? ''),
    score: str(raw.vod_score ?? raw.score ?? ''),
    actor: str(raw.vod_actor ?? ''),
    director: str(raw.vod_director ?? ''),
  };
}

export function parseLines(from: string, url: string, note = ''): Line[] {
  const froms = (from ?? '').split('$$$');
  const groups = (url ?? '').split('$$$');
  const notes = (note ?? '').split('$$$');
  const lines: Line[] = [];
  groups.forEach((group, gi) => {
    const name = (froms[gi] || notes[gi] || `线路${gi + 1}`).trim();
    const episodes = [];
    for (const segment of group.split('#')) {
      const seg = segment.trim();
      if (!seg) continue;
      const split = seg.indexOf('$');
      const epName = split >= 0 ? seg.slice(0, split).trim() : '';
      const epUrl = split >= 0 ? seg.slice(split + 1).trim() : seg;
      if (!epUrl) continue;
      episodes.push({
        name: epName || `第${episodes.length + 1}集`,
        url: epUrl,
        index: episodes.length,
      });
    }
    if (episodes.length) lines.push({ name, episodes });
  });
  return lines;
}

async function searchSite(site: SiteRecord, wd: string): Promise<SearchItem[]> {
  const url = buildCmsUrl(site.api, { ac: 'detail', wd, pg: 1 });
  const { text } = await fetchText(url, {
    headers: siteHeaders(site),
    timeoutMs: Math.min((site.timeout ?? 10) * 1000, 12000),
  });
  let payload: Record<string, unknown>;
  try {
    payload = parseLooseJson<Record<string, unknown>>(text);
  } catch {
    if (/<rss|<video|<list/i.test(text)) throw new Error('XML 接口，暂不支持');
    if (/<html/i.test(text)) throw new Error('返回网页，接口可能失效');
    throw new Error('返回内容不是 JSON');
  }
  const list = Array.isArray(payload.list) ? (payload.list as Record<string, unknown>[]) : [];
  return list.map((raw) => cmsItemToSearchItem(raw, site)).filter((x): x is SearchItem => !!x);
}

export async function streamSearch(
  wd: string,
  sourceIds: string[] | null,
  emit: (e: SearchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  emit({ type: 'start', total: 0, sites: [] });
  const { sites, errors } = await loadSites();
  let enabled = settings.sources.filter((s) => s.enabled).map((s) => s.id);
  if (sourceIds && sourceIds.length) enabled = enabled.filter((id) => sourceIds.includes(id));
  const target = sites.filter((s) => enabled.includes(s.sourceId)).slice(0, 80);

  emit({
    type: 'start',
    total: target.length,
    sites: target.map((s) => ({ key: s.key, name: s.name, sourceName: s.sourceName })),
  });
  for (const e of errors) {
    emit({ type: 'site-error', siteKey: `source:${e.sourceId}`, siteName: e.name, error: e.error });
  }

  let failed = 0;
  let idx = 0;
  const concurrency = Math.min(10, target.length);
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (!signal.aborted) {
      const i = idx++;
      if (i >= target.length) return;
      const site = target[i];
      try {
        const items = await searchSite(site, wd);
        if (!signal.aborted) {
          emit({ type: 'results', siteKey: site.key, siteName: site.name, sourceName: site.sourceName, items });
        }
      } catch (err) {
        failed++;
        if (!signal.aborted) {
          emit({
            type: 'site-error',
            siteKey: site.key,
            siteName: site.name,
            error: (err as Error)?.message || '搜索失败',
          });
        }
      }
    }
  });
  await Promise.all(workers);
  if (!signal.aborted) emit({ type: 'done', total: target.length, failed });
}

export async function getDetail(siteKey: string, vodId: string): Promise<VodDetail> {
  const site = await getSite(siteKey);
  if (!site) throw new Error('资源站不存在或配置已变化，请重新搜索');
  const url = buildCmsUrl(site.api, { ac: 'detail', ids: vodId });
  const { text } = await fetchText(url, {
    headers: siteHeaders(site),
    timeoutMs: 20000,
  });
  const payload = parseLooseJson<Record<string, unknown>>(text);
  const list = Array.isArray(payload.list) ? (payload.list as Record<string, unknown>[]) : [];
  const raw = list[0];
  if (!raw) throw new Error('接口没有返回该影片详情');

  const base = cmsItemToSearchItem(raw, site);
  if (!base) throw new Error('详情数据不完整');
  const lines = parseLines(str(raw.vod_play_from), str(raw.vod_play_url), str(raw.vod_play_note)).filter((line) => {
    line.episodes = line.episodes.filter((ep) => /^https?:\/\//i.test(ep.url));
    return line.episodes.length > 0;
  });

  return {
    ...base,
    content: str(raw.vod_content ?? raw.vod_blurb ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    referer: suggestedReferer(site),
    lines,
  };
}

export async function testSource(url: string, name: string): Promise<SourceTestResult> {
  try {
    const parsed = await loadOneSource({ id: 'test', name: name || '测试接口', url });
    const usable = parsed.sites.filter((s) => s.searchable);
    return {
      ok: usable.length > 0,
      name: parsed.name,
      sites: parsed.sites.length,
      usable: usable.length,
      multiRepo: false,
      sample: usable.slice(0, 8).map((s) => s.name),
      error: usable.length ? undefined : '配置里没有可用的搜索站点',
    };
  } catch (err) {
    return {
      ok: false,
      name: name || '测试接口',
      sites: 0,
      usable: 0,
      multiRepo: false,
      sample: [],
      error: (err as Error)?.message || '测试失败',
    };
  }
}