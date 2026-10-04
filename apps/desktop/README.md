# 影策桌面壳

与 `web/`、`backend/` 平级的独立构建单元。壳只做宿主：选一个空闲回环端口、拉起后端 sidecar、轮询健康门、再把窗口导航到本地地址。业务逻辑一概不在壳里。

边界与取舍见 `docs/adr/0010-desktop-shell-tauri-local-service.md`，环境变量契约、产物布局、退出语义与验收方式见 `docs/plans/desktop-shell-implementation.md`。改壳与后端的接口时以那份契约为准，两侧同时改。

## 目录

```text
apps/desktop/
├─ package.json            # 只装 @tauri-apps/cli，用 bun；不要引入其他前端依赖
├─ bun.lock                # 唯一锁文件（不要产生 pnpm-lock.yaml / package-lock.json）
├─ splash/index.html       # 启动页：纯静态，无构建，Tauri 窗口的初始地址
├─ icon-source.svg         # 图标源（可替换），由图标脚本转成 PNG 再生成图标集
├─ scripts/
│  ├─ stage-assets.sh      # 打包输入：web/dist + Go sidecar → src-tauri/{resources,binaries}
│  ├─ generate-icons.sh    # icon-source.svg → src-tauri/icons/
│  └─ build-dmg.sh         # macOS：tauri build → 签名 → DMG → 公证 → 装订
└─ src-tauri/
   ├─ Cargo.toml           # version 必须与仓库根 VERSION 一致（build.rs 会校验并失败）
   ├─ build.rs             # 版本漂移守卫
   ├─ tauri.conf.json      # 窗口、bundle、sidecar 与资源映射
   ├─ capabilities/        # 页面内调用壳命令的权限声明
   ├─ entitlements.plist   # macOS 签名用的授权文件
   ├─ icons/               # 构建输入（提交进仓库）；替换方式见下方
   └─ src/                 # config / server / tray / commands / prefs / keep_awake / shell_i18n / …
```

`src-tauri/binaries/`、`src-tauri/resources/`、`src-tauri/target/`、`node_modules/` 都不提交。

## 命令

| 命令 | 作用 |
| --- | --- |
| `bun install` | 只装 `@tauri-apps/cli` |
| `bun run stage` | 构建 `web/dist` 与 Go sidecar，暂存到 `src-tauri/` 下（`--skip-web` / `--skip-go` 可跳过单项） |
| `bun run tauri dev` | 开发运行（等价 `bunx --bun tauri dev`） |
| `bun run tauri build` | 打包当前平台产物 |
| `bun run icons` | 由 `icon-source.svg` 重新生成 `src-tauri/icons/` |
| `bun run dmg` | macOS 打包链路；本地验证用 `bash scripts/build-dmg.sh --skip-sign` |

调用 Tauri CLI 一律走 **bun 运行时**（脚本里已写成 `bunx --bun tauri`）。用 node 执行 CLI 的 shim 会直接失败，实测报错是：

```text
Error: Cannot find native binding. npm has a bug related to optional dependencies
    at .../node_modules/@tauri-apps/cli/index.js:577
```

即 `@tauri-apps/cli-darwin-arm64` 装在 `node_modules/` 里、node 却解析不到；`bunx --bun tauri` 能正常加载。这是实测结果，不是风格偏好。

在 `src-tauri/` 里直接跑 `cargo check` / `cargo build` 前需要先 `bun run stage`：`bundle.externalBin` 的 sidecar 在编译期就被校验，没暂存时会以 `resource path binaries/canvas-server-<target-triple> doesn't exist` 失败。这是预期行为，不是配置错误——只跑不带 `--skip-go` 的那一半即可。

## sidecar 必须用 CGO_ENABLED=1 构建

后端 SQLite 走 `gorm.io/driver/sqlite` → `github.com/mattn/go-sqlite3`，是 cgo 实现：

- `CGO_ENABLED=1`（现状，`backend/Dockerfile` 一直如此）：正常建库。
- `CGO_ENABLED=0`：二进制启动即打印 `Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to work. This is a stub` 并退出，健康门 `/api/health/startup` 永远到不了 200，壳只会显示启动失败。**不要用这种产物当占位**。

由此带来的工具链前置条件：

| 目标平台 | 构建方式 |
| --- | --- |
| macOS | 在 macOS 本机构建，Xcode Command Line Tools 的 clang 足够（`xcode-select --install`） |
| Linux | 在 Linux 本机构建，需要 gcc |
| Windows | 在 Windows 本机构建（需要 MSVC 生成工具），或配好 mingw-w64 交叉工具链后在 macOS/Linux 上构建 |

`scripts/stage-assets.sh` 会比对 `rustc -vV` 的 host 三元组与当前系统，不一致时直接报错退出并说明原因，不会静默产出一个起不来的二进制。

## 启动形态与调试覆盖

默认（Managed）形态：选空闲回环端口 → `tauri-plugin-shell` 拉起 sidecar → 轮询 `/api/health/startup` → 导航。壳注入子进程的环境变量见实施文档 §1.1，壳自己不设 `CANVAS_CORS_ORIGINS`。

壳按应用标识符 `ai.ddcat.open-ai-canvas` 做单实例：**dev 会话与打包出的 `影策.app` 共用这一把锁，也共用同一个应用数据目录**。所以 dev 在跑时再启动打包版，第二个进程会直接退出（窗口不出现、终端无输出），看起来像打包版坏了。测打包版前先关掉 dev。

端口会尽量稳定：壳把上次成功监听的端口记在 `desktop.json`，下次启动若仍空闲就直接复用，只有被占用时才另选一个空闲回环端口。原因是浏览器按 origin（含端口）隔离本地存储，端口一变，用户在界面里配的模型与本地缓存就都换了份。

调试用环境变量：

| 变量 | 作用 |
| --- | --- |
| `CANVAS_DESKTOP_DEV_URL` | 非空则窗口直接指向该地址（Vite dev server），不拉 sidecar、不走健康门 |
| `CANVAS_DESKTOP_SERVER_URL` | 非空则复用已运行的本地服务，跳过端口选择与 sidecar 启动，仍走健康门 |
| `CANVAS_SERVER_BIN` | 显式指定 Go 服务可执行文件，优先于 bundle 内 sidecar |
| `CANVAS_DESKTOP_STATIC_DIR` | 覆盖注入子进程的 `CANVAS_STATIC_DIR`（debug 构建默认回退到 `web/dist`） |
| `CANVAS_DESKTOP_APP_DIR` | 覆盖壳的应用根目录（日志、偏好、默认数据目录） |
| `CANVAS_DESKTOP_DATA_DIR` | 覆盖注入子进程的数据目录 |
| `CANVAS_DESKTOP_HEALTH_TIMEOUT_SECS` | 健康门超时秒数，默认 60 |

壳的目录默认落在 OS 应用数据目录（macOS 为 `~/Library/Application Support/ai.ddcat.open-ai-canvas`），**不在仓库内**，与 `.local/project-workbench-debug` 的开发库物理隔离。

`Cargo.toml` 的 `version` 必须与仓库根 `VERSION` 一致：`build.rs` 会在漂移时直接失败，避免安装包版本与后端自称的版本不一致。

## 窗口尺寸

窗口尺寸不是常量，由壳按显示器可用工作区自适应：

| 项 | 行为 |
| --- | --- |
| 偏好尺寸 | 首次启动 1280×800，之后用 `desktop.json` 里上次关闭时的尺寸 |
| 裁到屏幕 | 启动与恢复统一裁到当前显示器**可用工作区**（扣除菜单栏与 Dock）的 92%，再居中 |
| 最小尺寸 | 产品下限 960×640；屏幕工作区比它还小时随之下调 |
| 拿不到工作区 | 不裁、不下调（宁高不缩） |

窗口创建时是隐藏的（`tauri.conf.json` 的 `visible: false`），裁完再显示，不会先闪一下超屏窗口。发生裁剪时壳日志会记下「原尺寸 → 工作区 → 新尺寸」；日志在应用数据目录的 `logs/` 下。

尺寸逻辑是纯函数（`src/prefs.rs` 的 `WindowPrefs::fit_to`）并有单测，改阈值前先看 `cargo test`。


## 图标

`src-tauri/icons/` 里的文件是从 `icon-source.svg` 生成的**临时资产**，可整体替换：改 `icon-source.svg`（或换成任意 1024×1024 方形 PNG，写入 `icon-source.png`）后跑 `bun run icons`；`tauri.conf.json` 的 `bundle.icon` 只引用其中若干个文件，换图标不需要改配置。

## macOS：未签名版本的安装与放行

当前产物没有 Developer ID，只是 ad-hoc 签名（`codesign -dv` 显示 `flags=0x2(adhoc)`），也没有公证。直接双击从网络上下载来的 `影策.app` / DMG 会被 Gatekeeper 拦下——这是 macOS 的正常行为，不是包坏了。本地构建产物没有隔离标记（只有 `com.apple.provenance`），不会触发这一步。

### 1. 去掉下载隔离标记（最主要的一步）

```bash
# 把 app 拖进 /Applications 后执行
xattr -dr com.apple.quarantine "/Applications/影策.app"
```

然后正常双击打开。如果不方便用终端，也可以在 Finder 里**右键 → 打开 → 仍要打开**（只需一次，之后双击即可）。

### 2. 签名不完整时重做一次 ad-hoc 签名

`tauri build` 直接产出的 bundle 只带链接期签名（`codesign -dv` 显示 `flags=0x20002(adhoc,linker-signed)`、`Sealed Resources=none`），`spctl -a -vv` 会报 `code has no resources but signature indicates they must be present`。如果提示「已损坏，无法打开」，就地对整个 bundle 重新签一次：

```bash
codesign --force --deep --sign - "/Applications/影策.app"
```

实测结果：签名从 `linker-signed` 变为完整的 ad-hoc bundle 签名（`Sealed Resources version=2 rules=13 files=1628`），`codesign --verify --deep` 返回 `valid on disk`，`code sign` 标识符也从 `yingce_desktop-<hash>` 变成真正的 `ai.ddcat.open-ai-canvas`。

### 3. 自行确认状态

```bash
codesign --verify --deep --verbose=1 "/Applications/影策.app"   # 期望：valid on disk
codesign -dv --verbose=2 "/Applications/影策.app" 2>&1 | grep -E "flags|Sealed"
spctl -a -vv "/Applications/影策.app"                            # 依然会 rejected，除非有 Developer ID + 公证
```

最后一条 `rejected` 是预期的：ad-hoc 签名不是可信签名，`spctl` 不会通过。它不影响本机运行，但也不应该把这种包当作正式发布物外发——要真正免打扰，得用 Developer ID 签名并公证（`bash scripts/build-dmg.sh`）。


## 尚未接线的部分

ADR-0010 落地顺序第 4 项（选目录、开机自启、外链、更新检查的原生命令与自定义标题栏）不在当前范围内。**Tauri 自更新与后端 host-updater 二选一**：桌面形态下必须关闭或隐藏后端的 `/api/system/update*` 入口，不要同时接两个更新器。

## Agent 运行时供给

后端跑画布智能体时会另行拉起 `node` 执行 `backend/agent-runtime/pi`，这条依赖不在壳的进程表里，必须由打包链路显式供给，否则打包版里智能体必然启动失败（与用户是否配置模型无关）。

现在的做法是「pi 随包、node 按需下载」：

| 产物 | 供给方式 | 落点 |
| --- | --- | --- |
| pi 运行时 | `stage-assets.sh` 打成 `resources/pi-runtime.tar.gz`（约 38M），经 `bundle.resources` 随包携带 | 壳解析出资源路径并注入 `CANVAS_PI_ARCHIVE`；后端解包到 `<数据目录>/runtimes/pi/<sha256 前 12 位>/` |
| node | 后端按需从官方 dist 下载并核对 `SHASUMS256.txt` 的 sha256，校验不过即失败 | `<数据目录>/runtimes/node/<版本>/` |

解包与下载都是先落到同级临时目录、再原子改名，失败不会留下半成品。离线部署可设 `CANVAS_RUNTIME_AUTO_INSTALL=false`，或直接给出 `CANVAS_PI_RUNTIME_DIR` / `CANVAS_NODE_BIN`。变量清单见根目录 `.env.example` 的「Agent 运行时供给」段。

`stage-assets.sh` 用 `-trimpath` 构建 sidecar，编译期路径在打包产物里不可用，所以运行时位置只能靠上面这些变量传递，不能靠相对源码目录推断。

## 官方协议插件供给

后端把「解析不到官方 `plugin-packages` 目录」当作启动失败：`newPluginRuntime` 在引导内置协议插件时直接返回错误，`main` 落成 `log.Fatal`，进程退出码 1。

解析顺序是 `CANVAS_OFFICIAL_PLUGIN_DIR` → 从工作目录向上逐级找 `plugin-packages`（生产容器靠写死的 `/app/plugin-packages` 命中）。双击 `.app` 时壳的工作目录是 `/`，向上找不到，于是第一版打包版其实永远起不来——而 `tauri dev` 和仓库内跑 sidecar 都从仓库目录启动，能向上找到 `plugin-packages`，所以这个缺口在开发路径上一直没暴露。

修法与 pi 运行时一致：`stage-assets.sh` 把 `plugin-packages/*.yingce-plugin` 暂存到 `resources/plugin-packages`（**只取顶层包文件**，后端只读这一种，源码目录复制过去只是白占体积），经 `bundle.resources` 随包携带，壳解析出目录后注入 `CANVAS_OFFICIAL_PLUGIN_DIR`。当前 101 个包约 86M，其中 `official-payment-*` 五个占了大头（支付页 Host 资源，本地单用户实例用不到）。

源码方式运行时不注入这个变量，后端回退到向上查找，行为与以前完全一致。
