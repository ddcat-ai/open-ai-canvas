---
name: freestyle-template-match
description: 当用户要用 GPT-Image2 风格库做图（产品/海报/UI/信息图/品牌/摄影/角色/场景），或"不知道选哪个模板/风格标签混乱"，或要把请求匹配到工业模板时调用。核心能力：四级匹配序（模板类目→视觉风格标签→场景标签→最近案例）+ 请求模糊时呈现 2-3 个方向让用户选 + 输出必带模板名。关键触发：模板选择、风格标签、场景标签、gpt-image-2、工业模板、哪个模板、template match。工位边界：本技能只做风格库模板匹配，不产出系列套图生产；后者由上游市场技能『系列套图生成』等负责，两者接力不抢戏。
source_book: "awesome-gpt-image-2 style-library（GitHub: freestylefly/awesome-gpt-image-2，MIT License）"
source_chapter: agents/skills/gpt-image-2-style-library
tags: [模板匹配, 风格标签, 场景标签, AI生成友好]
layer_confidence: "candidate"
pack: freestylefly 风格库
core_stance: "匹配序是漏斗：类目定行当、风格定脸、场景定处境、案例定细节"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/freestylefly/awesome-gpt-image-2"
source_license: "MIT"
source_url: "https://github.com/freestylefly/awesome-gpt-image-2"
upstream_defer: ["系列套图生成"]
first_seen: 2026-09-21
source_card: freestylefly 风格库/freestyle-template-match
evidence: E4

---

# 风格库四级匹配序

## R — 原文要点 (Reading)

来源方法（MIT，整理自 freestylefly gpt-image-2-style-library）：**四级匹配序**——①显式产品类型对**模板类目**（product/poster/UI/infographic/brand/photography/character/document）；②视觉词对**风格标签**（realistic/3D/illustration/classical/brand/poster/UI）；③语境词对**场景标签**（commerce/education/social/food/travel/story/history/tech/creative）；④仍不定则对**最近示例案例**。**请求模糊时**：呈现 2-3 个强模板方向+短理由让用户选，不独自决定。**输出三件套**：选中的模板名、可直贴的 GPT-Image2 提示词、文字/画幅/布局/负向细节的简明约束。**模板实例（风格库节选）**：UI 截图系统（锁平台/比例/层级/画面文字，避平台描述过泛）、信息图引擎（3-5 模块/信息流/层级/短标签，避长段塞图）、科学尺度缩放图（6-8 尺度框/单位/倍率）、海报排版系统等。**维护纪律**：源库变动时重新生成参考文件，以参考文件为准而非记忆。

## I — 方法论骨架 (Interpretation):

1. **漏斗不跳级**：类目没定不要先看风格——行当错则全错。
2. **模糊即呈现**：拿不准就给 2-3 个方向+理由（配 options-presentation）。
3. **模板名是溯源键**：输出带模板名，用户与后续迭代都能对上账。
4. **约束是交付一部分**：文字/画幅/布局/负向细节不写=模板白选。
5. **参考文件优先于记忆**：模板名/类目/封面以生成参考为准。

## A1 — 应用案例 (Past Application)

- 来源实践：用户「生成城市生命系统图谱」→类目 infographic→风格 infographic/charts→场景 tech→输出带模板名+可贴提示词+约束。
- 反例：凭记忆写模板名——模板早已更新，名不对版。

## A2 — 触发场景 (Future Trigger)

- 用 GPT-Image2 风格库做任何图。
- 用户说「找个合适的模板」。
- 影策 Agent 生图前的模板决策。

## E — 可执行步骤 (Execution)

1. **判类目**：按产品类型定模板类目。
   *完成标准*：类目唯一确定。
2. **对风格**：视觉词对风格标签。
   *完成标准*：风格标签命中。
3. **对场景**：语境词对场景标签。
   *完成标准*：场景标签命中。
4. **兜底案例**：仍不定则对最近案例/呈现 2-3 方向。
   *完成标准*：候选收敛或已呈现选项。
5. **输出三件套**：模板名+可贴提示词+约束清单。
   *完成标准*：三件齐全。
