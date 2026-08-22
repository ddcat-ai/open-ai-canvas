# AGENTS.md

本文件是影策仓库中 AI、自动化工具和协作者的工作约定。用户当前任务优先于本文件；本文件优先于个人习惯。所有结论应能回溯到代码、配置、测试、日志或文档，不用历史印象替代现状。

## 1. 项目边界

影策（`ddcat-ai/open-ai-canvas`）是面向 AI 影视与短剧创作的工作台，当前仍在快速开发。公开接口、数据结构和部署配置可能直接调整；除非任务明确要求，不为旧字段、旧 API 或旧数据增加兼容层。

仓库由几个边界清晰但可独立运行的单元组成：

| 单元 | 技术栈 | 入口 | 责任 |
| --- | --- | --- | --- |
| `web/` | Vite、React 19、TypeScript、React Router、Ant Design、Tailwind、Zustand、TanStack Query | `web/src/application.tsx`、`web/src/router.tsx` | 工作区 UI、画布交互、浏览器缓存、API 调用和模型协议适配 |
| `backend/` | Go 1.25、Gin、GORM、SQLite/PostgreSQL、Redis 协调 | `backend/cmd/server/main.go` | 登录、权限、业务 API、任务队列、资源、模型中转和后台管理 |
| `canvas-agent/` | Node.js 18+、TypeScript、Express、MCP SDK、Codex SDK | `canvas-agent/src/index.ts` | 本机 Agent、MCP、画布会话桥接和本地渠道 |
| `plugins/yingce/` | Codex App 插件清单和 skills | `.codex-plugin/plugin.json` | 将 Canvas Agent MCP 接入 Codex App |
| `docs/` | Next.js、Fumadocs、MDX | `docs/content/docs/` | 面向用户和开发者的专题文档；构建配置见 `docs/source.config.ts` |

根目录的 `Dockerfile` 构建前端静态镜像；`nginx.conf` 托管 SPA 并代理后端。`docker-compose.dev.yml` 是源码热更新开发编排，`docker-compose.local.yml` 是本地构建运行，`docker-compose.deploy.yml` 是 PostgreSQL + Redis 部署编排。

## 2. 开始工作前

1. 先读取任务涉及的入口、调用方、配置、锁文件和相邻测试；先理解现状，再决定是否抽象或重构。
2. 使用 `rg` / `rg --files` 搜索，优先并行读取相关文件。不要为了“统一风格”改动无关模块、依赖、格式或用户已有修改。
3. 先形成目标边界：页面负责什么、service 负责什么、handler/service/repository 如何分层、数据和错误如何流动。新增 helper 必须消除真实重复或隔离明确协议，不能只透传参数。
4. 检查 `git status --short`。不覆盖、不回滚、不清理非本次产生的变更；不使用 `git reset --hard`、`git checkout --` 或宽范围删除。
5. 手工编辑使用 `apply_patch`；默认使用 ASCII，业务中文或已有 Unicode 文件除外。注释只解释非直观算法、核心入口、安全边界和降级原因。

## 3. 目录职责和依赖方向

### 前端

- `web/src/pages/`：路由页面及页面私有 hook/组件；页面协调流程，不直接拼装后端协议。
- `web/src/layouts/`：路由级布局、全局浮层和页面壳；不要在页面重复设置全局 body 状态。
- `web/src/components/`：真实跨页面复用的 UI 或交互能力；页面私有组件留在页面目录。
- `web/src/services/api/`：业务 API、模型渠道协议、资源 API；不依赖 JSX、路由或 AntD 提示。
- `web/src/services/`：文件、媒体、同步、缓存和生成任务等跨页面副作用。
- `web/src/stores/`：跨页面状态和持久化配置；页面临时状态留在页面，媒体大对象不进 `localStorage`。
- `web/src/lib/`：纯函数、画布算法、协议转换、设计 token 和可独立测试的基础能力。
- `web/src/styles/globals.css`：变量、重置和必要的第三方覆盖；页面样式优先使用现有 token 或页面样式。

### 后端

- `backend/internal/handler/`：HTTP 入参、鉴权上下文、调用 service、返回统一响应；不放业务判断和数据库查询。
- `backend/internal/service/`：校验、权限、默认值、ID、时间、配额、幂等、任务编排和外部调用。
- `backend/internal/repository/`：GORM 查询和持久化；不承载业务策略。
- `backend/internal/model/`：结构、枚举和简单模型方法；不调用外部服务。
- `backend/internal/provider/`：模型供应商能力和协议实现。
- `backend/internal/database/`：数据库连接、迁移和连接池。
- `backend/cmd/`：可执行入口、迁移和启动配置；启动参数不得绕过数据目录约束。

调用链应保持为：`HTTP -> handler -> service -> repository/model -> database/resource`；需要模型上游时由 service 进入 `provider/outbound`。跨层调用必须有明确理由并补测试。

### Agent、插件和文档

- 修改 `canvas-agent/` 前先读 `canvas-agent/README.md`，它有独立的 Node 版本、构建、发布和 token 边界。
- 修改 `plugins/yingce/` 前先读插件 README、manifest 和对应 skill；不要把主应用的页面约定套到插件运行时。
- 修改 `docs/` 前确认内容属于专题文档，而不是把长篇说明重新复制到根 README。目录索引见 `docs/index.md`。

## 4. 前端 API 和状态合同

### 后端业务 JSON

业务 API 的唯一公共客户端是 `web/src/services/api/request.ts` 导出的 `apiClient` 和 `request<T>`：

- 复用现有 `axios.create`；不要新增 `httpClient`、平行响应解包器或业务模块自己的 axios 实例。
- `apiClient` 默认使用 `VITE_CANVAS_BACKEND_URL || "/api"` 和 `withCredentials: true`，登录 Cookie 不放进 URL。
- 后端成功响应为 `{ code: 0, data: T, msg: string }`；HTTP 200 不等于业务成功，`code !== 0` 必须抛错。
- API 模块定义并导出接口类型；页面和 React Query 直接接收解包后的 `data`，不重复访问 `.data.data`。
- 查询参数使用 `compactApiParams` / `serializeApiParams`；取消请求传递 `AbortSignal` 并保留取消语义。
- `FormData` 不手动设置 `Content-Type`，让 Axios 生成 boundary。写路径失败必须向上抛出，不能 `catch { return defaultValue }`。

### 模型渠道和流式请求

- 文本、图片、视频、音频模型请求统一经过 `web/src/services/api/custom-channel-relay.ts` 的 `channelRequest` 及其协议函数。
- 自定义渠道必须由登录态后端 `/api/ai/custom` 中转；重建 headers 时清除 `x-goog-api-key` 和旧的 `X-Canvas-Upstream-Headers`，不得把第三方密钥放入浏览器 URL。
- Provider 特有 payload、响应解包和状态机留在对应 `image.ts`、`video.ts`、`audio.ts`；不要塞进通用 `request.ts`。
- 原始 `fetch` 仅用于媒体 blob/data URL、资源、Worker/本地 Agent 或 SSE；必须检查 `response.ok`，传递正确的 `credentials` 和 `signal`。
- 文本任务 SSE 是 `GET /api/tasks/:id/text-events`，游标是递增事件 `id`；断线使用 `Last-Event-ID` 或 `?after=`，不能把任务 ID 当游标。
- 代理只对文本任务和明确的系统模型事件流路径关闭缓冲/缓存/gzip；不要给所有 `/api/` 请求复制长超时和 `proxy_buffering off`。

### 数据、缓存和写路径

- 画布、项目、任务、素材和大 JSON 使用带用户 scope 的 `localforage`；`localStorage` 只保存小型配置、当前 scope 或 UI 偏好。
- 用户切换时隔离 React Query、localforage 和资源缓存；不能让账号之间串数据。
- 后端不可用时的本地缓存是降级，不代表服务端已保存。UI 必须区分“本地缓存成功”和“服务端持久化成功”。
- 生成、激活、审批、权限、删除、上传、配额、账务和密钥相关操作属于强校验写路径；不使用空 ID、默认用户、默认权限或默认额度兜底。
- 素材删除必须先检查项目、画布、任务和其他业务引用；有引用则保留并返回来源，无引用才清理物理对象。物理删除失败不得删除素材记录。

## 5. 后端响应、权限和安全

- Gin 接口统一返回 `{ code, data, msg }`；失败时 HTTP status 和业务 `code` 都应表达真实失败，不把所有错误包装成 200。
- 所有对象读取、更新、删除都在 service 校验当前用户和资源归属；管理员权限在 service 校验，不依赖前端隐藏按钮。
- 默认拒绝本机、私网和链路本地上游。可信开发主机只能通过 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` 精确放行；不要设置“允许全部私网”来绕过 SSRF 防护。
- 用户 API Key 保存在浏览器本地，任务创建时可能提交给自部署后端；只在可信部署和 HTTPS 下使用真实密钥。日志、错误上报、URL、localStorage 和持久任务正文不得写入敏感 URL、Cookie 或 API Key。
- 生产必须配置明确的 `CANVAS_CORS_ORIGINS`，保持 HTTPS，限制数据库、备份、数据目录和 `.settings-key` 权限；默认关闭公开注册。
- 数据库字段或表变化时同步更新 `docs/content/docs/backend/backend-database.mdx`，不能只改 GORM model。

## 6. 画布、UI 和设计系统

- 画布组件、状态、算法分别放在 `web/src/components/canvas/`、`web/src/stores/canvas/`、`web/src/lib/canvas/`。事件忽略选择器必须覆盖 modal、popover、dropdown 等浮层。
- 画布拖拽、连接、缩放和快捷键要考虑 pointer capture、滚轮冒泡、焦点以及 `data-canvas-no-zoom` / `data-canvas-wheel-scroll` 边界。
- 节点和对象名称要有可发现的铅笔入口并支持单击编辑；双击或右键不能是唯一入口。图片节点保持原始比例，面板不能长期遮挡主要画布空间。
- Ant Design 共性主题和控件状态集中在 `web/src/lib/app-theme.ts` / `AppProviders`。Modal 当前内容外壳是 `.ant-modal-container`，优先使用 `styles.container`、`styles.body` 和组件 class。
- 第三方覆盖限定在具体组件，不新增全局 `.ant-modal-*`、`.dark .ant-switch-*`、`.ant-checkbox-*` 或 Segmented 状态补丁。新增 CSS 前先搜索同名选择器，回到唯一源规则修改。
- 遵循 `docs/ui-design-system.md` 及项目三层 token：Primitive → Semantic → Component。inline style 优先引用 `var(--token-name)`，不要散落颜色、圆角、阴影和层级字面值。
- 主操作、普通选中、Checkbox/Radio、Switch 是不同颜色角色；持久切换使用 `aria-pressed`，`type="primary"` 只表示当前主要命令。尊重 `prefers-reduced-motion`，键盘导航保留 `:focus-visible`。

## 7. 本地开发、部署和数据目录

- 先阅读 `.env.example` 和对应 Compose 文件。宿主机后端开发必须使用 Git 忽略的 `.local/project-workbench-debug`，通过 `CANVAS_BACKEND_DATA_DIR` 显式指定；不要把 `backend/data` 当作开发账号数据库。
- 本地缓存放 `.local/cache`；不要提交数据库、上传文件、`.env`、真实密钥、构建产物或编辑器配置。
- 宿主机开发：`backend/` 运行 `CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server`，`web/` 使用 Bun 和 Vite。Docker 热更新使用 `docker-compose.dev.yml`；本地构建运行使用 `docker-compose.local.yml`。
- 生产 Compose 使用 `docker-compose.deploy.yml`（PostgreSQL、Redis、backend、web），源码构建可叠加 `docker-compose.build.yml`。公网只暴露 web 的 `3000`，backend `8080` 留在 Compose 网络内。
- 默认不启动 dev server；只有用户明确要求浏览器预览或联调时才启动，并先确认端口、数据目录和现有进程。
- 健康检查只能证明入口可用，不能替代登录、SSE、任务生成和资源访问验证。

## 8. 验证纪律

项目当前默认不自动运行语法检查、类型检查、测试或构建。用户明确要求验证，或改动风险需要验证时，按范围选择最小充分命令，并在交付中如实记录：

- 前端：`cd web && bun run build`；专项测试用 `bun test ...`。
- 后端：`cd backend && go test ./...`；涉及 PostgreSQL、资源、任务或权限时补对应集成/冒烟路径。
- Canvas Agent：`cd canvas-agent && npm test`，构建用 `npm run build`。
- 文档站：`cd docs && bun run types:check` 或 `bun run build`。
- UI 变更能浏览器验证时，检查关键路由、明暗主题、滚动、弹窗、空态和核心交互；不能验证时说明替代依据，不把静态阅读或 `git diff` 写成运行验证。

同类失败连续三次时停止盲试，记录现象、已排除项和新假设，再切换路径或请求用户决策。

## 9. 文档与交付

- 根 `README.md` 只保留项目定位、能力概览、快速开始、部署、安全和文档入口；详细专题写入 `docs/content/docs/`。
- 功能、代码地图、待办、待测试分别维护在 `docs/content/docs/overview/features.mdx`、`docs/content/docs/backend/code-map.mdx`、`docs/content/docs/progress/todo.mdx`、`docs/content/docs/progress/pending-test.mdx`。已实现但未由用户确认的变化先写入 `pending-test.mdx`。
- API、数据表、SSE、资源存储、部署或安全边界变化时同步对应专题文档；不要只改代码和根 README。
- 文档默认中文，不写过期日期，不公开密码、Token、Cookie、真实账号或机器敏感路径。命令、端口、环境变量必须以当前脚本和 Compose 为准。
- Git 提交说明使用 `<type>(<scope>): <业务模块> - <变更摘要>`，`type` 为 `feat|fix|refactor|perf|docs|test|build|ci|chore|revert`。

交付前至少检查：改动是否聚焦、调用方和类型是否同步、错误/权限/数据归属是否完整、必要文档是否同步、验证是否如实说明、是否留下密钥或本地数据。
