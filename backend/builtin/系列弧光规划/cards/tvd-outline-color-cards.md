---
name: tvd-outline-color-cards
description: "当需要写完一集发现\"某条线中间断了\"或\"结尾只有 A 线 payoff、B/C 没回收\"。；单集写到超长、焦点涣散，需要回到 时调用。核心能力：大纲 + 颜色卡片多线追踪。关键触发：某条线中间断了、结尾只有 A 线 payoff、B/C 没回收、帮我写这一集的分集大纲 / outline、A-B-C 三条线怎么铺 / 用颜色卡片管理多线。不适用于：用户还在\"这个点子能不能做一集\"阶段——用 tvd-finding-storie。"
tags: ["outline", "multi-line-tracking", "beat-sheet"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-outline-color-cards\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

动笔前必写 outline（分场/beat sheet）作路线图；用颜色卡片管理多线：

1. **先写 outline**：把每集拆成分场或 beat sheet，作为全局路线图，防止 AI/写手跑偏。
2. **颜色卡片法**：用不同颜色代表每条故事线（A 主 / B 次 / C 调剂或 runner），分别铺满该线全部 beat 再拼装。
3. **一眼诊断**：颜色法立刻暴露某条线在某幕"丢失"、或某线结尾没有 payoff。
4. **工作流**：先快速冲到 act break 与结尾出完整雏形（J.J. Abrams 室信条），再回头打磨，避免逐场精雕卡住整体。

核心价值：让"多线并行"变得可触摸、可平衡，特别适合 AI 批量产集时守住结构一致性。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: John Wells 编剧室——用 outline 排整季
- **问题**: 长寿剧如何保证单集与整季不脱轨？
- **方法论的使用**: 编剧室用 outline / beat sheet 先把整季 12 集 plot points 排上白板，个别编剧再据 outline 写 treatment→草稿→二稿。
- **结论**: outline 是单集与整季之间的契约层，先有干净叙事再展开。
- **结果**: 提供"理想流程"模板，单集在已知框架里工作、不跑题。

### 案例 2: J.J. Abrams 的"好编剧室"——先冲到 act break 再回头改
- **问题**: 编剧常陷入逐场精雕，整体节奏塌陷。
- **方法论的使用**: 健康 room 信条是快速冲到 act break 与结尾，先有完整雏形再回头修正，避免"精心设计的虚无"。
- **结论**: 工作流顺序（先雏形后打磨）比逐场完美更重要。
- **结果**: 与 case-017 地狱 room 对照，提炼健康协作的可操作原则。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 写完一集发现"某条线中间断了"或"结尾只有 A 线 payoff、B/C 没回收"。
3. 单集写到超长、焦点涣散，需要回到 outline 做减法。

### 语言信号 (用户的话里出现这些就应激活)

- "帮我写这一集的分集大纲 / outline"
- "A-B-C 三条线怎么铺 / 用颜色卡片管理多线"
- "批量生成 大纲，保持结构一致"
- "outline / beat sheet / 多线追踪 / 分集大纲模板"

### 与相邻 skill 的区分

- 与 `tvd-grid-reverse-engineering` 的区别：grid 是从 act break 的 cliffhanger **反向工程分幕锚点**（结构骨架）；本 skill 是拿到故事后**写 outline + 用颜色卡追踪多线分布与平衡**（执行路线图）。grid 定"幕在哪断"，本 skill 定"每幕里三线各走到哪"。
- 与 `tvd-a-b-c-stories` 的区别：a-b-c-stories 是"什么是 A/B/C 并行线"的概念定义；本 skill 是把这些线**落到 outline 并用颜色卡管理**的操作法。常配套使用。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后，agent 应按以下步骤执行:

1. **产出分集大纲模板（beat sheet）**

2. **铺颜色卡片并诊断**
   - 完成标准: 用 A（主计线）/B（家庭线）/C（邻里 runner）三色铺满各线 beat；输出"丢失线/无 payoff 线"清单。
   - 判停条件: 若某线全程无 beat，回到 finding-stories-filter 或 a-b-c-stories 重审。

3. **先出雏形再迭代**
   - 完成标准: 先快速冲到 act break + 结尾出完整雏形，再回头打磨；确认无 backstory/tangent 过载（避 ce07）与故事过载（避 ce08）。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户还在"这个点子能不能做一集"阶段——用 tvd-finding-stories-filter。
- 用户要"整季 首尾与情感旅程"——用 tvd-season-arc-planning。
- 用户只问"这一集分几幕、幕末钩子怎么锚"——用 tvd-grid-reverse-engineering / tvd-tent-poles-worst-case。

### 作者在书中警告的失败模式

- **ce07 沉溺 backstory / 支线 / tangent**：大篇幅铺过往、加戏给次要人物，单集肿胀焦点涣散——回到 outline 做干净叙事。
- **ce08 故事过载**：outline 把"一串场景"乐观算作"一个 beat"，实际远超单集容量，需删整条弧而非小修。

### 作者的盲点 / 时代局限
### 容易混淆的邻近方法论

- `tvd-grid-reverse-engineering`（最易混，见 A2）；`tvd-a-b-c-stories`；`tvd-tent-poles-worst-case`。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — outline 须对照 bible 规则保持一致。
  - `tvd-a-b-c-stories` — 先有 A/B/C 线定义，才能用颜色卡管理它们。
  - `tvd-grid-reverse-engineering` — grid 反向工程给出幕断，outline 在其上铺内容。
  - `tvd-finding-stories-filter` — 先有通过筛选的点子再写 outline。
  - `tvd-dramatic-beat` — outline=beat sheet，须逐 beat 合格。
- contrasts-with:
  - （无）
- composes-with:
  - `tvd-season-arc-planning` — 单集 outline 须服务季弧节点。
  - `tvd-episode-quality-checklist` — 写完后用质检验收 outline。

---
