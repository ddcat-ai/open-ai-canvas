---
name: loop-three-elements
description: "当用户说\"我想让 AI 每天自动做 X\"、\"我的 loop 跑了 3 天还没停\"、\"设计一个 loop\"时调用。核心能力：Loop 三要素 — 任何循环的最小可工作结构。关键触发：我想让 AI 每天自动做 X、我的 loop 跑了 3 天还没停、设计一个 loop、这个循环怎么停。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\loop-three-elements\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

任何循环系统,无论多复杂,都可以拆解为三个基本要素:

1. **Trigger (触发器)**: 什么条件下启动循环? 可以是定时 (cron)、事件 (新邮件到达)、或状态变化 (CI 失败)。
2. **Action (动作)**: 循环启动后执行什么操作? 这是循环的主体逻辑。
3. **Stop Condition (停止条件)**: 何时判定任务完成并退出循环? 可以是目标达成 (凑够 5 条)、次数上限 (最多 8 轮)、或状态判断 (无新任务)。

三要素缺一不可: 没有 trigger 的循环不知道何时开始; 没有 action 的循环是空壳; 没有 stop condition 的循环会无限运行直到资源耗尽。

## A1 — Past Application (书中案例)

**案例1: Boris Cherny 的 Support Loop (视频2)**
- Trigger: 每 30 分钟定时启动
- Action: 读取新 support ticket → AI 分类+回复 → 记录摩擦/想法到 signals 文件夹
- Stop Condition: 无新 ticket 或达到最大处理数

**案例2: 小木头的选题 Loop (视频3)**
- Trigger: 每天早上 8 点 (cron)
- Action: 拉取过去 24h AI 资讯 → 用 topic-score 子智能体评级 → 追加到 inbox.md
- Stop Condition: 无新资讯或 inbox 达到上限

## A2 — Future Trigger (未来触发)

用户会在以下情境下需要这个 skill:

1. **设计新循环时**: "我想让 AI 每天自动做 X" → 先问: trigger 是什么? action 是什么? 何时停止?
2. **诊断失效循环时**: "我的 loop 跑了 3 天还没停" → 检查 stop condition 是否缺失或过主观
3. **向团队解释 Loop 时**: 用三要素作为教学框架,让非技术人员理解循环系统的结构
4. **比较不同 Loop 实现时**: 用三要素作为分析框架,对比不同方案的触发策略和停止逻辑

**语言信号**: "设计一个 loop"、"这个循环怎么停"、"什么是 loop 的最小结构"、"帮我看看这个 loop 缺什么"

**与相邻 skill 的区别**:
- `loop-worthiness-test`: 判断"要不要做 loop" (本 skill 假设已决定要做,关注"怎么做")
- `goal-verification`: 关注 stop condition 的设计 (本 skill 是三要素的整体框架)
- `loop-build-path`: 关注构建步骤 (本 skill 是静态结构分析)

## E — Execution (可执行步骤)

### Step 1: 识别三要素
面对任何循环需求,先回答三个问题:
1. **Trigger**: 什么事件/时间会启动这个循环? (如果答不上来,说明需求不清晰)
2. **Action**: 循环内具体执行什么操作? (写成一连串动词: 读取→分析→生成→写入)
3. **Stop Condition**: 何时判定"完成了"? (尽量客观可验证)

### Step 2: 验证三要素的完整性
- Trigger 是否明确? (不是"有需要时",而是"当 X 发生时")
- Action 是否可执行? (agent 有对应工具和权限吗?)
- Stop Condition 是否客观? (不是"直到满意",而是"达到 X 指标或最多 N 轮")

### Step 3: 设计 Hard Stop
即使 stop condition 是主观的,也必须设置硬性最大迭代次数:
- 例: "直到平均分 ≥ 9 **或** 最多 8 轮"
- 这是防止失控循环的安全网

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **单次任务**: "帮我写一封邮件"不需要 loop — 没有重复触发
2. **纯自动化脚本**: "每天备份数据库"是 cron job,不是 loop — 没有验证-迭代环
3. **已经稳定运行的系统**: 如果 loop 运行良好,不需要用三要素重新分析

**作者的盲点与局限**:
- 三要素是静态分析框架,不涉及"循环系统如何随时间演化" (参见 `three-stage-evolution`)
- 三要素假设设计者已经选定了任务,不涉及"该不该做 loop" (参见 `loop-worthiness-test`)
- 视频中的案例全部基于 Claude Code 生态,其他工具可能有不同的三要素实现方式

**与之相邻但容易混淆的方法论**:
- **RAO 循环 (Reason-Act-Observe)**: 关注单次迭代内的思维过程; 三要素关注循环的整体结构
- **5+1 架构**: 关注完整系统的组件; 三要素是最小可用单元的分析框架
