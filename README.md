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
- 兼容 TVBox 常见配置编码：Base64、图片隐写（JPEG/PNG 尾部）、FongMi `2423` AES 加密，使用 OkHttp UA 拉取
- 聚合搜索电影、电视剧、综艺、动漫，支持多线路、多清晰度
- m3u8 分片并发下载，线程 1 - 64 可调
- 支持 AES-128 加密流、`EXT-X-MAP`（fMP4）、`BYTERANGE`
- 下载完成自动用 ffmpeg 合并为 MP4（无 ffmpeg 时回退为 TS 直接拼接）
- 任务暂停 / 继续 / 重试 / 重新解析，实时进度与速度
- 目录浏览与新建文件夹，下载路径自由选择
- 智能导入：粘贴 TVBox 单仓/多仓地址，自动展开、实测并添加可用直连源
- 可作为飞牛 fnOS 原生应用（`.fpk`）安装，飞牛桌面图标直接打开
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

## 飞牛 OS 原生应用（推荐）

项目可直接打包为飞牛 fnOS 应用（`.fpk`），安装后出现在飞牛桌面，点开即在飞牛桌面窗口内使用，不走单独的 PC 网页。

### 安装

1. 在飞牛「应用中心」安装 **Node.js v22**（分类：开发工具），本项目依赖该运行时。
2. 下载 [release/lexiangtv-1.0.7.fpk](release/lexiangtv-1.0.4.fpk)，或自行构建（见下）。
3. 飞牛桌面 → 应用中心 → 右上角「设置」→「手动安装应用」，选择 `.fpk` 文件。
4. 安装完成后，飞牛桌面会出现「乐享TV」图标，点开即可使用。

应用通过飞牛统一网关（`/app/lexiangtv/` + `app.sock`）提供页面，同时监听 `8099` 端口，便于局域网内其他设备直接访问。

### 下载目录

- 安装时会创建应用共享目录：`/vol1/@appshare/lexiangtv/downloads`（文件管理可见），作为默认下载位置。
- 推荐在「应用中心 → 乐享TV → 应用设置 → 授权目录」中添加你的媒体文件夹，应用会自动读取 `TRIM_DATA_ACCESSIBLE_PATHS`。
- 若当前系统版本没有该入口，可用下面的备用方式（已验证）：先给应用用户授予目录 ACL，再写入 `extra-roots` 清单，然后重启应用。

```bash
# 以 /vol1/1000/影视 为例
sudo /usr/trim/bin/trimacl -m "a:u:$(id -u lexiangtv):rwxpdDaAeEcCo:sfd" "/vol1/1000/影视"
echo "/vol1/1000/影视" | sudo tee /vol1/@appconf/lexiangtv/extra-roots
sudo appcenter-cli stop lexiangtv && sudo appcenter-cli start lexiangtv
```

### 构建 fpk

```bash
npm install
npm run build:fpk        # 前端(base=/app/lexiangtv/) + 服务端 + 组装到 fpk/lexiangtv/app
cd fpk/lexiangtv
fnpack build             # 飞牛自带 fnpack，也可从官方开发者站下载
```

生成的 `lexiangtv.fpk` 可在应用中心手动安装。应用数据位于 `/vol1/@appdata/lexiangtv/data`，升级前建议备份。

> 说明：部分版本的应用中心通过 `appcenter-cli install-fpk` 覆盖安装时不会更新生命周期脚本。升级时可先备份 `/vol1/@appdata/lexiangtv`，卸载后重新安装；或手动替换 `/vol1/@appcenter/lexiangtv/server` 后重启应用。

## Docker 部署（可选）

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
1.5 **智能导入**：设置 → 智能导入接口 → 粘贴 TVBox 单仓/多仓地址 → 「解析并导入」，会自动展开子仓、在 NAS 上实测并添加可用直连源。
2. **搜索**：输入片名，结果会按接口流式返回；可按来源筛选。
3. **选集下载**：点开海报，选择线路（自动优先 m3u8 直链）、清晰度、线程，勾选剧集后「加入下载」。

> 当前内置推荐直连源：**非凡、魔都、红牛、360、创享、优质、淘片**（苹果CMS 直连）。
> 光速、量子、电影天堂、素博等源已失效或临时 403，默认停用。
> Spider（`csp_` / jar / dex）与 JS/Python 源需要 TVBox 的 Spider 运行环境，当前版本不支持。
4. **下载管理**：支持全部 / 单个暂停与继续；出错时可「重试」或「重新解析」（后者会丢弃已下载分片，适合链接过期）。
5. **合并输出**：默认输出 MP4；文件保存为 `下载目录/剧名/剧集.mp4`。

> 部分采集站返回的是“分享页”而非直链，这类线路会探测失败，换用带 `.m3u8` 的线路即可。

## 目录结构

```
server/          后端：接口聚合、HLS 解析、下载引擎、API
shared/          前后端共享类型
web/             React 前端
scripts/         构建脚本
fpk/lexiangtv/   飞牛 fnOS 应用包工程（含预构建 app/server）
release/         已构建的 .fpk 安装包
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