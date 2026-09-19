# Open AI Canvas 裸机部署

这套部署与 `/root/yingpix` 完全分开。它不使用 Docker，不复用 yingpix 的程序目录、数据库、systemd 服务或 Caddy 站点。

## 部署坐标

| 项目 | 值 |
| --- | --- |
| 私有仓库 | `kinoko-shelter/open-ai-canvas`，分支 `main` |
| 服务器 | `root@154.36.173.216` |
| 代码目录 | `/root/open-ai-canvas` |
| 运维目录 | `/root/open-ai-canvas-ops` |
| 发布目录 | `/opt/open-ai-canvas/releases/<UTC>-<commit>` |
| 当前/上一版本 | `/opt/open-ai-canvas/current` / `/opt/open-ai-canvas/previous` |
| 服务用户 | `openaicanvas` |
| 后端服务 | `open-ai-canvas-backend.service`，监听 `127.0.0.1:8080` |
| 前端服务 | `open-ai-canvas-web.service`，监听 `127.0.0.1:3000` |
| 配置 | `/etc/open-ai-canvas/production.env`，root:openaicanvas，0640 |
| 数据目录 | `/var/lib/open-ai-canvas` |
| 数据库 | PostgreSQL `open_ai_canvas`，只监听本机 |
| 协调服务 | Redis `redis-server.service`，只监听本机 |
| 备份目录 | `/var/backups/open-ai-canvas` |
| 域名 | `canvas.yingpix.com` |

项目的业务前端是 React/Vite，不能编译成 Go 前端业务代码。线上构建阶段使用 Bun 生成 `web/dist`，运行阶段由 `deploy/native/web-server` 编译出的 Go 二进制提供静态文件和 SPA 回退；因此线上不运行 Node、Bun 或 Vite。后端使用 Go 二进制运行。

## 首次安装

先在私有仓库登记服务器专用 Deploy key。不要把个人 GitHub token 放到服务器。服务器上的私钥建议为 `/root/.ssh/open_ai_canvas_github`，并用只读权限登记到仓库。

服务器准备好 `/root/open-ai-canvas` 后，以 root 执行：

```bash
cd /root/open-ai-canvas
APP_DOMAIN=canvas.yingpix.com bash deploy/native/server-setup.sh
```

脚本会安装 Go 1.25.0 和 Bun 1.3.9 到 `/opt/open-ai-canvas/toolchains`，安装或复用 PostgreSQL 和本机 Redis，创建独立数据库和 `openaicanvas` 用户，写入受保护配置，安装两个 systemd 单元，建立 `/root/open-ai-canvas-ops`，并把独立 Caddy 站点加入现有 Caddyfile。它不会修改 `/root/yingpix` 或 `yingpix.service`。

`CANVAS_REGISTRATION_ENABLED` 首次默认开启，用于注册第一个管理员。完成注册并确认登录后，编辑 `/etc/open-ai-canvas/production.env` 改为 `CANVAS_REGISTRATION_ENABLED=false`，再重启后端：

```bash
systemctl restart open-ai-canvas-backend.service
```

配置文件中只保存数据库连接等服务器配置，不提交到 Git；模型密钥、SMTP 和对象存储优先在后台设置中配置。

## 发布、更新和回滚

运维目录是唯一的线上更新入口：

```bash
ssh root@154.36.173.216
cd /root/open-ai-canvas-ops
./release.sh
```

发布脚本会加锁，检查仓库干净且位于 `main`，执行 `git pull --ff-only origin main`，安装前端依赖并构建静态文件，运行后端 Go 测试，编译后端和前端 Go 二进制，备份 PostgreSQL，切换 `current`，重启两个服务并检查：

```text
http://127.0.0.1:8080/api/health
http://127.0.0.1:3000/healthz
```

构建或健康检查失败时会恢复上一版本程序；数据库不会自动回滚。查看状态和回滚：

```bash
cd /root/open-ai-canvas-ops
./status.sh
./rollback.sh
journalctl -u open-ai-canvas-backend -n 100 --no-pager
journalctl -u open-ai-canvas-web -n 100 --no-pager
```

当前仓库的 `plugin-packages/autodl-comfyui.yingce-plugin` 压缩包与其接口文档中的声明式 manifest 合同存在既有漂移，完整 `go test ./...` 会在 `backend/internal/protocol` 失败。首次上线若尚未修复该上游包，可显式使用 `GO_TEST_SCOPE=without-protocol ./release.sh`；其余后端测试仍会运行。修复压缩包后应恢复默认的完整测试范围。

本地完成代码修改后推送：

```bash
git status
git add deploy/native docs/DEPLOYMENT_NATIVE.md
git commit -m "chore(deploy): add standalone native deployment"
git push origin main
ssh root@154.36.173.216 'cd /root/open-ai-canvas-ops && ./release.sh'
```

## DNS 与 HTTPS

`canvas.yingpix.com` 应新增或保持以下记录：

| 类型 | 主机 | 值 |
| --- | --- | --- |
| A | `canvas` | `154.36.173.216` |

Caddy 站点只代理新域名：`/api/*` 和 OAuth 回调转发到 Go 后端，其余路径转发到 Go 前端静态服务器。Caddy 自动申请和续期 HTTPS。验证：

```bash
dig +short canvas.yingpix.com A
curl -fsS https://canvas.yingpix.com/healthz
curl -fsS https://canvas.yingpix.com/api/health
```

DNS 未指向服务器或证书尚未签发时，只能确认本机两个健康接口，不能宣称公网 HTTPS 已上线。现有 `yingpix.com`、`app.yingpix.com`、`img.yingpix.com` 和 `/root/yingpix` 不在本部署范围内。

## 运行边界

- 后端只绑定 `127.0.0.1:8080`，前端只绑定 `127.0.0.1:3000`，公网入口统一由 Caddy 提供。
- PostgreSQL 使用独立角色和数据库；Redis 使用本机 `redis-server.service`，配置为 `redis://127.0.0.1:6379/0`，用于限流、并发和熔断协调。
- 生产数据、上传目录、认证状态和环境文件均在 Git 与 release 目录之外。
- 发布会重启后端，正在执行的后台任务应在低峰期发布；发布失败时程序可回滚，数据库迁移不自动回滚。
