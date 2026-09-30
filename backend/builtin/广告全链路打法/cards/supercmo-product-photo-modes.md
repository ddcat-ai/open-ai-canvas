---
name: supercmo-product-photo-modes
description: 当用户要拍产品商业图（主图/场景图/模特图/细节图/平铺），或分不清"该棚拍还是场景拍"，或商业图"不像商品图像艺术照"时调用。核心能力：产品摄影模式选择器（studio/lifestyle/hero/on-model/close-up/flat-lay/seasonal/infographic/concept/floating 十格式）+ 边界（不含广告图/listing 图库）+ 品牌指南与买家两问。关键触发：产品摄影、主图、棚拍、场景图、平铺、产品信息图、product photo、packshot。
source_book: "superCMO generating-product-photos（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-3
tags: [产品摄影, 模式选择, 商业图, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "每张商业图只回答一个问题：这张是让谁在哪一刻信什么——模式即答案"
skill_type: "framework"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-product-photo-modes
evidence: E4

---

# 产品摄影十格式选择器

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO generating-product-photos）：**边界**：Marketplace listing 画廊不在范围；成品广告（建立在标题/优惠/CTA/前后对比上的）属图片广告技能；主体不是产品的不适用。**十格式模式选择器**：①studio 棚拍（产品独站干净可控背景）②lifestyle 场景（产品在真实场景被使用/共处）③hero 主视觉（一张引领 campaign 的精致帧，产品被拍到渴望）④on-model 上身（穿戴/手持/上肤）⑤close-up 特写（材质/工艺/紧裁物件本身）⑥flat-lay 平铺⑦seasonal staging 季节布景⑧infographic 产品信息图⑨concept 概念图⑩floating 悬浮。**两问纪律**：brief 不缺就不问；缺则一次问全（≤4 问+自由文本出口）：产品（无图无链接时）/品牌指南（色板/美术方向/禁入画元素/字体/调性——可选，很多品牌没有）/买家是谁（决定 infographic 喊什么卖点、lifestyle 是谁的家、on-model 选谁）/几张+用在哪（目的地决定裁切）。弃问默认：棚拍+工具默认比例，一句话声明。产品图缺失是唯一值得坚持追问的。

## I — 方法论骨架 (Interpretation):

1. **格式即用途**：十格式对应十个商业问题，选错格式=答非所问。
2. **买家决定画面**：同一产品卖给 Z 世代 vs 长辈，场景/模特/卖点全不同。
3. **品牌指南可选**：没有指南是常态，别把可选问成必答。
4. **目的地定裁切**：详情页/信息流/户外海报的裁切预设不同，先问用在哪。
5. **边界防串门**：广告图归广告技能，listing 画廊不接——各司其职。

## A1 — 应用案例 (Past Application)

- 来源实践：床垫详情页系列→lifestyle 六场景（窗边/儿童房/主卧/酒店风/长辈房/特写）+ close-up 面料细节，买家=家庭采购者决定场景选型。
- 反例：把「买它」的广告图当产品图做——CTA 一上，格式就串了。

## A2 — 触发场景 (Future Trigger)

- 电商产品图/详情页素材生产。
- 「不像商品图」的诊断（先查格式再查提示词）。
- 影策 Agent 生图任务的格式决策。

## E — 可执行步骤 (Execution)

1. **定边界**：是产品图（继续）还是广告图/listing（转路线）。
   *完成标准*：边界判定明确。
2. **选格式**：从十格式选最强匹配；多个合理则呈现 2-3+理由。
   *完成标准*：格式唯一或已呈现选项。
3. **两问补缺**：买家+目的地（必要时+品牌指南），一次问全。
   *完成标准*：单轮问全或默认声明。
4. **装深骨架**：读该格式模式参考文件再写提示词。
   *完成标准*：格式骨架已加载。
5. **产品核籍**：产品描述走 supercmo-product-description 定稿。
   *完成标准*：描述冻结复用。
