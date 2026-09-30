---
name: tvd-world-extension-canon
description: "当需要AI 批量产出的番外与正片设定打架（某角色背景矛盾），需要用 canon 规则约束延展。；正片时长有限，某些 mytho时调用。核心能力：故事世界延展。关键触发：正片放不下的背景故事想另做、canon / extended universe / 母舰之外 / 延展世界观。不适用于：仅做正片单集 → 用其它结构/质检 skill、没有建 bible/canon。"
tags: ["canon", "webisodes", "world-extension"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-world-extension-canon\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- 故事世界延展 = 用网络集/番外承载放不进正片的神话/背景故事，作为系列"正典(canon)"的补充，而非平行宇宙(alt universe)。
- 三条原则：① 它是 canon 的**补充容器**，不是 alt universe；② "盯紧母舰"——最好的点子永远上正片，其余才进延展；③ 小屏独看，宜用更亲密、日记式叙事。
- 边界：canon = 官方承认、不可矛盾的设定总和；任何延展不得与之冲突，延展产生的新设定若升格为正典须回写 bible。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: Lost — $12M Pilot 与孤岛世界的衍生（case-009）
- **问题**：庞大群像 + 坠机前后双时间线，正片塞不下全部 mythology。
- **方法论的使用**：靠"每集《阴阳魔界》式怪转折"在正片推进，衍生内容承载放不下的背景与神话。
- **结论**：延展是主世界观的安全溢出阀。
- **结果**：成为"世界构建 + 延展"的综合样本，并推动网络台从四幕走向五/六幕。

### 案例 2: Reality 伪圣经 — Scott Stone 揭示"无剧本"也有规划（case-025）
- **问题**：真人秀被误认为"无写作"，实际需整季 treatment、分集 rundown、六幕 act break。
- **方法论的使用**：制作人用概念大纲与"伪圣经"规划整季结构与角色弧，延展内容同样纳入规划。
- **结论**：结构法则在脚本与非脚本之间、正片与延展之间并无本质差别。
- **结果**：证明"延展世界"的规划是普遍需要，不限于传统剧集。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. AI 批量产出的番外与正片设定打架（某角色背景矛盾），需要用 canon 规则约束延展。
3. 正片时长有限，某些 mythology（家族秘史、邻里恩怨）想另开容器承载。

### 语言信号 (用户的话里出现这些就应激活)

- "正片放不下的背景故事想另做"
- "canon / extended universe / 母舰之外 / 延展世界观"

### 与相邻 skill 的区分

- 与 `tvd-season-bible` 的区别：bible 是 canon 的权威母本，world-extension 是在 canon 外沿做延展——先有 bible 才有可靠的延展；延展产生的新设定还要回写 bible。
- 与 `tvd-platform-agnostic-pendulum` 的区别：pendulum 讲跨平台原理不变（元判断），world-extension 讲具体如何用番外延展世界（落地动作）。
- 与 `tvd-episode-quality-checklist` 的区别：质检针对单集成立与否，延展针对番外的 canon 一致性。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **核对母剧 bible 的 canon 清单，列出延展边界**
   - 完成标准：延展点都能映射到 canon，标注"可延展 / 不可矛盾"项，无冲突项放行。

2. **选定延展容器并用亲密叙事，确保最好的点子留给正片**

3. **把延展产生的任何新设定回写 bible 的 canon 区（若升格为正典）**
   - 完成标准：bible 与延展同步，长期不矛盾；AI 后续产集可对照同一 canon。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 仅做正片单集 → 用其它结构/质检 skill
- 没有建 bible/canon 就想延展 → 先建 `tvd-season-bible`
- 需要判断"哪些方法跨平台可迁移" → 用 `tvd-platform-agnostic-pendulum`

### 作者在书中警告的失败模式

- ce12 重复/虚无：挖坑不填或平行宇宙式矛盾，破坏 canon（"投资了却走向虚无"）；Alias 式牵强逆转即反例。
- ce24 预言式断言（间接）：延展形态随平台变，把某一时期形态当永恒会失真。

### 作者的盲点 / 时代局限

- "The Web is Dead"判断失误，忽略网络原生延展的长期生命力。

### 容易混淆的邻近方法论

- `tvd-world-extension-canon` 与 `tvd-season-bible`：最易混。记忆点——bible 定义"什么算 canon"，world-extension 在 canon 外沿"安全地多讲一点"。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 先有 bible 的 canon 母本，延展才能不矛盾（延展新设定还需回写 bible）。
- contrasts-with:
  - （无）
- composes-with:
  - `tvd-platform-agnostic-pendulum` — 延展形态随平台变，但 canon 一致性内核不变。

---
