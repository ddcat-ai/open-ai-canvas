---
name: supercmo-product-description
description: 当用户产品要进任何生成流程（UGC/产品摄影/广告/克隆），或多镜之间"产品长得不一样/材质不对/尺寸感错"，或要写产品参考描述时调用。核心能力：产品描述五要素（逐面材质/真实尺寸/2-5 个视觉锚/机制/一次写定全程复用）。关键触发：产品描述、材质不对、产品变形、视觉锚、product description、尺寸感、跨镜产品一致。工位边界：本技能只做产品描述五要素写法，不产出产品图与广告片生产；后者由上游市场技能『顶级波普视觉广告导演』等负责，两者接力不抢戏。
source_book: "superCMO generating-ugc-videos + cloning-video-ads + generating-product-photos（Apache-2.0）"
source_chapter: Step 4 三处一致的产品描述写法
tags: [产品描述, 视觉锚, 跨镜一致, 材质, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "产品描述一次写定全程逐字复用——换个说法就是换个产品"
skill_type: "template"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
upstream_defer: ["顶级波普视觉广告导演"]
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-product-description
evidence: E4

---

# 产品描述五要素

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO 三个技能的一致写法）：**一份产品描述，在所有分镜/提示词中逐字复用**——换个措辞重述，模型读成不同的产品。五要素：①**逐面材质与表面处理**（matte/gloss/brushed/woven/translucent，一面一面写：brushed steel barrel, matte soft-touch collar, a woven wrist strap）；②**真实尺寸**（宽高+与手的比例关系：sits in a closed palm, roughly 9 cm tall and 4 cm across——给真实测量，**不拿别的物件类比**，类比物模型渲染不一致）；③**2-5 个视觉锚**（只能在产品图上核实到的特征：精确颜色/扣件形状/链条粗细/表面处理/识别标记——别的什么都不写）；④**产品机制**（怎么构成怎么动：哪些部件动/怎么开合/哪里出料：hinged lid at one end, folds back flat; the brush sits inside the cap）；⑤**不变项声明**（跨镜必须保持 identical 的清单）。另两条纪律：**先看图再描述**（产品事实取自图像分析，不取自行 brief/文件名/产品名）；产品未提供不猜——成为第一个要问的事。

## I — 方法论骨架 (Interpretation)

1. **逐字复用是底线**：描述是产品的 DNA 串，改一个词=改一次基因。
2. **视觉锚=可核实**：每条锚点都要在产品图里指得出，指不出的不写。
3. **尺寸给数字**：测量值+手的比例，禁「巴掌大」类类比。
4. **机制即动作库**：机制写清，后续所有「使用中」镜头才有物理依据。
5. **图先于名**：文件名会骗人，图像不会——描述从图出发。

## A1 — 应用案例 (Past Application)

- 来源实践：床垫产品描述（面料织法/尺寸/三个视觉锚/边缘支撑机制）一次写定后，UGC 六镜 + 产品摄影十格式全程复用，跨镜零变形。
- 反例：第 1 镜「保温杯」第 3 镜「水壶」——同物异名，模型直接换物。

## A2 — 触发场景 (Future Trigger)

- 任何含产品的生成流程的第一步。
- 跨镜产品不一致的修复（先统一描述再重生）。
- 影策 Agent 组装产品素材任务前的描述定稿。

## E — 可执行步骤 (Execution)

1. **看图**：对产品图做图像分析，提取事实。
   *完成标准*：事实来自图像非 brief。
2. **写五要素**：逐面材质/真实尺寸/2-5 视觉锚/机制/不变项。
   *完成标准*：五要素齐全。
3. **定稿冻结**：描述定稿，后续全程逐字复用。
   *完成标准*：复用记录可查。
4. **锚点核实**：每个视觉锚在产品图里指得出。
   *完成标准*：锚点全部可指认。
5. **跨镜验收**：成镜对照不变项清单验收。
   *完成标准*：不变项零漂移。
