---
name: cca-series-arc
description: "当需要你在规划三部曲/多部曲，想知道主角弧光怎么跨卷分配、三部曲能不能对齐三幕。；你写完第一本主角正弧，第二本不知道怎么让主角时调用。核心能力：系列弧光两种路线。关键触发：主角变好了就没戏写、系列的角色弧光怎么设计、三部曲弧光节奏、第二部主角怎么继续成长。不适用于：只是要给主角安排一个催化者、或规划单卷内配角弧——本 skill 不管单卷内的位。"
tags: ["series", "long-form", "character-evolution"]
metadata:
  source_book: "《Creating Character Arcs》 K.M. Weiland"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\04-人物弧光与角色设定\\Creating Character Arcs\\cca-series-arc\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

系列弧光有两条基础路线，先选路线再谈节奏：(A) 整系列一条总弧——适合讲一个无缝整体故事的系列（如三部曲）；(B) 每卷一条独立弧——适合每卷自成一体的剧集式系列，每卷给角色一条新的 Lie、卷末克服。

三部曲可以天然对齐三幕：第一幕 = 被 Lie 奴役、第二幕 = 发现 Truth、第三幕 = 借 Truth 获得力量。关键注意：第二幕在单卷里占全篇一半，所以跨卷后它格外长——总弧的"第二幕"往往从第一本的 3/4 处开始、延伸到第三本的 1/4 处，跨卷时必须重新分配 beat 时机。

每卷独立弧可以全新，也可以"继承"：Thor 第一集正弧产出的 Truth，恰好成为第二集平弧的 Truth 基石——角色先完成人格成长（正弧），再以平弧身份改造世界。

进阶玩法：总弧之上，每卷再叠一条基于"迷你 Lie"的独立小弧（如卷 1"勇敢是英雄的事"、卷 2"恐惧等于懦弱"），逐卷贡献角色克服总 Lie 的能力，层层加深主题。

决策核心：先回答"我的系列是连续性长篇还是剧集式独立卷"，再决定弧的粒度；书越多节奏越难，卷与卷的因果链越容易被稀释。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: 漫威 Thor 系列——第一集正弧转化为第二集平弧
- **问题**: 角色在第一部完成了完整的正弧、克服了傲慢之 Lie，第二部他还能有什么弧？
- **方法论的使用**: 采用"每卷独立弧"路线——第一集的正弧结束时产出一个新 Truth，恰好作为第二集平弧的 Truth 基础。
- **结论**: "Thor undergoes a Positive Change Arc, which then sets up the Truth on which his Flat Arc in the second movie is based."
- **结果**: 角色先完成人格成长（正弧），再以平弧身份成为改造世界的催化剂——这条"继承式"衔接让续作不必重复成长线，也让系列整体呈现出"成长 → 传道"的递进结构。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 你在规划三部曲/多部曲，想知道主角弧光怎么跨卷分配、三部曲能不能对齐三幕。
2. 你写完第一本主角正弧，第二本不知道怎么让主角继续"有弧光"。
3. 你在写剧集式系列（每卷/每季自成一集），想知道每卷是否该给主角一条新 Lie。
4. 你在写长连载，担心"主角变好了就没戏写"，想用迷你 Lie 分层维持张力。

### 语言信号 (用户的话里出现这些就应激活)

- "系列的角色弧光怎么设计" / "三部曲弧光节奏" / "第二部主角怎么继续成长" / "每本书一个谎言" / "每季一个小弧"
- "series character arc" / "trilogy arc" / "overarching arc" / "each book a new Lie" / "character evolution across books" / "long-running series"

### 与相邻 skill 的区分

- 与 `cca-subplot-arc` 的区别: 副线 skill 管"单卷内一条弧的位置（主线/副线）"；本 skill 管"一条弧跨多卷的时间分配（粒度）"。用户说"这部里/这一本里"归副线，说"三部曲/几卷/每季"归系列。
- 与 `cca-arc-foundation` 的区别: Lie/Ghost 诊断是单卷/单角色的地基；本 skill 处理跨卷的 Lie 分层（总 Lie vs 每卷迷你 Lie）。
- 与 `cca-flat-arc` 的区别: 系列中"正弧→平弧"的衔接会用到平弧概念，但平弧 skill 管单卷平弧怎么构，本 skill 管跨卷怎么接。
- 与 `cca-arc-selection` 的区别: 三问选单条弧的类型；本 skill 选跨卷的路线与粒度。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **判定系列类型**
   - 完成标准: 明确回答"连续性长篇（一条无缝总弧）还是剧集式独立卷"，并写出总故事的一句话 Lie（若不存在总 Lie 则属独立卷路线）。

2. **总弧路线：把弧光分布到全系列**
   - 三部曲对齐三幕：第一幕 = 被 Lie 奴役、第二幕 = 发现 Truth、第三幕 = 借 Truth 获得力量；特别标注第二幕因独卷长度而在跨卷时需重排（从第一本 3/4 延伸到第三本 1/4）。
   - 完成标准: 画出"卷号 × 三幕/关键 beat"分布表，每个 beat 标注落在哪一卷哪个位置。
   - 判停条件: 若步骤 1 判定为剧集式独立卷 → 跳过本步骤，直接进入步骤 3。

3. **每卷独立弧路线：逐卷规划新 Lie**
   - 每卷写一条新的（或继承前卷的）Lie→Truth，卷末克服；可用 Thor 模式：上一卷正弧的 Truth 作为下一卷平弧的基石。
   - 完成标准: 每卷都有独立的 Lie→Truth 一句话描述，且注明卷与卷的衔接关系（全新 / 继承）。

4. **进阶：总弧之上叠迷你 Lie 分层**
   - 若系列存在总 Lie，为每卷设计一条支撑性的迷你 Lie 小弧，逐卷贡献克服总 Lie 的能力。
   - 完成标准: 每卷迷你 Lie 与总 Lie 的关系能一句话说清；自检：卷数越多节奏越紧时，跨卷的因果链是否被稀释。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 单本独立故事（无续作计划）——用主弧 skill（`cca-positive-arc` / `cca-flat-arc` / `cca-negative-arc`）。
- 只是要给主角安排一个催化者、或规划单卷内配角弧——本 skill 不管单卷内的位置与角色分工。
- 非连载的一次性短篇/中篇——两条路线都建立在线性连载的前提上。

### 作者在书中警告的失败模式

- "书越多，节奏越难"（Ch27）：每加一卷，总弧的 beat 分配越难，尤其第二幕跨卷时长度失衡。
- 教训与成功的因果断裂（McCollum，Ch13 转述）：跨卷时若总弧的 Truth 在第一卷就学到、最终胜利在末卷才兑现，因果链会被稀释——关键"选择/觉悟"应尽量贴近其兑现点。
- 结构对、执行错（前传三部曲，Ch18 反例）：按弧光骨架打满点但卷内执行失败，整套系列照样垮掉——系列规划不能只做宏布局。

### 作者的盲点 / 时代局限

- 写于 2016，未触及串流时代的跨季长弧与"半连续半单元"混合叙事，也没有处理动漫/连载小说几百话的超长生命周期。
- 三部曲对齐三幕以好莱坞三幕电影为底座，对东方章回、物语、诗化叙事零覆盖。
- 单一主角假设 + "每卷一个 Lie"的干净模型，在群像/多视角长篇中会失真。

### 容易混淆的邻近方法论

- 总弧 vs. 平弧：总弧是"一条弧跨多卷"，可以是正弧也可以是平弧路线；别把"主角后续走平弧"与"无弧"混为一谈。
- 迷你 Lie vs. 每卷新 Lie：迷你 Lie 是叠在总弧之上的支撑性小弧；每卷新 Lie 是独立卷路线里每卷的完整新谎言——前者默认存在总弧，后者默认没有总弧。

---

## 相关 skills (阶段 3 填充)

- depends-on: `cca-arc-foundation`（Lie/Truth）、`cca-arc-selection`
- contrasts-with: `cca-subplot-arc`, `cca-flat-arc`
- composes-with: `cca-subplot-arc`（半连续格式）

---
