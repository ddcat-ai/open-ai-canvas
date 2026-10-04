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
   ├─ icons/               # 提交进仓库的构建输入
   └─ src/                 # config / server / tray / commands / prefs / keep_awake / shell_i18n / …
```

- Go 服务二进制走 `bundle.externalBin`：Tauri 按目标三元组命名并在 macOS 签名阶段一并签名，这是 sidecar 的既定形态；web 产物走 `bundle.resources` 映射到资源目录 `web/`。ADR 里「`bundle.resources` 带 sidecar 与 web 资源」的 sidecar 一项按此细化。
- sidecar 必须用 `CGO_ENABLED=1` 构建：后端 SQLite 走 `gorm.io/driver/sqlite` → `mattn/go-sqlite3`，`CGO_ENABLED=0` 的二进制启动即报 stub 错误、无法建库。代价是跨平台构建需要各自的原生工具链：macOS 本机构建用 Xcode CLT 的 clang；Windows 需在 Windows 上构建（或备好 mingw-w64 交叉工具链）。容器镜像早已是 `CGO_ENABLED=1`（`backend/Dockerfile`），桌面侧与之一致。
- 子进程用 `tauri-plugin-shell` 的 sidecar 调用，不用 `std::process::Command` 自己拼路径。

### 1.7 退出语义

正常退出时壳主动结束子进程，孤儿看门狗用于壳被强杀或崩溃的情形：两条路径都要有，只靠其中一条会分别留下孤儿进程或依赖超时退出。看门狗轮询间隔取秒级，保证壳异常退出后服务不会被另一实例长期占用端口。

## 2. 落地项与状态

| # | 项 | 状态 | 验收 |
| --- | --- | --- | --- |
| 1 | 后端静态承载 `CANVAS_STATIC_DIR` | 已完成 | 文件命中、SPA 回退、不劫持 `/api`、目录穿越拒绝、未配置时行为不变（Go 测试） |
| 2 | 后端孤儿看门狗 | 已完成 | 父进程消失后退出；POSIX 与 Windows 各自实现，交叉编译通过 |
| 3 | `apps/desktop/` 壳 | 已完成 | `cargo check --all-targets` 无 error/warning、`cargo test` 14 项通过；实机启动到 `影策.app` 内 bundled sidecar，健康门 200、SPA 深链 200、就绪后导航窗口 |
| 4 | 打包链路 | 已完成（macOS 无签名） | `bunx --bun tauri build --bundles app` 从零产出 `影策.app`（190M，内含 web 产物与 sidecar）；签名与 DMG 仍需凭据 |
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

Rust 侧（`apps/desktop/src-tauri`）：`cargo check --all-targets` 无 error 无 warning，`cargo test` 14 项全通过。首次编译暴露并修复了 4 个真实缺陷——`build.rs` 找 `VERSION` 的层级差一层（写成 `../../VERSION`，实际仓库根在三层之上）、`CommandEvent` 是 `non_exhaustive` 漏了通配分支、`state.rs` 的 `boot_error` 缺 `mut`、`commands.rs` 里 `open_path` 传了 `PathBuf` 而插件只收 `String`，以及尾表达式里锁 guard 的临时值释放顺序导致的 `state does not live long enough`。另有一个死字段 `shell_i18n::window_title`，改为启动与切语言时真实设置窗口标题。


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
