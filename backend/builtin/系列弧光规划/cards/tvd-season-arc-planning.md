---
name: tvd-season-arc-planning
description: "当需要已有一堆单集点子但\"集与集之间没线\"，需要一张弧光图看哪条线在哪段\"丢失\"。；担心写成\"单元拼盘\"、缺贯穿 的系列问题（时调用。核心能力：季弧规划。关键触发：集与集之间没线、。 3. 担心写成、帮我把 总纲排一下 / 整体走向怎么定、这 有没有一条贯穿的主线弧。不适用于：用户只问\"第一集怎么开头/前 3 秒怎么抓人\"——用 tvd-pilot-des。"
tags: ["season-arc", "series-bible", "macro-planning"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-season-arc-planning\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

长篇系列开发先做"集训（camp）"定下全局，而非边写边想：

1. **定整季角色弧光**：每个常驻角色这一季从哪到哪（情感旅程），用"角色 × 集数"颜色弧光图（白板）统一规划交集与空白。
2. **锚定已知首尾**：开头状态与结尾状态必须预先锁定；如能，再定关键集（如第 12 集的中点转折）。中间可演化，但首尾不动。
3. **每集服务终点**：任何单集都要朝已知终点推进，不孤立噱头。

区别于单集思维：先有 macro 的情感旅程，单集才知自己落在曲线的哪一点。首尾锚定让续看引擎持续点火，避免季终 prematurely 收掉主线。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: John Wells 编剧室——全组 6 周排整季
- **问题**: ER / The West Wing 等长寿剧如何保证一整季而非单集各自为战？
- **方法论的使用**: 6 月第一周起，长木桌 + 白板写满 12 集 plot points，全组 6 周排出整季 episodes 与 arc，再分派个别编剧写 treatment→草稿。
- **结论**: 整季 arc 先于单集被排布，单集 writers 在已知首尾的框架里工作。
- **结果**: 提供"理想编剧室"运转模板，单集不再脱轨。

### 案例 2: Babylon 5——预先写完五年的极致样本
- **问题**: 长篇如何避免 arc 失控或挖坑不填？
- **方法论的使用**: J.M. Straczynski 在另一档 staffing 期间就把五年剧情全写完，提案前系列已"完成"，首尾与每季转折全部锚定。
- **结论**: "已知首尾 + 长弧图"可推到极致控制。
- **结果**: 树立系列可预先整体设计的上限，对照 Northern Exposure 的"边写边攒"路径。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 已有一堆单集点子但"集与集之间没线"，需要一张弧光图看哪条线在哪段"丢失"。
3. 担心写成"单元拼盘"、缺贯穿 的系列问题（series question）与续看引擎。

### 语言信号 (用户的话里出现这些就应激活)

- "帮我把 总纲排一下 / 整体走向怎么定"
- "这 有没有一条贯穿的主线弧"
- "季终该怎么留钩子 / 首尾怎么锁"
- "season arc / 系列问题 / 角色弧光图 / 整季规划"

### 与相邻 skill 的区分

- 与 `tvd-pilot-design` 的区别：pilot-design 只管**第一集**如何建立 world、埋续看钩子、前几分钟抓人；本 skill 管**整季 **的首尾与情感旅程。问"第 1 集前 3 秒怎么抓人"→ pilot-design；问"整体怎么走、首尾锁哪"→ 本 skill。
- 与 `tvd-long-narrative-types` 的区别：long-narrative-types 是分类透镜（closure/serial/混合）；本 skill 是在选定类型后用"已知首尾 + 弧光图"落地执行。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后，agent 应按以下步骤执行:

1. **提炼 Series Question 与首尾状态**
   - 完成标准: 产出一句话系列问题 + 开头状态卡 + 结尾状态卡（如从第 1 集"被动护家"到第 "主动立家规"）。

2. **画"角色 × 集数"颜色弧光图**
   - 判停条件: 若某常驻角色全程无变化，回到 finding-stories-filter 重审其 existence。

3. **倒推单集归属 + 季终钩子**
   - 完成标准: 每集标注"服务哪个弧光节点"；季终输出 ≥1 个留给下一季的 unanswered question（禁止 prematurely 闭合主弧，见 ce11）。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户只问"第一集怎么开头/前 3 秒怎么抓人"——用 tvd-pilot-design。
- 用户只问"这个具体点子能不能做一集"——用 tvd-finding-stories-filter。
- 用户要的是 world 规则与角色小传的权威文档——用 tvd-season-bible。

### 作者在书中警告的失败模式

- **ce11 季终 prematurely 收掉主线弧**：续订未定时"勇敢收尾"，把本应滚动数年的核心疑问写出；一旦续订，引擎熄火。系列化命脉是"已知情感旅程 + 留悬念"。
- **ce12 重复/套路化/走向虚无**：只挖坑不填或多季零进展，观众投资感转愤怒。

### 作者的盲点 / 时代局限
### 容易混淆的邻近方法论

- `tvd-pilot-design`（最易混，见 A2）；`tvd-season-bible`；`tvd-long-narrative-types`。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-episodic-characterization` — 季弧建立在角色垂直弧光之上。
  - `tvd-long-narrative-types` — 先判定 closure/serial 混合骨架，再规划弧强度。
- contrasts-with:
  - `tvd-season-bible` — arc 是"怎么走（纵向旅程设计）"，bible 是"写下来给人看（横向规则存档）"，最易混。
  - `tvd-pilot-design` — 季弧管整季 首尾，pilot 只管第一集，层级不同易混。
- composes-with:
  - `tvd-outline-color-cards` — 单集 outline 须服务季弧节点（组合使用）。

---
