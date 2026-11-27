# LeXiangTV · 飞影影视下载器

> **免责声明 / Disclaimer**
>
> 本仓库仅用于个人学习、研究与技术交流，请勿用于任何商业用途或违法行为。
>
> 本项目不提供、不托管、不存储任何影视资源，所有搜索结果均来自用户自行配置的第三方接口。
>
> **请于下载后 24 小时内删除相关文件，并支持正版内容。**
>
> 使用本项目所产生的一切后果由使用者自行承担，**本人不承担任何法律责任**。
>
> This project is for personal study and research only. No media content is provided or hosted.
> Please delete downloaded files within 24 hours and support the official release.
> The author assumes no legal responsibility for any use of this software.

一个部署在 NAS（如飞牛 OS / Debian）上的影视聚合搜索与 HLS(m3u8) 下载工具：

- 兼容 TVBox 单仓（`sites`）/ 多仓（`urls`）接口，也可直接填写苹果CMS 采集接口
- 聚合搜索电影、电视剧、综艺、动漫，支持多线路、多清晰度
- m3u8 分片并发下载，线程 1 - 64 可调
- 支持 AES-128 加密流、`EXT-X-MAP`（fMP4）、`BYTERANGE`
- 下载完成自动用 ffmpeg 合并为 MP4（无 ffmpeg 时回退为 TS 直接拼接）
- 任务暂停 / 继续 / 重试 / 重新解析，实时进度与速度
- 目录浏览与新建文件夹，下载路径自由选择
- 暗色现代简约 Web 界面，适配桌面与手机

## 技术栈

- 后端：Node.js 24 + TypeScript + Express 5
- 前端：React 19 + Vite + Tailwind CSS 4
- 合并：ffmpeg（`-c copy` 转封装，不重新编码，速度快）
- 存储：JSON 文件（配置 / 任务 / 分片），无数据库依赖

## 快速开始（本地）

要求：Node.js ≥ 24，建议安装 ffmpeg。

```bash
npm install
npm run build          # 前端 + 服务端打包到 dist/
DOWNLOAD_ROOTS=/path/to/media DATA_DIR=./data PORT=8099 node dist/server.mjs
```

开发模式：

```bash
npm run dev            # 后端 :8099
npm run dev:web        # 前端 :5173，自动代理 /api
```

首次启动会内置若干公开采集接口（可能失效），可在「设置」中增删、测试或一键添加推荐接口。

### 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 服务端口 | `8099` |
| `DATA_DIR` | 配置与任务数据目录 | `./data` |
| `DOWNLOAD_ROOTS` | 允许下载的根目录，多个用 `:`（Windows 用 `;`）分隔 | Windows `./downloads`，Linux `/media` |
| `HOST` | 监听地址 | `0.0.0.0` |

UI 中只能选择 `DOWNLOAD_ROOTS` 下的子目录，避免路径逃逸。

## Docker 部署（飞牛 OS 推荐）

```bash
# 在仓库目录中
MEDIA_DIR=/vol1/1000/影视 docker compose up -d --build
```

或在同目录创建 `.env`：

```env
MEDIA_DIR=/vol1/1000/影视
```

然后：

```bash
sudo docker compose up -d --build
```

访问 `http://NAS_IP:8099`。

> 仓库内已提交预构建的 `dist/`，因此无需在 NAS 上安装 Node 即可构建镜像。
> 修改源码后请先在本机执行 `npm run build`，再将新的 `dist/` 提交。

说明：

- `./data` 保存配置与任务，`MEDIA_DIR` 映射到容器内 `/media`
- 容器默认以 `1000:1001` 运行，请确保宿主机媒体目录对应用户可写；如遇权限问题可修改 `docker-compose.yml` 中的 `user`
- 镜像基于 `node:24-bookworm-slim`，构建时自动安装 ffmpeg

## 使用说明

1. **配置接口**：设置 → TBox 接口 → 添加。支持：
   - TVBox 单仓 JSON：`{"sites":[...]}`
   - TVBox 多仓 JSON：`{"urls":[...]}`（会展开所有子仓）
   - 直接填写苹果CMS 采集地址：`https://example.com/api.php/provide/vod`
   - 部分订阅可能失效，可点「测试」查看可用站点数
2. **搜索**：输入片名，结果会按接口流式返回；可按来源筛选。
3. **选集下载**：点开海报，选择线路（自动优先 m3u8 直链）、清晰度、线程，勾选剧集后「加入下载」。
4. **下载管理**：支持全部 / 单个暂停与继续；出错时可「重试」或「重新解析」（后者会丢弃已下载分片，适合链接过期）。
5. **合并输出**：默认输出 MP4；文件保存为 `下载目录/剧名/剧集.mp4`。

> 部分采集站返回的是“分享页”而非直链，这类线路会探测失败，换用带 `.m3u8` 的线路即可。

## 目录结构

```
server/          后端：接口聚合、HLS 解析、下载引擎、API
shared/          前后端共享类型
web/             React 前端
scripts/         构建脚本
Dockerfile       生产镜像
docker-compose.yml
```

## 常见问题

- **搜索无结果 / 大量站点失败**：接口失效或网络不可达，更换 TVBox 接口即可；可点「测试」确认。
- **合并失败**：确认 ffmpeg 可用（设置页会显示版本）；直播流（无 `EXT-X-ENDLIST`）不支持下载；SAMPLE-AES 加密不支持。
- **下载 403**：链接带时效，使用「重新解析」重新加入任务。
- **目录无法写入**：检查 Docker `user` 与宿主机目录权限。
- **本项目没有登录鉴权**：请仅在可信内网使用，不要直接暴露到公网。

## 致谢

- 参考了 [hgtuj5688/tvbox-desktop](https://github.com/hgtuj5688/tvbox-desktop) 对 TVBox 配置方言、苹果CMS 接口与多线路解析的整理思路。
- 图标来自 [Lucide](https://lucide.dev/)。

## License

[MIT](LICENSE) © 2026 wltj

再次提醒：**本仓库仅用于个人学习，请下载后 24 小时内删除，本人不承担任何法律责任。**