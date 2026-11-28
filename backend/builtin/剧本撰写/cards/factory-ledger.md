---
name: factory-ledger
description: 当用户要连写多集/批量生产，或出现"死人开口/伏笔埋了不收/道具状态前后矛盾"，或跨集连续性出问题时调用。核心能力：连续性台账四类账（伏笔/人物/道具/规则）+ 读写规程（写前读台账、写后更新，无台账不开写）。关键触发：连写、批量、伏笔、死人开口、道具穿帮、连续性、台账、ledger、continuity。
source_book: "short-drama-factory（GitHub: lixiaoxiao9888-create/short-drama-factory，MIT License）"
source_chapter: SKILL.md Step 2 + continuity-ledger.md
tags: [连续性台账, 伏笔管理, 连写, 状态机, AI生成友好]
layer_confidence: "candidate"
pack: short-drama-factory 剧本工厂
core_stance: "台账是长剧的账本：写前不读账，写后不记账，穿帮只是时间问题"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
source_license: "MIT"
source_url: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
first_seen: 2026-09-21
source_card: short-drama-factory 剧本工厂/factory-ledger
evidence: E4

---

# 连续性台账四类账

## R — 原文要点 (Reading)

来源方法（MIT，整理自 short-drama-factory continuity-ledger）：分集时同步登记四类账——①**伏笔账**（埋于哪集/拟收哪集/当前状态）；②**人物账**（存活状态/关系变化）；③**道具账**（状态机：在谁手里/损坏否/转移记录）；④**规则账**（世界观规则引用与例外）。**读写规程：无台账不开写**——写前读台账（相关账目全过一遍），写后更新台账（本集发生的状态变化全部入账）。批量连写模式：带台账逐集生产，每集写前读账写后对账，伏笔/人物/道具状态全程可查。全剧机检（validate_series.py）查：伏笔超期未收/死人开口/断章缺失/付费墙空缺。

## I — 方法论骨架 (Interpretation)

1. **账目即状态机**：每个实体（伏笔/人/道具/规则）是一个有状态的对象，剧集是状态转移序列。
2. **写前读账是硬门**：不读账开写=蒙眼开车；读账成本远低于穿帮返工。
3. **伏笔有时效**：埋了不收=叙事债务；超期未收由机检捕获。
4. **批量生产的前提**：连写模式的价值全在台账——没台账的连写是批量制造穿帮。
5. **机检兜底**：四类高危穿帮模式（伏笔超期/死人开口/断章缺失/付费墙空缺）机械可查。

## A1 — 应用案例 (Past Application)

- 来源实践：24 集模板中伏笔跨 10+ 集回收（如「30 年前真相」第 11 集埋第 14/19 集收）——全程靠台账跟踪。
- 反例：第 8 集死亡角色第 12 集开口说话（死人开口，台账缺失的典型症状）。

## A2 — 触发场景 (Future Trigger)

- 任何多集连续创作（连写模式前置）。
- 跨集穿帮排查与修复。
- 影策 Agent 批量分集生产的流程约束。

## E — 可执行步骤 (Execution)

1. **开写前读账**：本集涉及的伏笔/人物/道具/规则账目全过。
   *完成标准*：读账记录在案。
2. **写中记账**：本集状态变化实时入账。
   *完成标准*：账目更新与剧本同步。
3. **写后对账**：本集涉及的实体状态与台账一致。
   *完成标准*：对账无差异。
4. **伏笔时效核**：埋的伏笔有计划回收集，无超期。
   *完成标准*：伏笔账无超期项。
5. **机检兜底**：跑全剧机检四模式。
   *完成标准*：四模式全过。
