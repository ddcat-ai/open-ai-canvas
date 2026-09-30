---
name: flux-asset-image
description: 当用户要生成角色定妆照/三视图/场景概念图/道具图等资产图，或角色在多张图里长得不一样、HEX 颜色还原不准、写实感不足、写了负向词反而更糟时调用。核心能力：FLUX.2 四层结构（Subject→Action→Style→Context，词序即权重）+ 五条专属规则（无负向词 / HEX 绑物体 / 外观段逐字重复保一致性 / 相机代码提写实感 / 多主体切 JSON）。关键触发：定妆照、资产图怎么生成、角色图不一致、FLUX 怎么写、负向提示词、HEX 控色。工位边界：只产出 FLUX 图像提示词与资产一致性规则；画面视觉决策由 vis 系列卡负责，决策转短语走 vis-to-prompt，完整分镜与成片流程由上游市场技能『叙事短片导演分镜』等负责，接力不抢戏。
source_book: "FLUX.2 官方提示词指南与官方发布页（2026-08-14 核验）"
source_chapter: "docs.bfl.ai/guides/prompting_guide_flux2 + blackforestlabs.ai/flux-2"
tags: [flux, prompt-engineering, image-gen, 资产图, 角色一致性, HEX控色, AI生成友好]
layer_confidence: "candidate"
pack: FLUX.2 图像提示词工程
core_stance: "FLUX.2 没有负向通道、没有运镜——所有「不要 X」必须改写成正面描述，颜色必须绑定到具体物体，角色一致性靠外观段逐字重复而不是靠模型记住"
skill_type: "framework"
consult_tier: "B（琥珀区·公开官方文档方法论）"
verify_state: raw
card_type: book
publish_tier: tier-attrib
source_repo: "Black Forest Labs FLUX.2 官方提示词指南（docs.bfl.ai/guides/prompting_guide_flux2）"
source_license: "规范要点整理自 BFL 公开文档（功能事实整理，非表达复制）"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-08-14
source_card: FLUX.2 图像提示词工程/flux-asset-image
evidence: E4

---

## S — 规范要点 (Spec Summary)

> 本节为 BFL FLUX.2 公开文档的功能事实整理（字段名/参数/规则属公共技术事实，非表达复制）；官方原始措辞以 BFL 文档为准。

FLUX.2 是图像模型，没有运镜指令（运镜属于视频模型 H3 的领域）。官方推荐的提示词框架是四层：Subject + Action + Style + Context，词序即权重——主体、关键动作、关键风格、必要场景依次前置，次要细节放最后，越靠前权重越高。

长度分档：10–30 词适合风格探索；30–80 词是多数项目的理想区间；80 词以上用于复杂场景。

关键约束：FLUX.2 没有负向提示词通道——"不要模糊"要写成 "sharp focus throughout"，"不要有人"要写成 "empty scene"。

四项专属能力：HEX 精确上色（颜色必须绑到具体物体上）；JSON 结构化提示词（多主体、自动化、逐元素迭代时用）；文字渲染（引号 + 位置 + 风格 + 颜色）；相机代码（`Shot on <机身>, <焦段> lens, <光圈>` 的格式，如 `Shot on Hasselblad X2D, 80mm lens, f/2.8`，比笼统的 "professional photo" 更出片）。

角色一致性的官方做法：漫剧多格/多张图时，每一格都逐字重复该角色的完整外观描述段。

## I — 方法论骨架 (Interpretation)

资产图提示词 = 四层结构 + 五条 FLUX 专属规则：

**四层结构**（按权重前置）：
1. **Subject 主体**：从资产卡（ip-character-bible）抄视觉锚点——年龄/体型/肤色/发型/服装/标志物。
2. **Action 动作/姿势**：定妆照用中性站姿或角色标志动作；三视图写 "front view, side view, back view"。
3. **Style 风格**：画风（与 ip-style-decoupling 解耦后的画风词）+ 媒介（illustration / photo / comic panel）。
4. **Context 场景光影**：背景、光线、时间、氛围；定妆照建议纯色/简洁背景突出角色。

**五条专属规则**：
1. **无负向提示词**：所有"不要 X"一律改写成正面描述（要锐利写 "sharp focus throughout"，要干净背景写 "clean plain background"）。
2. **HEX 绑定物体**：色板（vis-color-mapping）里的 HEX 必须写死在具体物体上——"The jacket is color #C4725A" 优于 "use #C4725A in the image"；渐变用 "starting with color X and finishing with color Y"。
3. **角色一致性 = 重复**：把角色完整外观写成一个固定描述段，该项目所有图（每格/每张）逐字重复，不改词序不换近义词。
4. **写实感靠相机代码**：需要真实摄影质感时追加 `shot on [机型], [焦段], [光圈]`；风格年代感用 `80s vintage photo` / `2000s digicam style`。
5. **复杂多主体用 JSON**：≥3 个主体或需逐元素控色时切 JSON schema（scene/subjects[]/style/color_palette/lighting/camera），单主体自然语言即可。

## A1 — 书中的应用 (Past Application)

- **Diffusion Man 四格漫画（官方案例 2.6）**：四格每一格都重复 "athletic 30-year-old with brown skin tone, short natural fade haircut with black hair, …gradient bodysuit…, purple half-mask, strong jawline" 完整外观段 → 四格角色零漂移。漫剧资产图直接套用：外观段存进 assets.json 的角色卡，生成时逐字注入。
- **HEX 控色客厅（官方案例 2.4）**：墙 #C4725A、沙发 #1B6B6F、抱枕 #E8A847 逐个绑定物体 → 场景概念图可精确还原 vis-color-mapping 色板。
- **反面例**：写 "no text, no watermark" → FLUX 无负向通道，等于白写甚至引入干扰 → 改为不提及文字即可，要干净就写 "clean plain background"。

## A2 — 触发场景 (Future Trigger)

- 阶⑧资产设计：角色定妆照、三视图、场景概念图、道具图生成前，先用本卡出 FLUX 提示词，产物登记进 assets.json。
- 漫剧分格图（多张连发）：每张提示词必须包含同一角色外观段（规则 3）。
- 会审放行（阶⑩）可执行性轴：检查图像侧提示词无负向词、HEX 已绑定物体、外观段与角色卡一致。
- 语言信号："定妆照 / 资产图怎么生成 / 角色图不一致 / FLUX 怎么写"。

## E — 可执行步骤 (Execution)

1. **取锚点**：从 assets.json 角色卡/场景卡抄视觉锚点与色板 HEX；无卡先回阶⑧补卡。
   *完成标准*：主体锚点 + 色板 HEX 齐备。
2. **搭四层**：按 Subject → Action → Style → Context 顺序写，重要项前置，目标 30–80 词。
   *完成标准*：四层齐全且顺序正确。
3. **绑颜色**：把需要的 HEX 逐个绑定到具体物体；渐变用 start/finish 句式。
   *完成标准*：每个 HEX 都有归属物体。
4. **注外观段**：角色图则将完整外观描述段逐字并入 Subject；多格项目确认每格都含该段。
   *完成标准*：外观段与角色卡逐字一致。
5. **加质感词**（按需）：写实质感加相机代码；年代风格加 era 关键词；多主体复杂场景切 JSON。
   *完成标准*：质感词与画风设定不冲突。
6. **负向词清洗自检**：全文搜索 no/without/avoid，全部改写为正面描述；与案例窖「资产图」模块比对。
   *完成标准*：零负向词，过会审可执行性轴。
