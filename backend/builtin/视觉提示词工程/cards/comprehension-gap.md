---
name: comprehension-gap
description: "当用户说\"仓库里有很多代码但我看不懂\"、\"它说做完了,但我不确定对不对\"、\"自动化≠理解\"时调用。核心能力：认知差距警告 — Loop 的隐性风险。关键触发：仓库里有很多代码但我看不懂、它说做完了,但我不确定对不对、自动化≠理解、AI 生成的代码我看不懂。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\comprehension-gap\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

**核心洞察: 自动化程度与理解深度负相关。**

Loop 交付速度越快 → 你没亲手写/看的代码越多 → 仓库里有的东西和你真正搞懂的东西之间的差距越大 → 风险越高。

**最危险的态度**: 舒舒服服地接受 Loop 输出的一切,不加审视。

**关键原则**: 验证永远在你自己手上。即使 loop 有自我验证环节,人仍需定期审查。

## A1 — Past Application (书中案例)

**案例1: Ralph Loop 失败 (视频3)**
- 一个出了名的循环: 锲而不舍,永不放弃
- 失败模式: 无人盯着的 loop 持续犯错,把小修复变成灾难
- 教训: 没有人类监督的 loop 会制造"理解鸿沟"

**案例2: Boris 的代码库 (视频2)**
- Loop 产出的代码占仓库很大比例
- Boris 强调"代码库必须对 agent 可读" — 但可读 ≠ 人理解
- 隐含风险: agent 能改代码 ≠ 团队能理解为什么这么改

## A2 — Future Trigger (未来触发)

1. **产出理解不过来时**: "仓库里有很多代码但我看不懂"
2. **Loop 产出质量不确定时**: "它说做完了,但我不确定对不对"
3. **团队 AI 使用风险警示时**: 向团队传达"自动化≠理解"
4. **设计 Loop 监督机制时**: 在哪些环节加入人类审查?

**语言信号**: "AI 生成的代码我看不懂"、"产出太多理解不过来"、"AI 使用风险"、"无人盯着的 loop"

**与相邻 skill 的区别**:
- `loop-worthiness-test`: 判断要不要做 loop (本 skill 是运行后的风险管理)
- `maker-checker`: 用 AI 审查 AI 的质量 (本 skill 是人类理解层面的风险)
- `three-stage-evolution`: 阶段定位 (本 skill 是 Stage 3 的特定风险)

## E — Execution (可执行步骤)

### Step 1: 评估认知差距
定期问自己:
- 这个 loop 产出的东西,我能解释给新人听吗?
- 如果 loop 出错,我能快速定位问题吗?
- 仓库里有多少代码/内容是我没亲手看过的?

### Step 2: 设置人类审查节点
- **定期审查**: 每周/每月审查 loop 产出样本
- **关键节点审查**: 在 loop 重大变更、新任务类型、或异常指标时触发人工审查
- **理解度检查**: 随机抽取 loop 产出,尝试用自己的话解释其逻辑

### Step 3: 缓解策略
- **文档化**: 要求 loop 在产出时附带"设计说明"
- **渐进式自动化**: 从 `loop-build-path` 的 Step 1 开始,确保每步都理解后再升级
- **团队 review**: 定期让团队成员互相审查 loop 产出

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **产出完全可客观验证**: 测试 100% 通过 → 认知差距风险低
2. **纯技术调试**: "这个 loop 报错" — 不是认知风险
3. **非 AI 场景**: 这个模型只适用于 AI 生成内容

**作者的盲点与局限**:
- "理解越深越好"是隐含假设,但有些场景 (如 CI/CD) 不需要人理解每一行
- 作者没有给出"理解到什么程度就够了"的标准
- 警告了风险但没有量化 — "差距多大算危险?"没有答案

**与之相邻但容易混淆的方法论**:
- **Technical Debt**: "代码质量负债"; 本 skill 是"理解程度负债"
- **Bus Factor**: "只有一个人会"; 本 skill 是"没人理解"
