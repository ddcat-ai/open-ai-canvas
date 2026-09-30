---
name: three-stage-evolution
description: "当用户说\"我现在 AI 用得怎么样?\"、\"下一步该学什么?\"、\"为什么要升级到 Stage 3\"时调用。核心能力：三阶段进化模型 — 定位你的 AI 使用阶段。关键触发：我现在 AI 用得怎么样?、下一步该学什么?、为什么要升级到 Stage 3、我现在在哪个阶段。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\three-stage-evolution\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

个人与 AI 协作方式经历三个进化阶段:

1. **逐行驾驶 (Prompting)**: 手写代码/内容,AI 给自动补全。人是操作者,AI 是工具。
2. **并行手动 (Parallel)**: 同时开 5-10 个对话,每个都在干活。人是调度员,在多个窗口间切换。
3. **Loop 系统 (Loop Engineering)**: 不再发起对话,设计一个系统让 AI 自主工作。人是系统设计者。

**每个阶段的特征**:
- Stage 1: 每次任务都是一次性的,AI 是"高级自动补全"
- Stage 2: 效率提升但人是瓶颈,所有对话都需亲手发起
- Stage 3: 系统自主运行,人只需要设计和监督

## A1 — Past Application (书中案例)

**案例1: Boris Cherny (视频2)**
- 描述了从"逐行驾驶"到"写 loop"的进化
- 当前处于 Stage 3: 有一堆 loop 在跑,自己只写新的 loop

**案例2: 小木头 (视频3)**
- 自评处于 Stage 2 (并行手动)
- 正在向 Stage 3 过渡 (演示了选题 loop)

**案例3: Adam Gillock (视频1)**
- 非技术背景,但已经用 loop 做视频剪辑
- 说明 Stage 3 不限于技术人员

## A2 — Future Trigger (未来触发)

1. **自我评估时**: "我现在 AI 用得怎么样?"
2. **制定学习计划时**: "下一步该学什么?"
3. **团队能力建设时**: 评估团队整体 AI 使用阶段
4. **向他人解释 Loop Engineering 时**: 用这个模型说明"为什么要升级到 Stage 3"

**语言信号**: "我现在在哪个阶段"、"AI 使用下一步"、"团队 AI 能力评估"、"从手动到自动"

**与相邻 skill 的区别**:
- `loop-build-path`: 升级到 Stage 3 后的构建指南 (本 skill 是定位和决策)
- `loop-worthiness-test`: Stage 3 中判断具体任务要不要做 loop (本 skill 是整体阶段评估)
- `comprehension-gap`: Stage 3 的风险 (本 skill 是 Stage 3 的进阶路径)

## E — Execution (可执行步骤)

### Step 1: 自评当前阶段
回答以下问题:
- 你每次用 AI 都是亲手发起对话吗? → Stage 1 或 2
- 你有多个 AI 对话同时运行吗? → Stage 2
- 你有定时/事件触发的 AI 任务吗? → 可能是 Stage 3
- 你设计过"让 AI 自主决定做什么"的系统吗? → Stage 3

### Step 2: 对照特征定位
- 如果主要是"人发起→AI 执行→人反馈" → **Stage 1**
- 如果主要是"人同时管理多个 AI 任务" → **Stage 2**
- 如果主要是"系统自动运行,人设计系统" → **Stage 3**

### Step 3: 给出下一步建议
- Stage 1 → Stage 2: 学习并行使用多个 AI 任务,用工作树隔离
- Stage 2 → Stage 3: 选择一个小任务,用 `loop-build-path` 做成第一个 loop
- Stage 3 → 优化: 用 `loop-5plus1-architecture` 审计现有系统

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **已经处于 Stage 3 且运行良好**: 需要的是优化,不是阶段评估
2. **纯技术问题**: "这个 loop 为什么报错?" — 不是阶段定位
3. **非 AI 场景**: 这个模型只适用于 AI 工具使用

**作者的盲点与局限**:
- 三阶段模型是线性假设,实际使用中可能混合多个阶段
- "Stage 3 最好"是隐含假设,但作者也承认"多数任务不需要 loop"
- 视频作者全部是 Stage 3 或正在升级,缺少"Stage 1 也很好"的视角

**与之相邻但容易混淆的方法论**:
- **Dreyfus 模型**: "新手→专家"五阶段; 本 skill 是 AI 使用的三阶段
- **技术采纳生命周期**: "创新者→早期采纳者→..."; 本 skill 是个人能力模型
