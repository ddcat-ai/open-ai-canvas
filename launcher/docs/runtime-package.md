# 源码安装运行目录与本地网关

活动安装入口为 `launcher/src-tauri/src/core.rs` 和 `source_install.rs`。当前从固定公开 Release 提交现场构建，不依赖预先发布 `yingce-runtime-*.zip`。旧 `stage-runtime.mjs` 仅是遗留本地预构建整理工具，不参与默认安装。

## 受管目录

```text
管理根目录/
├── sources/<commit>/                  # 独立下载的源码（成功后保留）
├── releases/source-<commit>/
│   ├── runtime/bin/yingce-runtime[.exe]
│   ├── runtime/bin/yingce-backend[.exe]
│   ├── runtime/web/                    # 真实 Vite dist
│   ├── runtime/node/node[.exe]
│   ├── runtime/agent/                  # 脚本、锁文件及生产 node_modules
│   └── plugin-packages/                # .yingce-plugin 包
├── data-versions/<版本标识>-<时间标识>/ # 每次安装独立的数据副本
├── data/                              # 旧布局数据，仍保留
├── cache/                             # 完整源码归档、工具及依赖缓存
├── staging/
├── logs/
└── state/                             # 配置、文件库存、当前版本/数据指针
```

目标目录已存在时不静默覆盖数据；失败构建的同提交产物需保留再准备新候选。不得手动合并不同版本数据或删除活跃锁。

## 工具链与构建

- Go 最低版本取源码 `backend/go.mod`，Bun 取 `web/package.json#packageManager`，Node >=22.19.0 且须有 npm。
- 可复用满足最低要求的系统工具；缺失 Go/Bun/Node 下载到缓存，核对官方 SHA-256。Windows 缺少 CC 时准备便携 LLVM-MinGW，同样要求官方摘要。
- macOS 使用 `xcode-select --install`；Debian/Ubuntu 安装 `build-essential`，Fedora 安装 `gcc glibc-devel`。Unix 缺少编译器/头文件时明确失败，不自动改系统安装。
- 先执行本机 C 编译/链接/运行探测，再下载 Go 依赖并以 `CGO_ENABLED=1` 编译 SQLite 后端，注入精确 Release 版本与提交。
- 按锁文件安装前端依赖、执行真实 Vite 生产构建；复制 Agent 脚本并用 `npm ci --omit=dev --ignore-scripts` 安装生产依赖，配套 Node；构建当前平台支付插件并封装官方插件。
- 网关不是安装时外部下载：`src-tauri/build.rs` 用 Go >=1.25、`CGO_ENABLED=0` 编译独立 `launcher/runtime/`，嵌入应用，安装时写入运行目录。不要混淆网关 CGO=0 与业务后端 CGO=1。

## 网关及环境

网关是独立 Go 模块，以发布目录为基础定位文件：

```text
runtime/bin/yingce-runtime[.exe] --port <固定端口> --data-dir <绝对受管数据目录>
```

仅监听 `127.0.0.1`，默认浏览器端口 37890，不自动改端口。静态文件限定在 `runtime/web`，真实 SPA 回退、资源缺失 404；同源代理 API、OAuth 和 SSE/WebSocket。校验 Host/Origin，不暴露后端二进制、Node 或数据目录。

后端使用内部随机回环端口，明确设置 SQLite、`CANVAS_BACKEND_DATA_DIR`、`CANVAS_PI_RUNTIME_DIR`、`CANVAS_OFFICIAL_PLUGIN_DIR` 及精确 CORS 来源；PATH 仅提供配套 Node，不继承宿主数据库、远端 Agent、调试或私网上游放行配置。不设置 `YINGCE_AGENT_URL`，不改变服务器独立 Agent 容器机制。业务登录、归属、权限和 SSRF 校验仍有效。

`/api/health/ready` 代理真实后端，就绪后还须核对版本和完整提交。网关监听成功或一次健康响应不等于完整业务验收。

## 正常关闭与更新

仅在下载的固定源码副本中，安装器为 Go 后端增加认证回环关闭适配；不修改开发仓库 `backend/`。私有 POST 钩子校验真实回环来源和随机 Token，请求取消后端上下文；网关正常停止等待后端退出，超时才清理进程树。令牌不放 URL、不写日志；该入口不是对外业务 API。

Windows 使用 Job Object、Unix 使用进程组及数据目录互斥。异常退出/强制终止仍不保证任务无损。正常停服、锁释放及跨平台残留进程行为须实测，不能以单元测试代替。

更新显式先停止，持旧数据锁复制到新目录，候选在副本上自动迁移，精确就绪核对后才提交新指针；旧版本和数据保留。没有实现数据库自动降级、完整断电恢复或全盘备份产品。浏览器 IndexedDB 不包含在服务端复制中。

## 验证边界

Rust/前端专项结果与实网探测记录见 [README](../README.md)。官方源码和受管 Bun已取得；直连 Go 依赖失败、镜像依赖成功不等于安装成功。Windows LLVM 规范化路径问题修正后的完整安装仍待确认；macOS/Linux 原生流程未验收。

待验证：首次安装/停止/重启、克隆迁移与失败回退、登录/上传/Agent/SSE/WebSocket、完整模型生成、媒体工具及动态库、中文和空格路径、低磁盘空间、崩溃与锁竞争。网关单元测试、历史交叉编译或 CI 产物不能替代这些验收。
