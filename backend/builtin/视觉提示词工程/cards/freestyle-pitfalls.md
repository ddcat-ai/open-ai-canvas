---
name: freestyle-pitfalls
description: 当用户用 GPT-Image2 做信息图/图表/UI/科普图但"画面文字乱/模块拥挤/布局像通用模板"，或模板跑出来有典型工件时调用。核心能力：模板陷阱清单（长段塞图/模块数超限/文字不可读/布局通用化/尺度框同质）+ 对应约束写法。关键触发：模板陷阱、文字乱码、模块拥挤、信息图、pitfalls、图表工件、布局通用。
source_book: "awesome-gpt-image-2 style-library（GitHub: freestylefly/awesome-gpt-image-2，MIT License）"
source_chapter: references/style-library.md 各模板 Pitfalls
tags: [模板陷阱, 信息图, 文字可读, 布局, AI生成友好]
layer_confidence: "candidate"
pack: freestylefly 风格库
core_stance: "先限制模块数量，再补视觉细节——顺序反了就拥挤"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/freestylefly/awesome-gpt-image-2"
source_license: "MIT"
source_url: "https://github.com/freestylefly/awesome-gpt-image-2"
first_seen: 2026-09-21
source_card: freestylefly 风格库/freestyle-pitfalls
evidence: E4

---

# 模板陷阱清单

## R — 原文要点 (Reading)

来源方法（MIT，整理自 freestylefly style-library 各模板 Pitfalls 节选）：**通用陷阱**——①**长段正文塞进画面**：图里禁长段落，文字要短标签级；②**模块数超限**：先限制模块数量再补视觉细节（信息图 3-5 模块、科学尺度图 6-8 框）；③**文字不可读**：约束文字可读性与平台/模板特征；④**布局通用化**：避免「通用放大镜式布局」「泛平台 App  mockup」这类无特征构图；⑤**尺度框同质**：每个尺度框视觉要有区分，禁全部一样。**对应约束写法**：文字块写精确内容+短标签；布局块写模块数上限+层级；负向块写「禁长段文字/禁通用布局/禁同质重复元素」。

## I — 方法论骨架 (Interpretation):

1. **信息密度有上限**：图的承载力远低于文档——长段必崩。
2. **先减后加**：模块数定顶再补细节；边加边看必拥挤。
3. **特征是记忆点**：通用化布局=没有品牌=看完就忘。
4. **同质即失败**：重复元素无区分=信息图变壁纸。
5. **陷阱可前置**：所有陷阱都能写进负向约束块预防（配 freestyle-prompt-blocks）。

## A1 — 应用案例 (Past Application)

- 来源实践：信息图模板约束「3-5 模块+短标签+色块箭头控制复杂度」→一次通过；去掉模块数上限的版本拥挤到读不动。
- 反例：「画一个科技感信息图」——无模块数无文字约束，出来一张漂亮但读不了的壁纸。

## A2 — 触发场景 (Future Trigger)

- 信息图/图表/UI/科普图生成。
- 模板产出「漂亮但读不了」的修复。
- 影策 Agent 生图任务负向约束的预置清单。

## E — 可执行步骤 (Execution)

1. **定模块数**：按模板类型设上限（信息图 3-5/尺度图 6-8）。
   *完成标准*：模块数上限写入提示词。
2. **文字短签化**：画面文字全部短标签级。
   *完成标准*：无长段文字。
3. **布局特征化**：指定具体布局结构，禁通用式。
   *完成标准*：布局描述具体可辨。
4. **元素区分**：重复类元素（尺度框/卡片）逐一定差异。
   *完成标准*：无同质元素。
5. **负向预置**：陷阱清单写进约束块。
   *完成标准*：负向块覆盖五类陷阱。
