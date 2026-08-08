<p align="center">
  <img src="web/public/logo.svg" width="88" alt="影策 logo">
</p>

<h1 align="center">影策</h1>

<p align="center">让一个故事，从文字走向银幕</p>

<p align="center">
  <a href="https://github.com/ddcat-ai/open-ai-canvas"><img src="https://img.shields.io/github/stars/ddcat-ai/open-ai-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v1.0.43-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
</p>

一个故事也许始于一页小说、一个人物，或一句还没写完的对白。影策从章节中梳理角色与情节，让人物的外观、声音和气质成为可复用的角色资产，再把分镜、图片、视频和音频组织在同一张画布上。从最初的文字到可以被看见、被听见的镜头，创作者始终掌握故事的方向。

影策是一款面向 AI 影视与短剧创作的开源工作台，集成自由画布、结构化分镜、角色卡、3D 导演台、素材库、异步生成任务和 Agent 协作能力。

> 项目仍在快速开发，数据结构可能直接调整。当前更适合个人、本地或可信环境部署，不建议未经安全配置直接开放公网多人使用。

## 在线体验

- 临时演示环境：[https://ddcat.pronhubcn.com](https://ddcat.pronhubcn.com)
- 测试账号：`test`
- 测试密码：`test123456`
- 测试环境：[https://ai.ddcat.pro/login](https://ai.ddcat.pro/login)
- 代码仓库：[ddcat-ai/open-ai-canvas](https://github.com/ddcat-ai/open-ai-canvas)

## 赞助商

| LOGO | 类型 | 赞助商名称 | 说明 | 网站 |
| --- | --- | --- | --- | --- |
| <img src="assets/artdance.png" alt="ArtDance" width="160"> | 商业 | ArtDance | 本项目 Seedance 模型的天使投资人。 | [artbox.top](https://artbox.top) |
| <img src="assets/sponsor1.svg" alt="快乐机艺术小组" width="160"> | 团队 | 快乐机艺术小组 | 快乐机艺术小组，一支跨学科的艺术创作团队，持续探索数字+艺术的全新表达形式。 | 暂无 |

## 团队成员

| 头像 | 昵称 | 邮箱 | 个性签名 |
| --- | --- | --- | --- |
| <img src="assets/user-sikongyue.png" alt="爱笑的毛毛虫" width="80"> | 爱笑的毛毛虫<br><sub>用户名：sikongyue</sub> | [315515767@qq.com](mailto:315515767@qq.com) | 正在啃 main 分支，争取下次 merge 的时候变成蝴蝶 |
| <img src="assets/user-delve.jpg" alt="delve-s" width="80"> | delve-s | [3013141136@qq.com](mailto:3013141136@qq.com) | 我亦无他，惟手熟尔 |
| <img src="assets/user-CyrusAuyeung.jpg" alt="CyrusAuyeung" width="80"> | CyrusAuyeung | [cyrusauyeungho@gmail.com](mailto:cyrusauyeungho@gmail.com) | HKUST(GZ) UG |
| <img src="assets/user-nz.jpg" alt="奶大佬" width="80"> | 奶大佬 | [1304634970@qq.com](mailto:1304634970@qq.com) | 人生就是要不断的探索 |

## 主要功能

- **自由画布**：多项目、节点与连线、框选布局、撤销重做、小地图、导入导出和公开只读分享。
- **AI 生成**：支持文本、图片、视频和音频任务，以及参考图编辑、首尾帧、运镜、视频续写和局部修改。
- **影视工作流**：结构化分镜脚本、角色卡、批量镜头节点、3D 导演台和控制图回写。
- **任务与素材**：后端异步队列、任务日志、失败重试、素材库及登录后的后端同步。
- **Agent 能力**：网页画布助手、本地 Canvas Agent、Codex App 插件和技能库。
- **管理与安全**：用户与系统渠道、用量分析、私有 OSS、资源归属校验和敏感配置加密。

## 界面预览

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/login.png" alt="登录与注册" width="100%">
      <br><sub><b>登录与注册</b></sub>
    </td>
    <td width="50%" valign="top">
      <img src="assets/create.png" alt="AI 创作工作台" width="100%">
      <br><sub><b>AI 创作工作台</b></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="assets/project-detail.png" alt="短剧项目制作概览" width="100%">
      <br><sub><b>短剧项目制作概览</b></sub>
    </td>
    <td width="50%" valign="top">
      <img src="assets/canvas.png" alt="自由画布创作工作台" width="100%">
      <br><sub><b>自由画布创作工作台</b></sub>
    </td>
  </tr>
</table>

## 交流与反馈

感谢 [Linux.do 社区](https://linux.do/) 对项目的认可与支持，欢迎在社区参与讨论和分享使用体验。

Issue 反馈、技术讨论和产品升级建议都可以在 QQ 群中沟通。群内还会不定期组织 AI 学习与培训交流会。

<p align="center">
  <img src="assets/qq.jpg" alt="影策 QQ 交流群" width="360">
</p>

## 新服务器一键部署（推荐）

适用于刚买的 Linux 云服务器。准备一台 Ubuntu、Debian、CentOS 或 Rocky Linux 服务器，在云厂商防火墙（安全组）中先仅对自己的公网 IP 放行 TCP `3000` 端口，然后登录服务器执行这一条命令：

```bash
curl -fsSL https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/scripts/install-server.sh | sudo bash
```

脚本会自动安装 Docker 和 Docker Compose，把项目源码安装到 `/opt/open-ai-canvas`，生成随机数据库密码，在服务器本地构建网页与后端镜像，并启动网页、后端、PostgreSQL 和 Redis。该流程不依赖 GitHub Container Registry（GHCR）的匿名拉取权限；数据库和上传文件使用 Docker 数据卷持久保存，重新启动容器不会丢失。

完成后打开 `http://服务器IP:3000`。第一个注册的账号会自动成为管理员；登录后在系统设置中配置模型渠道即可开始使用。公开注册默认关闭，但不影响第一个管理员注册。

再次执行同一条命令即可拉取新代码并更新。常用排查命令：

```bash
cd /opt/open-ai-canvas
sudo docker compose --env-file .env -f docker-compose.deploy.yml -f docker-compose.build.yml ps
sudo docker compose --env-file .env -f docker-compose.deploy.yml -f docker-compose.build.yml logs -f --tail=200
```

首次部署需要下载构建依赖并编译前后端，耗时和资源占用会高于直接拉取镜像；后续更新会复用 Docker 构建缓存。需要固定代码版本时，可通过 `REPOSITORY_REF` 指定分支或标签。

### 直接使用 GitHub Packages 镜像

如果服务器不需要源码目录，可以使用只拉取 GitHub Container Registry（GHCR）镜像的快速脚本。脚本会下载部署 Compose 文件，不会 clone Git 仓库；首次执行仍会自动安装 Docker、生成 `/opt/open-ai-canvas/.env` 并启动全部服务：

```bash
curl -fsSL https://raw.githubusercontent.com/ddcat-ai/open-ai-canvas/main/scripts/install-server-image.sh | sudo bash
```

该快速脚本仍依赖 GHCR 容器包的可见性。容器包尚未公开时，必须先执行 `docker login ghcr.io`，或在直接运行脚本时提供 `GHCR_USERNAME` 和 `GHCR_TOKEN` 环境变量完成登录；未配置凭据时请使用上方推荐的源码构建脚本。默认使用 `latest` 标签，固定版本或修改端口可在首次执行后编辑 `/opt/open-ai-canvas/.env`，然后重新执行脚本。

部署配置和 PostgreSQL 密码保存在 `/opt/open-ai-canvas/.env`，不要发送给他人，也不要删除 `backend-data`、`postgres-data` 和 `redis-data` 数据卷。数据卷持久化不等于备份，请定期备份 PostgreSQL 和上传文件。直接使用 IP 访问仅适合首次配置；公网长期使用必须绑定域名并配置 HTTPS。

## 生产环境文本 SSE

文本任务事件流是登录态接口 `GET /api/tasks/:id/text-events`。它只发送当前用户有权限访问的文本任务增量，响应类型为 `text/event-stream`；事件 `delta` 的 `id` 是单调递增的文本序号，`terminal` 表示任务已经成功、失败或取消。生产反向代理必须对这一条路径关闭响应缓冲和缓存，并允许长时间读取；不要把这些设置复制到所有 `/api/` 请求上。

### Nginx

如果 Docker Compose 的网页容器暴露在本机 `3000` 端口，在 HTTPS server 中加入以下规则，并放在通用 `/api/` 规则之前。`proxy_pass` 也可以按你的部署拓扑改成实际网页入口；不要把后端 `8080` 直接暴露到公网。

```nginx
location ~ ^/api/tasks/[^/]+/text-events$ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

项目镜像内的 `nginx.conf` 已包含同等规则，并只对 `/api/tasks/<id>/text-events` 关闭缓冲。外层 Nginx 和镜像内 Nginx 都存在时，两层都要保留该路径的流式设置；任一层重新缓冲都会让浏览器看起来直到任务结束才收到增量。

### Caddy

Caddy 终止 HTTPS 后，将网页入口转发到 Compose 暴露的 `3000` 端口。`flush_interval -1` 让事件立即下发，长 `read_timeout` 防止长文本任务被网关主动断开：

```caddyfile
canvas.example.com {
    @textEvents path_regexp textEvents ^/api/tasks/[^/]+/text-events$
    reverse_proxy @textEvents 127.0.0.1:3000 {
        flush_interval -1
        transport http {
            read_timeout 1h
        }
        header_up X-Forwarded-Proto {scheme}
        header_down Cache-Control "no-cache, no-transform"
    }

    reverse_proxy 127.0.0.1:3000
}
```

HTTPS 不是可选项：事件流使用登录 Cookie，用户配置的模型凭据也会参与请求；公网浏览器到反向代理的链路必须使用 HTTPS，并保留 `Host`、`X-Forwarded-For` 和 `X-Forwarded-Proto`。反向代理到网页容器可以使用隔离的 Compose 内网 HTTP。不要通过放宽 CORS、关闭鉴权或把 `Last-Event-ID` 放进 URL 来解决断线问题。

### Docker 与健康检查

`docker-compose.deploy.yml` / `docker-compose.server.yml` 只需要对外暴露网页容器的 `3000`；后端 `8080` 留在 Compose 网络内。部署后先确认容器健康：

```bash
sudo docker compose --env-file .env -f docker-compose.deploy.yml -f docker-compose.build.yml ps
curl -fsS https://canvas.example.com/api/health
```

网页容器和后端镜像都带健康检查：网页检查 `/`，后端检查 `/api/health`。健康检查只能证明 HTTP 入口可用，不能证明代理正在逐事件转发；SSE 仍需按下面的命令验证。

### 断线恢复与排障

客户端重连时可以发送 `Last-Event-ID: <最后收到的序号>`，也可以使用 `?after=<序号>`；查询参数优先。服务端只返回 `sequence > after` 的 `delta`，因此同一段文本不会因为重连重复拼接。游标来自 SSE `id`，不是任务 ID。成功任务的增量保留 24 小时，失败或取消任务保留 7 天；超出保留期时应读取任务详情中的最终正文或失败草稿。

在已登录浏览器中复制 `open_ai_canvas_session` Cookie 后，可用 `curl -N` 检查首字节和增量是否在任务运行期间到达：

```bash
curl -N --http1.1 \
  -H 'Accept: text/event-stream' \
  -H 'Last-Event-ID: 0' \
  -b 'open_ai_canvas_session=<登录 Cookie>' \
  'https://canvas.example.com/api/tasks/<task-id>/text-events'
```

正常输出会先出现 `: connected`，随后是带 `id` 的 `event: delta`，最后是 `event: terminal`。如果只在任务结束后一次性出现全部内容，检查每一层是否仍有 `proxy_buffering on`、缓存规则或 gzip；如果长时间没有任何字节，检查 `proxy_read_timeout`、HTTPS 连接和后端容器日志。该排障命令只针对文本事件流，其他 API 仍使用默认缓存、安全和超时策略。

## 本地开发

需要 Bun、Go 和可用的 OpenAI 兼容模型渠道。

```bash
git clone https://github.com/ddcat-ai/open-ai-canvas.git
cd open-ai-canvas
```

后端开发数据统一保存在 Git 忽略的 `.local/project-workbench-debug`。启动前先检查该目录，不要改用 `backend/data` 或其他目录；仅在确认本机没有既有开发数据时创建：

```bash
if [ -d .local/project-workbench-debug ]; then
  find .local/project-workbench-debug -maxdepth 1 -type f -name 'open_ai_canvas.db*' -ls
else
  mkdir -p .local/project-workbench-debug
fi
mkdir -p .local/cache/go-build .local/cache/go-mod
```

直接在宿主机开发：

```bash
cd backend
CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server

# 另开终端
cd web
bun install
bun run dev
```

打开 `http://localhost:3000`，注册首个管理员账号，再在系统设置中配置渠道和模型。

资源配额、Worker/渠道/账号任务并发、业务频控、任务超时和渠道中转策略可在“系统配置 → 资源与策略”中统一热更新，支持重置和自用模式；系统渠道可选择跟随全局值，或单独设置 `1-999` 的最大并发数。未保存后台配置时 Worker 和全局渠道并发分别回退到 `CANVAS_WORKER_CONCURRENCY` 和 `CANVAS_CHANNEL_CONCURRENCY`，两者默认均为 `3`。渠道槽位暂满时任务会等待，不会直接标记失败。

Docker 热更新开发：

```bash
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) docker compose -f docker-compose.dev.yml up --build
```

前端通过 Vite HMR 更新，后端由 Air 在 Go 源码或模块文件变化后重新编译。前端地址为 `http://localhost:3000`，局域网设备可通过 `http://<开发机 IP>:3000` 访问；后端 `8080` 端口只开放给开发机本机，浏览器 API 请求统一由 Vite 转发。

宿主机端口冲突时可通过 `CANVAS_WEB_HOST_PORT` 和 `CANVAS_BACKEND_HOST_PORT` 覆盖默认的 3000/8080；建议把本机取值写入 Git 忽略的 `.local/docker-compose.dev.env`，并在 Compose 命令中使用 `--env-file .local/docker-compose.dev.env`。Go 模块和编译缓存保存在 `.local/cache`，重建容器不会重复完整冷编译。

后端默认通过 SSRF 防护拒绝本机、私网和链路本地上游。开发环境需要连接可信局域网模型服务时，在 `.local/docker-compose.dev.env` 中使用 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=192.168.1.10` 精确放行；只填写主机名或 IP，多个值用英文逗号分隔，不包含协议、端口和路径。精确白名单中的自定义渠道可使用 HTTP，但 API Key 会在后端到上游的链路中明文传输，仅限可信网络；其他自定义渠道仍要求 HTTPS。保持 `CANVAS_ALLOW_PRIVATE_UPSTREAMS=false`，避免放行所有私网目标。

Docker 一体化运行（静态前端和 release 后端，不提供源码热更新）：

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## 数据说明

- 用户自定义 AI API Key 保存在浏览器本地；登录态拉取模型目录时会临时提交给自部署后端但不会保存，创建异步任务时会加密入队；仅应使用可信部署，生产环境必须启用 HTTPS。
- 画布和素材登录后同步到后端，本地 `localForage` 继续承担缓存和降级存储。
- 媒体资源在启用 OSS 时保存到私有 OSS，否则保存到后端数据目录；删除业务记录不会自动清理 OSS 对象。
- 用户主动上传、Agent 会话附件和 AI 生成资源的单文件上限、账号容量及 UTC 日上传总量由后台“资源与策略”统一维护，默认分别为 50MB、32MB、64MB、2GB 和 200MB；管理员可按可信部署需要调整，单文件业务上限最高 999MB，Nginx 请求体硬上限为 1024MB。

## 公网部署安全

- 服务首次启动后应先在受控网络完成首个管理员注册，再开放公网入口。
- 生产环境保持 `CANVAS_REGISTRATION_ENABLED=false`，确需开放注册时应同时配置系统渠道用量预算。
- `CANVAS_CORS_ORIGINS` 必须设置为实际前端 Origin 列表，不要在公网使用 `*`。
- 后端和前端必须通过 HTTPS 提供服务，并限制数据目录、数据库、备份和 `.settings-key` 的访问权限。

## 项目文件

- [更新日志](CHANGELOG.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [上游与第三方声明](NOTICE)
- [本地 Canvas Agent](canvas-agent/README.md)
- [Codex App 插件](plugins/infinite-canvas/README.md)

## 上游致谢与二次开发

本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) `v0.5.0`（提交 `568f0f1838df8de31fe885a4e130e2f346dd14ab`）进行二次开发。上游项目由 `basketikun` 维护，该基线提交作者为 `HouYunFei`；上游作者和贡献者继续保留其对应代码的权利与署名。

漏洞请按 [SECURITY.md](SECURITY.md) 提交。项目采用 [AGPL-3.0](LICENSE) 协议。
