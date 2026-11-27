import { createApp } from './routes.ts';
import { initStore, tasks } from './store.ts';
import { initDownloader } from './downloader.ts';
import { loadSites } from './tvbox.ts';
import { ROOTS, DATA_DIR } from './paths.ts';

const PORT = Number(process.env.PORT) || 8099;
const HOST = process.env.HOST || '0.0.0.0';

initStore();
await initDownloader();

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`[飞影] 服务已启动: http://${HOST}:${PORT}`);
  console.log(`[飞影] 下载根目录: ${ROOTS.join(', ')}`);
  console.log(`[飞影] 数据目录: ${DATA_DIR}`);
  console.log(`[飞影] 任务数: ${tasks.length}`);
  void loadSites().catch(() => undefined);
});

process.on('unhandledRejection', (err) => {
  console.error('[飞影] 未处理的 Promise 异常', err);
});