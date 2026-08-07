# AGENTS.md

本文件约束本项目中的 AI、自动化工具和协作者。先遵循用户当前任务，再遵循本文件；项目规则优先于个人习惯和通用模板。

## 0. 项目事实与边界

- 项目是“影策”AI 影视创作工作台，当前仍在快速开发，数据结构和外部接口可能直接调整；除非用户明确要求，不为旧字段和旧数据编写迁移兼容层。
- 前端位于 `web/`，技术栈是 Vite、React 19、TypeScript、React Router、Ant Design 6、Tailwind CSS 4、Zustand、TanStack Query。
- 后端位于 `backend/`，技术栈是 Go、Gin、GORM、SQLite；生产/部署也支持 PostgreSQL、Redis、Docker Compose。
- `canvas-agent/` 和 `plugins/` 是相对独立的运行单元，修改其代码时先读取各自 README 和局部规则，不把主应用约定臆测套过去。
- 本项目不是默认公网安全产品。生产环境必须使用 HTTPS、明确 CORS Origin、可信的数据库/OSS/密钥权限和受控的管理员初始化流程。
- 用户配置的 AI API Key 保存在浏览器本地；任务创建时可能提交给自部署后端，只有可信部署和 HTTPS 才允许使用真实密钥。

## 1. 工作方式

- 先读代码、配置、锁文件和相关文档，再判断和修改；每个重要结论都要能回溯到文件、命令输出、依赖源码或用户说明。
- 需求不清时只问影响成败的问题；可以合理假设时声明假设并继续推进。
- 默认推进到可交付状态，但只改任务相关文件，不回滚、覆盖或格式化用户已有的无关修改。
- 修改前先形成目标结构：页面、组件、store、service、repository、handler 各自负责什么；不得通过增加透传 helper 掩盖职责混乱。
- 发现同类错误反复出现时，先找结构性原因并补规则，再修单点；不能只在末尾继续叠加临时覆盖。
- 页面视觉修改以现有主题和用户截图为事实依据。先检查实际 DOM、计算样式和依赖版本，再写选择器；不凭记忆套用第三方类名。
- 使用 `rg` / `rg --files` 搜索，读取文件优先并行；手工编辑必须使用 `apply_patch`，不得用 shell 重定向、`cat >` 或 Python 写文件。
- 默认 ASCII；只有文件已有明确字符集或业务文案确有需要时才引入非 ASCII 内容。
- 核心入口、非直观算法、安全边界和降级策略写简短中文注释，说明“为什么”和关键约束；显而易见的赋值不写注释。

## 2. 变更收敛与代码质量

- 变更保持最小充分范围；不顺手升级依赖、重命名大批文件、重排无关格式或重构无关模块。
- 页面或服务只保留本层职责。纯算法、协议转换、缓存和可独立测试的业务规则放到对应 `lib` 或 service；UI 不直接拼装后端协议。
- 不新增只改名、只透传 props、只包一层调用的组件或 helper；出现重复逻辑时先判断是否真的共享，再抽取有明确合同的能力。
- 新文件建议控制在 500 行以内；文件超过 800 行时，新增功能前优先拆出明确职责。历史超长文件按功能逐步治理，不做无关的大爆炸重构。
- CSS 不允许通过多段同名选择器不断追加“最后一条覆盖”。修改现有组件时优先回到唯一源规则；若必须兼容第三方，集中放在对应第三方覆盖区并删除被替代声明。
- UI 组件不得新增裸 Tailwind 任意值，如 `text-[10px]`、`rounded-[12px]`、`z-[1500]`、`p-[Npx]`、`gap-[Npx]`；使用现有设计 token，缺 token 时按 Primitive → Semantic → Component 顺序补齐。
- inline style 优先引用 `var(--token-name)`，不要散落字面颜色、圆角、阴影、层级和间距。
- 错误不可静默吞掉。读展示路径允许有明确的降级和提示；保存、生成、激活、审批、权限、删除、上传和密钥处理必须强校验并明确失败。
- 通用格式、解析、压缩、加密、日期、媒体处理使用成熟库；不手写已有库解决的底层协议。

## 3. 目录职责

### 前端目录

- `web/src/pages/`：路由页面和页面私有组件；页面私有 hook、类型和小组件放在页面目录内。
- `web/src/layouts/`：路由级布局和全局浮层边界；不要在页面里重复设置全局 body 状态。
- `web/src/components/`：跨页面复用组件；只有真实跨页面复用的能力才上移。
- `web/src/services/api/`：后端业务 API、模型渠道协议和资源 API；不放 React 状态和 JSX。
- `web/src/services/`：文件、媒体、同步和缓存等跨页面副作用；不直接承担页面布局。
- `web/src/stores/`：跨页面状态和持久化；已有全局状态直接读取，不通过多层 props 透传。
- `web/src/lib/`：纯函数、协议转换、画布算法、设计 token 读取和可独立复用的基础能力。
- `web/src/styles/globals.css`：变量、重置、通用样式和必要的第三方覆盖；页面私有样式优先用 Tailwind 或页面目录样式。
- `web/src/router.tsx`：路由配置；不要在页面内部偷偷新增不可发现的路由跳转。

### 后端目录

- `backend/internal/handler/` 只处理 HTTP 入参、鉴权上下文传递、调用 service 和返回 `OK` / `Fail`。
- `backend/internal/service/` 负责业务逻辑、校验、鉴权、默认值、时间、ID、配额、幂等和外部调用编排。
- `backend/internal/repository/` 只负责数据库访问和 GORM 查询，不承载业务判断。
- `backend/internal/model/` 只定义结构、枚举和简单模型方法，不调用外部服务。
- `backend/cmd/` 只放可执行入口、迁移和启动配置；启动参数不得绕过数据目录约束。

## 4. HTTP 客户端与 API 合同

### 4.1 后端业务 API：唯一复用客户端

后端业务 JSON 请求的唯一公共入口是 [`web/src/services/api/request.ts`](web/src/services/api/request.ts)：

- 项目当前没有另一个名为 `httpClient` 的公共实例；“httpClient 合同”实际指这里导出的 `apiClient` + `request<T>`。需要复用时直接使用它们，不要再创建 `httpClient`、`axios.create` 或平行的响应解包器。
- 使用 `apiClient`，它由 `axios.create({ baseURL: VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true })` 创建；必须保留登录 Cookie，不在 URL 中携带会话或 API Key。
- API 模块统一从 `@/services/api/request` 导入 `apiClient`、`request`、`BackendEnvelope`、`ApiParams`；不要在业务 API 文件里重复 `axios.create`。
- 后端成功响应合同是 `{ code: 0, data: T, msg: string }`。HTTP 200 不代表业务成功，`code !== 0` 必须失败。
- 服务层通过 `request<T>(api.get/post/patch/delete(...))` 解包并返回 `data`；调用页面和 React Query 不再重复访问 `.data.data`，也不直接处理 envelope。
- `request<T>` 会把 Axios 错误和后端 `msg` 转为 `Error`；业务模块应保留可读中文错误，不得 `catch { return defaultValue }` 掩盖写路径失败。
- 查询参数使用 `compactApiParams` 清除空值，使用 `serializeApiParams` 处理数组；不要手写不同的数组编码规则。
- 需要取消请求时把 `AbortSignal` 传到 Axios；取消应保留“请求已取消”语义，不提示成普通系统错误。
- `FormData` 通过 `apiClient` 发送时不要手动设置 `Content-Type`，让 Axios 生成 boundary；服务层负责文件名、类型和大小校验。
- API 返回类型在所属模块定义并导出；接口命名和字段沿用后端 JSON camelCase 合同，不在页面临时 `Record<string, unknown>` 传播。
- API 模块不得依赖页面组件、AntD message 或路由；用户提示由调用层决定，协议错误由 service 明确抛出。

### 4.2 模型渠道 API：必须经过渠道中转合同

- 文本、图片、视频、音频模型请求必须使用 [`web/src/services/api/custom-channel-relay.ts`](web/src/services/api/custom-channel-relay.ts) 的 `channelRequest`，再由 `channelPost` / `channelGet` 等小型协议函数发送。
- `channelRequest` 的返回值是 `{ url, headers, credentials }`：系统代理可以直连；自定义渠道必须改为登录态后端 `/api/ai/custom` 中转，并传 `X-Canvas-Upstream-URL`、`X-Canvas-Upstream-Format` 和编码后的渠道 headers。
- 自定义渠道的 `x-goog-api-key`、旧的 `X-Canvas-Upstream-Headers` 必须在重建 headers 时清除；不得绕过中转把第三方密钥暴露给浏览器或 URL。
- 统一保留 `AbortSignal`、`withCredentials` / `credentials` 和必要的幂等头；写请求失败必须向上抛出，不用默认任务结果掩盖。
- `buildApiUrl`、`resolveBackendApiUrl`、`isSystemProxyBaseUrl` 是现有 URL 解析合同；不要在各 provider 文件里重新拼接 `/v1`、`/v1beta` 或 `/api`。
- Provider 特有的 payload、响应解包和状态机放在对应 `image.ts`、`video.ts`、`audio.ts`；不要把 provider 分支塞进通用 `request.ts`。

### 4.3 fetch、媒体和流式请求例外

- 原始 `fetch` 只允许用于媒体 blob/data URL、资源文件、Worker/本地 Agent 通道或 SSE/流式响应等非标准 JSON 场景；必须检查 `response.ok`，并按资源类型设置 `credentials` 和 `signal`。
- 后端 JSON 不得因为“方便”改用裸 `fetch`；若确需例外，必须在所属 service 写清响应合同、状态检查和错误转换。
- 资源 URL 使用 `resource:<id>` storage key；资源文件下载和 OSS URL 解析统一通过 `services/api/resources.ts`，不要在组件里直接拼接 `/resources/...`。
- 文本 SSE 合同是 `GET /api/tasks/:id/text-events`，事件包含 `delta` 和终态 `terminal`；游标是单调递增事件 `id`，断线恢复使用 `Last-Event-ID` 或 `?after=`，不能把任务 ID 当游标。
- SSE 只对该路径关闭代理缓冲、缓存和 gzip；不得把长超时和 `proxy_buffering off` 复制到所有 `/api/` 请求。
- blob 下载、图片/视频生成结果和 OSS 私有资源不得把敏感 URL、Cookie、API Key 写入日志、localStorage 或错误上报。

### 4.4 后端响应、权限和安全合同

- Gin 接口统一返回 `{ code, data, msg }`；成功使用 `code: 0`，失败的 HTTP status 与 `code` 必须表达真实失败，不得始终返回 200。
- 列表接口沿用 `model.Query`、`Normalize`、分页和标签筛选；新增列表字段要同步前端类型和文档。
- 所有后端对象读取、更新、删除必须校验当前用户和资源归属；管理员能力必须在 service 层鉴权，不依赖前端隐藏按钮。
- 生成、激活、权限、删除、上传、配额、账务和密钥相关操作属于强校验写路径；禁止用空 ID、默认用户、默认权限或默认额度兜底。
- 新增或调整数据表时同步更新 `docs/content/docs/backend/backend-database.mdx`；不要只改 GORM model。
- SSRF 防护默认拒绝本机、私网和链路本地上游；开发时只用 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS` 精确放行可信主机，不设置“允许全部私网”。

## 5. 数据、状态与缓存

- 业务列表、生成记录、媒体和大 JSON 使用 `localforage`；`localStorage` 只保存极小配置、当前用户 scope 或明确的 UI 偏好。
- 用户切换时必须清理/隔离 React Query cache、localforage 和资源缓存；storage key 必须带用户 scope，不能让账号之间串数据。
- TanStack Query 使用稳定的业务 `queryKey`，写操作成功后主动 invalidate/refetch 相关 query；不要用页面级 `useEffect` 手工复制整个缓存。
- Zustand store 只保存跨页面状态和持久化配置；页面临时状态留在页面，媒体大对象不要塞进 localStorage。
- 生成任务、资源、画布、素材的本地缓存是后端不可用时的降级，不代表后端已保存；写路径必须区分“本地缓存成功”和“服务端持久化成功”。
- 媒体删除不会自动清理 OSS 远端对象；涉及删除提示和文档时必须说明这个边界。

## 6. 前端 UI 与设计系统

### 6.1 组件和视觉

- Ant Design 共性主题、按钮、下拉框、弹窗和反馈配置集中在 `web/src/lib/app-theme.ts` 或 `AppProviders`；页面不得重复创建全局 ConfigProvider。
- 当前依赖版本以 `web/package.json` 和 lockfile 为准；涉及第三方组件必须先核对安装版本和实际 DOM/源码，再决定类名、语义 `styles` 或 `classNames`。
- **AntD Modal 规则：当前版本使用 `.ant-modal-container` 作为实际内容外壳，默认内容 padding 在该元素上；不得凭旧版本经验只写 `.ant-modal-content`。** 优先使用 `styles={{ container: ... , body: ... }}` 和组件级 class；新增覆盖前必须检查实际渲染结构。
- AntD 第三方覆盖必须限定到具体页面/组件 class，不得用全局 `.ant-modal-*` 改变所有页面；覆盖应集中且唯一，禁止多个末尾 override 互相打架。
- UI 图标优先使用 `lucide-react` 或项目已有 Ant Design 图标；页面文案使用中文。页面身份图标统一使用 `WorkspaceSignalIcon`，导航和操作图标统一使用 `lucide-react`。
- 页面级分类导航至少 44px 高，并提供”图标 + 明确文字”入口和一致选中态；重要设置不能只藏在无文字图标中。
- 可编辑的工作区、画布和对象名称常显铅笔图标并支持单击编辑；双击和右键只能作为快捷方式，不能作为唯一发现路径。
- 不把页面大段说明文字当作”如何使用”的常驻教程；通过明确控件、空态、反馈和可发现的图标+文字表达功能。
- **卡片、列表、交互动效遵循 [UI 设计系统规范](docs/ui-design-system.md)**：统一卡片表面色、边框、投影、hover状态(240ms/translateY -4px)、双主题均衡策略。改造卡片前必须先读该规范，确保新增样式符合设计token体系。

### 6.2 空间、响应式和动效

- 弹窗、抽屉、输入框、卡片和网格要有明确的稳定宽高、滚动边界和响应式约束；避免默认 padding、margin、`min-height` 叠加造成四周大块空白。
- 发现“空白太多/太宽/不对齐”时，先按 DOM 层级检查外层 wrapper、container、content、body 的 computed style，再调整唯一源规则；不要盲目再加一条 CSS。
- 鼠标点击按钮或卡片不显示持久 focus 边框：统一用 `:focus:not(:focus-visible)` 清除 outline/box-shadow；键盘导航必须保留 `:focus-visible`，不要用全局 `:focus { outline: none }` 把可访问性一起删掉。
- 若浏览器仍把指针点击误判为 `:focus-visible`，统一复用 `ClientRootInit` 的 pointer focus 收口；不要给页面按钮逐个添加 `blur` 或复制事件监听。
- 不在卡片里套卡片，不用大面积装饰性留白掩盖信息层级；高频创作操作保持紧凑，主内容优先占据首屏。
- 页面核心界面以 Aceternity UI 的空间层次和组件语言为基线，但必须改造成当前项目的命令、状态和主题契约；不得长期并行维护新旧两套视觉入口。
- 遵循 `canvasThemes`、`useThemeStore`、AntD token 和 CSS 三层 token；不得硬编码导致明暗主题失配的颜色。
- 图片节点保持原始比例；批量生成、多图和助手面板不能长期遮挡主要画布空间。
- 动效服务状态变化和空间关系，尊重 `prefers-reduced-motion`；不要添加持续干扰创作的装饰动画。

### 6.3 三层 Design Token

- Primitive：纯值，不随主题变；包含色彩、4px 间距栅格、字号、圆角、阴影、层级、动效、描边和不透明度。
- Semantic：引用 Primitive 并随主题切换；包含 `--bg`、`--fg`、`--border-semantic`、Canvas、Aceternity spatial、节点类型和状态语义色。
- Component：引用 Semantic，定义 Dock、Node、Modal、Panel、Prompt、进度条和缩放控件等组件专属 token。
- 新增 token 必须按 Primitive → Semantic → Component 顺序添加；不要在组件里直接创造孤立字面值。
- AntD ConfigProvider、shadcn、画布主题和动效读取同一套 CSS token；修改 token 后检查明暗主题和第三方控件同步关系。

## 7. 画布与 Agent

- 画布组件、状态、工具分别放在 `components/canvas/`、`stores/canvas/`、`lib/canvas/`；Canvas 事件忽略选择器必须包含弹窗、popover、dropdown 等浮层。
- 画布节点编辑、连接、拖拽、缩放和快捷键必须考虑 pointer capture、滚轮冒泡、焦点和 `data-canvas-no-zoom` / `data-canvas-wheel-scroll` 边界。
- Canvas Agent 的本地 endpoint、token 和面板宽度是本机配置；不得把 token 写进 URL、日志、任务正文或服务端持久数据。
- Agent 附件和生成资源必须走既有文件/资源存储合同，记录 mime、大小和失败原因；不要在组件中重复实现 data URL 转换。

## 8. 本地开发、数据目录与部署

- 本地后端必须复用 `.local/project-workbench-debug`，通过 `CANVAS_BACKEND_DATA_DIR` 显式指定；启动前先检查已有数据库，禁止直接使用 `backend/data` 创建或切换本地账号数据。
- 本地缓存统一放 `.local/cache`；不要把数据库、上传文件、`.env`、真实 API/OSS 密钥、构建产物或编辑器配置提交到 Git。
- 宿主机开发可在 `backend/` 使用 `CANVAS_BACKEND_DATA_DIR=../.local/project-workbench-debug go run ./cmd/server`，在 `web/` 使用 Bun 和 Vite；Docker 开发沿用仓库现有 Compose 文件，不另起一套数据卷。
- 默认不启动 dev server；只有用户明确要求浏览器预览或联调时才启动，并先确认端口和数据目录。
- Docker 部署只对外暴露网页容器 `3000`；后端 `8080` 留在 Compose 网络内。健康检查只能证明入口可用，不能替代 SSE/登录/生成路径验证。
- 生产必须设置明确的 `CANVAS_CORS_ORIGINS`，保持公开注册关闭，HTTPS 终止后保留 Host、X-Forwarded-*，并限制数据库、备份、数据目录和 `.settings-key` 权限。
- Nginx/Caddy 只对 `/api/tasks/<id>/text-events` 配置 SSE 的 flush、长超时、禁缓冲和禁缓存，不把这套配置复制给所有接口。

## 9. 验证纪律

- 本项目当前明确要求：写完代码默认不自动执行语法检查、类型检查、测试或构建；交付时必须明确说明未运行验证。
- 用户明确要求验证时，按改动风险选择最小充分验证：前端至少 build 并验证关键路径；API/服务至少做最小冒烟；数据库/部署说明迁移、运行方式、回滚风险和版本约束。
- UI 任务能实际验证时优先使用真实浏览器/截图检查关键视口、滚动、弹窗、空态和交互；不能验证时说明替代依据，不伪造“已验证”。
- 同类失败连续 3 次时停止盲试，记录现象、已排除项和新假设，再换路径或请求用户决策。
- 不把 `git diff`、静态阅读或“代码看起来正确”描述成运行验证。

## 10. 文档同步

- README 只保留项目定位、核心功能、快速开始、数据说明和文档入口；详细开发规则写入 `docs/content/docs/` 对应页面。
- `docs/index.md` 是面向 AI 的短索引；功能、代码地图、待办、待测试分别维护在 `features.mdx`、`code-map.mdx`、`todo.mdx`、`pending-test.mdx`。
- 已实现但未由用户确认的变化写入 `pending-test.mdx`；确认后再更新正式功能说明。完成 TODO 后先移入 pending-test，不直接写正式功能说明。
- API、数据表、SSE、资源存储、部署和安全边界发生变化时同步更新对应文档；不要只改代码和 AGENTS。
- 文档默认中文，不写过期日期，不暴露密钥、Token、Cookie、真实账号或机器敏感路径。
- 每次任务结束前检查 todo 和 pending-test；没有功能变化时无需机械修改。

## 11. Git、提交与发布

- 不使用破坏性命令覆盖用户数据或工作区；禁止未经明确请求执行 `git reset --hard`、`git checkout --` 或大范围删除。
- 提交说明使用：`<type>(<scope>): <业务模块> - <变更摘要>`。`type` 使用 `feat|fix|refactor|perf|docs|test|build|ci|chore|revert`，`scope` 使用技术域英文，业务模块和结果用中文。
- 不把纯文件名列表、纯英文句子或“修了 bug”作为提交 subject；发布使用 `chore(release): 版本发布 - publish vX.Y.Z`。
- 发布前整理 `CHANGELOG.md` 的 `Unreleased`、更新 `VERSION`、提交当前改动并创建对应 tag；除非用户明确要求，发布流程不执行编译、测试或构建。
- Pull Request 应包含改动摘要、风险、验证方式和必要截图；不得提交 `.env`、数据库、数据目录、生成产物或真实密钥。

## 12. 交付前检查清单

- [ ] 是否先读了相关入口、调用方、依赖版本和现有样式，而不是凭记忆添加规则？
- [ ] 是否只改任务相关文件，且没有用重复 helper 或 CSS override 扩大项目？
- [ ] 是否遵守了本文件的 HTTP、数据归属、错误和安全合同？
- [ ] UI 是否检查了真实第三方 DOM 语义类名，特别是 AntD Modal 的 `.ant-modal-container`？
- [ ] 是否同步了必要的 API/数据库/SSE/部署文档和 pending-test？
- [ ] 是否按项目约束明确说明验证是否运行，且没有伪造成功？

## 13. 当前边界

- 画布和素材支持登录后端同步；localForage 仍是缓存及后端/OSS 不可用时的降级存储。
- 媒体资源支持私有 OSS 或后端文件存储；删除节点或素材不会自动清理 OSS 远端对象。
- 用户 AI API Key 保存在浏览器本地，任务创建时可能提交到自部署后端；安全说明必须强调 HTTPS 和可信部署。
- Docker 静态资源和生产部署仍需按待测试清单验证，不得写成已全面生产验证。
