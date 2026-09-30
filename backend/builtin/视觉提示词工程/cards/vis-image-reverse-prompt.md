---
name: vis-image-reverse-prompt
description: 当用户上传一张图说"照这个风格/感觉/构图再来一张"、"分析这个画面"、"图生提示词"、"反向工程这个look"、"把这张图的风格迁移到我的产品上"时调用。核心能力：四参数块深度解构（主体心理与场面调度/环境三平面/灯光明暗/技术摄影）+ 严格词序合成公式 + 只描述所见不发明。关键触发：图反推、image to prompt、reverse-engineer、风格迁移、分析画面、照这个感觉来一张。工位边界：本技能只做方法论与质检，不替代上游市场技能的生产流程，两者接力不抢戏。
source_book: "visual-skills image 参考库（GitHub: smixs/visual-skills，CC-BY-4.0，署名 Serge Shima）"
source_chapter: vision-decomposer.md
tags: [图反推, image-to-prompt, 风格迁移, 解构, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "反推是纯数据提取：扫描原始事实，不发明画面里没有的东西"
skill_type: "technique"
consult_tier: "A（绿区·CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-image-reverse-prompt
evidence: E4

---

# 图像反推提示词：四块解构 + 严格词序

## R — 原文要点 (Reading)

来源方法（CC-BY-4.0，整理自 visual-skills vision-decomposer.md）。**STEP 1 深度解构，四参数块**：①主体（心理与场面调度）——精确服装（年代/风格/材质）、年龄、肤质、妆容、微表情；景别（ELS/LS/MS/双三人群像/CU/贴脸 CU/极特写/插入镜头）；场面调度（主体孤立画框边缘=焦虑、物理屏障、背对镜头=未知感/无力感、高度差=支配）；知觉动力（视觉重量、重心、形式张力、姿态、运动矢量、动态模糊或纪念碑式静止）；局部色的情绪（Itten）；注视方向与画框关系。②环境（几何与空间结构）——场景美术、三平面深度（前景引导细节/中景动作面/背景，斯皮尔伯格）、图地关系与反射、影调空气透视（背景对比下降+去饱和+偏冷）、画框几何。③灯光（明暗与对比）——光学对比 OVK（亮暗面积比）、布光方案（主光/辅光/轮廓光/造型光）、伦勃朗/明暗对照、破光与反射（gobo/百叶/邻物反光）、高调低调、白平衡与色温对比。④技术与摄影——机位角度（高/低/平/荷兰角）、主观/过肩、焦段与景深、滤镜（Pro-Mist 等柔光/偏振）、画幅格式、曝光、风格化（漂白旁路）、胶片颗粒与色差。**STEP 2 合成规则**：只写英文逗号分隔关键词；**严格只描述所见，不发明新物体**；零填充语（禁 The image shows / A picture of / I can see）；**严格词序（不可协商）**：［镜头类型+光学+角度］→［主体+场面调度+视觉重量+服装动作］→［多平面环境（前中后景）+重叠与几何］→［布光方案+光学对比+gobo与反射］→［色板+色温对比+空气透视］→［调色+柔光滤镜+胶片库存+质感工件］。**输出协议**：两段式——先简短分析日志（Subject & Blocking / Environment & Depth / Lighting / Tech & Optics 四行），再成品提示词。

## I — 方法论骨架 (Interpretation)

1. **反推 ≠ 想象**：图里没有的一律不写；每一条都要指得出画面依据。
2. **四块是扫描仪**：按固定四块扫图，防漏检（尤其灯光与光学最易漏）。
3. **词序即权重**：合成公式顺序与模型注意力分布对齐——镜头与主体先行，质感工件垫后。
4. **分析日志是审计**：先出日志再出提示词，用户可核对哪条是编的。
5. **风格迁移场景**：把解构结果按目标模型（Nano Banana/GPT Image）五槽模板重排（配 vis-image-5slot-deslop）。

## A1 — 应用案例 (Past Application)

- 场景：用户上传竞品海报要「同样感觉」→ 四块解构出「低角度仰拍+冷蓝轮廓光+前景虚化遮挡+高对比低调」→ 迁移到用户产品重合成，风格可指认可复现。
- 反例：直接写「epic cinematic stunning poster」——无扫描无词序，模型自由发挥，与参考无关。

## A2 — 触发场景 (Future Trigger)

- 用户上传参考图/竞品图/喜欢的片子截图。
- 说「照这个感觉」「分析这个画面」「图生提示词」。
- 影策 Agent 接到图片附件且意图为复用其视觉特征时。

## E — 可执行步骤 (Execution)

1. **四块扫描**：主体/环境/灯光/技术逐块提取，每块记画面依据。
   *完成标准*：四块均有记录，无发明项。
2. **出分析日志**：四行日志（Subject & Blocking / Environment & Depth / Lighting / Tech & Optics）。
   *完成标准*：日志先行，可核对。
3. **按词序合成**：严格按六段词序组装英文关键词提示词。
   *完成标准*：词序合规，零填充语。
4. **模型适配**：按目标模型语法重排（五槽/自然段）。
   *完成标准*：输出带模型名与参数头。
5. **风格 DNA 回填**：如用于系列，把解构结果固化为四行 DNA 供后续验收。
   *完成标准*：DNA 四行落档。
