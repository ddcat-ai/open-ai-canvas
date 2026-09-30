---
name: tvd-a-b-c-stories
description: "当需要用户担心自己加了\"副线\"但每条线散、看不到哪条线在某幕断了，需要颜色卡片式追踪多线分布。；用户纠结\"这一集到底该几条线、时调用。核心能力：tvd-a-b-c-stories — A-B-C 并行故事线。关键触发：这一集到底该几条线、每线多长、一场戏内部有没有戏、一集之内有几条并行线、各占多少 beat、怎么交错、单集三锚点（开头/结尾/3-4处最坏情况）。"
tags: ["single-episode-structure", "multi-storyline", "parallel-tales"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-a-b-c-stories\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- A 故事 = 单集中最有"系列共振"的那条线（往往贴常驻主角的弧光），不一定页数最多。
- B 故事 = 第二重要的线，常与 A 共享冲突场域（如案子里的另一条人物张力）。
- C 故事 = 调剂/喜剧线，或跨集"runner"（贯穿性轻线索），可只占 3–8 个 beat。
- 三条线**独立但同处一个场域**，是并行 tale，不是"主线的附属支线/噱头"。
- 用颜色卡片法：黄/绿/蓝各代表一条线，先把每条线的全部 beat 铺满，再拼装，
  一眼看出某条线是否在某幕"丢失"、某线结尾是否 payoff。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: NYPD Blue "Simone Says" 三案并列范本
- **问题**: 作者要示范一小时剧如何不靠单线取胜，而是靠多线并行驱动。
- **方法论的使用**: 把开篇的 Sipowicz–Simone 权力暗战归为 A 故事（贴常驻角色系列弧光）；
  把命案调查归为 B 故事；把 Lesniak 与前男友的纠缠作为 C 故事（借客座案件承载常驻角色的
  情感线）。在 grid 上逐幕标注 A/B/C，证明三线在 teaser 与每幕交错推进。
- **结论**: 三线"独立但同场域"，C 故事虽短却用常驻角色的个人挣扎给客座案件赋予深层意义。
- **结果**: 成为全书最详尽的结构标本（case-001），证明"系列剧不是小电影，而是靠并行故事驱动"。

### 案例 2: A Year in the Life 的极简弧光式大纲
- **问题**: 主创 Brand/Falsey 给编剧的 outline 只写了角色情感进程，几乎无"情节"。
- **方法论的使用**: 即便在高度 serial 的剧里，A/B/C 仍按"家族父亲求婚被拒 / 孙女无证驾驶 /
  儿媳求职吵架"三条角色线划分，beat 之间的张力来自"人人有话不说"的内在冲突。
- **结论**: A-B-C 不要求每线都有外部动作，C 线甚至可以是两人厨房里"什么都不说"的克制戏。
- **结果**: 印证三线并行是"承载角色弧"的容器，而非必须热闹的支线。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 用户担心自己加了"副线"但每条线散、看不到哪条线在某幕断了，需要颜色卡片式追踪多线分布。
3. 用户纠结"这一集到底该几条线、每线多长"，或把 C 线写成纯搞笑段子、与 A 线毫无勾连。

### 语言信号 (用户的话里出现这些就应激活)

- "这一集只有一条线，感觉太单薄 / 怎么加副线 / 要不要加调剂线"
- "单集结构 / 单元集 / 一集里A故事B故事怎么分 / 多条故事线并行"
- "my episode has only one storyline / how to weave A-B-C stories / color cards for outline"

### 与相邻 skill 的区分

- 与 `tvd-dramatic-beat` 的区别: beat 管"一场戏内部有没有戏"（动机+冲突+对手），本 skill 管
  "一集之内有几条并行线、各占多少 beat、怎么交错"。先有 beat 质量，再谈多线编排。
- 与 `tvd-tent-poles-worst-case` 的区别: tent-poles 管"单集三锚点（开头/结尾/3-4处最坏情况）"，
  本 skill 管"锚点之间填几条并行线、如何分布"。两者是同一集的不同维度，可叠加使用。
- 与 `tvd-season-arc-planning` 的区别: 季弧管跨集/跨季的情感旅程总纲，本 skill 管单集内部多线。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **定义本集的 A / B / C 线并各写一句 log line**
   - 完成标准: 每条线都能用一句话说清"谁的什么欲望被什么反对"，且都贴常驻角色（/家人/邻里）的弧光，而非客座角色驱动。

2. **用颜色卡片铺满每条线的全部 beat，再交错拼装成分幕**
   - 完成标准: 产出一页 grid，黄(A)/绿(B)/蓝(C)三色覆盖 teaser + 各幕；能一眼指出是否有某线在 Act2 "丢失"、C 线是否在结尾 payoff。

3. **核查三线平衡与勾连**
   - 判停条件: 若某条线离开常驻角色、纯靠客座角色推进，则跳回步骤 1 重定该线归属。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 用户只想写单线闭环的程序/单元剧（每集一个独立事件），不需要并行线编排——此时用单一 beat 链即可。
- 用户问的是"整季 的情感总纲/每集服务什么"，那是 tvd-season-arc-planning 的范围。

### 作者在书中警告的失败模式

- **ce07 沉溺 backstory / tangent**: 作者提醒"Have you indulged in backstory or secondary characters
  or tangents? Return to your original outline." 加 B/C 线时最容易贪多、塞入与主线无关的次要角色支线，
  导致单集肿胀、焦点涣散。

### 作者的盲点 / 时代局限

  （甚至 C 线可弱化为"贯穿式笑点 runner"），不可照搬 12–16 beat 的绝对数字。
  "为凑线而凑线"（见平台无关性忠告：剥离好莱坞外壳，保留多线张力内核）。

### 容易混淆的邻近方法论

- 与 `tvd-dramatic-beat`（一场戏质检）和 `tvd-tent-poles-worst-case`（单集锚点）易混；
  记住本 skill 的视角是"集内横向多线"，而非"集内纵向锚点"或"场内纵向动力"。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 三线归属与角色绑定须对照 bible 的角色设定。
  - `tvd-episodic-characterization` — A/B/C 各线须贴常驻角色弧光，由角色驱动而非客座角色。
- contrasts-with:
  - `tvd-dramatic-beat` — beat 管"一场戏有无动力"，A-B-C 管"一集几条并行线"，粒度不同（场 vs 集）。
- composes-with:
  - `tvd-grid-reverse-engineering` — 把 A/B/C 线标注到 grid 的幕次时间轴上。
  - `tvd-outline-color-cards` — 用颜色卡片铺满并在 outline 中管理三线（组合使用）。

---
