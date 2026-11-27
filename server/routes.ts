import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import type { AppSettings, CreateTaskInput, SearchEvent } from '../shared/types.ts';
import { DATA_DIR, ROOTS, listDirs, makeDir, resolveInRoot } from './paths.ts';
import { settings, saveSettings, tasks, getPresets, bus } from './store.ts';
import { getDetail, loadSites, siteHeaders, streamSearch, testSource, suggestedReferer, getSite } from './tvbox.ts';
import { probeUrl } from './hls.ts';
import {
  createTasks,
  deleteTask,
  getFfmpegInfo,
  pauseAll,
  pauseTask,
  resumeAll,
  resumeTask,
  retryTask,
} from './downloader.ts';
import { fetchRaw } from './http.ts';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  const gatewayPrefix = (process.env.GATEWAY_PREFIX || '').replace(/\/+$/, '');
  if (gatewayPrefix) {
    app.use((req, _res, next) => {
      const url = req.url;
      if (url === gatewayPrefix || url.startsWith(`${gatewayPrefix}/`) || url.startsWith(`${gatewayPrefix}?`)) {
        const rest = url.slice(gatewayPrefix.length);
        req.url = rest === '' ? '/' : rest.startsWith('?') ? `/${rest}` : rest;
      }
      next();
    });
  }

  app.use(express.json({ limit: '4mb' }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/settings', (_req, res) => {
    res.json({
      ...settings,
      env: {
        roots: ROOTS,
        dataDir: DATA_DIR,
        ffmpeg: getFfmpegInfo(),
        platform: process.platform,
        version: '1.0.0',
      },
    });
  });

  app.put('/api/settings', (req, res) => {
    const patch = req.body as Partial<AppSettings>;
    const next = saveSettings(patch);
    void loadSites(true).catch(() => undefined);
    res.json(next);
  });

  app.get('/api/presets', (_req, res) => {
    res.json({ presets: getPresets() });
  });

  app.post('/api/sources/test', async (req, res) => {
    const { url, name } = req.body ?? {};
    if (!url || !/^https?:\/\//i.test(String(url))) {
      res.status(400).json({ error: '请填写 http/https 接口地址' });
      return;
    }
    const result = await testSource(String(url), String(name ?? ''));
    res.json(result);
  });

  app.get('/api/sites', async (_req, res) => {
    const { sites, errors } = await loadSites();
    res.json({
      sites: sites.map((s) => ({
        key: s.key,
        name: s.name,
        sourceId: s.sourceId,
        sourceName: s.sourceName,
        api: s.api,
      })),
      errors,
    });
  });

  app.get('/api/search/stream', async (req: Request, res: Response) => {
    const wd = String(req.query.wd ?? '').trim();
    if (!wd) {
      res.status(400).json({ error: '缺少搜索关键词' });
      return;
    }
    const sourcesParam = String(req.query.sources ?? '').trim();
    const sourceIds = sourcesParam ? sourcesParam.split(',').filter(Boolean) : null;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const abort = new AbortController();
    let closed = false;
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 15000);

    const send = (e: SearchEvent | { type: 'fatal'; error: string }) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    };

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      abort.abort();
    });

    try {
      await streamSearch(wd, sourceIds, send, abort.signal);
    } catch (err) {
      send({ type: 'fatal', error: (err as Error)?.message || '搜索失败' });
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  });

  app.get('/api/detail', async (req, res) => {
    const site = String(req.query.site ?? '');
    const id = String(req.query.id ?? '');
    if (!site || !id) {
      res.status(400).json({ error: '缺少站点或影片 id' });
      return;
    }
    try {
      const detail = await getDetail(site, id);
      res.json(detail);
    } catch (err) {
      res.status(502).json({ error: (err as Error)?.message || '获取详情失败' });
    }
  });

  app.post('/api/probe', async (req, res) => {
    const { url, referer, siteKey } = req.body ?? {};
    if (!url || !/^https?:\/\//i.test(String(url))) {
      res.status(400).json({ error: '请填写 http/https 视频地址' });
      return;
    }
    try {
      const site = siteKey ? await getSite(String(siteKey)) : undefined;
      const headers = site ? siteHeaders(site) : { 'User-Agent': settings.userAgent };
      const ref = String(referer || '') || suggestedReferer(site);
      if (ref) headers.Referer = ref;
      const probe = await probeUrl(String(url), headers);
      res.json({ ...probe, referer: ref });
    } catch (err) {
      res.status(502).json({ error: (err as Error)?.message || '探测失败' });
    }
  });

  app.get('/api/img', async (req, res) => {
    const raw = String(req.query.url ?? '');
    if (!raw || !/^https?:\/\//i.test(raw)) {
      res.status(400).end();
      return;
    }
    try {
      const u = new URL(raw);
      if (isPrivateHost(u.hostname)) {
        res.status(403).end();
        return;
      }
      const headers: Record<string, string> = { 'User-Agent': settings.userAgent };
      const ref = String(req.query.ref ?? '');
      if (ref) headers.Referer = ref;
      const out = await fetchRaw(raw, { headers, timeoutMs: 15000 });
      if (!/^image\//i.test(out.contentType) || out.buffer.length > 15 * 1024 * 1024) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', out.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(out.buffer);
    } catch {
      res.status(404).end();
    }
  });

  app.get('/api/tasks', (_req, res) => {
    res.json({ tasks });
  });

  app.post('/api/tasks', (req, res) => {
    const body = req.body ?? {};
    const inputs: CreateTaskInput[] = Array.isArray(body.items) ? body.items : [body];
    try {
      const created = createTasks(inputs);
      res.json({ tasks: created });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || '创建任务失败' });
    }
  });

  app.post('/api/tasks/bulk', (req, res) => {
    const action = String(req.body?.action ?? '');
    if (action === 'pause') pauseAll();
    else if (action === 'resume') resumeAll();
    else {
      res.status(400).json({ error: '未知操作' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/tasks/:id/pause', (req, res) => {
    pauseTask(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/tasks/:id/resume', (req, res) => {
    resumeTask(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/tasks/:id/retry', async (req, res) => {
    await retryTask(req.params.id, Boolean(req.body?.fresh));
    res.json({ ok: true });
  });

  app.delete('/api/tasks/:id', async (req, res) => {
    const deleteFile = String(req.query.file ?? '') === '1';
    await deleteTask(req.params.id, deleteFile);
    res.json({ ok: true });
  });

  app.get('/api/fs', async (req, res) => {
    const root = String(req.query.root ?? ROOTS[0] ?? '');
    const rel = String(req.query.path ?? '');
    if (!ROOTS.includes(root)) {
      res.status(400).json({ error: '根目录无效' });
      return;
    }
    try {
      resolveInRoot(root, rel);
      const dirs = await listDirs(root, rel);
      res.json({ roots: ROOTS, root, rel, dirs });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || '读取目录失败' });
    }
  });

  app.post('/api/fs/mkdir', async (req, res) => {
    const { root, path: rel } = req.body ?? {};
    if (!ROOTS.includes(String(root))) {
      res.status(400).json({ error: '根目录无效' });
      return;
    }
    try {
      await makeDir(String(root), String(rel ?? ''));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || '创建目录失败' });
    }
  });

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    let closed = false;
    let timer: NodeJS.Timeout | null = null;

    const send = () => {
      if (closed) return;
      res.write(`data: ${JSON.stringify({ tasks })}\n\n`);
    };

    const onChange = () => {
      if (timer || closed) return;
      timer = setTimeout(() => {
        timer = null;
        send();
      }, 400);
    };

    send();
    bus.on('tasks', onChange);
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 20000);

    req.on('close', () => {
      closed = true;
      if (timer) clearTimeout(timer);
      clearInterval(heartbeat);
      bus.off('tasks', onChange);
    });
  });

  const baseDir = import.meta.dirname ?? process.cwd();
  const publicDir = [path.join(baseDir, 'public'), path.join(baseDir, '..', 'dist', 'public')].find((p) =>
    fs.existsSync(p),
  ) ?? path.join(baseDir, 'public');
  app.use(
    express.static(publicDir, {
      index: 'index.html',
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      const indexFile = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
        return;
      }
    }
    next();
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api]', err);
    res.status(500).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal')) return true;
  if (!net.isIP(h)) return false;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  if (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('0.')) return true;
  if (h.startsWith('192.168.') || h.startsWith('169.254.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}