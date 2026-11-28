---
name: cca-arc-selection
description: "当需要用户动笔前问\"我该给这个角色配哪种弧光？\"。；用户在正弧/负弧/平弧之间摇摆，或担心选型与类型不匹配。时调用。核心能力：弧光选择与强度审计。关键触发：我该给这个角色配哪种弧光？、角色好像没变/变得很假、弧光到底怎么衡量、我的故事需不需要弧光。不适用于：用户已明确弧型并要结构打点：直接走对应弧型 skill，绕回选型是浪费。"
tags: ["arc-selection", "audit", "character"]
metadata:
  source_book: "《Creating Character Arcs》 K.M. Weiland"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\04-人物弧光与角色设定\\Creating Character Arcs\\cca-arc-selection\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

弧光选择被压缩成一个"三问决策 + 一个公式 + 一道强度自检"：

1. **三问**：①类型 genre——类型自带弧光期待（喜剧要 happy ending、悲剧要 sad ending；浪漫类型基本锁定正弧或平弧）；②起点——角色在好还是坏的境地、信 Lie 还是 Truth；③终点——happy or sad。
2. **核心公式**：弧光 = 结尾 − 开头。起点信 Lie → 终点变好 = 正弧；起点信 Truth = 平弧或腐化弧；起点信 Lie → 终点更糟 = 坠落弧；起点信 Lie → 终点看清悲剧真相 = 幻灭弧；起点与终点几乎一样 = 无弧光（situation）。
3. **强度双检**：a) 把 Climax 移到开场，角色会同样反应吗？会 → 弧太弱，改变只是标签；b) 起始与终局的反差够不够强？这条对 Flat Arc 同样适用——主角的 Truth 与正直可不变，但他开头的动机与理解力不足以支撑结尾的行动。
4. **用途**：三问可先于动笔锁定弧型；双检用于初稿后审计弧光是否"造假"（嘴上变好、行动未变），也用于拒绝"为弧而弧"。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: 奇幻人生——Harold Crick 的三问选型（作者案例）
- **问题**: 作者需要一个生动的入口，把"选弧光"从抽象审美讲成可执行决策。
- **方法论的使用**: 借《奇幻人生》主角 Harold Crick 的觉醒引出类型公式——*"Tragedy you die. Comedy you get hitched."*（Chapter 21）：正弧配 happy ending、负弧配 sad ending。由此进入三问：类型 → 起点 → 终点，因为弧光 = 结尾 − 开头。
- **结论**: 三问可先于动笔锁定弧型；再用"把 Climax 放到开场他会不会同样反应"自检强度。
- **结果**: 选型从"感觉"变成三个可回答的事实问题；作者据此进入全书的弧型分类。

### 案例 2: 夺宝奇兵——无弧光 story vs situation（作者用判断弧光的边界）
- **问题**: 选型时如何判断"这个故事到底要不要弧"？
- **方法论的使用**: 按四条判据判定《夺宝奇兵》是 situation 而非 story——显而易见的解题式处境、不揭示角色只考验解题能力、无复杂副线、起止于同一情绪空间（*"By Lyons's definition, Steven Spielberg's Raiders of the Lost Ark is a situation, not a story."*, Chapter 26）；Indiana Jones 开场与结尾是同一个人。
- **结论**: 无弧光故事可以伟大；但作者同时主张"还没见过哪个故事不能因加入一条深思熟虑的弧光而变得更好"。
- **结果**: 选型结果可以是"无弧"——但要基于判据判断，而非默认"必须有弧"。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 用户动笔前问"我该给这个角色配哪种弧光？"。
2. 用户在正弧/负弧/平弧之间摇摆，或担心选型与类型不匹配。
3. 用户初稿写完后觉得"角色好像没变/变得很假"，需要强度审计。
4. 用户问"弧光到底怎么衡量"或"我的故事需不需要弧光"。
5. 用户已给出角色设定与结局方向，需要快速锁定弧型再展开。

### 语言信号 (用户的话里出现这些就应激活)

- "该选哪种弧 / 用哪种弧光 / 弧光怎么选 / 这个角色走哪条弧"
- "弧光不够强 / 角色到底变没变 / 怎么审计弧光 / 他算有弧光吗"
- "which arc / choose an arc / pick a character arc / arc strength / arc audit / did my character change / ending minus beginning"

### 与相邻 skill 的区分

- 与 `cca-positive-arc` / `cca-flat-arc` / `cca-negative-arc` 的区别: 本 skill 是"选型决策"，后三者是"选定后的结构展开"。用户问"哪种弧" → 本 skill；用户问"正弧的 FPP 怎么打" → `cca-positive-arc`。
- 与 `cca-subplot-arc` / `cca-series-arc` 的区别: 副线弧三形态与系列弧两条路有独立的规划逻辑，不属于单条弧选型。
- 与 `cca-reward-punishment` 的区别: 强度审计发现"弧太弱"后，落地手段是场景级奖惩驱动；但先得完成选型与强度判断，再谈怎么驱动。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **三问锁定弧型**
   - 完成标准: 分别回答 ①类型/类型期待 ②起点（信 Lie 还是 Truth + 处境好坏）③终点（happy/sad）；用"弧光 = 结尾 − 开头"写出起点状态、终点状态、差额所指向的弧型（正弧 / 平弧 / 幻灭 / 坠落 / 腐化 / 无弧）。
   - 判停条件: 若三问指向多种弧型且无法取舍 → 进入步骤 2 用强度自检再筛，不在本步停；若起点与终点状态几乎相同 → 结论是"无弧"，用 Story vs Situation 判据（c30）确认后收尾，不强行造弧。

2. **强度自检（双检）**
   - 完成标准: a) 做"把 Climax 移到开场"测试——能具体说明开场反应与结尾反应的差异；b) 写出一段"同一情境、不同反应"的 before/after 对照场景。两项中任一过不了 → 判定弧太弱，回到步骤 1 强化起/终点的状态差。
   - 判停条件: 若用户要的是"马上把弧展开成逐拍结构" → 记录弧型结论后转对应弧型 skill（`cca-positive-arc` / `cca-flat-arc` / `cca-negative-arc`）。

3. **验证选型不可替换性 + 与类型一致性**
   - 完成标准: 能用一句话回答"为什么这种弧对这个角色不可替换"；检查所选弧与 genre 期待一致（喜剧不以负弧为主推、悲剧不以正弧空转等）。
   - 判停条件: 若"为什么这种弧"答不上来 → 弧型只是标签，回到步骤 1 重新评估起/终点的真实状态；若类型期待与弧型冲突（如喜剧配幻灭弧）→ 先仲裁：要么重估类型定位，要么转 `cca-negative-arc` 检查预兆是否足以让观众接受。

---

## S — 核心立场 (Stance) ★

| 要素 | 内容 |
|---|---|
| **一句话立场** | 三问 |
| **核心主张** | 1. 三问<br>2. 核心公式<br>3. 强度双检<br>4. 用途 |
| **典型敌人** | 凭感觉做弧光选择与强度审计的经验党、只会套模板不会变通的教条主义 |
| **适合议题类型** | 用户动笔前问"我该给这个角色配哪种弧光？"。、用户在正弧/负弧/平弧之间摇摆，或担心选型与类型不匹配。、用户初稿写完后觉得"角色好像没变/变得很假"，需要强度审计。 |

---

## B — 边界 (Boundary) ★

### 🔴 硬约束（世界层·违背就崩）

- 不能违背基本的弧光选择与强度审计逻辑，否则观众/读者会立刻出戏
### 🟡 软约束（规则层·违背有代价）

- 用户已明确弧型并要结构打点：直接走对应弧型 skill，绕回选型是浪费。
- 单场戏设计问题（"这一场怎么惩罚他"）：不是选型问题，转 `cca-reward-punishment`。
- 无 Lie/Truth 概念的纯行动故事：三问的起/终点可能都指向"无弧"，此时用 Story vs Situation 判据确认，不强行造弧。
### 🟢 自设约束（认知层·其实可以重定义）

- 以为弧光选择与强度审计只有一种正确用法——假墙，方法是工具，不是教条
- 以为弧光选择与强度审计能解决所有问题——假墙，每个方法都有适用场景
---

## 相关 skills

**依赖 (depends-on)**: 使用本 skill 前建议先掌握
- `cca-arc-foundation` — 本方法的输入前提

**对比 (contrasts-with)**: 时机/维度不同，看情境选一
- `cca-positive-arc` — 与本方法互斥或互补的替代路径

**组合 (composes-with)**: 常与本方法配合使用
- `cca-flat-arc` — 与本方法形成完整流水线
- `cca-negative-arc` — 与本方法形成完整流水线

---
