---
name: tvd-platform-agnostic-pendulum
description: "当需要团队争论\"AI 生成会不会让电视写作手册过时\"，需要用钟摆中心论证保留方法论内核、剥离制度外壳。时调用。核心能力：钟摆中心 / 平台无关性。关键触发：AI 生成会不会让电视写作手册过时、AI 写剧 / 生成剧本 会不会过时、平台无关 / 钟摆中心 / 原理不变 / craft endures。不适用于：需要单集质检 → 用 tvd-episode-quality-checklist。"
tags: ["platform-agnostic", "craft", "pendulum"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-platform-agnostic-pendulum\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- 方法三步：① 锚定不变原理（角色连续性、季弧规划、结构 grid、springboards 引擎）；② 剥离随平台变迁的好莱坞外壳（22 集季制度、LA 地缘、agent 门槛、广播网 act break 节奏）；③ 警惕把某一时期的具体规则当永恒（作者自警"任何预测都会错"）。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: David Simon 访谈 — 广告模式扼杀叙事（case-015）
- **问题**：传统广告台迫使叙事"降智、依赖 melodrama"，80% 电视只为维持 franchise 而存在。
- **方法论的使用**：Simon 指出"角色是工具，必须保持锋利"，HBO 订阅经济让他能"成年"——外壳（商业模式）在变，内核（真实角色与长叙事）不变。
- **结论**：变的只是载体与制度，craft 是跨平台常量。
- **结果**：成为全书"为何系列剧需要作者声音与真实世界经验"的最强论证。

### 案例 2: Quarterlife / The Closer 等新形态旁证（case-032）
- **问题**：系列剧定义随平台扩张（网络剧、短季、跨屏）。
- **方法论的使用**：作者把这些当作"系列化写作边界正在扩展"的旁证，呼应钟摆中心判断。
- **结论**：形态演变不改变核心 craft。
- **结果**：补全"系列化写作在流媒体前夜的边界扩张"图景。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 团队争论"AI 生成会不会让电视写作手册过时"，需要用钟摆中心论证保留方法论内核、剥离制度外壳。

### 语言信号 (用户的话里出现这些就应激活)

- "AI 写剧 / 生成剧本 会不会过时"
- "平台无关 / 钟摆中心 / 原理不变 / craft endures"

### 与相邻 skill 的区分

- 与 `tvd-season-bible` 的区别：pendulum 是元判断（哪些该留），bible 是留下后的具体文档（如何写）。
- 与 `tvd-tent-poles-worst-case` / `tvd-grid-reverse-engineering` 的区别：那些是具体结构工具（外壳层方法），pendulum 帮判断它们是否适用于新平台、哪些需改造。
- 与 `tvd-episode-quality-checklist` 的区别：质检是具体清单，pendulum 是适用范围的元原则。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **列出方法的"内核(可迁移)"与"外壳(随平台变)"两栏**
   - 完成标准：每项方法被归类；内核 = 角色连续性 / 季弧 / 结构逻辑 / springboards，外壳 = 广播网节奏 / 22 集季 / LA 地缘 / agent 门槛。

2. **对目标平台校验外壳是否真需要**
   - 完成标准：广播网 act break、22 集季、地缘门槛等可弃；保留的内核能在该平台落地，无被误删的可迁移原理。
   - 判停条件：若用户只问单集结构步骤，转 `tvd-grid-reverse-engineering` / `tvd-tent-poles-worst-case`。

3. **写一条"本剧不可妥协的原理清单"作为 AI 产集常驻约束**
   - 完成标准：清单被团队/AI 采纳为硬约束，至少含"角色连续性 + 季弧 + 结构张力 + springboards 引擎"。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 需要具体单集结构步骤 → 用 `tvd-grid-reverse-engineering` / `tvd-tent-poles-worst-case`
- 需要单集质检 → 用 `tvd-episode-quality-checklist`
- 仅做单集大纲 → 用 `tvd-outline-color-cards`

### 作者在书中警告的失败模式

- ce24 对未来做确定性预言：把 2011 好莱坞外壳当永恒规律外推，忽略平台已变；"任何预测都会错"是作者自警，本书衍生最易踩此坑。

### 作者的盲点 / 时代局限

- "The Web is Dead"误判，低估网络原生与 UGC 成为主战场。

### 容易混淆的邻近方法论

- `tvd-platform-agnostic-pendulum` 与 `tvd-season-bible`：最易混。记忆点——pendulum 回答"什么该留"（元原则），bible 回答"留下后怎么写成文档"（落地）。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 钟摆中心（角色/长叙事）正是 bible 要固化的不变内核。
- contrasts-with:
  - （无）
- composes-with:
  - `tvd-episodic-characterization` — 可信角色是钟摆中心（跨平台不变内核）。
  - `tvd-long-narrative-types` — 长叙事是钟摆中心内核之一。

---
