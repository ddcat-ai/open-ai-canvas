---
name: supercmo-segment-split
description: 当一条口播稿要拆成多镜（每镜几秒）分段，或拆完"接缝处听起来断裂/像几段录音拼的"，或分镜与口播对不上时调用。核心能力：分段四律（顺耳切/少而长/缝处不改词/只首段引入）+ 镜-稿节拍对齐。关键触发：拆分口播、分镜分段、接缝断裂、缝处改词、segment split、每镜几秒。
source_book: "superCMO writing-video-scripts（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 5
tags: [分段规则, 接缝, 镜稿对齐, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "拼回去必须一字不差复现整篇——要靠改词才能落的拆法，错的是稿不是拆法"
skill_type: "technique"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-segment-split
evidence: E4

---

# 口播分段四律

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO writing-video-scripts Step 5）：一条口播拆成每镜一段，**成片听起来必须像一条录音被剪成几段，而不是几段录音按顺序播放**。四律：①**顺耳切**——切在耳朵已经听到断的位置（句尾/逗号/分句接缝）；句中切可以，半句切不行——半句切口让一段悬停、下一段悬起。②**少而长优先**：相邻两句都放得进同一镜预算就并一段——每道缝都是听起来像拼接的机会，能少则少。③**缝处不改词**：按序拼回去必须逐字复现整篇独白——没有为迁就拆分而改写/重排/增删；如果一个拆法只有改词才成立，那是稿子错了不是拆法错了，回炉重写独白。④**只首段引入**：之后每段从思绪中续上——不重新介绍、不复述背景。

## I — 方法论骨架 (Interpretation)

1. **缝是听觉事件**：切点选在耳朵的呼吸位，不是在秒数网格上。
2. **拼接复现是硬测试**：拆完拼回一字不差——可机械验证。
3. **少缝原则**：每道缝都是风险预算，能合并就合并。
4. **续接不重述**：后续段落默认观众记忆连续，重述=把观众当金鱼。
5. **镜-稿对齐**：每段覆盖该镜分镜给的节拍（画面发生什么），声画各司其职。

## A1 — 应用案例 (Past Application)

- 来源实践：15 秒 3 镜稿，切点全在逗号位，拼回朗读与独白逐字一致——成片如一镜到底。
- 反例：为凑秒数在半句处下刀——上一段悬着口气，下一段突然起头，拼接感爆棚。

## A2 — 触发场景 (Future Trigger)

- 多镜视频的口播拆分。
- 分镜表与口播稿的节拍对齐。
- 「接缝听起来断了」的修复。

## E — 可执行步骤 (Execution)

1. **标切点**：只在句尾/逗号/分句接缝标切。
   *完成标准*：切点全在顺耳位。
2. **能并则并**：相邻段可合并则合并，少缝优先。
   *完成标准*：缝数最小化。
3. **拼接复现**：拆完拼回逐字对照独白。
   *完成标准*：一字不差。
4. **续接检查**：非首段无重新引入/复述。
   *完成标准*：零重述段。
5. **镜稿对齐**：每段对应该镜节拍。
   *完成标准*：声画节拍对应。
