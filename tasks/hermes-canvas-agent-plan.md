# Hermes Agent 植入画布 Agent 规划

## 目标

将 `D:/MANJU/hermes-agent-main` 的 Agent 编排能力接入影策画布，使用户可以在画布内通过自然语言完成剧本拆分、角色设计、分镜规划和媒体生成。画布 Agent 只服务画布创作：负责项目上下文、节点操作和生成任务；Hermes 负责模型路由、画布工具调用、Skills、记忆、流式会话和子 Agent 编排。

目标交互形态是“画布内嵌、上下文感知、可执行创作协同 Agent”，而不是单独的聊天窗口或静态工具栏。

## 当前实现边界

本项目同时存在两条路径：网页内置 Agent 和外部 Agent 的远程 MCP。外部 Agent（Codex、Claude 等）自行加载 Skill、生成 Plan/Task 并处理审批，`canvas-agent` 仅提供画布专用 stdio MCP；网页内置 Agent 才是 Hermes Bridge、Skill、Plan、Task 和询问/自动模式的接入目标。远程 MCP 不公开这些编排接口。

## 架构决策

- **运行时桥接优先**：保留 Hermes Python 核心，通过受控 Bridge 与现有 Node/TypeScript `canvas-agent` 通信；不复制 Hermes 源码，也不先重写成 TypeScript。
- **画布工具独立适配**：复用现有 Canvas MCP 工具合同，将画布读写封装为 Hermes 可调用的工具 Provider。
- **写入继续失败关闭**：所有写操作继续携带 `expectedRevision` 与 `expectedStateHash`，经过校验、审批和服务端权限检查；Hermes 不直接修改 React 状态或数据库。
- **能力边界固定**：保留“CLI 登录授权 + stdio MCP + HTTPS 远程画布”的画布专用远程 MCP；远程 MCP 只提供画布读取、校验和操作，不暴露 Canvas Agent 的 Skill、Plan、Task 或 `ask/auto` 编排能力。Agent 客户端负责意图理解、Skill 加载、计划生成和审批；不接入 Terminal、Browser、任意文件写入、外部网站操作或与画布无关的通用外部 MCP。
- **会话上下文结构化传递**：每轮传递项目、选中节点、相关节点摘要、资源、连接和并发版本；不把完整画布 JSON 无限制放进系统提示词。

## Skill、Plan、Task 与执行模式

### Skill

画布 Skill 是带有输入、输出、版本和权限边界的创作能力包，不是可以任意调用工具的提示词。Skill 只允许使用画布专用工具，并输出文本结果、画布操作计划或媒体生成计划。第一批 Skill 包括 `/script-to-scenes`、`/script-to-characters`、`/character-three-view`、`/storyboard`、`/image-prompt` 和 `/video-prompt`。

Skill 必须由用户手动调用。用户启用 Skill 只表示它出现在可用列表中，不授权 Agent 在普通对话中自动选择或执行。调用入口使用 `/skill-name` 命令或 Skill 选择器；只有调用发生后，当前回合才加载该 Skill 的完整合同。未明确调用 Skill 时，Agent 只能使用普通对话能力和已允许的基础画布工具。

每个 Skill 需要声明支持的节点类型、是否要求选中节点、是否允许 `@` 引用、是否允许媒体生成、是否允许自动执行，以及 Skill 版本。Skill 不直接修改 React 状态或数据库。启用、调用和执行是三个独立状态，调用后仍须经过输入校验、画布版本校验和宿主审批。

### Plan

Plan 是一次复杂用户请求的整体执行方案，描述目标、步骤、依赖、影响范围和预计生成任务。例如“根据剧本生成角色卡、三视图和分镜视频”应先形成计划，再拆成读取剧本、提取角色、创建角色卡、提交三视图、生成分镜和提交视频等步骤。

Plan 在系统内部必须存在；简单的单节点改名等请求可以只生成一个内部 Task。复杂 Plan 应在消息流中显示为“执行计划”卡片，列出将读取、创建、修改、删除和生成的内容，并提供执行、修改和取消操作。不设置名为“Plan”的常驻按钮。

### Task

Task 是 Plan 中可独立执行、暂停、重试和恢复的步骤。Task 至少包含 `id`、类型、依赖、输入节点、输出节点、状态、重试策略和操作计划。状态使用 `pending`、`running`、`waiting_approval`、`succeeded`、`failed`、`cancelled`、`blocked` 等明确值。

Task 不以“Task”技术名词直接呈现给用户，而在消息流中显示为步骤和进度：已完成、执行中、等待确认、失败、暂停和重试。不设置名为“Task”的常驻按钮。

### 询问模式与自动模式

询问/自动模式控制的是 Task 的执行授权，不替代 Plan，也不改变 Skill 的工具范围。

- **询问模式**：读取和分析可以自动进行；创建、修改、删除、覆盖和媒体生成等有影响的 Task 在计划或步骤层面等待用户批准。
- **自动模式**：自动执行符合策略的 Task；遇到删除、覆盖、费用超限、输入缺失、revision 冲突、权限错误或结果未知时暂停并询问。

底部输入区保留一个“询问模式 / 自动模式”下拉。Plan 和 Task 通过消息中的“执行计划”卡片与“执行进度”卡片呈现，不增加常驻 Plan/Task 按钮。无论哪种模式，服务端权限、`expectedRevision`、`expectedStateHash`、幂等和失败关闭规则都不能绕过。

### 执行关系

```text
用户消息
  ↓
选择 Skill
  ↓
简单请求 → 一个内部 Task
复杂请求 → Plan → 多个有依赖关系的 Task
  ↓
询问/自动模式决定哪些 Task 需要批准
  ↓
Canvas Tool Adapter
  ↓
画布服务端校验与持久化
```

画布节点连接图和 Agent Task 依赖图分开维护。Task 通过输入节点 ID、输出节点 ID 和 `planId` 关联画布节点；不能直接把画布连线当作任务调度关系。

## 分阶段任务

### 阶段 1：Bridge 与最小闭环

- [ ] 在 Hermes 侧新增受控 Agent Bridge，提供会话创建、提交回合、SSE 事件和取消接口。
- [ ] 在 `canvas-agent` 侧新增 Hermes 客户端、协议类型和错误映射，支持会话生命周期与断线取消；保留 Codex/Claude 通过 CLI 登录授权后使用 stdio MCP 操作远程画布的入口。
- [ ] 抽出不依赖 MCP 传输的 Canvas Tool Adapter，复用现有 schema、工具规划和远程客户端逻辑。
- [ ] 实现 `canvas_get_context`、`canvas_validate_ops`、`canvas_apply_ops` 三个 Hermes 工具。
- [ ] 跑通“读取当前剧本 → 拆分三个场景 → 校验 → 审批 → 创建文本节点”的真实浏览器闭环。

**检查点：** Agent 能流式回复；画布真实出现节点；写入携带版本前置条件；409 冲突会重读而不是重放旧操作。

### 阶段 2：影视创作 Skills 与媒体任务

- [ ] 定义 `/script-to-scenes`、`/script-to-characters`、`/character-three-view`、`/storyboard`、`/image-prompt` 和 `/video-prompt` 的输入输出合同。
- [ ] 接入画布节点查找、读取、更新、删除和连线工具。
- [ ] 接入图片、视频、音频生成提交工具，并区分“任务已提交”和“媒体已完成”。
- [ ] 在网页 Agent 面板显示消息增量、工具调用、工具结果、审批、生成进度、完成和失败事件。
- [ ] 支持 `@` 画布引用和附件引用进入 Hermes 回合上下文。
- [ ] 在消息流中实现复杂请求的执行计划卡片和 Task 执行进度卡片。
- [ ] 统一询问模式与自动模式的 Task 授权、暂停、继续、重试和取消语义。

**检查点：** 用户可从剧本节点生成角色、分镜和媒体节点，并能看到每一步工具调用和结果。

### 阶段 3：画布 Agent 扩展能力

- [ ] 接入 Memory，并按用户与项目隔离记忆范围。
- [ ] 接入 Subagent delegation，用于长剧本拆解、角色一致性检查和批量分镜任务。
- [ ] 增加画布专用 Memory，并按用户与项目隔离记忆范围。
- [ ] 接入 Subagent delegation，用于长剧本拆解、角色一致性检查和批量分镜任务；子 Agent 只能使用画布工具集。
- [ ] 增加上下文压缩、恢复、幂等和长任务后台状态查询。

## 主要接口

Bridge 最小接口：

```text
POST /agent/sessions
POST /agent/sessions/:id/turns
GET  /agent/sessions/:id/events
POST /agent/sessions/:id/cancel
```

画布工具最小集合：

```text
canvas_get_context
canvas_find_nodes
canvas_get_node
canvas_validate_ops
canvas_apply_ops
canvas_connect_nodes
canvas_generate_image
canvas_generate_video
canvas_generate_audio
```

事件至少包括：

```text
turn_started
message_delta
tool_call
tool_result
canvas_operation_pending
canvas_operation_applied
generation_submitted
generation_progress
turn_completed
turn_failed
```

## 验收标准

- 用户可在画布 Agent 面板发起会话并看到流式文本。
- Agent 能读取当前项目和选中节点，并将 `@` 引用传给 Hermes。
- Agent 能通过 Canvas Tool Adapter 创建、更新、删除节点并建立连线。
- 所有写入均使用服务端返回的 revision 和 state hash；冲突、参数错误、限流和鉴权失败会如实显示。
- Skill 调用能生成结构化画布操作，而不是只返回说明文字。
- 复杂请求会先生成可预览的 Plan；每个 Task 可追踪、暂停、重试和从失败处继续。
- 询问模式会等待有影响操作的批准；自动模式只自动执行符合策略的 Task，遇到风险或异常会暂停。
- 图片、视频、音频任务显示真实提交状态，不能把节点创建误报为媒体完成。
- 刷新页面后会话、画布节点和任务状态保持一致。
- Hermes 的 Terminal、Browser、任意文件写入、外部网站操作和与画布无关的通用外部 MCP 不在能力集合中；画布专用远程 MCP 属于保留能力。

## 验证计划

- `canvas-agent`：`npm test`、`npm run build`。
- Hermes Bridge：针对会话、SSE、取消、画布工具白名单和错误映射增加 Python 真实导入测试。
- 前端：运行 Agent 面板和画布工具聚焦测试，并在真实 Edge 页面验证流式消息、Skill、`@` 引用、审批和节点变化。
- 集成：使用临时用户、项目和画布执行一次完整剧本拆场景流程；覆盖刷新、断线、重复提交和 409 冲突。
- 编排：覆盖简单请求单 Task、复杂请求多 Task、Task 依赖、询问模式审批、自动模式暂停、失败恢复和取消。
- 交付前运行 `git diff --check`，并同步功能清单与待测试文档。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Python Hermes 与 Node 进程生命周期不一致 | 高 | Bridge 负责启动、健康检查、取消和崩溃恢复；会话状态落在服务端或受控目录 |
| Agent 绕过画布并发保护 | 高 | Canvas Adapter 统一注入 revision/state hash，禁止直接调用底层写接口 |
| 长上下文导致成本和延迟上升 | 中 | 传递结构化摘要，按需读取节点正文，复用 Hermes 压缩机制 |
| 工具越界访问非画布资源 | 高 | Bridge 只注册画布工具；服务端按用户、项目和画布校验归属，拒绝未知工具名 |
| 现有未提交画布改动与接入工作冲突 | 高 | 先建立 Git checkpoint，按纵向切片增量修改，禁止回滚既有改动 |

## 不在第一期范围内

- 不把 Hermes 全仓复制到 `canvas-agent`。
- 不重写 Hermes 的模型、记忆和工具系统为 TypeScript。
- 不恢复已移除的本机 HTTP/SSE 运行时或 `17371` 端口。
- 不接入 Terminal、Browser、任意文件写入、外部网站操作或与画布无关的通用外部 MCP；画布专用远程 MCP 属于本项目保留能力。
- 不在没有真实浏览器闭环证据时宣称“完整可执行 Agent”已完成。
