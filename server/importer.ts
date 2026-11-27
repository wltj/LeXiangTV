import crypto from 'node:crypto';
import type { ImportJobSnapshot, ImportSiteResult, SourceConfig } from '../shared/types.ts';
import { settings, saveSettings } from './store.ts';
import { buildCmsUrl, collectSitesFromConfig, loadSites, parseLines, siteHeaders } from './tvbox.ts';
import type { SiteRecord } from './tvbox.ts';
import { fetchText, parseLooseJson } from './http.ts';

interface ImportJobInternal extends ImportJobSnapshot {
  cancel: boolean;
}

const jobs = new Map<string, ImportJobInternal>();

const TEST_KEYWORDS = ['流浪地球', '庆余年'];
const CONCURRENCY = 8;
const REQUEST_TIMEOUT = 10000;
const MAX_SITES = 120;
const MAX_ADD = 12;

const BLOCKED_NAME =
  /(成人|色情|情色|色欲|老色|麻豆|探花|约炮|里番|无码|中出|自拍|巨乳|学生妹|少妇|福利姬|外围|楼凤|海角|黑料|91视频|成人片|av女|艾旦|lovedan)/i;

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function apiKey(api: string): string {
  try {
    const u = new URL(api);
    for (const k of ['ac', 'wd', 'pg', 'ids', 'at']) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/+$/, '');
    const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const qs = new URLSearchParams(params).toString();
    const host = u.host.toLowerCase().replace(/^www\./, '');
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return api.replace(/\/+$/, '').toLowerCase();
  }
}

function cleanApiUrl(api: string): string {
  try {
    const u = new URL(api);
    for (const k of ['ac', 'wd', 'pg', 'ids', 'at']) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, '');
  } catch {
    return api;
  }
}

function cleanSourceName(name: string, api: string): string {
  const cleaned = name
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .replace(/^\d+\s*[-、.．]\s*/, '');
  const generic = /^(导入接口|导入源|接口|test|测试)$/i.test(cleaned);
  if (cleaned && !generic) return cleaned;
  try {
    return new URL(api).hostname.replace(/^www\./, '').slice(0, 24);
  } catch {
    return '导入源';
  }
}

function uniqueSourceName(base: string, existing: SourceConfig[]): string {
  const names = new Set(existing.map((s) => s.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; i < 50; i++) {
    const candidate = `${base} ${i}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now() % 1000}`;
}

async function searchList(
  api: string,
  keyword: string,
  headers: Record<string, string>,
  ac: 'detail' | 'videolist',
): Promise<Record<string, unknown>[]> {
  const url = buildCmsUrl(api, { ac, wd: keyword, pg: 1 });
  const { text } = await fetchText(url, { headers, timeoutMs: REQUEST_TIMEOUT });
  const payload = parseLooseJson<Record<string, unknown>>(text);
  return Array.isArray(payload.list) ? (payload.list as Record<string, unknown>[]) : [];
}

async function fetchDetail(
  api: string,
  id: string,
  headers: Record<string, string>,
): Promise<{ m3u8: number; httpLinks: number }> {
  const url = buildCmsUrl(api, { ac: 'detail', ids: id });
  const { text } = await fetchText(url, { headers, timeoutMs: REQUEST_TIMEOUT });
  const payload = parseLooseJson<Record<string, unknown>>(text);
  const item = Array.isArray(payload.list)
    ? (payload.list[0] as Record<string, unknown> | undefined)
    : undefined;
  if (!item) return { m3u8: 0, httpLinks: 0 };
  const lines = parseLines(String(item.vod_play_from ?? ''), String(item.vod_play_url ?? ''));
  let m3u8 = 0;
  let httpLinks = 0;
  for (const line of lines) {
    for (const ep of line.episodes) {
      if (!/^https?:\/\//i.test(ep.url)) continue;
      httpLinks++;
      if (/\.m3u8/i.test(ep.url)) m3u8++;
    }
  }
  return { m3u8, httpLinks };
}

async function testSite(
  site: SiteRecord,
  keywords: string[],
): Promise<Pick<ImportSiteResult, 'ok' | 'm3u8' | 'httpLinks' | 'searchOk' | 'ms' | 'error'>> {
  const api = cleanApiUrl(site.api);
  const headers = siteHeaders(site);
  const started = Date.now();
  let searchOk = 0;
  let lastError = '';

  for (const keyword of keywords) {
    if (Date.now() - started > 45000) break;
    try {
      let list = await searchList(api, keyword, headers, 'detail');
      if (!list.length) list = await searchList(api, keyword, headers, 'videolist');
      if (!list.length) {
        lastError = '搜索无结果';
        continue;
      }
      searchOk++;
      const item = list.find((x) => x.vod_id !== undefined) ?? list[0];
      const id = String(item.vod_id ?? '');
      if (!id) {
        lastError = '搜索结果缺少 vod_id';
        continue;
      }
      const detail = await fetchDetail(api, id, headers);
      if (detail.m3u8 > 0) {
        return {
          ok: true,
          m3u8: detail.m3u8,
          httpLinks: detail.httpLinks,
          searchOk,
          ms: Date.now() - started,
          error: '',
        };
      }
      lastError = `详情 ${detail.httpLinks} 个链接 / 0 个 m3u8`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }

  return {
    ok: false,
    m3u8: 0,
    httpLinks: 0,
    searchOk,
    ms: Date.now() - started,
    error: lastError || '未找到可用 m3u8',
  };
}

function snapshot(job: ImportJobInternal): ImportJobSnapshot {
  const { cancel: _cancel, ...rest } = job;
  return JSON.parse(JSON.stringify(rest)) as ImportJobSnapshot;
}

async function runImport(job: ImportJobInternal): Promise<void> {
  try {
    job.phase = '加载配置与多仓子接口';
    const sites = await collectSitesFromConfig(job.url, '导入接口');

    const seenApis = new Set<string>();
    const unique: SiteRecord[] = [];
    for (const site of sites) {
      const key = apiKey(site.api);
      if (seenApis.has(key)) continue;
      seenApis.add(key);
      unique.push(site);
      if (unique.length >= MAX_SITES) break;
    }

    job.total = unique.length;
    job.status = 'testing';
    job.phase = `已提取 ${unique.length} 个直连站，开始测试`;
    if (!unique.length) {
      job.errors.push('没有提取到直连采集站（配置可能全部是 Spider/加密源或已失效）');
      job.status = 'error';
      return;
    }

    const existingApis = new Set(settings.sources.map((s) => apiKey(s.url)));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
      while (true) {
        if (job.cancel || cursor >= unique.length) return;
        const site = unique[cursor++];
        const name = cleanSourceName(site.name, site.api);
        const key = apiKey(site.api);

        if (existingApis.has(key)) {
          job.results.push({
            name,
            api: cleanApiUrl(site.api),
            ok: false,
            added: false,
            m3u8: 0,
            httpLinks: 0,
            searchOk: 0,
            ms: 0,
            skipped: true,
            reason: '已在配置中',
          });
          job.tested++;
          continue;
        }

        if (BLOCKED_NAME.test(site.name) || BLOCKED_NAME.test(site.api)) {
          job.results.push({
            name,
            api: cleanApiUrl(site.api),
            ok: false,
            added: false,
            m3u8: 0,
            httpLinks: 0,
            searchOk: 0,
            ms: 0,
            skipped: true,
            reason: '疑似成人/不适内容，已跳过',
          });
          job.tested++;
          continue;
        }

        const tested = await testSite(site, TEST_KEYWORDS);
        job.tested++;
        job.results.push({
          name,
          api: cleanApiUrl(site.api),
          added: false,
          ...tested,
        });
      }
    });
    await Promise.all(workers);

    if (job.cancel) {
      job.status = 'cancelled';
      job.phase = '已取消';
      return;
    }

    job.status = 'done';
    job.phase = '测试完成';

    if (job.autoAdd) {
      const candidates = job.results
        .filter((r) => r.ok && !r.skipped && !r.added)
        .sort((a, b) => b.m3u8 - a.m3u8 || a.ms - b.ms)
        .slice(0, MAX_ADD);

      if (candidates.length) {
        const sources = [...settings.sources];
        const newSources: SourceConfig[] = [];
        for (const r of candidates) {
          const key = apiKey(r.api);
          if (sources.some((s) => apiKey(s.url) === key)) continue;
          const source: SourceConfig = {
            id: `import-${shortHash(key)}`,
            name: uniqueSourceName(r.name, [...sources, ...newSources]),
            url: cleanApiUrl(r.api),
            enabled: true,
          };
          newSources.push(source);
          r.added = true;
        }
        if (newSources.length) {
          saveSettings({ sources: [...sources, ...newSources] });
          job.added = newSources;
          void loadSites(true).catch(() => undefined);
        }
      }
    }

    job.results.sort((a, b) => {
      if (a.added !== b.added) return a.added ? -1 : 1;
      if (!!a.skipped !== !!b.skipped) return a.skipped ? 1 : -1;
      if (a.ok !== b.ok) return a.ok ? -1 : 1;
      return b.m3u8 - a.m3u8 || a.ms - b.ms;
    });
  } catch (err) {
    job.status = 'error';
    job.phase = '导入失败';
    job.errors.push((err as Error)?.message || '导入失败');
  } finally {
    job.finishedAt = Date.now();
    setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref?.();
  }
}

export function startImport(url: string, autoAdd: boolean): ImportJobSnapshot {
  const cleaned = url.trim();
  if (!/^https?:\/\//i.test(cleaned)) throw new Error('请填写 http/https 接口地址');
  const job: ImportJobInternal = {
    id: crypto.randomUUID(),
    url: cleaned,
    status: 'loading',
    phase: '准备中',
    total: 0,
    tested: 0,
    autoAdd,
    results: [],
    added: [],
    errors: [],
    startedAt: Date.now(),
    cancel: false,
  };
  jobs.set(job.id, job);
  void runImport(job);
  return snapshot(job);
}

export function getImportJob(id: string): ImportJobSnapshot | null {
  const job = jobs.get(id);
  return job ? snapshot(job) : null;
}

export function cancelImportJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancel = true;
  job.phase = '正在取消...';
  return true;
}