---
name: freestyle-prompt-blocks
description: 当用户要把风格库模板落成最终提示词，或提示词"缺块导致模型自由发挥"，或多概念图"风格飘了/概念互相污染"时调用。核心能力：六块组装（主体与任务/构图与布局/视觉风格与材质/文字与标签要求/画幅与输出格式/约束与负向细节）+ 多概念同模板复用变体法。关键触发：六块组装、prompt blocks、缺块、多概念复用、文字约束、aspect ratio、negative details。
source_book: "awesome-gpt-image-2 style-library（GitHub: freestylefly/awesome-gpt-image-2，MIT License）"
source_chapter: SKILL.md Workflow Step 5-6
tags: [六块组装, 提示词结构, 文字约束, 多概念复用, AI生成友好]
layer_confidence: "candidate"
pack: freestylefly 风格库
core_stance: "六块是施工单：缺一块，模型就用想象补一块"
skill_type: "template"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/freestylefly/awesome-gpt-image-2"
source_license: "MIT"
source_url: "https://github.com/freestylefly/awesome-gpt-image-2"
first_seen: 2026-09-21
source_card: freestylefly 风格库/freestyle-prompt-blocks
evidence: E4

---

# 风格库六块组装

## R — 原文要点 (Reading)

来源方法（MIT，整理自 freestylefly style-library SKILL.md）：最终提示词按六块组装——①**主体与任务**（subject and task）；②**构图与布局**（composition and layout）；③**视觉风格与材质**（visual style and materials）；④**文字与标签要求**（text and label requirements——精确文字内容、可读性、层级）；⑤**画幅与输出格式**（aspect ratio and output format）；⑥**约束与负向细节**（constraints and negative details——要避免的工件）。**约束要具体**：精确文字、画幅、可读标签、布局层级、避免的工件——不写约束等于让模型猜。**多概念复用**：用户要多个概念时，复用同一模板、只变主体/构图/色板/场景——保系列一致性。**语言跟随用户**：中文请求最终提示词用中文（除非用户要英文）——gpt-image 对中文请求出中文提示词表现好。

## I — 方法论骨架 (Interpretation):

1. **六块=六个施工面**：缺块即缺指令，模型必自由发挥。
2. **文字块是 GPT-Image 强项**：画面文字要精确到内容+可读性+层级，别只说「带标题」。
3. **约束块防工件**：把常见工件（乱码/多余元素/水印感）写进负向。
4. **同模板变主体=系列感**：系列图锁模板变变量，不锁模板必散。
5. **语言策略**：中文请求默认中文提示词——别无脑翻译成英文。

## A1 — 应用案例 (Past Application)

- 来源实践：UI 截图系统模板六块化——平台锁定+比例+层级+可见文字+UI chrome（状态栏/Tab/操作行/评论层）+约束（避平台描述过泛/文字可读）。
- 反例：只写「做个科技感海报」——六块缺五块，模型交啥全靠运气。

## A2 — 触发场景 (Future Trigger)

- 风格库模板落成提示词的组装步。
- 系列图/多概念批量出图。
- 画面文字类需求（海报/UI/信息图）。

## E — 可执行步骤 (Execution)

1. **六块铺满**：主体/构图/风格材质/文字/画幅/约束逐块写实。
   *完成标准*：六块无空块。
2. **文字精确化**：画面文字内容+可读性+层级三要素。
   *完成标准*：文字块含三要素。
3. **负向列工件**：常见工件写进约束块。
   *完成标准*：负向清单非空。
4. **系列锁模板**：多概念同模板变变量。
   *完成标准*：系列模板一致。
5. **语言核对**：提示词语言与请求语言策略一致。
   *完成标准*：语言策略已声明。
