---
name: tvd-season-bible
description: "当需要发现 AI 生成的相邻集出现设定矛盾（某计解释前后不一、性格跳变），需要回头建立/补完 bible 来约束。时调用。核心能力：Season Bible / Overview 总纲文档。关键触发：AI 产出来的集前后不一致，规则没统一、整季情感旅程的已知首尾 + 每集节点、把世界规则与角色事实固化成权威文档、帮我把世界观/角色设定写成 bible / 总纲 / 设定集。不适用于：只写单集分集大纲 → 用 `tvd-outline-color-cards`。"
tags: ["season-bible", "canon", "worldbuilding"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-season-bible\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- Overview 介绍整个系列的世界与 quest（地点/风格/调性/语境/尤其角色），**不是** pilot 摘要。
- Season Bible 是固化"系列规则 + 正典(canon)"的权威文档，含七块：log line、franchise、springboards 总览、tone/style/quest、角色小传、故事指引、过往集摘要。
- 两种生成路径：预先整体规划（Babylon 5 写满五年再提案）vs 边写边攒（Northern Exposure 每集新事实发给全组，多年累积成 compendium）。
- 核心判断：bible = 故事世界延展的权威 canon 文档；脱离它，集与集、人与人的设定就会打架。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: Northern Exposure — "边写边攒"的 Bible（case-007）
- **问题**：ongoing pilot 型剧集人物弧从第一集就滚动，无法预先定死所有设定。
- **方法论的使用**：编剧团队每集发明角色的新兄弟/秘密/恐惧，就列为"facts to wax"发给全组，多年累积成 compendium。
- **结论**：bible 不必一次写全，可持续生长。
- **结果**：形成与"预先写五年"路径对照的活文档范式。

### 案例 2: Star Trek: The Next Generation — "圣经之王"（case-028）
- **问题**：长寿系列跨多季多编剧，如何维持世界观与 continuing cast 统一。
- **方法论的使用**：把规则文档做到极完备，作为新编剧/导演理解系列的唯一权威源。
- **结论**：bible 是跨季一致性的制度保障。
- **结果**：成为书中"靠 bible 维持跨季一致"的标杆，作者本人曾任 TNG 编剧，论述带一手可信度。

### 案例 3: Babylon 5 — 预先写满五年（case-027）
- **问题**：长线神话如何不烂尾、不挖坑不填。
- **方法论的使用**：JMS 在另一档 staffing 期间把五年剧情全写完，提案前系列已"完成"。
- **结论**：bible 可预先整体设计到极致。
- **结果**：树立"系列可预先整体设计"的可能性上限，对照 Northern Exposure 的累积路径。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 发现 AI 生成的相邻集出现设定矛盾（某计解释前后不一、性格跳变），需要回头建立/补完 bible 来约束。

### 语言信号 (用户的话里出现这些就应激活)

- "帮我把世界观/角色设定写成 bible / 总纲 / 设定集"
- "AI 产出来的集前后不一致，规则没统一"
- "series bible / season bible / overview / canon / 世界观文档 / world rules"

### 与相邻 skill 的区分

- 与 `tvd-season-arc-planning` 的区别：arc-planning 关注"整季情感旅程的已知首尾 + 每集节点"（纵向弧光节奏，是规划方法）；season-bible 关注"把世界规则与角色事实固化成权威文档"（横向一致性底座，是存储/规范）。前者设计、后者存档；规划季弧时也要查 bible，但 bible 是存档不是设计。
- 与 `tvd-pilot-design` 的区别：pilot 设计是造第一集的世界与引擎，bible 是把已建世界写成可复用的规则文档。
- 与 `tvd-world-extension-canon` 的区别：bible 是 canon 的母本/权威源，world-extension 是用 canon 做番外延展——bible 定义规则，world-extension 在规则外沿拓展。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **列出 bible 必含区块并逐项填空**
   - 完成标准：log line / franchise / springboards / tone-style-quest / 角色小传 / 故事指引 / 过往集摘要 七块均有实质内容；角色小传含"维度 + 内在冲突 + 连续性约束"。

2. **单列 canon 清单作为 AI 产集硬约束**
   - 判停条件：若项目仅 1 集、无跨集一致需求，跳到步骤 3 只出不完整 bible。

3. **建立"边写边攒"更新机制**
   - 完成标准：每集产生的新事实/秘密写入 bible 的 canon 区并广播，有明确责任人/流程，新集产出后 bible 同步更新。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 只写单集分集大纲 → 用 `tvd-outline-color-cards`
- 只规划季情感弧 → 用 `tvd-season-arc-planning`
- 仅 1 集短内容、无跨集/跨人需求 → 不必建完整 bible

### 作者在书中警告的失败模式

- ce19 躲回家写导致与系列脱节：脱离 bible/canon 同步，草稿与系列设定矛盾，交稿即过时。
- ce11 季终 prematurely 收掉主线弧：bible 若把滚动 quest 写成闭合，系列引擎熄火（"如果只拍一季也圆满"成设计目标即错）。
- ce12 重复/虚无：bible 没有真实情感引擎、纯公式化，观众投资感转愤怒。

### 作者的盲点 / 时代局限

- "The Web is Dead"判断失误，低估了 bible 的跨平台、跨分发形态价值。

### 容易混淆的邻近方法论

- `tvd-season-bible` 与 `tvd-season-arc-planning`：最易混。记忆点——arc 是"怎么走（纵向旅程）"，bible 是"写下来给人看（横向规则）"。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - （无，本 skill 是多数 skill 的底座：其余 14 个 skill 均 depends-on 本 skill）
- contrasts-with:
  - `tvd-season-arc-planning` — bible 是规则存档（横向），arc 是旅程设计（纵向），最易混。
- composes-with:
  - `tvd-world-extension-canon` — bible 是 canon 母本，延展在其外沿。
  - `tvd-platform-agnostic-pendulum` — 钟摆中心（角色/长叙事）正是 bible 要固化的不变内核。

---
