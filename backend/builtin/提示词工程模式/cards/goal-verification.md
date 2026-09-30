---
name: goal-verification
description: "当用户说\"跑了 3 天还没完\"、\"有时好有时坏\"、\"为什么产出差\"时调用。核心能力：Goal 可验证化 — 循环设计的质量杠杆点。关键触发：跑了 3 天还没完、有时好有时坏、为什么产出差、loop 停不下来。"
tags: []
metadata:
  source_book: "循环工程"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "classics\\循环工程\\整理skill\\goal-verification\\SKILL.md"
evidence: E4

---
## I — Interpretation (自述)

循环的质量上限 = 其验证环节的质量上限。设计 Loop 时,必须回答两个问题:

1. **Goal (目标)**: 循环要达成什么? 必须是**客观可验证**的 — 不是"做好",而是"达到 X 指标"。
2. **Verification (验证)**: 如何判断目标已达成? 必须有**可执行的检查步骤**。

**好 Goal vs 坏 Goal**:
- ❌ "直到你满意" — 主观,不可验证
- ❌ "做好这个功能" — 模糊,无法判断
- ✅ "凑够 5 条数据" — 客观,可数
- ✅ "平均分 ≥ 9 或最多 8 轮" — 客观 + 硬停

**验证方式光谱** (从客观到主观):
- 纯客观: 跑测试套件、数值指标
- 半客观: 另一个 LLM 评判
- 主观: 人类在环判断
- 模糊: 无法明确判断好坏

## A1 — Past Application (书中案例)

**案例1: 坏 Goal — 缩略图生成 (视频1)**
- Goal: "迭代直到满意" → 主观,导致 27 分钟不可控
- 教训: 应改为"评分 ≥ 8/10 或最多 5 轮"

**案例2: 好 Goal — Abbey Road 复刻 (视频1)**
- Goal: "平均分 ≥ 9 或最多 8 轮" → 客观 + 硬停
- 虽然结果不完美,但循环在预期内停止

**案例3: 验证光谱应用 (视频4)**
- 测试套件 → 最客观,优先用
- LLM 评判 → 次选,需独立 checker
- 人类判断 → 最后手段,成本高

## A2 — Future Trigger (未来触发)

1. **Loop 无法停止时**: "跑了 3 天还没完" → 检查 stop condition 是否过主观
2. **产出质量不稳定时**: "有时好有时坏" → 验证环节可能不可靠
3. **设计新 Loop 时**: 先写 goal 和 verification,再写 action
4. **调试 Loop 时**: 诊断"为什么产出差" → 先看 goal 是否可验证

**语言信号**: "loop 停不下来"、"怎么定义完成"、"goal 怎么写"、"产出质量不稳定"

**与相邻 skill 的区别**:
- `loop-three-elements`: 三要素的整体框架 (本 skill 专注 stop condition 的设计)
- `maker-checker`: 验证环节的具体实现 (本 skill 是验证的设计原则)
- `loop-worthiness-test`: 判断要不要做 loop (本 skill 是决定后如何设计)

## E — Execution (可执行步骤)

### Step 1: 将模糊目标转化为可验证目标
面对"做好 X"类目标,问:
- "做好"的具体表现是什么?
- 能否用一个数字/布尔值判断?
- 如果不能,能否拆成多个可验证的子目标?

### Step 2: 选择验证方式
按客观性从高到低尝试:
1. **纯客观检查**: 测试通过? 数值达标? 文件存在?
2. **LLM 评判**: 用独立 agent 按 rubric 打分
3. **人类判断**: 以上都不可行时的最后手段

### Step 3: 设置 Hard Stop
即使验证是主观的,也必须设置硬性上限:
- 最大迭代次数 (如 8 轮)
- 最大运行时间 (如 30 分钟)
- 最大 token 消耗

### Step 4: 验证环节的独立检查
- 不要让同一个 agent 自产自检 (参见 `maker-checker`)
- 验证 agent 应该是 read-only 的,有明确的 spec

## B — Boundary (边界)

**不要使用这个 skill 的场景**:

1. **目标已经可验证**: "凑够 5 条"不需要再设计
2. **纯创意任务**: 诗歌、艺术等无法客观验证,本 skill 不适用
3. **非循环场景**: 单次任务的 goal 设计不需要考虑 stop condition

**作者的盲点与局限**:
- "Goal 必须客观"在创意类任务中很难实现,但作者没有给出创意任务的替代方案
- 验证光谱假设"越客观越好",但有时主观判断 (人类审美) 恰恰是目标
- 视频案例全部是技术任务,对内容创作、研究等场景的验证设计覆盖不足

**与之相邻但容易混淆的方法论**:
- **SMART 目标**: 通用目标设定框架; 本 skill 专注循环场景的"可验证停止条件"
- **测试驱动开发 (TDD)**: "先写测试再写代码"; 本 skill 的"先设计验证再设计 action"思路类似
