import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { build } from 'esbuild';

const root = process.cwd();
const outDir = path.join(root, 'dist-fpk');
const packApp = path.join(root, 'fpk', 'lexiangtv', 'app', 'server');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log('[fpk] 构建前端（base=/app/lexiangtv/）...');
execSync('npx vite build', {
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_BASE: '/app/lexiangtv/',
    VITE_OUT_DIR: path.join(outDir, 'public'),
  },
});

console.log('[fpk] 打包服务端...');
await build({
  entryPoints: ['server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(outDir, 'server.mjs'),
  logLevel: 'info',
  minify: false,
  sourcemap: false,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

console.log('[fpk] 组装应用文件...');
fs.rmSync(packApp, { recursive: true, force: true });
fs.mkdirSync(packApp, { recursive: true });
fs.copyFileSync(path.join(outDir, 'server.mjs'), path.join(packApp, 'server.mjs'));
fs.cpSync(path.join(outDir, 'public'), path.join(packApp, 'public'), { recursive: true });

console.log('[fpk] 完成，可用 fnpack 打包 fpk/lexiangtv');