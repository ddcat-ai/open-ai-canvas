<p align="center">
  <img src="web/public/logo.svg" width="88" alt="无限画布 logo">
</p>

<h1 align="center">无限画布</h1>

<p align="center">面向 AI 影视创作的开源画布工作台</p>

<p align="center">
  <a href="https://github.com/ddcat-ai/open-ai-canvas"><img src="https://img.shields.io/github/stars/ddcat-ai/open-ai-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="VERSION"><img src="https://img.shields.io/badge/version-v1.0.4-2563eb?style=flat-square" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
</p>

无限画布把节点编排、图片/视频/音频生成、结构化分镜、3D 导演台、素材库、异步任务和 Agent 会话放在同一个创作空间中，适合连续探索视觉方案并沉淀影视资产。

> 项目仍在快速开发，数据结构可能直接调整。当前更适合个人、本地或可信环境部署，不建议未经安全配置直接开放公网多人使用。

## 在线体验

- 测试环境：[https://ai.ddcat.pro/login](https://ai.ddcat.pro/login)
- 代码仓库：[ddcat-ai/open-ai-canvas](https://github.com/ddcat-ai/open-ai-canvas)

## 主要功能

- **无限画布**：多项目、节点与连线、框选布局、撤销重做、小地图、导入导出和公开只读分享。
- **AI 生成**：支持文本、图片、视频和音频任务，以及参考图编辑、首尾帧、运镜、视频续写和局部修改。
- **影视工作流**：结构化分镜脚本、角色卡、批量镜头节点、3D 导演台和控制图回写。
- **任务与素材**：后端异步队列、任务日志、失败重试、素材库及登录后的后端同步。
- **Agent 能力**：网页画布助手、本地 Canvas Agent、Codex App 插件和技能库。
- **管理与安全**：用户与系统渠道、用量分析、私有 OSS、资源归属校验和敏感配置加密。

## 界面预览

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="assets/login.png" alt="登录与注册" width="100%">
      <br><sub><b>登录与注册</b></sub>
    </td>
    <td width="33%" valign="top">
      <img src="assets/huabu.png" alt="画布项目管理" width="100%">
      <br><sub><b>画布项目管理</b></sub>
    </td>
    <td width="33%" valign="top">
      <img src="assets/huabu-info.png" alt="画布创作工作台" width="100%">
      <br><sub><b>画布创作工作台</b></sub>
    </td>
  </tr>
  <tr>
    <td width="33%" valign="top">
      <img src="assets/backend.png" alt="运维管理后台" width="100%">
      <br><sub><b>运维管理后台</b></sub>
    </td>
    <td width="33%"></td>
    <td width="33%"></td>
  </tr>
</table>

## 交流与反馈

感谢 [Linux.do 社区](https://linux.do/) 对项目的认可与支持，欢迎在社区参与讨论和分享使用体验。

Issue 反馈、技术讨论和产品升级建议都可以在 QQ 群中沟通。群内还会不定期组织 AI 学习与培训交流会。

<p align="center">
  <img src="assets/qq.jpg" alt="无限画布 QQ 交流群" width="360">
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

## 本地开发

需要 Bun、Go 和可用的 OpenAI 兼容模型渠道。

```bash
git clone https://github.com/ddcat-ai/open-ai-canvas.git
cd open-ai-canvas

cd backend
go run ./cmd/server

# 另开终端
cd web
bun install
bun run dev
```

打开 `http://localhost:3000`，注册首个管理员账号，再在系统设置中配置渠道和模型。

任务 Worker 和全局渠道并发可在“系统配置 → 任务并发”中热更新；系统渠道可选择跟随全局值，或单独设置 `1-100` 的最大并发数。未保存后台配置时分别回退到 `CANVAS_WORKER_CONCURRENCY` 和 `CANVAS_CHANNEL_CONCURRENCY`，两者默认均为 `3`。渠道槽位暂满时任务会等待，不会直接标记失败。

Docker 一体化运行：

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## 数据说明

- 用户自定义 AI API Key 保存在浏览器本地；创建异步任务时会提交给自部署后端并加密入队，生产环境必须使用 HTTPS。
- 画布和素材登录后同步到后端，本地 `localForage` 继续承担缓存和降级存储。
- 媒体资源在启用 OSS 时保存到私有 OSS，否则保存到后端数据目录；删除业务记录不会自动清理 OSS 对象。
- 用户主动上传的单个文件必须小于 50MB，每个账号按 UTC 自然日累计必须小于 200MB；AI 生成结果不计入主动上传额度。

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

当前二次开发由 `ddcat` 维护，主要改动包括：

- 新增 Go/Gin/GORM/PostgreSQL/SQLite 多用户后端、登录会话、管理员后台、异步任务中心和用量分析。
- 新增私有 OSS、后端资源存储、跨设备画布与素材同步、公开只读分享和资源归属校验。
- 扩展文本、图片、视频和音频生成，增加影视分镜、短剧流水线、角色参考与 3D 导演台。
- 重构画布工作区、交互状态和 Aceternity 风格空间 UI，并增强 Canvas Agent 与 Codex App 插件。
- 收敛上游代理、任务密钥、上传额度、日志脱敏和公网部署安全边界。

漏洞请按 [SECURITY.md](SECURITY.md) 提交。项目采用 [AGPL-3.0](LICENSE) 协议。
