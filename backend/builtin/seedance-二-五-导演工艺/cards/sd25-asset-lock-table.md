---
name: sd25-asset-lock-table
description: 当用户带多个参考素材（图/视频/音频）做 Seedance 2.5 视频，或"素材用了但没按预期生效/互相污染"，或多人多物同框要分配参考时调用。核心能力：素材锁表（label|role|active time|preserve|do not inherit）+ 标签规范化 + 每人只绑一个身份源。关键触发：素材映射、参考图分配、asset lock、多人锁定、素材污染、@Image N。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: Direction workflow Step 2-3
tags: [素材锁表, 参考分配, 身份绑定, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "每个素材先锁角色再进提示词：没锁表的素材就是没分配工地的工人"
skill_type: "template"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-asset-lock-table
evidence: E4

---

# 素材锁表与身份绑定

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director workflow Step 2-3）：**素材清单纪律**：只用用户实际提供或明确编号的素材；标签规范化为 `@Image N` / `@Video N` / `@Audio N`，不改顺序。**素材锁表**：为每个素材记录 `label | role（角色）| active time（生效时段）| preserve（保留什么）| do not inherit（不继承什么）`——有素材时锁表不可省略。**每人只绑一个身份源**：服装、脸、身体比例、角色身份各管各的，不与他人串。**重复引用要有理由**：只在要紧处引用，并说清借什么不借什么——单写「参考 @Video 1」是不够的。**示例继承锁定**：用户给示例时列出迁移维度（层级/细节度/时序/故事/运镜/表演/风格/素材范围）；「参考结构」默认只迁移层级与粒度。

## I — 方法论骨架 (Interpretation):

1. **锁表是施工图**：每个素材的角色/时段/保留/禁继承四列写清，模型才知道每张图站哪班岗。
2. **标签规范化**：@Image N 顺序即用户上传顺序——不重排不重命名。
3. **身份源唯一**：一人一源，多源=身份混合。
4. **借还要说清**：参考不是万能膏药，借什么不借什么必须点名。
5. **示例继承有默认**：参考结构≠参考一切——默认只继承层级与粒度。

## A1 — 应用案例 (Past Application)

- 来源实践：@Image 1（角色）@Image 2（场景）@Video 1（运镜）→ 锁表定角色/场景/运镜三岗，提示词按表分配，素材零互相污染。
- 反例：@Image 1 既是角色又当场景又借运镜——三重身份串味，成品四不像。

## A2 — 触发场景 (Future Trigger)

- 多素材输入的视频任务。
- 素材「没按预期生效」的排查（先查锁表）。
- 影策 Agent 组装多参考任务时的映射表生成。

## E — 可执行步骤 (Execution)

1. **建清单**：只用实际提供的素材，标签规范化。
   *完成标准*：清单与用户上传一一对应。
2. **建锁表**：每素材四列（role/time/preserve/don't inherit）。
   *完成标准*：锁表覆盖全部素材。
3. **身份唯一**：每人只绑一个身份源。
   *完成标准*：身份-素材一一对应。
4. **借还声明**：每处引用写清借什么不借什么。
   *完成标准*：引用句含借还声明。
5. **示例继承核**：示例迁移维度列明（默认仅层级粒度）。
   *完成标准*：继承维度成表。
