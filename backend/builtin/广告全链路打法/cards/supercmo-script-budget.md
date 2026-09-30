---
name: supercmo-script-budget
description: 当用户要写口播稿/视频台词，或写完的稿子"念不完/太赶/时间对不上"，或要按视频时长配字数时调用。核心能力：口播预算律（每秒 2-3 词，上限 3 词/秒；15 秒=30-40 词，46 词即失败）+ 先算预算再动笔。关键触发：口播稿、字数配时长、念不完、语速、word budget、script timing、台词太长。
source_book: "superCMO writing-video-scripts（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 2
tags: [口播预算, 语速, 字数配时长, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "字数不是风格选择是物理约束：先算预算再动笔，永远不加速念、不拉长凑"
skill_type: "framework"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-script-budget
evidence: E4

---

# 口播预算律

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO writing-video-scripts）：口播有固定语速，**字数不是风格选择**——目标每秒 **2-3 词**（15 秒片段约 30-40 词）；**上限 3 词/秒**（15 秒超 46 词即失败，这是机检线）。目标与上限之间的差是故意的：那是停顿、呼吸和画面carry 时刻的空间——顶格写的段落没有留呼吸。**流程纪律**：动笔前先把每片段预算加总核对总时长；某段超预算就删词——**永远不加速念，永远不拉长片段凑字数**。开写前先收集已定条件：文案要传达什么/总时长/几镜每镜几秒/哪些节拍落在哪镜/出镜口播还是旁白/可做什么声明（缺项要问，不假设）。

## I — 方法论骨架 (Interpretation)

1. **预算先于写作**：先把每秒词数×秒数的配额算好，再往格子里填词。
2. **2-3 词/秒是呼吸区间**：留白给停顿与画面，顶格=无呼吸。
3. **超预算删词不改速**：语速是人的物理限制，不是可调参数。
4. **机检线明确**：3 词/秒是硬上限，超线即返工。
5. **中文换算参考**：中文语速约 3.5-4.5 字/秒（配 factory-episode-specs），口播稿按目标平台语种换算。

## A1 — 应用案例 (Past Application)

- 来源实践：15 秒口播写 52 词 → 机检失败 → 删至 38 词留呼吸，成片节奏正常。
- 反例：顶格 45 词/15 秒——念到脸红，观众跟着憋气。

## A2 — 触发场景 (Future Trigger)

- 任何口播稿/旁白稿写作前。
- 「稿子和视频长度对不上」的修复。
- 影策 Agent 生成口播稿后的时长校验。

## E — 可执行步骤 (Execution)

1. **算预算**：每秒 2-3 词×片段秒数=每镜配额，加总对总时长。
   *完成标准*：预算表与总时长一致。
2. **定额写作**：每镜稿在配额内。
   *完成标准*：逐镜不超 3 词/秒。
3. **呼吸检查**：目标区 2-3 词/秒，非顶格。
   *完成标准*：无顶格片段。
4. **超限处置**：删词，不加速不拉长。
   *完成标准*：删词记录在案。
5. **机检终验**：逐镜过 3 词/秒硬线。
   *完成标准*：零超线。
