# Agent 系统融合报告：吸收 tigerowo/infinite-canvas 优点

> 日期：2026-09-03
> 对照对象：
>
> [https://github.com/tigerowo/infinite-canvas](https://github.com/tigerowo/infinite-canvas)
>
> （Next.js + Go/Gin，纯前端 ReAct 运行时直连文本模型）
> 被融合方：影策 open-ai-canvas（本地 Codex runtime + 独立 canvas-agent + MCP 工具 + 语义创作域）

## 一、两套 Agent 架构的根本差异



| 维度    | tigerowo/infinite-canvas                                   | 影策 open-ai-canvas（我们）                                        |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| 运行时   | 浏览器内 ReAct 循环（最多 12 步），每轮直接 fetch 文本模型 API                 | 本地 Codex CLI / 线程（thread）+ canvas-agent Node 进程，MCP 41 工具    |
| 上下文   | 前端维护全部 protocolMessages，自己管长上下文                            | Codex thread 服务端管历史；每轮注入画布快照                                 |
| 工具协议  | native tool calling → structured-json → prompt-json 三级自动降级 | Codex 原生工具调用 + MCP                                           |
| 技能    | 意图正则 + phase + 选中节点类型动态加载 14 个内置技能                         | 用户技能 + 第一方默认技能（storyboard-director），按 profile 注入             |
| 创作域   | 以画布节点为中心                                                   | 更先进：Shot/ShotRevision 语义域 → 持久化 → 画布投影；AgentRun 审计；Benchmark |
| 可靠性机制 | 滚动摘要记忆、上下文裁剪、参数错误自纠、危险动作显授权、媒体并行 / 非媒体串行                   | 语义优先、一次 apply 可撤销、AgentRun 终态安全、技能渐进式读取                      |

结论：**路线不同，不能照搬其运行时**；但其在「Agent 行为约束、技能按需激活、上下文预算」三类纯设计层面的优点，与我们的 Codex 路线完全兼容，值得吸收。

## 二、tigerowo 六大优点与取舍判断



1. **CORE\_SKILL 公共执行手册**（最成熟）：统一规定事实优先级、上下文选择、引用 / 连线 / 分组、工具批次协议、错误分类、任务恢复、安全边界。→ **本次吸收**，改造成适配我们 MCP 工具名的 `canvas-core`。

2. **意图驱动技能动态激活**：无显式选择时按「用户文本 + 创作阶段 + 选中节点类型」正则决定加载哪些细分技能，省 token、降误触发。→ **本次吸收**（第一层：按用户文本意图激活 storyboard-director）。

3. **画布上下文优先级裁剪**：选中 / 批准 / 相邻 / 异常节点优先，节点上限 120、长文本截断、悬空连线剔除。→ **本次吸收**。

4. **长上下文滚动压缩记忆（checkpoint）**：260K 总预算 / 64K 近期轮 / 16K 增量滚动摘要。→ **暂不吸收**：我们的对话历史由 Codex thread 管理，重复造一套摘要层收益低；后续若出现超长 thread 爆上下文，再做「项目级 checkpoint 注入」。

5. **agentState 创作状态机**（phase/approved/reference/pending/completed，刷新可恢复、不重复提交任务）。→ **后续迭代**：需要前后端协同，价值高但改动面大，单独立项。

6. **三级工具协议降级 / 前端直连 LLM**：仅服务于「无本地 runtime、浏览器直连模型」路线。→ **不吸收进主链路**；但「后端直连文本模型处理轻任务」可作为远期**轻量 Agent 模式**，正好解决本地 runtime 连接失败时网站 Agent 不可用的问题。

另外两个中等价值点，记录待办：



* **媒体自动生成开关 autoGenerateMedia**：关闭时媒体工具只建配置节点不提交任务（先搭结构、确认后批量生成，也省钱）。canvas-core 已写入该语义，缺一个 UI 开关，后续补。

* **多文件技能包（AgentSkillFile + read\_skill\_file 按需读取）**：我们已有渐进式读取工具（canvas\_list/get/read/search\_skill\_file），后端 SkillFile 存储模型可后续补齐。

## 三、本次实际改动（P0 / P1 / P2）

### P0 — 新增第一方基础技能 `canvas-core`（画布执行手册，始终生效）



* 新增 `backend/internal/service/seed/skills/canvas-core.md`：9 节公共约束（唯一事实来源、上下文选择、语义优先、引用连线分组、工具调用协议、生成配置、沟通授权、错误分类处理、总结恢复），全部使用我们真实的 MCP 工具名（canvas\_*、project\_*）。

* `backend/internal/service/seed/skills.json`：新增 canvas-core 定义（tag=core，sort\_weight=110）。

* `backend/internal/service/skills_seed.go`：`//go:embed canvas-core.md`，新增 `firstPartySkillMD` 映射统一覆盖第一方技能正文；`defaultFirstPartySkillIDs` 加入 canvas-core。后端启动 `EnsureBuiltinSkills` 自动入库，`AddedSkills` 自动对所有用户可用（is\_added=true），无需手动添加。

### P1 — 第一方技能分两层：canvas-core 始终注入，storyboard-director 按意图激活



* `web/src/services/skill-runtime.ts`：


  * `FIRST_PARTY_ALWAYS_BY_PROFILE.localAgent = ["canvas-core"]`（所有模式都加载，含 benchmark baseline，作为公共基线，保证对照实验唯一变量是分镜导演）。

  * `FIRST_PARTY_INTENT_BY_PROFILE.localAgent = [storyboard-director + 意图正则]`。

  * 新增并导出 `isStoryboardDirectorIntent()`：命中「分镜 / 故事板 /storyboard/ 镜头语言 / 镜头设计 / 拆镜头 / 怎么拍 / 把剧本剧情拆成镜头」等才激活；「移动节点 / 生成单图 / 延长视频」等不激活。

  * `composeSkillsForTurn` 新语义：normal=canvas-core 恒在 + 分镜导演按意图；baseline = 只保留 canvas-core；director = 两者强制；用户显式 @/ 选择优先级最高且去重；两层第一方技能都不占用户 maxSkills=4 容量；非 localAgent 的 5 个 profile 仍完全不注入。

### P2 — 画布上下文优先级窗口，给大画布「瘦身」



* `web/src/lib/canvas/canvas-agent-context.ts`：


  * 新增 `MAX_AGENT_CONTEXT_NODES=120` 与导出的纯函数 `selectContextNodes()`：未超上限时零改动；超限时按「选中节点 → loading/error 节点 → 选中节点一跳邻居 → 其余按原始顺序」保留窗口，并保持画布原始顺序。

  * `buildCanvasAgentContext()`：nodes/connections/resources 只输出窗口内容；连线两端任一不在窗口内则剔除（避免引用未展示节点）；nodeCount/nodeTypeCounts 仍报真实总数；新增 `contextIncluded/contextTruncated`，截断时追加一条告警提示用 canvas\_find\_nodes 精确检索，避免 Agent 误以为未展示节点不存在。

## 四、验证结果



* 前端 `bun test`：skill-runtime 41 pass、canvas-agent-context 14 pass，连同 agent-prompt-cache /canvas-local-runtime/project-chapter-skill-runtime 合计 75 pass，0 fail。

* 前端 `tsc --noEmit`：本次改动的两个源文件零类型错误（输出中的 7 处错误均为历史遗留文件，已逐一核对未在本次改动范围内）。

* 后端容器（golang:1.25-alpine）`go build ./...` 通过；service 包 7 项技能种子测试全 PASS（含新增 canvas-core 嵌入、映射、seed JSON、覆盖逻辑测试）。

## 五、我们必须保留、不被稀释的既有优势

Creative OS 语义层（Shot/ShotRevision → project\_create\_or\_update\_shots → canvas\_create\_storyboard\_shots，metadata.shotId 身份、幂等 reconcile、一次 apply 可撤销）、AgentRun/AgentRunStep 持久化审计、storyboard-director 电影方法论、5×2 Benchmark、MCP 工具生态 —— 本次全部未改动，canvas-core 反而在第 3 节明确强化了「语义优先、禁止跳过语义层手搓文本节点、禁止 LLM 算坐标」。

## 六、建议的后续路线（按价值排序，本次均未做）



1. agentState 创作状态机（进行中 / 已完成任务不重复提交，刷新可恢复）。

2. 媒体自动生成开关 UI（canvas-core 已留语义）。

3. 后端多文件技能包存储模型（配合已有的渐进式技能读取工具）。

4. 轻量 Agent 模式：后端直连文本模型处理简单任务，作为本地 Codex runtime 不可用时的降级通道。

5. 超长 thread 的项目级 checkpoint 注入（仅在真实出现上下文爆炸时再做）。