---
name: character-ip-master
description: "当需要要设计一个能跨图/跨视频反复出现的角色 IP，但不知从哪几层下手。；已有现成 Skill（别人的/开源的），想改造成\"自时调用。核心能力：跨媒介角色 IP 表现总控。关键触发：角色 IP 怎么设计 / 怎么保持一致 / 角色一致性、IP 配图 / 怎么把现成 Skill 改成自己的、角色演得假 / 不统一 / 每次长得不一样、视频+配图。不适用于：纯一次性出图/出片，根本不关心角色能否跨场景连续出现。、纯信息图（流程/分层结构。"
tags: ["角色IP", "跨媒介", "总控框架", "身份层", "表演层", "工作流", "一致性"]
metadata:
  source_book: "《【IP 配图 Skill 必看】全网独一份的架构详解》艾笑 teacherAi + 《我把自己的IP配图技能开源了》小互（合并整理）"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\13-AI角色表演与资产\\ip-character-system\\character-ip-master\\SKILL.md"
evidence: E4

---
## I — 方法论骨架 (Interpretation)

本 skill 是"跨媒介角色 IP 表现"的总控入口，先把混乱的"IP/角色/配图"概念统一成一份**三层输入合同**：

1. **内容层**（标题 + 摘要 + 要点）：这段内容该画/演成什么关系？这是普通配图与 IP 配图共用的主干，IP 不是替代它而是叠加。
2. **身份层**（外貌 + 人格 + 连续性锚点）：进入画面的人到底是谁？对应 `ip-character-bible`（角色圣经）。
3. **表演层**（动作 + 表情 + 视线 + 人物尺度）：她为什么出现、在做什么、用什么态度完成？对应 `ip-action-library` + `ip-performance-faces`（配图侧）/ `emotion-action-beats`+`facial-part-spec`+`head-body-movement`（视频侧）。

再加一层 **媒介层**（视频 vs 配图）：同一个"身份+表演"落到不同媒介，只换渲染差异——配图=画风/画幅，视频=镜头/载体。

三条跨媒介设计律（小互 IP 三定律）：A. 弱人设/反差 > 强造型；B. 角色是"情绪代名词"；C. 特色在姿态态度不在静态奇观。验收准绳（艾笑"删人测试"）：把人物删掉画面核心意思仍完整 → 角色只是装饰，表演失败。

---

## A1 — 书中的应用 (Past Application)

### 案例 1：从普通配图升级到 IP 配图（八步法）
- **问题**：很多人的"IP 配图"只是把现成 Skill 里的固定人物贴上去，大家做出来的东西都差不多。
- **方法论的使用**：按八步逐步——①保留普通配图流程 ②建角色圣经 ③整理参考素材标证据边界 ④身份与画风解耦 ⑤建动作库 ⑥加表情视线系统 ⑦建连续画面 QA（含回归测试）⑧明确文字交付模式并保存参数。
- **结论**：IP 比简单换脸复杂，是多出"身份系统+表演系统"两套长期管理。
- **结果**：读者记住的是角色与表达方式，而非某种流行画风。

### 案例 2：小互 31 角色库的"情绪代名词"设计
- **问题**：开源 Skill 里站着的是小互本人，别人用别人的号发很别扭。
- **方法论的使用**：先做一套统一画风的 31 个原创角色，让用户按内容类型挑（AI 焦虑→替替、打工人→牛马）；用 IP 三定律 B 让角色成为"情绪代名词"。
- **结论**：角色要先解决"他是谁、代表什么情绪"，再谈画风。
- **结果**：没有自己形象的人也能立刻用，将来换自己的只需一句话。

---

## A2 — 触发场景 (Future Trigger) ★

### 用户会在什么情境下需要这个 skill?

1. 要设计一个能跨图/跨视频反复出现的角色 IP，但不知从哪几层下手。
2. 已有现成 Skill（别人的/开源的），想改造成"自己的"定制化工作流，而非停留在默认设置。
3. 角色一致性出问题（飘了/每次不一样），想系统性重建身份与表演管理。

### 语言信号（用户的话里出现这些就应激活）

- "角色 IP 怎么设计 / 怎么保持一致 / 角色一致性"
- "IP 配图 / 怎么把现成 Skill 改成自己的"
- "角色演得假 / 不统一 / 每次长得不一样"
- "character IP / role consistency / customize a skill / IP illustration"

### 与相邻 skill 的区分

- 与 `ai-acting-master` 的区别：master 是**视频/数字人侧**的总控（十项公式）；本 skill 是**跨媒介**总控，管"视频+配图"的统一语言与编排，视频侧细节仍交给 ai-acting-master。
- 与 `ip-illustration-master` 的区别：ip-illustration-master 管**配图这一媒介**的总控（五步+八步+交付）；本 skill 管跨媒介编排，不直接写配图提示词。

---

## E — 可执行步骤 (Execution)

当 skill 被激活后，agent 应按以下步骤执行：

1. **判定媒介与起点**
   - 完成标准：确认用户要的是视频/数字人还是配图，还是两者都要；若只要某一媒介，直接跳到对应侧总控（ai-acting-master / ip-illustration-master）。

2. **建内容层（共用主干）**
   - 完成标准：先按"认知锚点→关系结构"理清这段内容该表达什么关系，IP 不替代内容。

3. **建身份层（角色圣经）**
   - 完成标准：调用 `ip-character-bible` 写清视觉锚点/人格/参考素材边界/失败标准；视频侧同理落实一致性。

4. **建表演层（动作+表情+视线+尺度）**
   - 完成标准：按内容语义调用 `ip-action-library`（动作语义映射）+ `ip-performance-faces`（表情/视线/人物尺度）；视频侧转 `emotion-action-beats`/`facial-part-spec`/`head-body-movement`。

5. **定渲染层（媒介差异）**
   - 完成标准：配图侧调用 `ip-style-decoupling`（画风解耦）；视频侧落实镜头/载体。

6. **编排子 skill 并给"删人测试"自检**
   - 完成标准：确认角色承担了画面关键关系（删人后意思不完整），而非装饰立牌。

---

## B — 边界 (Boundary) ★

### 不要在以下情况使用此 skill

- 纯一次性出图/出片，根本不关心角色能否跨场景连续出现。
- 纯信息图（流程/分层结构），强加 IP 反而干扰信息传达（艾笑：普通配图仍有价值）。
- 与角色塑造无关的纯画面/光效/运镜请求。

### 作者在书中警告的失败模式

- **换脸误区**：以为"普通配图+固定人物=IP 配图"，人物贴角落只成 logo/装饰，读者记不住她做了什么。
- **只换画风**：同样内容结构换拼贴/毛毡，人物动作信息关系没变，仍同质化——定制=改工作流不是换模板。

### 作者的盲点 / 时代局限

- 假设模型能稳定遵从身份/表演指令，未区分不同生图/视频模型的遵从力差异（与 ai-acting-master 系已标注的盲点同源）。
- "角色漂移"检测靠失败标准+人工 QA，未工程化自动回归（艾笑提了回归用例思路但未落地）。

### 容易混淆的邻近方法论

- 与"电影感运镜/纯画风切换"类混淆：本 skill 的渲染层只服务于"让同一角色稳定且有戏"，不是炫技。

---

## 相关 skills

- depends-on: （无；本 skill 为跨媒介总控入口）
- contrasts-with: （无；与子 skill 是编排关系而非对立）
- composes-with: ai-acting-master（视频侧总控）, ip-illustration-master（配图侧总控）, ip-character-bible（身份层）, ip-action-library（表演层·动作）, ip-style-decoupling（渲染层·画风）, ip-performance-faces（表演层·表情）

---
