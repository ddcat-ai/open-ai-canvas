---
name: tvd-long-narrative-types
description: "当需要被问\"这是单元剧还是连续剧\"，需要给出可操作的混合骨架而非二选一。；评估某集\"太像独立小品/太像连续剧拖沓\"，需要三型透时调用。核心能力：tvd-long-narrative-types — 长叙事三型与混合结构。关键触发：这是单元剧还是连续剧、太像独立小品/太像连续剧拖沓、这集要不要当集闭环 / 留跨集线、类型判定。不适用于：用户在画整季弧光图表、定已知首尾（应改用 tvd-season-arc-planning。"
tags: ["narrative", "structure", "series"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-long-narrative-types\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

把任何系列拆成三型，作为判断骨架的分类透镜：

1. **Anthology（选集式）**：每周完全独立故事，仅框架相连（如 The Twilight Zone），现代罕见。
2. **Closure（闭环式）**：常驻主演 + 每集新情境且当集"闭合"，如 CSI 等 procedural；可任意顺序重播。
3. **Serials（连载式）**：故事跨多集延续、主演长期演变（如 The Wire, Mad Men），弧光滚动不闭合。

核心洞见：多数成功剧是**混合体**——当集闭合线（closure）与跨集弧光线（serial）并存。Closure 喂饱"随意观看"，Serial 喂饱"情感投资"。
---

## A1 — 书中的应用 (Past Application)

### 案例 1: CSI — 程序剧的纯正 closure 范式 (case-012)
- **问题**: 如何设计一个"可无限复制、可任意顺序重播"却仍高张力长青的剧？
- **方法论的使用**: Ann Donahue 把 CSI 定为最纯正的 procedural/closure 范式——每集带来新案件、靠线索在结尾收束；用"秘密终将被揭穿"的谜题结构统一全类型。作者据此说明 closure 型如何让 syndicator 无视集序。
- **结论**: closure 是"可批量产出、低观众门槛"的结构地基；但纯 closure 缺长期情感投资。
- **结果**: 解释 CSI 为何能"格式化输出"成 Miami/NY 等多档衍生（format franchising）。

### 案例 2: House — 程序骨架下的 serial 关系弧 (case-003)
- **问题**: 一部每集"当集闭合"的医疗剧，如何仍然黏住观众数年？
- **方法论的使用**: 作者指出 House 在写作上被构建为 procedural（closure），却靠 Chase–Cameron 等持续角色关系积累出 followings——证明"closure 外壳 + serial 内核"的混合才是常态。
- **结论**: 判定结构类型时不能只看表面节奏，要看是否有滚动的角色/关系弧在底下运行。
- **结果**: 成为 long-narrative-types 与 episodic-characterization 的交汇证据。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 被问"这是单元剧还是连续剧"，需要给出可操作的混合骨架而非二选一。
3. 评估某集"太像独立小品/太像连续剧拖沓"，需要三型透镜校准。

### 语言信号 (用户的话里出现这些就应激活)

- "这集要不要当集闭环 / 留跨集线"
- "单元剧 vs 连续剧 / 单元计谋 + 长期家庭弧光 怎么混"
- "closure / serial / anthology / 长叙事类型"
- "这部剧整体叙事结构 narrative structure 怎么定"
- "long narrative / mixed structure / 系列化骨架"

### 与相邻 skill 的区分

- 与 `tvd-episodic-characterization` 的区别：本 skill 是**整季结构分类透镜**（哪些集闭合/跨集）；episodic-characterization 是单角色的连续性与维度原则，不回答集间连接方式。
- 与 `tvd-season-arc-planning` 的区别：本 skill 只做"类型判定"（这是 closure+serial 混合）；season-arc-planning 是把判定后的 serial 部分落到"已知首尾 + 每集情感节点"的具体规划。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **判定剧的整体三型归属**
   - 完成标准: 明确写出"本剧以 closure 为主 / serial 为主 / 混合"，并给出依据（是否当集闭合、是否跨集演变）。

2. **逐集标注闭合/跨集占比**
   - 完成标准: 对每集标出"A 线是当集闭合（计谋收口）还是跨集延续（家庭弧）"，至少区分出两类集的比例。

3. **校准混合比例**
   - 完成标准: 给出"每 X 集至少一次 serial 推进"或"closure 集不得完全零跨集钩子"的明确配比建议，避免 ce12 的重复/虚无。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户只在打磨单角色人设与维度（应改用 `tvd-episodic-characterization`）。
- 用户在画整季弧光图表、定已知首尾（应改用 `tvd-season-arc-planning`）。
- 用户在写 pilot 前几集的钩子设计（应改用 `tvd-pilot-design`）。

### 作者在书中警告的失败模式

- **ce12 重复/套路化/走向虚无（contrived & going nowhere）**：要么每集重复同一爆点（审美疲劳），要么为维持悬念搞牵强逆转，要么铺了多年谜题从不兑现。混合骨架必须保证 serial 线"持续真实 reveal"，否则观众投资感转愤怒。

### 作者的盲点 / 时代局限
### 容易混淆的邻近方法论

- 与 `tvd-season-arc-planning` 最常混淆：记住本 skill 只回答"结构属于哪型/怎么混"，不回答"整季首尾怎么定、每集情感节点怎么排"。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — overview 需先判定 closure/serial 混合骨架，再写入总纲。
- contrasts-with:
  - （无）
- composes-with:
  - `tvd-season-arc-planning` — 三型决定季弧该多强、哪些集跨集延续。
  - `tvd-platform-agnostic-pendulum` — 长叙事是钟摆中心内核之一，跨平台不变。

---
