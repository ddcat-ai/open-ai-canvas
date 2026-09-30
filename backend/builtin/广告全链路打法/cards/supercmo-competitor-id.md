---
name: supercmo-competitor-id
description: 当用户说"找出我的竞对"而手里没有清单，或竞对清单过期要刷新，或分不清"谁是真竞对"时调用。核心能力：双通道发现（search_ads 广告库/网页搜索 alternatives）+ 来源纪律（每个候选必须带出处，记忆里的不算）+ 确认制交付（3-5 个候选各带一句竞争逻辑）。关键触发：找竞品、谁是我的竞争对手、竞对清单、alternatives、refresh competitors。工位边界：本技能只交付"名字+网站"清单；找到之后做什么（调研/拆解）是后续技能的活。
source_book: "superCMO identifying-competitors（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-6 + Edge cases
tags: [竞对发现, 来源纪律, 确认制, 清单维护, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "每个候选都要有出处——记忆里报得出名字的竞对，一条都不许进清单"
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
source_card: superCMO 广告链路/supercmo-competitor-id
evidence: E4

---

# 竞对发现：从品类语料到确认清单

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO identifying-competitors）：**只交付 names + websites，别的不产**。缓存优先：competitors.md 已有即交回停止。流程：①定品牌（name+website 缺一不可，没有网站不往下走）；②搞清品牌卖什么（读站或已知跳过）；③双通道发现——主通道网页搜索两类问句（`alternatives to <brand>`= 已知品牌的买家在比什么；`best <category> for <audience>`= 不知道品牌的买家怎么找品类），**每个候选必须带来源**（说出它的那条搜索结果），记忆里的候选不许加；搜索薄（小众/非英语市场）再走 search_ads 广告库通道（花额度，先说清等确认）；④确认制：一次消息给 3-5 个候选，各带 name+website+一句为什么算竞对，问哪个真/哪个砍/还漏谁；brief 说跳过确认才直接存；⑤落盘 competitors.md（一行一个：名字+网站；**已存在则合并不覆盖**，用户砍掉的才移除）。边界：零售商/ marketplace/比价站不算竞对除非用户说算；多国市场要问清这份清单属哪个市场，不混。

## I — 方法论骨架 (Interpretation)

1. **两条买家路径**：alternatives 抓"品牌认知池"里的对手，best-for 抓"品类认知池"里的对手——只搜一条会漏一半。
2. **来源纪律是防幻觉阀**：竞对清单会被后续所有调研继承，一个记忆编出来的竞污染整条链。
3. **确认制防误伤**：3-5 个候选+竞争逻辑一句话，让用户一分钟内能裁决——比甩 20 个名字或自作主张都稳。
4. **合并不覆盖**：清单是累积资产，刷新是增量不是重写。
5. **花钱通道要审批**：广告库检索计费，先说明再执行。

## A1 — 应用案例 (Past Application)

- 国产床垫新品牌：alternatives 搜出 3 个直接对手 + best-for 搜出 2 个品类上位者；其中 1 个候选来源是比价站，向用户说明后剔除；确认后清单 4 条落盘，直接成为竞品调研的输入。
- 反例：模型凭训练记忆列了 6 个"知名竞对"——其中 2 家已转型不做 C 端床垫，调研白做一半。

## A2 — 触发场景 (Future Trigger)

- 「谁是我竞品？」「帮我找竞对」
- 「竞对清单该更新了」
- 调研任务前置：竞品调研卡第一步的清单缺失时

## E — 可执行步骤 (Execution)

1. **查档+定品牌**：competitors.md 命中即交回；否则拿齐 name+website。完成标准：网站到手。
2. **学卖点**：读站搞清品类与人群。完成标准：一句话能说清卖什么。
3. **双通道发现**：两类问句都搜，候选逐个带来源。完成标准：候选表每行有出处。
4. **确认**：3-5 个候选+竞争逻辑，一次问全。完成标准：用户裁决记录在案。
5. **落盘**：写/合并 competitors.md。完成标准：清单与用户裁决一致。

## B — 边界 (Boundary)

- **不产调研结论**：本技能到清单为止，拆解是竞品调研卡的活。
- **不凭记忆加竞对**：无来源不进表。
- **零售商不算竞对**（除非用户指定）；多市场不混清单。
- **影策适配边界**：搜索与广告库拉取依赖用户提供数据源或手动导出；候选来源以用户可查验的检索记录为准。
