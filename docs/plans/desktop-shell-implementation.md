# 桌面壳实施文档（ADR-0010）

状态：实施中。日期：2026-10-04。边界与形态见 `docs/adr/0010-desktop-shell-tauri-local-service.md`，本文只记实施细节、逐项状态与验收方式。

## 1. 冻结契约

壳与本地服务之间只有环境变量与一个健康探针，两侧按本表实现，改这里必须同时改另一侧。

### 1.1 壳注入子进程的环境变量

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `CANVAS_BACKEND_ADDR` | `127.0.0.1:<port>` | 壳选定的空闲回环端口，只绑回环 |
| `CANVAS_BACKEND_DATA_DIR` | `<app_data_dir>/data` | OS 应用数据目录，不在仓库内，与开发库物理隔离 |
| `CANVAS_PUBLIC_BASE_URL` | `http://127.0.0.1:<port>` | 本次运行内有效；持久链接仍指向真实部署地址 |
| `CANVAS_STATIC_DIR` | `<bundle 资源目录>/web` | 前端构建产物；未设置时后端只提供 API |
| `CANVAS_PI_ARCHIVE` | `<bundle 资源目录>/pi-runtime.tar.gz` | Agent 运行时压缩包；仅在资源存在时注入，缺失则后端回退仓库/系统路径 |
| `CANVAS_OFFICIAL_PLUGIN_DIR` | `<bundle 资源目录>/plugin-packages` | 官方协议插件目录；仅在资源存在时注入，缺失则后端从工作目录向上查找（打包形态下找不到，会启动失败） |
| `CANVAS_EXIT_WITH_PARENT` | `1` | 父进程消失即退出 |
| `CANVAS_PARENT_PID` | 壳进程 PID | 与上一项同时生效 |

不设置 `CANVAS_CORS_ORIGINS`：窗口地址与服务地址同源，CORS 不参与判定。
本地存储签名链接需要服务端取回本机地址时，只精确放行 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=127.0.0.1`。

### 1.2 后端新增的可选变量

| 变量 | 默认 | 语义 |
| --- | --- | --- |
| `CANVAS_STATIC_DIR` | 空 | 非空时，`NoRoute` 对非 `/api` 路径静态提供该目录，未命中回退 `index.html`；目录缺失或无 `index.html` 时启动失败，不静默降级 |
| `CANVAS_EXIT_WITH_PARENT` | `false` | 开启后轮询父进程存活状态，父进程消失时走正常退出流程 |
| `CANVAS_PARENT_PID` | 无 | 与上一项同时使用；开启看门狗但未给出合法 PID 时启动失败 |
| `CANVAS_PI_ARCHIVE` | 空 | Agent 运行时压缩包（内容平铺，根目录即 `agent-runtime.mjs`）；非空时解包到运行时目录并复用 |
| `CANVAS_PI_RUNTIME_DIR` | 空 | 直接指定 pi 运行时目录，优先于压缩包；显式指定但目录不合法时报错而不是静默回退 |
| `CANVAS_NODE_BIN` | 空 | 直接指定 node 可执行文件，优先于受管目录与 PATH |
| `CANVAS_RUNTIME_DIR` | `<数据目录>/runtimes` | 受管运行时根目录 |
| `CANVAS_RUNTIME_AUTO_INSTALL` | `true` | 置 `false` 时禁止联网下载 node，只用已有运行时（离线部署） |
| `CANVAS_NODE_VERSION` / `CANVAS_NODE_DIST_BASE` | `22.22.2` / 官方 dist | 内网镜像覆盖下载源；sha256 仍以官方 `SHASUMS256.txt` 为准，校验不过即失败 |

`/api/*` 语义完全不变：短代理、业务路由、404 行为都与今天一致。容器与 Web 部署由 nginx 承载前端，不设置本变量。

### 1.3 健康门

壳轮询 `GET http://127.0.0.1:<port>/api/health/startup`，返回 200 才把窗口导航到本地地址；未就绪返回 503 属于正常等待，不计失败。超时或子进程提前退出时在启动页给出原因、日志入口与重试。

### 1.4 壳的调试覆盖

| 变量 | 作用 |
| --- | --- |
| `CANVAS_DESKTOP_DEV_URL` | 非空时窗口直接指向该地址（Vite dev server），不拉 sidecar、不走健康门 |
| `CANVAS_DESKTOP_SERVER_URL` | 非空时复用已运行的本地服务，跳过端口选择与 sidecar 启动，仍走健康门 |
| `CANVAS_SERVER_BIN` | 显式指定 Go 服务可执行文件，优先于 bundle 内 sidecar |
| `CANVAS_DESKTOP_STATIC_DIR` | 覆盖注入子进程的 `CANVAS_STATIC_DIR`（dev 默认指向 `web/dist`） |
| `CANVAS_DESKTOP_APP_DIR` | 覆盖壳的应用根目录（默认 OS 应用数据目录）；影响日志、偏好与默认数据目录 |
| `CANVAS_DESKTOP_DATA_DIR` | 覆盖注入子进程的数据目录，优先于 `APP_DIR/data` |
| `CANVAS_DESKTOP_HEALTH_TIMEOUT_SECS` | 健康门超时秒数，默认 60 |

### 1.5 窗口尺寸

窗口尺寸不是常量，硬编码尺寸会在小屏上超出屏幕。

| 项 | 约定 |
| --- | --- |
| 偏好尺寸 | 首次启动 1280×800；存在 `desktop.json` 时用上次保存值 |
| 裁剪规则 | 启动与恢复统一裁剪到**当前显示器工作区**的 92%（`MAX_WORK_AREA_RATIO`），再居中 |
| 最小尺寸 | 产品下限 960×640；工作区比它小时随之下调，否则窗口永远超屏 |
| 工作区未知 | 平台返回 0 或取不到显示器时不裁剪、不下调，宁高不缩 |
| 首帧 | `tauri.conf.json` 的 `visible: false`，裁剪完成后再 `show`，不先闪一下超屏窗口 |
| 实现位置 | `prefs::WindowPrefs::fit_to` / `prefs::min_size`（纯函数，有单测）；`lib.rs::monitor_work_area` 取工作区 |

裁剪发生时写一行壳日志（原尺寸 → 工作区 → 新尺寸），便于事后判断用户实际看到的尺寸。

### 1.6 产物布局

```text
apps/desktop/
├─ package.json            # 只装 @tauri-apps/cli，用 bun（唯一锁文件 bun.lock）
├─ README.md               # 壳的定位、命令、工具链前置条件与 sidecar 的 cgo 约束
├─ splash/index.html       # 启动页，纯静态，无构建
├─ icon-source.svg/png     # 图标源（可替换），由 scripts/generate-icons.sh 转成 icons/
├─ scripts/                # stage-assets.sh / generate-icons.sh / build-dmg.sh
└─ src-tauri/
   ├─ binaries/            # 暂存的 Go sidecar（canvas-server-<target-triple>，不提交）
   ├─ resources/web/       # 暂存的前端构建产物（不提交）
   ├─ resources/pi-runtime.tar.gz  # 暂存的 Agent 运行时压缩包（约 38M，不提交）
   ├─ resources/plugin-packages/  # 暂存的官方协议插件包（*.yingce-plugin，约 86M，不提交）
   ├─ icons/               # 提交进仓库的构建输入
   └─ src/                 # config / server / tray / commands / prefs / keep_awake / shell_i18n / …
```

- Go 服务二进制走 `bundle.externalBin`：Tauri 按目标三元组命名并在 macOS 签名阶段一并签名，这是 sidecar 的既定形态；web 产物走 `bundle.resources` 映射到资源目录 `web/`。ADR 里「`bundle.resources` 带 sidecar 与 web 资源」的 sidecar 一项按此细化。
- `CANVAS_OFFICIAL_PLUGIN_DIR` 与 `CANVAS_PI_ARCHIVE` 不同：后者缺失只是智能体不可用，前者缺失会让后端在引导内置插件时直接退出（退出码 1，工作目录为 `/` 时向上也找不到 `plugin-packages`）。因此这份资源是启动必需项，不是可选项。
- sidecar 必须用 `CGO_ENABLED=1` 构建：后端 SQLite 走 `gorm.io/driver/sqlite` → `mattn/go-sqlite3`，`CGO_ENABLED=0` 的二进制启动即报 stub 错误、无法建库。代价是跨平台构建需要各自的原生工具链：macOS 本机构建用 Xcode CLT 的 clang；Windows 需在 Windows 上构建（或备好 mingw-w64 交叉工具链）。容器镜像早已是 `CGO_ENABLED=1`（`backend/Dockerfile`），桌面侧与之一致。
- 子进程用 `tauri-plugin-shell` 的 sidecar 调用，不用 `std::process::Command` 自己拼路径。

### 1.7 退出语义

正常退出时壳主动结束子进程，孤儿看门狗用于壳被强杀或崩溃的情形：两条路径都要有，只靠其中一条会分别留下孤儿进程或依赖超时退出。看门狗轮询间隔取秒级，保证壳异常退出后服务不会被另一实例长期占用端口。

## 2. 落地项与状态

| # | 项 | 状态 | 验收 |
| --- | --- | --- | --- |
| 1 | 后端静态承载 `CANVAS_STATIC_DIR` | 已完成 | 文件命中、SPA 回退、不劫持 `/api`、目录穿越拒绝、未配置时行为不变（Go 测试） |
| 2 | 后端孤儿看门狗 | 已完成 | 父进程消失后退出；POSIX 与 Windows 各自实现，交叉编译通过 |
| 3 | `apps/desktop/` 壳 | 已完成 | `cargo check --all-targets` 无 error/warning、`cargo test` 18 项通过；实机启动到 `影策.app` 内 bundled sidecar，健康门 200、SPA 深链 200、就绪后导航窗口 |
| 4 | 打包链路 | 已完成（macOS 无签名） | `bunx --bun tauri build --bundles app` 从零产出 `影策.app`（约 311M，内含 web 产物、sidecar、`pi-runtime.tar.gz` 与 `plugin-packages/`）；签名与 DMG 仍需凭据 |
| 5 | 原生命令接入与自定义标题栏 | 未开始 | 见 ADR-0010 落地顺序第 4 项 |

## 3. 已知取舍

- 发布形态下窗口加载 `http://127.0.0.1:<port>/`，属于安全上下文，但不再是 `https`；不影响会话 Cookie（`SameSite=Lax` 对同源请求成立），也不放宽 CORS。
- 本地服务不实现 gzip：nginx 侧的压缩能力不随之迁移。回环传输下无收益，先不做；若将来静态资源体积成为问题再评估。
- 页面内调用 Tauri 命令依赖 `remote.urls` 的端口通配放行；若实测不可用，退路是固定端口并精确放行该源。
- 更新器二选一：桌面模式必须关闭或隐藏后端 host-updater 入口，避免两个更新器指向同一安装。
- Tauri CLI 必须在 bun 运行时下调用（`bunx --bun tauri`）：`@tauri-apps/cli` 的原生绑定在 node 下加载失败（`MODULE_NOT_FOUND`），`bunx tauri` / `bun run tauri` 均不可用。与「本目录只用 bun」的策略一致，脚本与 `package.json` 均按此写法。

## 4. 验证记录

端到端冒烟（`.local/cache/desktop-smoke/smoke.sh`，不经过壳，但完全按 §1.1 的环境变量注入；后端用 `CGO_ENABLED=1 go build` 出的可执行文件，数据目录为空、现场完成迁移）：

| 检查 | 实际结果 |
| --- | --- |
| 健康门 `/api/health/startup` | 冷启动 5 秒后 200，之前的轮询为连接未就绪 |
| `GET /`、`/projects/42/canvas`、`/canvas/abc-123`、`/settings/agent-memory` | 均 200 `text/html`，返回应用入口（`createBrowserRouter` 深链可用） |
| 真实构建产物 `assets/*.js` | 200 `text/javascript`，字节数与磁盘一致 |
| 缺失资源 `/assets/does-not-exist.js` | 404，没有拿入口 HTML 顶替 |
| `/api/health/*`、`/api/system/version` | 200 `application/json`；`/api/nope-nope` 404 `application/json`，静态承载未劫持 `/api` |
| 越界路径 `/../VERSION`、`/assets/../../VERSION`、`/..%2fVERSION`、`/assets%5c..%5cVERSION` | 400 或 404，没有任何仓库文件内容泄漏 |
| 强杀父进程后子进程状态 | 2 秒内退出，日志出现「父进程已退出，本地服务开始退出」 |

自动化部分：`gofmt -l`、`go vet`（含 `GOOS=windows`）无输出；静态承载与看门狗专项测试全通过；`go test ./...` 全包通过。冒烟使用的是仓库中已有的 `web/dist`（上一次前端构建），打包环节会由构建脚本重新产出。

Rust 侧（`apps/desktop/src-tauri`）：`cargo check --all-targets` 无 error 无 warning，`cargo test` 18 项全通过。首次编译暴露并修复了 4 个真实缺陷——`build.rs` 找 `VERSION` 的层级差一层（写成 `../../VERSION`，实际仓库根在三层之上）、`CommandEvent` 是 `non_exhaustive` 漏了通配分支、`state.rs` 的 `boot_error` 缺 `mut`、`commands.rs` 里 `open_path` 传了 `PathBuf` 而插件只收 `String`，以及尾表达式里锁 guard 的临时值释放顺序导致的 `state does not live long enough`。另有一个死字段 `shell_i18n::window_title`，改为启动与切语言时真实设置窗口标题。窗口尺寸修正后又新增 4 项裁剪单测，总数到 18。


打包与实机链路（`apps/desktop/`）：

| 检查 | 实际结果 |
| --- | --- |
| `bunx --bun tauri build --bundles app` | 从零完成，`Finished release profile in 3m 27s`，产出 `target/release/bundle/macos/影策.app`（190M） |
| 包内构成 | `Contents/MacOS/yingce-desktop` + `Contents/MacOS/canvas-server`（65.9M）+ `Contents/Resources/web/`（1556 个 assets）；`CFBundleIdentifier`=`ai.ddcat.open-ai-canvas`、版本 1.6.0、`LSMinimumSystemVersion`=11.0 |
| 实机启动 | 壳自选回环端口 57364，拉起包内 sidecar，日志出现 `serving frontend static assets`（目录就在 `.app` 内）与 `[shell] 本地服务已就绪，导航窗口` |
| 就绪后探测 | `/api/health/startup` 200；`/` 200 `text/html`；`/projects/42/canvas` 200 `text/html`（深链由回环服务兑现） |
| 退出清理 | 结束壳进程后 3 秒内包内 sidecar 一并消失 |
| 数据目录 | 落在 `~/Library/Application Support/ai.ddcat.open-ai-canvas`，仓库内无写入；`src-tauri/` 下的 `target`/`binaries`/`resources` 与 `node_modules/` 均被忽略，`icons/` 可提交 |

签名状态：当前为 `adhoc`/linker-signed（无 Developer ID），因此没做公证也没出 DMG；`scripts/build-dmg.sh` 的签名与打 DMG 分支需要真实凭据才能验证。
尚未验证：带 Developer ID 的签名与公证、DMG 产出（需真实凭据）、Windows 构建与打包、托盘菜单与单实例的交互行为、长时间运行下的 keep-awake。这些在待测试清单中逐条列出。

窗口尺寸自适应（修正：原写死 1440×900）：

| 检查 | 实际结果 |
| --- | --- |
| 逻辑屏幕与工作区（`osascript` 问 Finder，独立于壳） | 桌面 `0,0,1408,881`；壳读到的工作区 1408×803（差值为菜单栏与 Dock），两边一致 |
| 修正前 | 1440×900 比工作区宽 32、高 97，在 1408×881 的屏上宽高都溢出，与用户报的现象一致 |
| 修正后（实机） | 日志 `窗口尺寸 1280×800 超出可用工作区 1408×803，调整为 1280×738`，随后正常导航窗口 |
| 单测 | `cargo test` 18 项通过（新增 4 项：小屏裁剪、换屏后恢复受限、极小工作区同步下调下限、工作区缺失或为 0 时不裁剪） |
| 首帧 | `visible: false` + 裁剪后 `show()`，不会先闪一下超屏窗口 |

上表「修正后」一行是当时正在运行的 `bun run tauri dev` 会话在我改完源码后自动重建重启产生的（PID 与启动时间已核对）：日志、工作区数值、应用后的尺寸都是运行时的真实值，不是推断。

## 5. 打包后发现的问题：桌面版智能体不可用

用户反馈「打包后发现桌面版配置好模型后无法使用，不管是在创作页还是在画布智能体，web 端可以使用」。探针实测后确认**两层原因**，第二层是桌面壳自身的供给缺口，与用户配置无关。

### 5.1 第一层：Agent 只接受后端受管的模型

| 检查 | 实际结果 |
| --- | --- |
| 桌面实例后端的模型库 | `model_channels` / `channel_models` / `logical_models` 全为 0，后端没有任何受管模型 |
| 用户「配置好」的模型在哪 | 浏览器 `localStorage`（`open_ai_canvas:ai_config_store:user:<id>`）：`channelMode=remote`、`baseUrl=https://api.deepseek.com`、渠道 `scope=user`（个人渠道） |
| 前端取渠道 ID 的规则 | `use-config-store.ts` 的 `resolveModelRequestConfig` 只在 `scope === "system"` 时回填 `channelId`，个人渠道回空串 |
| 结果 | `canvas-cloud-agent-panel` 的请求体只剩 `model`，`validateCloudAgentRequest`（`internal/app/cloud_agent.go`）判 400「请选择后端受管文本模型；Agent 不接受浏览器自定义密钥或上游地址」 |
| 探针直发 `POST /api/agent/runs` | HTTP 400、`latency_ms=0~5`，与界面报错一致；换真实个人渠道 ID 得到「指定的渠道不存在」 |
| web 端为何可用 | web 部署的后端里有受管系统渠道，模型选择器会一并列出（`mergeSystemChannels`） |
| 创作页为何同样不行 | 创作页的「对话/agent」入口就是画布智能体（`CreationAgentEntry` → `/canvas/<id>?agent=1`），同一个 400；而创作页默认模式是图片（`creation-types.ts` 的 `defaultCreationMode = "image"`），用户只登记了 DeepSeek 文本模型（`imageModels: []`），图片模式没有可选模型 |
| 用户实机（2026-10-05 00:05–00:06，dev 壳、与应用同等的数据目录） | 后端日志连续多条 `POST /api/agent/runs status=400`（00:05:51、00:06:00、00:06:16/17/20、00:06:53），且 `grep -c "[Agent]"` 为 0 —— run 一次都没有进入执行，界面「发消息没有响应」正是这条 400 |

### 5.2 第二层：壳没有供给 Agent 运行时（打包版无解）

补上受管渠道、能力配置合法后，请求层已经通过，但 run 仍然跑不完：

| 检查 | 实际结果 |
| --- | --- |
| `POST /api/agent/runs` | HTTP 200，run 创建成功（`status=running`） |
| 随后落库状态 | `status=failed`，`Agent 执行中断，请重新发送消息；如反复出现，请把诊断号 … 反馈给管理员` |
| 探针 A：不设 `CANVAS_PI_RUNTIME_DIR` | `[Agent] session failed run=…: Agent runtime files are missing; set CANVAS_PI_RUNTIME_DIR` |
| 探针 B：设了 `CANVAS_PI_RUNTIME_DIR`，PATH 取 macOS GUI 默认 `/usr/bin:/bin:/usr/sbin:/sbin` | `start Agent runtime: exec: "node": executable file not found in $PATH` |
| 探针 C：两者都补齐 | run 走到真实模型调用，报「模型服务鉴权失败」（探针渠道用的是占位 Key，属预期），链路本身打通 |
| 三个候选路径为何都落空 | `RuntimeDir()` 依次试 `CANVAS_PI_RUNTIME_DIR` → `/app/backend/agent-runtime/pi`（容器路径）→ `runtime.Caller(0)` 推出的相对路径；而 `stage-assets.sh` 用 `-trimpath` 构建，编译期路径变成模块相对路径，第三个候选必然落空 |
| 壳侧现状 | `tauri.conf.json` 的 `bundle.resources` 只映射 `resources/web`；壳注入的环境变量里没有 `CANVAS_PI_RUNTIME_DIR`，也没有随包提供 node |
| 结论 | ADR-0010 写「唯一子进程是 Go 后端」，但后端自己还会拉起 node 跑 Agent 运行时。这层供给在 ADR、本实施计划与壳的实现里都没有落点，因此第一版打包产物下画布智能体必然失败，与用户是否配置正确无关（修法见 §6） |
| 临时绕行 | 壳未调用 `env_clear`，子进程继承壳的环境变量；从终端带 `CANVAS_PI_RUNTIME_DIR` 启动 `影策.app/Contents/MacOS/yingce-desktop`（同时终端 PATH 里有 node）可以让智能体跑起来，仅用于验证 |

### 5.3 附带发现（不阻塞，待单独跟进）

探针日志出现 ``sql="SELECT * FROM `canvas` WHERE …" error="no such table: canvas"``（`internal/app/cloud_agent_pi_request.go` 的 `buildPermissionsConfig` → `repo.GetCanvas`）。当前 schema 里只有 `canvas_projects`，没有 `canvas`/`canvases` 表，这条查询必然失败，但只记 WARN、不中断执行，因此不是本次故障的原因。用户实例日志里没有这行，因为他们的 run 在更早的 400 就中止了。表名来源尚未定位。

另一个独立缺陷：壳每次启动都新选一个空闲回环端口，而浏览器的 `localStorage` 按 origin（含端口）隔离，于是每换一次端口就换一份浏览器本地配置。实测 `~/Library/WebKit/yingce-desktop/WebsiteData/Default/` 下已累积 4 个 `<hash>/<hash>/` 目录，分别对应 `127.0.0.1` 的 4 个端口（58730、61806、64218 等），当前在用的是 64218。用户的个人渠道写在 `localStorage`（`open_ai_canvas:ai_config_store`）里，不随启动恢复，因此「配置好的模型」重启后会消失，需要重配。**已修**：首次选到的端口记进 `desktop.json`，下次启动若仍空闲就复用，不改变 ADR-0010「回环 + 同源」语义。

## 6. 本次修复与验证

本轮针对 §5 的两层原因落地改动，并重新打包。改动位置：

| 改动 | 位置 |
| --- | --- |
| Agent 运行时供给模块 | `backend/internal/agent/runtime/`（`provision.go` / `node_dist.go` / `download.go` / `extract.go`） |
| `Run` 先确保运行时再拉起 | `runtime.go`：`Ensure(ctx)` → `provision.NodePath` / `provision.Dir` |
| 壳传入运行时压缩包 | `config.rs` 解析 `pi_archive` → `server.rs` 注入 `CANVAS_PI_ARCHIVE` |
| 压缩包随包携带 | `tauri.conf.json` 的 `bundle.resources`；`stage-assets.sh` 负责打包 |
| 端口复用 | `prefs.rs` 的 `port` 字段 + `server.rs` 的 `select_port` / `remember_port` |
| 提示与措辞 | `canvas-cloud-agent-panel.tsx` 发送前拦截；`cloud_agent.go` 的 400 文案指明修法 |

验证记录见下表；没从打包产物真实跑一遍不算完成。

| 验证 | 命令 / 路径 | 结果 |
| --- | --- | --- |
| 供给层单测 | `cd backend && go test ./internal/agent/runtime/...` | ok（14 用例） |
| 相关包回归 | `go test ./internal/handler/... ./internal/platform/... ./cmd/server/...` | 全部 ok |
| 格式与静态检查 | `gofmt -l .` 、`go vet ./...` | 无输出 |
| 壳单测 | `cargo check --all-targets`、`cargo test` | 无 error/warning；22 项通过 |
| 重新打包 | `bunx --bun tauri build --bundles app` | 产出 `影策.app`，225M；`Contents/Resources/pi-runtime.tar.gz` 39,771,799 B |
| 从包内 sidecar 跑供给链路 | 干净 PATH（`/usr/bin:/bin:/usr/sbin:/sbin`）启动 `Contents/MacOS/canvas-server`，`CANVAS_PI_ARCHIVE` 指向包内资源 | `/api/agent/runs` HTTP 200；日志：「正在解包 pi 运行时」→「pi 运行时已解包：…/runtimes/pi/52a56cc3fffd」→「未找到 node，正在安装 node-v22.22.2-darwin-arm64.tar.gz」→「node 已安装：…/runtimes/node/v22.22.2/bin/node」 |
| 链路终点 | 同上，run `ag83ad711bd14af48c5e4c8389f097e912` | 走到真实模型调用；探针渠道是占位 Key，报「模型服务鉴权失败」属预期 |

尚未从窗口点下去跑完整对话：现存 `tauri dev` 会话持有单实例锁，打包版无法同时启动。验证用的是包内 sidecar，与窗口路径共用同一份 sidecar 与同一套环境变量。

已解包的目录里会出现 `._agent-runtime.mjs` 这类 163 B 的 AppleDouble 伴生文件（带 `com.apple.provenance` 属性），归档本身不含这些条目，不影响 node 加载。

## 7. 打包版无法启动的修复（官方协议插件目录）

从 Finder/`open` 启动第一版打包产物时，壳报「启动失败：本地服务在就绪前退出」，子进程退出码 1，日志里只有一行：

```
level=WARN msg="未找到官方 plugin-packages 目录；请设置 CANVAS_OFFICIAL_PLUGIN_DIR"
```

根因：后端 `officialPluginPackageDir()` 的解析顺序是 `CANVAS_OFFICIAL_PLUGIN_DIR` → 写死的 `/app/plugin-packages`（生产容器命中）→ 从**进程工作目录**逐级向上找 `plugin-packages`。双击 `.app` 时壳的工作目录是 `/`，三条路都落空；而 `newPluginRuntime` 把「引导内置协议插件」视为启动必需，错误一路返回到 `main` 的 `log.Fatal`，进程退出码 1。之前所有验证（`tauri dev`、仓库内跑包内 sidecar）都从仓库目录启动，能向上找到 `plugin-packages`，所以这个缺口在开发路径上完全隐藏。

实测定位（均为包内 sidecar，端口逐个更换）：工作目录 `/`、`/tmp`、`$HOME` 一律退出码 1；工作目录为仓库时正常启动；工作目录 `/tmp` 但显式给出 `CANVAS_OFFICIAL_PLUGIN_DIR` 正常启动；指向一个**空目录**也能启动——说明唯一硬条件是「该目录必须存在且可读」。

改动：

| 改动 | 位置 |
| --- | --- |
| 暂存官方插件包随包携带 | `stage-assets.sh`：`plugin-packages/*.yingce-plugin` → `resources/plugin-packages`（只取顶层包文件，源码目录不复制） |
| 资源映射 | `tauri.conf.json` 的 `bundle.resources` 增加 `resources/plugin-packages` → `plugin-packages` |
| 壳解析并注入 | `config.rs` 的 `resolve_plugin_dir`（显式变量优先，其次 bundle 资源）→ `server.rs` 注入 `CANVAS_OFFICIAL_PLUGIN_DIR` |

验证：

| 验证 | 命令 / 路径 | 结果 |
| --- | --- | --- |
| 壳类型检查 | `cargo check --all-targets` | 无 error |
| 重新打包 | `bunx --bun tauri build --bundles app` | `影策.app` 310.62 MiB；`Contents/Resources/plugin-packages` 101 个包 / 86M |
| 从窗口启动 | 双击/`open` `影策.app` | 日志「本地服务进程已拉起」→「backend listening」→「本地服务已就绪，导航窗口」；无插件目录警告 |
| 入口探针 | `http://127.0.0.1:<port>` 的 `/api/health/ready`、`/`、`/canvas/123` | 均 200 |
| 插件真的加载 | `<数据目录>/plugin_registry.json` | 104 条，含 `a6api` / `adobe-firefly` / `agnes-image` / `official-payment-*` 等官方包 |
| 端口复用 | 重启打包版 | 「沿用上次端口 50491」，`desktop.json` 记录 `port: 50491` |
| 前端在真实调用 | 窗口就绪后的后端日志 | `POST /api/ai/models` status=200，来自 127.0.0.1 |

体积代价：225M → 310.62 MiB。其中 `official-payment-*` 五个包占 85M 左右，是支付页 Host 资源，本地单用户实例用不到；如后续要瘦身，可在 `stage-assets.sh` 里按前缀排除，但会同时失去这五个支付渠道的内置注册。
