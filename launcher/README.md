# 影策启动器（源码安装开发版）

独立 Tauri 桌面启动器：点击“安装并启动”，从固定公共仓库的 `main` 分支解析最新完整提交（上游不发 Release），下载该提交的 GitHub 源码归档，在独立受管目录编译真实影策；服务就绪后打开默认浏览器。**不操作用户现有开发仓库，不再等待上游提供桌面预构建运行包**。

## 当前安装与更新路径

- 来源固定为 <https://github.com/ddcat-ai/open-ai-canvas>，匿名读取公开仓库 `main` 的最新提交，无需 Git、GitHub Token、发布公钥或云账号。
- 检查 Go（不低于下载源码的 `backend/go.mod`）、Bun（不低于 `web/package.json#packageManager`）、Node（>=22.19.0，含 npm）及 C 编译器。缺失工具下载到独立缓存，按官方发布摘要校验；不修改全局 PATH。
- Windows 缺少 C 编译器时准备便携 LLVM-MinGW；macOS/Linux 须自行安装系统编译器和开发头文件。后端启用 `CGO_ENABLED=1`，不会用无 SQLite 能力的构建冒充成功。
- 构建真实后端、Vite 网页、Agent 生产依赖、配套 Node 和官方插件包。网关在启动器构建时编译并嵌入应用，安装时释放。
- 工作台展示安装/下载/构建/验证阶段进度和受控日志；百分比是阶段进度，不是精确剩余时间。
- 更新必须显式先停止服务。持旧数据锁复制完整数据到新的 `data-versions/`，候选后端仅在副本上执行启动时自动迁移，精确核对版本、提交及就绪后才持久化新指针。旧版本和原数据保留，不静默覆盖，也不承诺已完成自动灾难恢复。
- 默认使用镜像下载（`gh-proxy.com`，Go 依赖 `goproxy.cn`，npm 依赖 `registry.npmmirror.com`），可在设置中改为官方直连或“按需”；设置保留六个第三方 GitHub 代理候选（`gh-proxy.com`、`gh-proxy.org`、`gh.idayer.com`、`cors.isteed.cc`、`ghfast.top`、`ghproxy.net`），下载前自动测速排序。详情见[镜像说明](docs/mirror-options.md)。

固定浏览器地址默认 `http://127.0.0.1:37890`；端口冲突不自动换端口，改变端口会改变浏览器缓存作用域。网关仅回环监听，保留业务登录、权限和 SSRF 校验。

## 验证现状与限制

已收到的专项结果：Rust 19 项通过、2 项实网测试默认忽略；启动器前端 11 项测试及构建通过。这些不是完整产品验收。

真实首次安装探测已下载约 300 MB 官方源码并验证受管 Bun；官方直连 Go 依赖连接失败，启用镜像后 Go 依赖下载成功。Windows CGO 随后遇到规范化路径 `\\?\` 导致 LLVM 头文件查找失败；路径适配已修正，完整重试仍未确认成功。**尚不能宣称首次安装、启动、停止及重启端到端通过**。

- macOS/Linux 尚无原生完整安装与运行验证；CI 矩阵或交叉编译不等于真机通过。
- 登录、上传、Agent、SSE/WebSocket、完整模型生成及媒体链路仍待真实应用验收。
- 下载取消、磁盘空间预检、启动器自更新、托盘未完成。源码包与工具包支持 Range 分段续传（仅同一来源内续传，代理忽略 Range 时整包重下）；首次安装按目录清单只下载构建需要的文件，不可用时退回完整源码包。
- 私有认证回环关闭适配仅修改下载的独立 Go 源码，不修改仓库后端；正常停止会请求后端退出，强制终止与异常退出不保证任务无损。
- 更新失败注入、迁移失败恢复、进程残留、断电与数据一致性仍待验证；请保留旧目录，不手动删除活跃数据锁。
- 摘要校验不等于独立发布者签名，公共代理及工具/包源有各自信任与网络边界。

## 开发与验证命令

构建启动器需要 Bun、Rust/Cargo、**Go >=1.25** 及平台 Tauri 依赖（Go 用于 `build.rs` 内嵌本机网关）：

```sh
cd launcher
bun install --frozen-lockfile
bun run tauri dev
# 含打包网页及网关的开发可执行文件
bun run tauri build --debug --no-bundle
# 专项验证
bun run build
bun test src/
cd src-tauri
cargo test --locked --lib
```

实网测试不会在普通测试中自动执行：

```powershell
# 在仓库根目录；必须指定 .local 下绝对、隔离、可保留的 smoke 根目录
$env:YINGCE_LAUNCHER_SMOKE_ROOT = Join-Path (Get-Location).Path '.local/launcher-source-smoke'
# 网络需要时启用；不需要时 Remove-Item Env:YINGCE_LAUNCHER_SMOKE_MIRROR
$env:YINGCE_LAUNCHER_SMOKE_MIRROR = '1'
Set-Location launcher/src-tauri
cargo test --locked source_install_live_smoke -- --ignored --nocapture
# 仅检查 main 最新提交（不是完整安装）
cargo test --locked public_repository_live_probe -- --ignored --nocapture
```

smoke 会联网下载、编译、启动真实后端并保留隔离数据；已有安装时测试启动/停止/重启，不会重新覆盖安装。不得指向开发账号、生产数据或已有业务目录。网关专项：在 `launcher/runtime` 执行 `go test ./...`。

## 文档

- [公共发布与源码安装来源](docs/release-publishing.md)
- [运行目录及网关](docs/runtime-package.md)
- [镜像与依赖源](docs/mirror-options.md)
- [当前方案与待验收边界](../docs/specs/feature-001-local-launcher.md)
