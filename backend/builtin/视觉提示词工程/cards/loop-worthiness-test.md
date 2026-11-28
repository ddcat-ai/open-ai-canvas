---
name: loop-worthiness-test
description: "当用户说\"我想让 AI 每天做 X,值得做 loop 吗?\"、\"这个 loop 跑一次花太多 token\"、\"loop 出来的东西不能用\"时调用。核心能力：Loop 适用性四条件测试 — 防止过度工程化。关键触发：我想让 AI 每天做 X,值得做 loop 吗?、这个 loop 跑一次花太多 token、loop 出来的东西不能用、要不要做。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\loop-worthiness-test\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

判断一个任务是否值得搭建循环系统,需要同时满足四个条件:

1. **高频重复**: 任务至少每周做一次。一次性或低频任务不值得搭建 loop 系统。
2. **可自动验证**: 有测试/Lint/检查能自动拦截坏结果,无需人工审验每条输出。
3. **Token 预算充足**: 能承受反复读取上下文和试错的成本,包括浪费的 token。
4. **完整工具链**: Agent 拥有日志、运行环境、自测能力,能自己跑代码看结果。

**四条都满足才值得做 loop。** 这是一个反直觉的过滤器 — 大多数人看到 loop 很酷就想用,不会先做适用性判断。

## A1 — Past Application (书中案例)

**案例1: 值得做 Loop — 选题收件箱 (视频3)**
- 高频: 每天 ✅ | 可验证: 有 topic-score 评级 ✅ | 预算: 小 ✅ | 工具: 有 research API ✅
- 结论: 值得

**案例2: 不值得做 Loop — 一次性脚本 (视频1 隐含)**
- 高频: 一次性 ❌ | 可验证: N/A | 预算: N/A | 工具: N/A
- 结论: 不值得,单次提示即可

**案例3: 部分满足 — 缩略图生成 (视频1)**
- 高频: 每周 ✅ | 可验证: 主观评分 ❌ | 预算: 中 ✅ | 工具: 有 ✅
- 结论: 验证环节是瓶颈,需要引入独立评分 agent

## A2 — Future Trigger (未来触发)

1. **纠结是否自动化时**: "我想让 AI 每天做 X,值得做 loop 吗?"
2. **Loop 成本过高时**: "这个 loop 跑一次花太多 token" → 检查条件3和4
3. **Loop 产出质量差时**: "loop 出来的东西不能用" → 检查条件2 (验证是否可靠)
4. **团队推广 Loop 时**: 用这个测试作为"要不要做"的决策门槛

**语言信号**: "值得做 loop 吗"、"该不该自动化"、"loop 成本太高"、"这个任务适合 loop 吗"

**与相邻 skill 的区别**:
- `loop-three-elements`: 假设已决定要做,关注"怎么设计" (本 skill 是前置决策)
- `loop-build-path`: 关注构建步骤 (本 skill 是构建前的判断)
- `comprehension-gap`: 关注 loop 运行后的风险 (本 skill 是运行前的判断)

## E — Execution (可执行步骤)

### Step 1: 四条件检查清单
对目标任务逐条检查:
```
□ 高频重复: 至少每周做一次?
□ 可自动验证: 有客观标准判断好坏?
□ Token 预算: 能承受反复试错?
□ 完整工具链: agent 有日志+环境+自测能力?
```

### Step 2: 决策
- **4/4 通过** → 进入 `loop-build-path` 开始设计
- **3/4 通过** → 识别瓶颈条件,先解决再建 loop
- **≤2/4 通过** → 不建议做 loop,用单次提示或简单自动化替代

### Step 3: 如果不满足,替代方案
- 条件1不满足 → 单次提示 / 按需触发
- 条件2不满足 → 人类在环 (Human-in-the-loop)
- 条件3不满足 → 降低频率 / 简化 action
- 条件4不满足 → 先完善工具链,再考虑 loop

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **已经决定要做 loop**: 此时应进入 `loop-build-path`,不再做适用性判断
2. **纯技术问题**: "这个 loop 为什么报错?" — 这是调试,不是决策
3. **非重复性任务**: 一次性任务直接做,不需要 loop

**作者的盲点与局限**:
- 四条测试条件是经验法则,缺乏严格的实证数据支持
- 条件2"可自动验证"在创意类任务中很难满足 (写作、设计),但这类任务仍可能有 loop 价值
- 视频作者全部是技术背景,对非技术场景 (内容创作、研究) 的适用性判断可能不准确

**与之相邻但容易混淆的方法论**:
- **成本-收益分析**: 通用决策框架; 本 skill 是 loop 领域的具体化
- **MVP 思维**: "先做最小可用版本"; 本 skill 是"先判断值不值得做"
