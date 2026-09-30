---
name: loop-build-path
description: "当用户说\"我想自动化 X,从哪里开始?\"、\"做了个 loop 但产出很差\"、\"入门指南\"时调用。核心能力：渐进式 Loop 构建路径 — 从手动到自动的四步。关键触发：我想自动化 X,从哪里开始?、做了个 loop 但产出很差、入门指南、怎么开始做 loop。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\loop-build-path\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

构建循环系统不要一步到位,而是按四个阶段渐进:

1. **手动验证**: 先手动让 AI 完成任务,确认它**能做到**。不要在你都没验证过的任务上搭建自动化。
2. **封装成 Skill**: 把指令固化为 SKILL.md,让每次执行一致。此时是"可重复的手动"。
3. **加触发器**: 加入定时 (cron) 或事件触发。此时是"自动化",但还不是 loop — 因为没有验证和迭代。
4. **加验证 + 状态**: 加入自动验证环节和持久化状态记录。**此时才成为真正的 Loop**。

关键洞察: **自动化 ≠ Loop**。自动化是"按时间表执行",Loop 是"执行→验证→调整→再执行"的闭环。

## A1 — Past Application (书中案例)

**案例1: 选题收件箱 (视频3)**
- Step 1: 手动用 research 工具拉取资讯 → 确认可行
- Step 2: 把指令写成 skill (research + topic-score)
- Step 3: 加 cron 触发 (每天早上 8 点)
- Step 4: 加 inbox.md 作为持久化状态 + 评级作为验证

**案例2: Boris 的多 Loop 系统 (视频2)**
- 先手动跑 support 确认 AI 能处理 → 封装成 skill → 加 30 分钟触发 → 加 signals 文件夹作为状态

## A2 — Future Trigger (未来触发)

1. **开始做第一个 loop 时**: "我想自动化 X,从哪里开始?"
2. **Loop 搭建失败时**: "做了个 loop 但产出很差" → 检查是否跳过了 Step 1
3. **团队推广 loop 时**: 用这个路径作为"入门指南"
4. **从自动化升级到 loop 时**: "我的 cron job 已经跑很久了,怎么升级成 loop?"

**语言信号**: "怎么开始做 loop"、"自动化第一步"、"从手动到自动"、"我的 cron 怎么升级"

**与相邻 skill 的区别**:
- `loop-worthiness-test`: 判断要不要做 (本 skill 是决定后如何做)
- `loop-three-elements`: 静态结构分析 (本 skill 是动态构建过程)
- `goal-verification`: 关注验证设计 (本 skill 关注整体路径)

## E — Execution (可执行步骤)

### Step 1: 手动验证 (Manual Proof)
- 手动让 AI 完成任务 3 次
- 记录: 成功率? 产出质量? 耗时?
- 如果手动都做不成,不要做 loop

### Step 2: 封装成 Skill
- 把指令写成 SKILL.md
- 包含: 输入、输出、步骤、边界
- 确保每次执行结果一致

### Step 3: 加触发器 (Trigger)
- 选择: 定时 (cron) / 事件 (webhook) / 状态变化
- 此时是"自动化" — 按时间表执行,但不会自我调整

### Step 4: 加验证 + 状态 (Verification + State)
- 定义: 如何判断产出好坏? (参考 `goal-verification`)
- 加入: 持久化状态文件 (记录历史操作)
- **此时才成为 Loop** — 系统能根据验证结果调整行为

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **已经决定不做 loop**: 应先过 `loop-worthiness-test`
2. **已经稳定运行的 loop**: 此时需要的是优化,不是从头构建
3. **纯探索性任务**: "试试 AI 能不能做 X" — 还在实验阶段,不需要正式构建

**作者的盲点与局限**:
- 四步路径假设任务已经明确,不涉及"如何发现值得自动化的任务"
- Step 1"手动验证"在复杂任务中可能需要很长时间,作者没有给出"何时放弃"的标准
- 视频案例全部是成功路径,缺少"某一步卡住怎么办"的失败处理

**与之相邻但容易混淆的方法论**:
- **敏捷开发**: "小步快跑"; 本 skill 是"小步自动化"
- **CI/CD 流水线**: "代码→测试→部署"; 结构类似但本 skill 面向 AI agent 任务
