---
name: maker-checker
description: "当用户说\"它自己说做得很好,但实际很差\"、\"有时好有时坏,没有保障\"、\"agent 自评不准确\"时调用。核心能力：Maker-Checker 模式 — 用独立 Agent 审查产出。关键触发：它自己说做得很好,但实际很差、有时好有时坏,没有保障、agent 自评不准确、怎么让 agent 审查 agent。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\maker-checker\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

**核心规则: 不要让同一个 agent 做事又检查。**

Maker-Checker 模式将生产和审查拆分为两个独立 agent:
- **Maker**: 执行任务 (写代码、写文章、生成方案)
- **Checker**: 审查产出,给出反馈或打分

**为什么需要**:
- 同一个 agent 给自己的作业打分通常过于宽容
- Agent 有盲点,看不到自己的错误
- 独立 checker 可以给出更客观的评估

## A1 — Past Application (书中案例)

**案例1: Boris 的代码审查 (视频2)**
- Maker: 写代码的 agent
-Checker: read-only 的 verifier agent,有详细 spec
- 结果: 自审经常放过问题,独立 checker 能发现更多缺陷

**案例2: 缩略图评分 (视频1)**
- Maker: 生成 10 个缩略图概念
- Checker: 用 Mr. Beast 风格 rubric 打分
- 教训: 如果 maker 和 checker 是同一个 agent,评分会过于主观

## A2 — Future Trigger (未来触发)

1. **Agent 自评不准确时**: "它自己说做得很好,但实际很差"
2. **产出质量不稳定时**: "有时好有时坏,没有保障"
3. **设计 loop 验证环节时**: 选择 maker-checker 作为验证策略
4. **团队 code review 自动化时**: 用 AI checker 替代部分人工 review

**语言信号**: "agent 自评不准确"、"怎么让 agent 审查 agent"、"产出质量不稳定"、"独立审查"

**与相邻 skill 的区别**:
- `goal-verification`: 关注"验证什么" (标准设计); 本 skill 关注"谁来验证" (角色分工)
- `loop-5plus1-architecture`: 完整系统架构 (本 skill 是子智能体层的具体模式)
- `loop-three-elements`: 三要素框架 (本 skill 是 action 环节的质量保障)

## E — Execution (可执行步骤)

### Step 1: 判断是否需要 Maker-Checker
- 产出可以客观验证 (测试/数值)? → 不需要,用自动化检查
- 产出需要主观判断 (写作/设计)? → 需要 Maker-Checker
- 成本极其敏感? → 谨慎,因为多一个 agent 多一倍成本

### Step 2: 设计 Maker
- 明确任务: 做什么? 输出什么?
- 提供上下文: 规则、约束、参考案例
- 输出格式: 确保 checker 能清楚审查

### Step 3: 设计 Checker
- **必须是 read-only**: 不能修改产出,只能评估
- 提供详细 spec: 评分标准、常见错误、质量 rubric
- 输出: 问题列表 + 评分 + 改进建议

### Step 4: 集成到 Loop
- Maker 产出 → Checker 审查 → 通过? 提交 / 不通过? 反馈给 Maker 重做
- 设置最大重做次数 (防止无限循环)

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **产出可以客观验证**: 测试通过/失败 → 不需要独立 checker
2. **成本敏感**: 多一个 agent 多一倍 token 消耗
3. **简单任务**: 单次提示能搞定的,不需要分工

**作者的盲点与局限**:
- Maker-Checker 假设"两个 agent 比一个 agent 好",但没有给出"checker 也不靠谱怎么办"的方案
- 独立 checker 的成本 (token、时间) 被低估
- 视频案例全部是代码审查,对非技术场景 (内容创作) 的适用性未知

**与之相邻但容易混淆的方法论**:
- **Code Review**: 人工审查代码; 本 skill 是 AI 审查 AI
- **A/B 测试**: "两个版本对比"; 本 skill 是"生产和审查分工"
