---
name: supercmo-campaign-planning
description: 当用户问"下一步做什么广告"、要把调研结论变成可执行清单，或一次要一批创意概念时调用。核心能力：四输入汇聚（产品/品牌/自有广告/竞品广告）→ 概念清单（上限3战役×10概念，证据带得动就停）→ 逐概念路由 → 批准后才构建。关键触发：做什么广告、下次投什么、创意清单、campaign、概念、策划。工位边界：本技能到批准为止；批准后的构建按各概念的路由交给生产技能，逐个构建。纪律：未批准不生成；未答的问题不是同意。
source_book: "superCMO planning-campaigns（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-6
tags: [广告策划, 概念清单, 四输入汇聚, 先批后建, 路由分发, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "计划建立在四个输入的证据上；概念写到手就能生产；批准之前一个像素都不生成"
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
source_card: superCMO 广告链路/supercmo-campaign-planning
evidence: E4

---

# 广告策划：从四输入到可构建概念清单

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO planning-campaigns）：**计划未批准前什么都不生成；构建是用户最后逐个概念做的独立决定**。①范围一次问全（产品必给——URL 或照片，多个产品要问清是一个战役还是各一个；目标 awareness/consideration/conversion；竞对；市场；深度），缺产品不往下走；②汇聚四输入——产品（analyzing-products）、品牌（analyzing-brand）、自有广告（analyzing-own-ads）、竞品广告（researching-competitor-ads），**每个技能一个独立文件夹、产物全量保留**，Step 1 的答案全部传下去（收到答案的技能把 scope 问题当作已答；没收到会猜），收尾一句话说清计划建在哪几个输入上、哪几个缺席；③建概念清单——**数量自己定别问**：至多 3 个战役各至多 10 个概念，是天花板不是目标，证据带得动几个建几个并说清什么用尽了；每个概念写全（就是给生产的完整交接，没有单独 brief）；**能不能生产不是这里的筛选项**（路由是下一步的事）；④逐概念路由（production-palette）：每个概念都有路由，不因"不可路由"丢弃；⑤交付：grounding 头（建在哪些输入上）→一条消息呈现全部战役与概念→问构建哪些并说明计费→**等回答，未答不是同意**；⑥只构建用户点名的：按计划顺序逐个来，把 concepts.md 里的概念原文交给路由指向的技能。

## I — 方法论骨架 (Interpretation)

1. **四输入是证据地基**：计划只建在产品/品牌/自有/竞品四类证据上；输入缺席要在计划头部声明——缺席不阻塞，隐瞒才致命。
2. **概念=完整交接**：写到生产者能直接动手，消灭"brief 再说一遍"的损耗。
3. **产量由证据定不由配额定**：设上限防注水，说清"什么用尽了"防虚假丰产。
4. **可生产性归路由管**：策划阶段不挑软柿子，路由阶段才匹配生产能力。
5. **批准是硬闸**：构建计费且贵，未答的问题不是 yes。

## A1 — 应用案例 (Past Application)

- 床垫客户：四输入汇聚后发现自有矩阵已饱和"压力测试"角度、竞品 live 集无人做"夫妻分床"→ 建 2 战役 7 概念（其中 1 概念直接继承自家长投结构）；呈现后用户点名 3 个构建，其余留档。
- 反例：输入只有产品 URL 也硬建了 10 个概念——没有自有/竞品证据的概念全是通用模板货，构建完全部不投。

## A2 — 触发场景 (Future Trigger)

- 「下一步做什么广告？」
- 「把这些调研结论变成创意」
- 「给我一批可测试的概念」
- 调研/审计完成后的自然下游

## E — 可执行步骤 (Execution)

1. **定范围**：一次问全，缺产品即停。完成标准：产品/目标/竞对/市场/深度五项有着落。
2. **聚四输入**：逐技能跑、分文件夹、全量保留。完成标准：四输入各有产物或明示缺席。
3. **建概念**：证据定产量、概念写全。完成标准：概念可直接交生产。
4. **路由**：逐概念贴生产技能。完成标准：无未路由概念。
5. **交付+等批**：grounding 头+一条消息呈现+问构建。完成标准：用户明确答复。
6. **构建获批项**：按序逐个、交概念原文。完成标准：只建了点名的。

## B — 边界 (Boundary)

- **未批不建**：呈现后停，等用户点名。
- **不问产量**：数量自己按证据定。
- **不丢概念**：不可路由也要给路由或明示原因。
- **影策适配边界**：四输入技能在影策里由本库对应卡承担（竞品调研/品牌分析/自有审计/产品描述）；构建走影策 generate_media 及官方市场生产技能。
