---
name: tvd-episode-quality-checklist
description: "当需要人工写完整集，交稿前用清单自查防翻车。；评审他人/批量产出的集，统一用清单过滤低质集。时调用。核心能力：单集质量质检清单。关键触发：这集过一遍质检 / 质量清单、观众会希望赢吗 / rooting interest、先锚定三柱再填肉、写完后逐条验收。不适用于：规划整季弧 → 用 `tvd-season-arc-planning`。"
tags: ["quality-check", "sonnys-list", "rooting-interest"]
metadata:
  source_book: "《Writing the TV Drama Series, 3rd Edition》 Pamela Douglas"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\06-分集大纲与叙事脉络（系列化）\\Writing the TV Drama Series 3rd Edition\\tvd-episode-quality-checklist\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

- 单集 QA 两件套：(A) 拆故事双测试——① Credibility：真实常人在此情境会这么做吗？是否硬拗剧情。② Rooting Interest：观众是否关心主角成败、赌注是否高到让人站队。
- (B) Sonny's List 四准则——① 每个 beat 都是 action（"意识到"不是戏）② 反派同强且 motivated ③ 瞄准主角须做艰难道德抉择的 turning point ④ worst case 锚定在 3/4 处。
- 这是单集质量底线，可作 AI 每集生成后的自动核查项：计谋是否可信、观众是否真希望主角赢、结构锚点是否守住。

---

## A1 — 书中的应用 (Past Application)

### 案例 1: David Simon — 真实感是质检根基（case-015）
- **问题**：广告模式迫使叙事降智、依赖 melodrama，角色沦为工具。
- **方法论的使用**：Simon 主张"角色是工具，必须保持锋利"——对照双测试的 Credibility / Rooting Interest，真实角色才有站队价值。
- **结论**：质检的本质是守住"真实感"，而非堆奇观。
- **结果**：成为全书"为何系列剧需要真实角色与真实世界经验"的方法论支点，也是本清单的灵魂。

### 案例 2: Sonny's List 作为行业口诀（Chapter 4 专节）
- **问题**：单集结构常失之于"软"（无 action、反派弱、无抉择点、无最坏情况）。
- **方法论的使用**：作者以导师 Sonny 之名命名四准则，作可背诵的单集底线，与双测试并用。
- **结论**：清单把"好单集"翻译成可逐条验收的硬指标。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

2. 人工写完整集，交稿前用清单自查防翻车。
3. 评审他人/批量产出的集，统一用清单过滤低质集。

### 语言信号 (用户的话里出现这些就应激活)

- "这集过一遍质检 / 质量清单"
- "观众会希望赢吗 / rooting interest"
- "Sonny's List / 每个 beat 是不是 action / credibility 检查"

### 与相邻 skill 的区分

- 与 `tvd-tent-poles-worst-case` 的区别：tent-poles 是"先锚定三柱再填肉"的结构设计法（**事前**），本清单是"写完后逐条验收"的 QA（**事后**）；worst case 在两者都出现但角色不同（设计 vs 验收）。最易混。
- 与 `tvd-dramatic-beat` 的区别：beat 定义"一个戏剧步"，本清单用 beat 作为验收单元之一（"每 beat 是 action"即来自此）。
- 与 `tvd-season-arc-planning` 的区别：弧规划看纵向（整季），质检看单集横向（成立与否）。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后, agent 应按以下步骤执行:

1. **跑拆故事双测试**
   - 完成标准：逐场问 Credibility（真实人会这样？）与 Rooting Interest（赌注够高让人站队？），每场有双测试判定，不过项列出具体修改。

2. **跑 Sonny's List 四准则**
   - 完成标准：① beat 皆 action？② 反派同强 motivated？③ 有道德抉择 turning point？④ worst case 在 3/4？四条全过或不过项有明确修复方案。

3. **输出质检报告**
   - 完成标准：给出通过/打回 + 优先修复项（先修 credibility/rooting，再修结构），最低优先级修措辞。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 规划整季弧 → 用 `tvd-season-arc-planning`
- 建世界观 bible → 用 `tvd-season-bible`
- 仅设计 pilot 开篇 → 用 `tvd-pilot-design`
- 单集还没写出来 → 先写，再质检

### 作者在书中警告的失败模式

- ce04 角色过火/失控：质检应拦下卡通化、人格跳变（"你 over the top，那角色 running wild，stop him!"）。
- ce14 用 gimmick 替代真实转折：质检的 credibility/rooting 应识别"靠奇观而非人物逻辑"的假惊喜（"surprise by a turn true to these people, not by a gimmick"）。

### 作者的盲点 / 时代局限

- 作者所有 QA 假设"人写、人审"；AI 批量产集时，本清单恰应被做成自动校验 prompt，但作者未及此，需主动转为机器可执行的质检脚本。

### 容易混淆的邻近方法论

- `tvd-episode-quality-checklist` 与 `tvd-tent-poles-worst-case`：最易混。记忆点——tent-poles 是"盖房子前钉柱子（事前设计）"，质检是"盖完验房（事后验收）"；worst case 同时出现但用途不同。

---

## 相关 skills (阶段 3 填充)

- depends-on:
  - `tvd-season-bible` — 质检需对照 bible 的角色/世界设定。
  - `tvd-dramatic-beat` — 质检以"每个 beat 是否 action"为验收单元，beat 是前提。
- contrasts-with:
  - `tvd-tent-poles-worst-case` — tent-poles 事前锚定，质检事后验收，worst case 角色不同。
- composes-with:
  - `tvd-outline-color-cards` — 写完后对 outline 跑质检。
  - `tvd-grid-reverse-engineering` — 验收每幕末 cliffhanger 是否到位。

---
