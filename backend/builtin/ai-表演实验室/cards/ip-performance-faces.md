---
name: ip-performance-faces
description: "当需要要给配图角色定\"用什么态度/看哪/占多大\"，与动作配合。；同一动作想换表情/视线却不重画整套。时调用。核心能力：IP 表演变量：表情/视线/人物尺度。关键触发：用什么态度/看哪/占多大、配图表情怎么写 / 视线看哪 / 人物占多大、表演变量 / 表情态度 / 怀疑审视配什么表情、用什么态度/看哪/占多大。不适用于：建角色身份系统（走 ip-character-bible）。、设计动作语义（走。"
tags: ["表演层", "表情", "视线", "人物尺度", "可组合变量", "人格锚点"]
metadata:
  source_book: "《【IP 配图 Skill 必看】全网独一份的架构详解》艾笑 teacherAi（合并整理）"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\13-AI角色表演与资产\\ip-character-system\\ip-performance-faces\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

本 skill 管"表演层·表情"——把配图角色的表演拆成可组合变量，与 `ip-action-library`（动作）配合，保留二次加工空间：

- **表情（态度）**：怀疑审视/专注/惊讶/警觉/确认放松——由人格锚点约束幅度（冷静拆解者幅度小，兴奋展示者幅度大）。
- **视线（注意力）**：看向哪（如看向决策转盘），交代角色注意力落在哪，是表演的方向标。
- **头部/身体姿态**：轻微倾斜等，决定情绪方向、人物与物件关系。
- **人物尺度**：主角/共同主角/中景/局部特写——决定角色占画面多大、读者关注层级。

**组合配方示例**：动作=检查决策转盘、表情=怀疑审视（中等强度）、视线=看向转盘、头部=轻微倾斜、画风=可替换不影响以上表演。证明同一表演可放进线稿/毛毡/编辑卡通，且可从全身切手部特写。

**关键原则**：这些变量不要写死在一张参考图里，而要作为可组合字段进入生成合同——换表情不换动作，换尺度不换表情。

---

## A1 — 书中的应用 (Past Application)

### 案例 1：怀疑检查的可组合表演
- **问题**：同一"检查"动作，每次出图表情/视线都不同，难以复用。
- **方法论的使用**：写表演合同——动作=检查转盘、表情=怀疑审视（中强）、视线=看向转盘、头部=微倾；画风可替换。
- **结论**：表演成可组合变量，二次加工空间被保留。
- **结果**：同表演跨线稿/毛毡/编辑卡通一致。

### 案例 2：尺度切换（全身→手部特写）
- **问题**：想强调某动作细节却被固定全身构图限制。
- **方法论的使用**：将人物尺度作为独立变量，同一 IP 可从全身动作切到手部特写。
- **结论**：尺度是表演的一部分，不只构图。
- **结果**：局部特写强化关键关系。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 要给配图角色定"用什么态度/看哪/占多大"，与动作配合。
2. 同一动作想换表情/视线却不重画整套。
3. 要从全身切到特写强调细节。

### 语言信号（用户的话里出现这些就应激活）

- "配图表情怎么写 / 视线看哪 / 人物占多大"
- "表演变量 / 表情态度 / 怀疑审视配什么表情"
- "facial expression in illustration / gaze direction / character scale"

### 与相邻 skill 的区分

- 与 `ip-action-library` 的区别：本 skill 管"用什么态度/看哪/占多大"（表情/视线/尺度），ip-action-library 管"在做什么"（动作语义）。
- 与 `facial-part-spec`/`head-body-movement`（视频侧）的区别：那两个管视频里"面部部位拆解/头身承接的时间线表演"；本 skill 管配图里静态但可组合的表情/视线/尺度变量，媒介不同。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后，agent 应按以下步骤执行：

1. **定表情（态度）**
   - 完成标准：按人格锚点选态度（怀疑/专注/惊讶/放松）与幅度，不写死。

2. **定视线（注意力）**
   - 完成标准：明确看向哪（具体物件/方向），交代注意力落点。

3. **定头部/尺度**
   - 完成标准：头部微倾等姿态 + 主角/中景/特写层级，与动作形成构图关系。

4. **组合并标注可替换**
   - 完成标准：与 ip-action-library 的动作组合成表演合同，标注"画风/尺度可替换不影响表演"。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 建角色身份系统（走 ip-character-bible）。
- 设计动作语义（走 ip-action-library）。
- 视频里带秒数的面部时间线（走 facial-part-spec / head-body-movement）。

### 作者在书中警告的失败模式

- **表演写死在参考图**：把表情/视线/尺度固定在一张图，后面难改——应作可组合变量进入生成合同。

### 作者的盲点 / 时代局限

- 表情幅度与模型遵从力相关，未区分不同生图模型对"微表情"的还原差异。

### 容易混淆的邻近方法论

- 与"纯构图/景别"混淆：本 skill 的尺度是表演变量（交代主角层级），不是单纯构图美化。

---

## 相关 skills

- depends-on: character-ip-master（跨媒介总控，定义表演层契约）, ip-action-library（动作，被其组合）
- contrasts-with: facial-part-spec, head-body-movement（视频侧，媒介不同）
- composes-with: ip-character-bible, ip-style-decoupling, ip-illustration-master

---
