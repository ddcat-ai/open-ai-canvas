---
name: tool-specification
description: "当需要设计 AI agent 的工具集，从零开始定义工具接口；工具数量增长到需要发现机制或分组策略时调用。核心能力：工具定义与集成模式。关键触发：AI 需要调用外部工具/API、工具太多，模型经常用错、某些操作需要用户确认才能执行、需要子代理并行处理。不适用于：AI 产品不需要调用任何外部工具（纯对话场景）、工具集成属于后端工程问题而非 p。"
tags: ["tool-use", "function-calling", "agent-architecture", "api-design"]
metadata:
  source_book: "系统提示词设计模式库"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\系统提示词设计模式库\\整理skill\\tool-specification\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

工具定义与集成的核心设计模式包含五个正交维度：

1. **定义格式 (Definition Format)**: JSON Schema（Meta AI, Claude）、XML（Grok 4 的 xai:function_call）、TypeScript 类型（Codex）——格式选择影响解析效率和可组合性。
2. **权限门控 (Permission Gating)**: 三层模型——禁止层（Prohibited，绝不可执行）、显式授权层（Explicit Permission，需用户确认）、常规层（Regular，自动执行）。Claude Chrome 的三层分类是这一模式的典范。
3. **发现机制 (Discovery Mechanism)**: 当工具数量庞大时（Jules 25+，Meta AI 四个命名空间），需要延迟加载（Claude Code 的 ToolSearch）或命名空间分组（Meta AI 的 media/browser/meta_1p/container/third_party）。
4. **并行执行 (Parallel Execution)**: Claude Code 支持并行工具调用，Gemini CLI 通过子代理委托实现并行调查，ChatGPT Agent 通过三通道架构实现思考与行动的并行。
5. **生命周期管理 (Lifecycle Management)**: 工具从发现到执行到结果处理的完整流程。Jules 的 plan/review/submit 三阶段生命周期和 Codex 的 Plan tool with skip rules 是这一模式的代表。

## A1 — 案例分析 (Past Application)

### 案例 1: Claude Chrome 的三层权限门控
- **问题**: 浏览器操作涉及极高安全风险（支付、删除、导航到恶意站点），如何在不牺牲易用性的前提下实现安全控制？
- **设计模式的使用**: 将所有浏览器操作分为三层——Prohibited（如自动填写密码字段，绝不执行）、Explicit Permission（如点击购买按钮，必须用户确认）、Regular（如滚动页面，自动执行）。配合 critical_injection_defense 安全层，形成深度防御。
- **结论**: 三层分类比简单的"允许/禁止"二分法更灵活，既避免了过度限制又守住了安全底线。

### 案例 2: Meta AI 的四命名空间工具架构
- **问题**: Meta 的工具集横跨媒体生成、浏览器操作、第一方服务和第三方插件，如何管理这种复杂度？
- **设计模式的使用**: 将工具按功能域分为四个命名空间，每个命名空间内的工具共享统一的 JSON Schema 定义和权限策略。这种分组方式使得添加新工具成为局部操作，不影响其他命名空间。
- **结论**: 命名空间分组是工具数量超过 15 个时的必选策略，否则 system prompt 会变得不可维护。

### 案例 3: Gemini CLI 的子代理委托
- **问题**: 单一代理如何高效处理需要并行调查的复杂编程任务？
- **设计模式的使用**: 实现 codebase_investigator、cli_help、generalist、browser_agent 四种专用子代理。主代理作为编排者，将不同类型的子任务委托给专用子代理并行执行，最后汇总结果。
- **结论**: 子代理委托模式在复杂任务中显著优于单体代理，但需要精心设计子代理间的信息传递机制。

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?
1. 设计 AI agent 的工具集，从零开始定义工具接口
2. 工具数量增长到需要发现机制或分组策略
3. 某些工具操作涉及安全风险，需要设计权限控制
4. 需要实现子代理或并行执行架构
5. 需要选择工具定义格式（JSON Schema / XML / TypeScript）

### 语言信号
- "AI 需要调用外部工具/API"
- "工具太多，模型经常用错"
- "某些操作需要用户确认才能执行"
- "如何设计 function calling 的 schema"
- "需要子代理并行处理"

### 与相邻 skill 的区分
- 与 `safety-guardrails` 的区别: tool-specification 中的权限门控是工具层面的操作控制（"这个按钮能不能按"），safety-guardrails 是内容层面的行为约束（"能不能讨论这个话题"）。两者互补但不重叠。
- 与 `persona-design` 的区别: persona-design 决定 AI "是谁"，tool-specification 决定 AI "能做什么"。

## E — 可执行步骤 (Execution)

1. **步骤 1: 选择定义格式**
   - 评估工具使用场景：标准 API 调用用 JSON Schema，需要与 XML 生态集成用 XML 格式，内部工具可用 TypeScript 类型
   - 为每个工具编写接口定义，包含名称、描述、参数列表和返回值格式
   - 完成标准: 格式选择有明确理由，且每个工具的定义能被模型准确理解和调用

2. **步骤 2: 实现三层权限门控**
   - 将所有工具操作分类：Prohibited（自动拒绝）、Explicit Permission（需确认）、Regular（自动执行）
   - 为 Explicit Permission 层设计用户确认流程和超时机制
   - 完成标准: 每个工具操作都有明确的权限层级分类，且分类结果经过安全评审

3. **步骤 3: 设计发现与分组策略**
   - 工具数量 <10: 全量列举在 system prompt 中
   - 工具数量 10-25: 按功能域分组，使用命名空间
   - 工具数量 >25: 实现延迟加载机制（如 ToolSearch），按需发现
   - 完成标准: 模型在任何场景下都能在 2 轮对话内找到并调用正确的工具

4. **步骤 4: 设计并行执行与委托机制**
   - 识别可并行的工具调用（如多个独立搜索、多文件读取）
   - 设计子代理委托协议：任务描述格式、结果返回格式、错误处理
   - 完成标准: 并行调用不产生竞态条件，子代理结果能被主代理正确汇总

5. **步骤 5: 定义生命周期与错误处理**
   - 设计工具调用的生命周期：发现 → 参数构造 → 权限检查 → 执行 → 结果解析 → 错误恢复
   - 为每个阶段定义失败处理策略
   - 完成标准: 任何工具调用失败都不会导致 agent 停滞，且有明确的降级策略

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill
- AI 产品不需要调用任何外部工具（纯对话场景）
- 工具集成属于后端工程问题而非 prompt 设计问题（如 API 实现）
- 试图通过工具设计解决安全问题（安全规则应在 safety-guardrails 中定义）
- 工具数量极少（<5 个）且无安全风险（简单列举即可，无需复杂设计）

### 常见失败模式
- **工具描述歧义**: 工具的自然语言描述不够精确，导致模型在边界情况下调错工具。应使用具体示例而非抽象描述。
- **权限层级过度简化**: 所有操作都设为 Regular 或都需要确认，前者导致安全风险，后者导致用户体验灾难。应严格使用三层分类。
- **忽略工具发现成本**: 大量工具全部写入 system prompt，消耗宝贵的上下文窗口。应按需加载。
- **子代理信息孤岛**: 子代理之间无法共享上下文，导致重复工作或信息矛盾。应设计明确的信息传递协议。
- **缺少错误恢复**: 工具调用失败后 agent 直接放弃或陷入重试循环。应定义降级策略和最大重试次数。
