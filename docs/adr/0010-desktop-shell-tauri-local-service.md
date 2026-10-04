# ADR-0010: 桌面壳用 Tauri 2 托管本地服务，前端与 API 同源承载

状态：已接受。日期：2026-10-04。来源：借鉴 Orrery（仪象台）桌面壳流程，按影策 Web + Go 架构重新决策。

> 更新记录（2026-10-04）：桌面壳与前端包分离，新增 `apps/desktop/`（含 `src-tauri/`）承载跨平台应用；本 ADR **推翻并取代** ADR-0001「不引入 Tauri/Electron 壳」一条，见「与 ADR-0001 的关系」。
>
> 更新记录（2026-10-04，修正）：原「默认 1440×900」一条是错的，已改为按显示器可用工作区自适应，见下方「窗口」。

## 背景

### 参考实现：Orrery 桌面壳的流程

Orrery 的桌面形态是「Tauri 2 host 进程 + 被托管的本地 sidecar」，流程如下（来自其 `surfaces/gui/src-tauri`）：

- Rust host 是唯一入口。启动时选一个空闲回环端口并生成一次性令牌，把服务端地址、WS 地址、令牌和平台标识注入 webview 全局（`withGlobalTauri` + `window.__COWORKER_HTTP__` / `__COWORKER_WS__` / `__COWORKER_API_TOKEN__` / `__OCW_PLATFORM__`），窗口加载打包进 app 的前端资源。
- 同一时刻拉起本地 sidecar（Python / PyInstaller onedir），用环境变量传端口、令牌、父进程 PID 与 `COWORKER_EXIT_WITH_PARENT=1`（父进程消失即自杀），stdout/stderr 落 `<state_dir>/logs/`，Windows 加 `CREATE_NO_WINDOW`。
- 跨源是显式处理的：服务端用 `_ALLOWED_ORIGIN_RE` 固定放行 `tauri://localhost`、`http(s)://tauri.localhost`、`http(s)://localhost(:port)`、`http://127.0.0.1(:port)`；前端把 `fetch` 包一层带上 `X-OpenWorker-Token`，WebSocket 用子协议传令牌。
- 壳层能力：单实例插件排在首位、close-to-tray、托盘菜单与文案表（`shell_i18n.rs`，`en`/`zh` 两套 + 品牌文案一致性测试）、keep-awake、原生命令（选目录、窗口拖动、启动状态查询）、`desktop.json` 存壳偏好、Tauri updater（minisign）自更新。
- 打包：macOS 走 `build_dmg.sh`——先签每个 Mach-O、`tauri build --bundles app`、hdiutil 出 DMG、codesign、notarytool、stapler、`spctl` 验证。

### 影策现状

- 前端：Vite + React 19（`web/`），`createBrowserRouter` 路径路由，`build` 未设置 `base`（按根路径绝对引用），无 Service Worker，无前端 i18n（界面中文）。
- 前端接口层：`apiBaseURL = import.meta.env.VITE_CANVAS_BACKEND_URL || "/api"`，`withCredentials: true`；登录态是 `SameSite=Lax` 会话 Cookie（`backend/internal/handler/auth.go`）。
- 后端：Go / Gin / GORM（`backend/`），`CANVAS_BACKEND_ADDR`（默认 `:8080`）、`CANVAS_BACKEND_DATA_DIR`（默认 `data`）、`CANVAS_CORS_ORIGINS`（默认空）、`CANVAS_PUBLIC_BASE_URL`、`CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS`；健康检查 `/api/health/live|startup|ready`（未就绪返回 503）；`r.NoRoute` 目前只承接 `/api/<渠道>/<path>` 短代理，其余返回 404。
- 本地运行现状：脚本拉起后端 8080 + 前端 3000，再用系统浏览器打开 `http://localhost:3000`（`scripts/start-local.ps1` / `start-canvas.ps1`）。

### 为什么不能照搬「app 内置前端 + 跨源令牌」

三个已核实的事实让 Orrery 的跨源路线在本项目代价很高：

1. 后端只接受 http/https 的 `Origin`，`Origin: tauri://localhost` 会被 CORS 中间件直接 403。
2. 会话 Cookie 是 `SameSite=Lax`。`tauri://localhost` 与 `http://127.0.0.1:<port>` 属于不同 site，跨源 XHR 不会带 Cookie；即使改成 `SameSite=None; Secure`，WKWebView 的 ITP 也会拦第三方 Cookie。也就是说，桌面壳若保留「前端在 app 内、API 在别处」的形态，就必须**新增一套令牌身份**——而影策是多用户服务（项目/素材按用户归属、管理员权限、积分与配额），令牌必须映射到某个真实账号或自动建本地账号，这是产品级改动，并且会把鉴权与 CORS 维护成两套语义。
3. 应用是路径路由 + 会话登录的常规 Web 应用，同源假设贯穿其中（`CANVAS_PUBLIC_BASE_URL` 拼签名链接、CSRF 与 Cookie 语义、`withCredentials`）。把前端搬进 app 资源协议，等于在桌面模式下变更整套安全与链接语义。

## 决策

桌面壳沿用 Orrery 的技术栈与进程模型（Tauri 2 host + 托管的本地 sidecar + 托盘/单实例/自启/更新等原生能力），但把「前端内置在 app、跨源访问 API」替换为「**前端由同一个本地服务同源提供**」。

### 运行形态

- 唯一子进程是 Go 后端。窗口加载的地址就是本地服务地址 `http://127.0.0.1:<port>/`，与 API 同源。
- 因此 Cookie（`SameSite=Lax`）、`withCredentials`、CORS 判定、`CANVAS_PUBLIC_BASE_URL` 全部沿用现有语义：**不新增令牌身份、不放宽 `CANVAS_CORS_ORIGINS`、不改 `request.ts` 的 `apiBaseURL`**。

### 后端新增：可选静态承载（`CANVAS_STATIC_DIR`）

- 设置 `CANVAS_STATIC_DIR` 时，`NoRoute` 对非 `/api` 路径静态提供该目录，未命中文件回退 `index.html`（SPA fallback，保证 `createBrowserRouter` 深链可用）；`/api/*` 与现有短代理行为不变。
- 不设置该变量时行为与今天完全一致。容器与 Web 部署仍由 nginx 承载前端，本能力只在桌面模式启用。
- 该变量名与语义进入 `.env.example` 与后端部署文档。

### 壳侧职责

- **端口与子进程**：Rust 侧选一个空闲回环端口，通过 `CANVAS_BACKEND_ADDR=127.0.0.1:<port>` 交给子进程，同时设置 `CANVAS_BACKEND_DATA_DIR`（OS 应用数据目录，**不在仓库内**）、`CANVAS_PUBLIC_BASE_URL=http://127.0.0.1:<port>`、`CANVAS_STATIC_DIR`（bundle 内 web 资源目录）。子进程查找顺序：`CANVAS_SERVER_BIN` 环境变量 → bundle 内 sidecar → 开发回退路径；找不到时不拉起，直接报错而不是静默降级。
- **启动顺序**：先创建窗口加载 app 内打包的启动页（`frontendDist` = `apps/desktop/splash`，显示启动进度），再拉起子进程，轮询 `/api/health/startup`（未就绪 503），就绪后把窗口导航到本地地址；超时或失败在启动页给出原因、日志入口与重试按钮。
- **生命周期**：单实例插件排首位（第二次启动只聚焦已有窗口）；close-to-tray；窗口关闭不结束进程，托盘退出才结束；`RunEvent::ExitRequested` / `Exit` 杀子进程；Go 侧新增 `CANVAS_EXIT_WITH_PARENT=1` + `CANVAS_PARENT_PID` 孤儿看门狗（父进程消失即退出，POSIX 与 Windows 各一条实现）。
- **日志**：`<app_data_dir>/logs/canvas-server.log` 与 `.old`（上一轮），托盘提供「打开数据目录」「查看日志」。
- **壳偏好**：`desktop.json` 存 `lang`、`keep_awake`、窗口尺寸；keep-awake 用 `caffeinate` / `SetThreadExecutionState`。
- **托盘与文案**：托盘菜单（打开窗口 / 重启本地服务 / 打开数据目录 / 查看日志 / 退出）与原生文案集中在 `shell_i18n.rs` 文案表，默认 `zh`；产品界面目前只有中文，`en` 条目在产品引入英文时补齐，调用点不变（沿用 Orrery 的文案表 + 一致性测试形态）。
- **窗口**：尺寸不是固定值。首选项里存的是「偏好尺寸」（首次启动 1280×800），启动时一律裁剪到当前显示器可用工作区的 92% 以内，再居中显示；恢复上次保存的尺寸走同一条裁剪，所以外接显示器拔掉或换到小屏后不会还原出一个超出屏幕的窗口。窗口创建时先不显示（`visible: false`），裁剪完再 `show`，避免先闪一下超屏窗口。最小尺寸 960×640 是产品下限（保证 260px 侧栏之外仍有可用主区），不是从设计断点实测算出来的值；屏幕工作区比它还小时，最小尺寸随之下调。首版保留系统标题栏，自定义标题栏（macOS overlay + 窗口拖动命令 + 前端让位）留待后续，避免首版同时改壳与改前端布局。
  - 修正记录：原写成「默认 1440×900，最小尺寸按 `docs/design/workspace-shell-design.mdx` 的桌面断点实测确定」。两处都不成立——该设计文档只有 `--workspace-sidebar-width: 260px` 这类组件尺寸，没有桌面断点或最小宽度；而 1440×900 是本仓库**浏览器验收视口**的常用尺寸（见 `docs/design/admin-ui-change-log.md` 里的「较窄 PC 视口 1440×900」），当作桌面窗口尺寸会让 2408×1506 Retina（逻辑 1204×753）这类屏幕上的窗口宽高都超出屏幕。
- **原生能力与更新**：设置页需要的能力（选目录、开机自启、窗口拖动、外部链接、更新检查）用 Tauri 命令 + `withGlobalTauri`，前端接入点放 `web/src/services/desktop.ts`；能力配置需要用 URLPattern 放行本地服务源（`remote.urls: ["http://127.0.0.1:*"]`）才能从页面调用命令。更新走 Tauri updater，与后端 host-updater（`scripts/install-host-updater.sh`、`/api/system/update*`）**互斥**：桌面模式下必须关闭或隐藏后端更新入口，不能让两个更新器同时指向同一个安装。

### 目录与打包（新增 `apps/desktop/`）

- 新增 `apps/desktop/`：`src-tauri/`（Rust 壳，跨平台应用）、`splash/`（启动页，纯静态 HTML，无构建）、`package.json`（只装 `@tauri-apps/cli`，用 bun）。不放进 `web/`，也不作为 `web/` 的子目录，避免把 Rust 工具链与 Tauri 依赖混进前端包；`apps/desktop/` 与 `web/`、`backend/` 平级，作为独立构建单元。
- 打包链路（与 Orrery 的 PyInstaller 流程不同，sidecar 是 Go 单文件）：`bun run build`（web dist）→ `CGO_ENABLED=1 go build`（后端；SQLite 驱动是 cgo 实现，`CGO_ENABLED=0` 只能产出无法建库的桩）→ 暂存到 `apps/desktop/src-tauri/binaries/`（含 web dist）→ 签名 → `tauri build`（`bundle.resources` 带 sidecar 与 web 资源）→ macOS 继续 DMG、codesign、notarytool、stapler、`spctl`，沿用 Orrery `build_dmg.sh` 的结构。
- 目标是跨平台桌面应用（macOS / Windows / Linux）。壳层代码保持平台无关，平台差异各自隔离：孤儿看门狗 POSIX / Windows 各一条实现，keep-awake 用 `caffeinate` / `SetThreadExecutionState`，Windows 启动子进程加 `CREATE_NO_WINDOW`，签名与安装包按平台分别处理。落地顺序 macOS 先行、Windows 次之。
- macOS entitlements 按 Go 单二进制实测收敛（最小集，不照抄 Python 侧的 JIT/库校验豁免）。

### 与 ADR-0001 的关系

本 ADR **推翻并取代** ADR-0001 决策中的「不引入 Tauri/Electron 壳」一条；ADR-0001 已记录该条被取代（见其更新记录）。ADR-0001 的核心边界——「不移植 Concat 的 Rust 引擎」、TS 时间线状态机拥有编辑真相——保持不变：本壳不拥有任何模型，只做进程监督、窗口与系统集成，画布与时间线真相源仍在 TS 与 Go。被推翻的只是「连壳都不引入」这一形式约束，替代边界是「不引入**拥有模型**的桌面引擎」，其余边界（ADR-0002/0003/0005）不受影响。

### 落地顺序

1. 后端静态承载 + 孤儿看门狗（Go 测试覆盖）。
2. `apps/desktop/` 壳：启动页、空闲端口、子进程管理、健康门、托盘、单实例、日志。
3. 打包与签名（macOS 先行，Windows 次之）。
4. 原生命令接入（选目录、自启、外部链接、更新）与自定义标题栏。

实施细节与逐项验收落在 `docs/plans/` 的实施文档中，本 ADR 只固定边界与形态。

## 考虑过的方案

- **照搬 Orrery：app 内置前端 + 令牌 + 扩 CORS**（`tauri://localhost` 源、`X-Canvas-*` 令牌、白名单式 origin 放行）。壳层最接近参考实现，但必须为桌面新增一套映射到多用户账号的令牌身份，并在 Cookie/ITP 之外长期维护第二套鉴权与 CORS 语义；否决。
- **壳内置反向代理**（Rust 起 loopback 静态服务 + `/api` 反代到后端，前端同源但由壳承载）。Go 不用改，但要在壳里重新实现 SSE、上传、Range/大媒体回放等代理语义，风险与工作量都高于改 Go；否决。
- **后端 `embed.FS` 内嵌前端产物**：同样同源，但把前端构建产物耦合进 Go 模块（跨目录 embed 需先把 dist 拷进 `backend/`），且发布二进制被前端构建节奏绑住；改为运行时 `CANVAS_STATIC_DIR` 指向资源目录，dev 与发布共用一条代码路径；否决内嵌。
- **只做浏览器启动器**（沿用现有「起服务 + 开浏览器」脚本）：没有窗口、托盘、自启与更新，等于没做壳；否决。
- **Electron / Wails**：Tauri 2 与参考实现同栈，壳层行为可直接对照现成实现；否决。

## 后果

- Go 服务多一条可选静态路径：这是本项目第一次把「承载前端」的职责放进 Go（此前只有 nginx / Vite）。仅桌面模式启用、缺省关闭，容器与 Web 部署不变；必须补测试（文件命中、SPA 回退、不劫持 `/api`、目录穿越拒绝）。
- dev 与发布形态不同：dev 下窗口指向 Vite dev server（3000，`/api` 代理到 8080），发布下指向本地服务地址。壳提供环境变量覆盖，以便在 dev 中演练发布路径；打包产物仍需真实冒烟，静态阅读不能算验证。
- 桌面数据目录在 OS 应用数据目录，不使用仓库内 `.local/project-workbench-debug`，避免开发账号库被桌面应用读写；同一台机器上桌面应用与开发服务是两份独立数据。
- 本地服务默认只绑回环，且桌面模式不放宽 `CANVAS_CORS_ORIGINS`。若本地存储签名链接需要服务端取回本机地址，只用 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=127.0.0.1` 精确放行，不使用通配或「允许私网」开关。
- 桌面模式的 `CANVAS_PUBLIC_BASE_URL` 指向本次随机端口，导出/分享链接只在本次运行内有效；跨重启的持久链接仍应指向真实部署地址。
- 页面内调用 Tauri 命令依赖 `remote.urls` 的端口通配放行；若该能力在实测中不可用，退路是固定端口并精确放行该源（会牺牲「端口不冲突」的健壮性）。
- 打包差异：Go 单文件 sidecar 比 PyInstaller onedir 简单很多，主要成本转到 macOS 签名/公证顺序与 sidecar 可执行位、DMG 步骤上。
