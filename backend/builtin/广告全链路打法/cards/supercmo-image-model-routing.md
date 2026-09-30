---
name: supercmo-image-model-routing
description: 当用户要生成一张通用图（非产品摄影/非产品广告），或不确定该用哪个生图模型，或生图结果文字糊/画风不对/人脸崩时调用。核心能力：按"图要干什么"路由模型（要字→gpt-image-2/要绘→nano-banana-2/要真人→nano-banana-pro/改图→gpt-image-2/保脸改图→seedream-5）+ 五级优先序（用户点名>要字>非摄影>改图>风格 cues）。关键触发：生图、哪个模型、图片生成、文字糊、画风不对、改图、换背景。工位边界：产品摄影转产品摄影技能、带标题优惠的产品广告转图片广告技能；本技能管通用图。影策侧模型以 generate_media 实际清单为准。
source_book: "superCMO generating-images（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-2
tags: [生图路由, 模型选择, 通用图像, 改图, 文字可读, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "按图要干什么选模型，不按图是什么选；用户点名永远优先"
skill_type: "technique"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-image-model-routing
evidence: E4

---

# 通用生图：模型路由五级优先

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO generating-images）：两个决策驱动质量——**选哪个模型（永远）**和**有没有匹配的格式配方（仅已知交付物时）**。路由前先分诊：商业**产品摄影**（包装图/场景图/hero/banner/上身试穿/改造现有产品图）→ 转产品摄影技能；**产品广告**（图上压标题/优惠/CTA、促销前后对比）→ 转图片广告技能；其余留在本技能（通用图/图形海报/肖像/插画/电影静帧/信息图/一次性参考编辑）。**按"图要干什么"路由**（描述是信号不是字面路由器）：要可读文字或元素有 deliberate 位置的设计（海报/广告/banner/缩略图/信息图）→ `gpt-image-2`；绘画/渲染风（卡通/动漫/插画/扁平矢量/3D）→ `nano-banana-2`；可信真人或有刻意摄影的图片帧（创作者肖像/UGC/电影感静帧）→ `nano-banana-pro`；改造 supplied 图（换背景/移除替换元素/重布景）→ `gpt-image-2`；改图但真脸必须保持可认 → `seedream-5`；supplied 图只是风格情绪 cues（要这个味道不是改那张图）→ `nano-banana-2`（脸也要延续则 `seedream-5`）。**多条件命中时的优先序**：①用户点了模型→用它；②要可读文字→`gpt-image-2`（哪怕有人有景）；③非摄影外观→`nano-banana-2`（哪怕有人）；④在改 supplied 图→`gpt-image-2`，脸要可认才换 `seedream-5`；⑤只是风格 cues→`nano-banana-2`/`seedream-5`。都不沾（普通物件场景）→ `nano-banana-2`，或列模型清单按 strengths 挑。**写之前先读所挑模型的 prompt guide**。格式配方表：命中行就按它的段落和示例写，不命中就跳过——模型 guide 已够。

## I — 方法论骨架 (Interpretation)

1. **功能路由先于外观路由**：模型能力按任务分（文字/绘/真人/编辑），不按题材分。
2. **要字是硬信号**：文字可读性直接锁定文本能力强的模型，优先级仅次于用户点名。
3. **分诊防串门**：产品摄影和产品广告各有专门技能，路由错了一切参数都错。
4. **先读指南再动笔**：每个模型的提示词版式不同，跳过这步等于用方言下命令。
5. **默认值兜底**：没有清晰信号时有默认（普通图→绘图模型），不卡死。

## A1 — 应用案例 (Past Application)

- "做张带价格的海报" → 要字硬信号 → gpt-image-2，价格数字清晰；同需求若走绘图模型，价格必糊成乱码。
- "把这张床垫图换个卧室背景" → 改图路由 → gpt-image-2，产品本身不动只换景；若当新图重画，产品细节全丢。

## A2 — 触发场景 (Future Trigger)

- 「生成一张…」（通用图场景）
- 「用哪个模型生图好」
- 「图上的字全是乱的」
- 「把这张图的背景换掉」

## E — 可执行步骤 (Execution)

1. **分诊**：产品摄影/产品广告→转交；通用图→留下。完成标准：路由确认。
2. **选模型**：按五级优先序。完成标准：命中级可陈述。
3. **读指南**：所挑模型的 prompt guide。完成标准：版式规则在手。
4. **（可选）配方**：已知交付物命中配方行才用。完成标准：不瞎套。
5. **写提示词**：按指南版式成文。完成标准：版式合规。

## B — 边界 (Boundary)

- **不接产品摄影/产品广告的单**：分诊转交。
- **不跳过指南直接写**。
- **影策适配边界**：上游模型名（gpt-image-2/nano-banana/seedream）不照搬——以影策 generate_media 实际模型清单映射，缺模型时按"要字/要绘/要真人/改图"的能力维度选最接近的，并向用户说明。
