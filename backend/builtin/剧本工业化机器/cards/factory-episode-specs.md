---
name: factory-episode-specs
description: 当用户写单集剧本/分集正文，或单集"节奏不对/太平/断章无力"，或要核对单集硬规格时调用。核心能力：单集硬规格（90-120 秒/实拍 350-500 字/漫剧 260-400/场景≤2/语速 3.5-4.5 字每秒/前 3 秒钩/往返回合拍/四大断章公式）+ 微表情只写生理可观测动作。关键触发：单集规格、体量、字数、场景数、断章、集尾钩子、episode spec、cliffhanger。工位边界：本技能只做单集硬规格与断章公式，不产出故事开发与剧本撰写全流程；后者由上游市场技能『故事开发』等负责，两者接力不抢戏。
source_book: "short-drama-factory（GitHub: lixiaoxiao9888-create/short-drama-factory，MIT License）"
source_chapter: SKILL.md Step 3 + cliffhanger-master-formulas.md
tags: [单集规格, 断章公式, 体量控制, 集尾钩子, AI生成友好]
layer_confidence: "candidate"
pack: short-drama-factory 剧本工厂
core_stance: "单集是一次完整的施压-反驳：硬规格是骨架，断章是扳机"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
source_license: "MIT"
source_url: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
upstream_defer: ["故事开发", "剧本撰写"]
first_seen: 2026-09-21
source_card: short-drama-factory 剧本工厂/factory-episode-specs
evidence: E4

---

# 单集硬规格与断章公式

## R — 原文要点 (Reading)

来源方法（MIT，整理自 short-drama-factory v3.1）：单集硬规格——**时长 90-120 秒**；正文体量**实拍 350-500 字**（漫剧 260-400 字）；**场景 ≤2**；**语速 3.5-4.5 字/秒**；黄金前 3 秒钩子（五母型×20 变体）；每集必须构成一个「施压→反驳（或升级）」拍；集尾命中**四大断章公式**之一；微表情只写生理可观测动作。八条绝对红线：①严禁开篇铺垫（前 3 秒必须见血/见冲突/见危机）②严禁台词讲设定（背景走物证/反差/侧写/反转）③体量与场景数硬卡 ④每集必有断章卡点、严禁平静收尾 ⑤严禁全员播音腔（反派市井刻薄/主角隐忍冷酷或爆发霸道）⑥情绪流单一矛盾单元 ≤30 集 ⑦每回合反驳必须带新增量 ⑧合规一票否决类不碰、暴力用写意替代。

## I — 方法论骨架 (Interpretation)

1. **规格即质检**：字数/场景数/时长全部可机械检查，不靠感觉。
2. **前 3 秒是生死线**：开篇见冲突——铺垫是流失不是蓄势。
3. **断章是产品设计**：不断章=无追更；四大断章公式是现成扳机库。
4. **设定不进口号**：世界观走物证与侧写，台词讲设定即废稿。
5. **声线防同质**：反派与主角的语域必须错开，全员播音腔=全员无性格。

## A1 — 应用案例 (Past Application)

- 来源实践：validate_episode.py 机检项=字数/句长/场景/钩子/断章/复读/开篇禁词/情绪流变词——FAIL 必须修复重跑，不得裸交。
- 断章公式四型：悬念中断（话到嘴边）/反转前定格/狠话收/神秘细节特写。

## A2 — 触发场景 (Future Trigger)

- 单集撰写与精修。
- 单集节奏平的诊断（先对规格再对结构）。
- 影策 Agent 分集生产后的机检。

## E — 可执行步骤 (Execution)

1. **前 3 秒核**：钩子可见可听，无铺垫。
   *完成标准*：钩子位有冲突/悬念/反差。
2. **体量核**：字数区间+场景 ≤2+时长 90-120s。
   *完成标准*：三项全在规格内。
3. **拍核**：本集含一个施压→反驳（或升级）拍。
   *完成标准*：拍结构成立。
4. **断章核**：集尾命中四大断章公式之一。
   *完成标准*：断章类型明确。
5. **声线核**：角色语域错开，无播音腔。
   *完成标准*：语域区分可指认。
