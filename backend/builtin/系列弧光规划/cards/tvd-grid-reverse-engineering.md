---
name: tvd-grid-reverse-engineering
description: "当需要用户写完一集大纲但觉得\"不知道每幕在哪断、幕末没钩子\"，想用一张表把整集节拍摊开看。；用户拿到一段已有剧本，想\"反向\"拆时调用。核心能力：tvd-grid-reverse-engineering — 网格 + 反向工程。关键触发：不知道每幕在哪断、幕末没钩子、开头/结尾/3-4处最坏情况、一个叙事动力步、这些 beat 在哪些幕、以什么顺序排布。"
tags: ["single-episode-structure", "act-structure", "reverse-engineering"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-grid-reverse-engineering\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- Grid 是作者自创的分幕表工具（四/五/六幕 × 每幕若干 beat），目的是"在最早期一图看清整集"。
- 核心是**反向工程 (reverse-engineering)**：先占位几个关键 beat（开头、结尾、Act3 末 worst case、
  Act1/2 幕断），再从这些"已知节点"往回推前面的 beat，而不是从头顺着写。
- 结构服务于故事，不是外来的系统；空白页令人怯步，grid 只是起点地图。
  2–3 个"段"，每段末放一个悬念钩子。
- 与 tent-poles 配合：tent-poles 定三锚点，grid 是把锚点之间填成完整节拍地图。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: NYPD Blue "Simone Says" 的逐幕 grid 范本
- **问题**: 作者要让学生"看见"一小时剧的结构，而非只堆情节。
- **方法论的使用**: 在 grid 上逐幕标出 A/B/C 线落在哪个方框（teaser 写 A+C，Act1 写 B/B/C…），
  并指出 Act1 结尾本应是 cliffhanger，本集靠"Bobby Simone 到来"的好奇心撑住而非强悬念——
  示范了如何用 grid 诊断"幕断是否够钩人"。
- **结论**: grid 让"三线是否在每幕交错推进、幕末有无钩子"一目了然。
- **结果**: 成为全书结构教学标本（case-001），证明 grid 是反向工程的可视化底盘。

### 案例 2: Smallville 把过长 Act One 拆半（务实改结构）
- **问题**: Smallville 原四幕结构里 Act One 过长，节奏拖。
- **方法论的使用**: EP Kelly Souders 把 Act One 拆成"teaser + 两个小幕"，前提是 Act One 结尾
  有一个**动作 beat** 可作断点——这正是 grid 反向工程"先找强节拍再断幕"的实战。
- **结论**: 不必死守四幕，关键是在强节拍处断幕并制造悬念。
- **结果**: 示范"结构因剧、因节拍而变"（case-004）。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 用户写完一集大纲但觉得"不知道每幕在哪断、幕末没钩子"，想用一张表把整集节拍摊开看。
3. 用户拿到一段已有剧本，想"反向"拆解别人是怎么分幕、每幕结尾埋了什么悬念。

### 语言信号 (用户的话里出现这些就应激活)

- "分幕结构 / 一集怎么分段 / 每幕结尾钩子 / 反向工程大纲 / 结构表"
- "reverse-engineer this outline / grid for the episode / act break / cliffhanger map"

### 与相邻 skill 的区分

- 与 `tvd-tent-poles-worst-case` 的区别: tent-poles 只定"开头/结尾/3-4处最坏情况"三个(或五个)锚点；
  grid 是把锚点之间**填满成完整节拍地图**并标注每幕归属。先有 tent-poles 锚点，再做 grid 最顺。
- 与 `tvd-dramatic-beat` 的区别: beat 是"一个叙事动力步"，grid 是"这些 beat 在哪些幕、以什么顺序排布"。
- 与 `tvd-a-b-c-stories` 的区别: A-B-C 管"几条并行线"，grid 管"这些线在幕次上的分布时间轴"。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **先占位关键锚点（开头 / 结尾 / 3-4 处最坏情况 / 各幕断）**

2. **从幕末锚点往回推前面的 beat，逐幕填满**
   - 完成标准: 每个幕格内列出 2–6 个 beat（含 protagonist/goal/opposition），且每个幕末确实是一个
     cliffhanger 或 raised stakes，而非平淡收尾。

3. **通读 grid 校验节奏，标注缺失/过载**
   - 完成标准: 能指出"哪一段 beat 过密(故事过载)"或"哪一段无推进(meandering)"，并给出断幕调整建议。
     重新锚定，再回头精简。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户只问"这一集开头钩子、结尾、3/4 处危机三个点怎么定"——那是 tent-poles 的纯锚定任务，不必铺整张 grid。
- 用户问的是"整季 如何排布"——那是 tvd-season-arc-planning，grid 只服务单集。

### 作者在书中警告的失败模式

- **ce08 故事过载 (too much story)**: "you might have fooled yourself in the outline by counting
  sequences of scenes as one beat." 在 grid 里把"一串场景"乐观算成"一个 beat"，导致实际远超单集容量，
  后期必须删整条弧。grid 反向工程时须逐 beat 核实容量。
- **ce06 场景兜圈子 (meandering beat)**: grid 通读时应剔除"开场1/3与本节冲突无关"的闲笔。

### 作者的盲点 / 时代局限

  重新定义为"内容段落 + 算法留存钩子"，不能照搬四五幕数字（见平台无关性忠告）。
  导致每集同质（公式化，见 ce13）。

### 容易混淆的邻近方法论

- 与 `tvd-tent-poles-worst-case` 极易混（新手常把"分幕"与"锚点"当一个东西）；记住 grid=填满的地图，
  tent-poles=地图的三个地标。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 反向工程出的结构须对照 bible 规则保持一致。
  - `tvd-dramatic-beat` — grid 每个幕格填的是 beat，先有合格 beat 才能反向工程。
- contrasts-with:
  - `tvd-tent-poles-worst-case` — tent-poles 只定几个地标锚点，grid 是把地标之间填满成地图，层级不同易混。
- composes-with:
  - `tvd-a-b-c-stories` — 在 grid 上标注 A/B/C 线分布（组合使用）。
  - `tvd-outline-color-cards` — grid 反向工程后落到 outline 路线图。
  - `tvd-pilot-design` — pilot 四步法中 world/springboards 需用 grid 排结构。

---
