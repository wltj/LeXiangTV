import fs from 'node:fs';
import { createApp } from './routes.ts';
import { initStore, tasks } from './store.ts';
import { initDownloader } from './downloader.ts';
import { loadSites } from './tvbox.ts';
import { ROOTS, DATA_DIR } from './paths.ts';

const PORT = Number(process.env.TCP_PORT || process.env.PORT) || 0;
const HOST = process.env.HOST || '0.0.0.0';
const SOCKET_PATH = process.env.SOCKET_PATH || '';

initStore();
await initDownloader();

const app = createApp();

if (SOCKET_PATH) {
  try {
    fs.rmSync(SOCKET_PATH, { force: true });
  } catch {
    // ignore
  }
  const server = app.listen(SOCKET_PATH, () => {
    try {
      fs.chmodSync(SOCKET_PATH, 0o777);
    } catch {
      // ignore
    }
    console.log(`[飞影] 统一网关 Socket: ${SOCKET_PATH}`);
  });
  server.on('error', (err) => {
    console.error('[飞影] Socket 监听失败', err);
  });
}

if (PORT) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`[飞影] 服务已启动: http://${HOST}:${PORT}`);
  });
  server.on('error', (err) => {
    console.error('[飞影] 端口监听失败（可能已被占用）', err);
  });
} else if (!SOCKET_PATH) {
  const fallback = 8099;
  app.listen(fallback, HOST, () => {
    console.log(`[飞影] 服务已启动: http://${HOST}:${fallback}`);
  });
}

console.log(`[飞影] 下载根目录: ${ROOTS.join(', ') || '(未配置)'}`);
console.log(`[飞影] 数据目录: ${DATA_DIR}`);
console.log(`[飞影] 任务数: ${tasks.length}`);
void loadSites().catch(() => undefined);

process.on('unhandledRejection', (err) => {
  console.error('[飞影] 未处理的 Promise 异常', err);
});