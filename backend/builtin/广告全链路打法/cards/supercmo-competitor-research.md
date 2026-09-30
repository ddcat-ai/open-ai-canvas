---
name: supercmo-competitor-research
description: 当用户要做竞品广告调研/广告拆解/品类分析，或想知道某个竞对在投什么、什么在跑长、什么被悄悄停掉，或想找"没人占的角度"时调用。核心能力：七步调研法（定竞对→定范围→拉广告→建台账→看片拆解→全组模式→交付）+ 证据纪律（模式必须对照台账、带 ref 和计数才成立）。关键触发：竞品调研、广告拆解、竞对在投什么、什么广告在跑、品类分析、没人做的角度。工位边界：本技能只做研究与拆解，不生成任何东西；决定下次做什么是策划类技能的活。信息边界：影策云端 Agent 无视觉通道，看片拆解需用户提供逐秒笔记或转交支持视觉的模型单独跑，不得声称看见了画面。
source_book: "superCMO researching-competitor-ads（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-7 + Edge cases
tags: [竞品调研, 广告拆解, 品类分析, 投放时长, 证据纪律, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "结论必须长在台账上：没有 ref 和计数的模式不配叫模式；分析整个台账，而不只是你看过的那几片"
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
source_card: superCMO 广告链路/supercmo-competitor-research
evidence: E4

---

# 竞品广告调研：台账驱动七步法

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO researching-competitor-ads）：**Research only——本技能不生成、不发布、不建议做什么**（决策是 planning-campaigns 的活）。七步：①定竞对（三路由：先读 competitors.md 清单→没有就问用户→用户也不知道才用发现法：先 url_extraction 读自家网站搞清卖什么，再 social_research 查 meta_ad_library/search_ads，按广告数排序让用户确认谁是真竞对；每条路都要求拿到 name+website，Step 3 要用域名证明广告归属）；②定范围（一次问全：市场/深度/想学什么；深度两档——quick 保留 30+30 条看 10+10 条，detailed 保留 60+60 看 20+20；每个数字按竞对个数计费）；③拉广告（live 与 stopped 分开拉、分页保存、别自己拆）；④建台账（脚本汇总成 ledger.md：每竞对条数、待看清单、全部文案按重复分组、每行带投放时长/状态/格式/campaign/CTA）；⑤看片（视觉模型批量≤10 并行看，逐片拆解落 per-ad-teardowns.md，同一 ref 不看两遍、没标记的不看）；⑥读全组（模式命名后必须对照台账验证、引用 ref 和计数；**分析整个台账而不只看过的片**——时长分布/格式组合/campaign 结构来自全部行；看的是长投端样本，偏斜必须声明）；⑦交付（先用用户自己的话回答他的问题；没设目标就给品类全景：主导模式带计数+没人占的空间；只带 2-3 个核心发现各附计数和 ref）。

## I — 方法论骨架 (Interpretation)

1. **台账是唯一事实源**：任何"这个模式在跑"的说法，必须能指回台账里的行。没有 ref 和计数的模式是幻觉。
2. **长投即投票**：投放时长是最硬的信号——停了的是被市场投死的，还在跑的是被钱验证过的。stopped 集和 live 集分开看。
3. **样本偏斜要声明**：看片预算只够看长投端，所以"竞对现在在试什么"这类问题只能由元数据和文案回答，不能装成看过的。
4. **一次问全**：范围问题打包成一条消息问完，带自由文本出口；brief 里有的绝不重问。
5. **研究/决策分离**：调研产物是事实和模式，不是"你该做什么"——跨过这条线就是越权。

## A1 — 应用案例 (Past Application)

- 床垫品类：5 个竞对各拉 live+stopped，台账显示"压力测试"类钩子在 stopped 集占 41%、live 集占 9% → 模式判断"该类钩子已被投死"，同时发现 live 集里没人做"夫妻分床软硬分歧"角度 → 交付时按计数呈现两个结论，各附 ref。
- 反例：只看了 3 条 live 片就说"竞对都在用明星代言"——台账里 87 行的格式分布根本不支持，把样本偏差说成品类事实。

## A2 — 触发场景 (Future Trigger)

- 「帮我看看 XX 竞对最近在投什么广告」
- 「这个品类什么广告在跑长？什么被停了？」
- 「拆解一下这条竞品广告」（单条拆解也走本法第 5 步）
- 「帮我找没人做过的角度」

## E — 可执行步骤 (Execution)

1. **定竞对**：清单→问用户→发现法（需自家网站语料）。完成标准：每个竞对都有 name+website。
2. **定范围**：一条消息问全（市场/深度/目标），brief 有的不重问。完成标准：深度档位确定。
3. **拉广告**：live/stopped 分开拉取存档。完成标准：响应文件按竞对分目录。
4. **建台账**：汇总成 ledger（条数/待看/文案分组/每行元数据）。完成标准：台账行数=拉取数。
5. **看片拆解**：按待看清单批量拆解，逐片落盘。完成标准：每条 ref 一份拆解、不重看。
6. **读全组出模式**：模式对照台账验证。完成标准：每个模式带 ref+计数；偏斜已声明。
7. **交付**：先答用户的问题，再给 2-3 个支撑发现。完成标准：结论全部可指回台账。

## B — 边界 (Boundary)

- **不要越界生成**：本技能不写脚本、不出分镜、不建议"你该做什么"。
- **不要无据断言**：计数不支持的模式不进交付；样本偏斜必须明说。
- **影策适配边界**：Agent 无视觉通道——看片步骤需要用户提供逐秒笔记/文案，或转交支持视觉的模型单独跑，并在交付里注明信息缺口；广告拉取依赖用户提供的数据源或手动导出，不假装能直连广告库。
