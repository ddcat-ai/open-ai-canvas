---
name: shortfilm-multi-shot-lock
description: 当用户要做多镜剪辑片（3 镜以上）且担心"第 3-4 镜开始角色漂移/氛围跑偏"，或要开写多镜叙事前做准备时调用。核心能力：两把锁——主体登记表（每个主体的不变特征清单）+ 氛围锁定（色调/光线/质感基调），写第一镜前必落。关键触发：多镜漂移、主体登记、氛围锁定、multi-shot、consistency lock、跨镜一致。
source_book: "shortfilm-prompt（GitHub: jnMetaCode/ai-shortfilm-prompts，MIT License）"
source_chapter: SKILL.md Template library — project-planner §1-§2
tags: [多镜一致性, 主体登记, 氛围锁定, AI生成友好]
layer_confidence: "candidate"
pack: shortfilm-prompt 短片五段式
core_stance: "多镜片撑不撑得住，在第一镜之前就已经决定了——锁不牢，后面全漂"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
source_license: "MIT"
source_url: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
first_seen: 2026-09-21
source_card: shortfilm-prompt 短片五段式/shortfilm-multi-shot-lock
evidence: E4

---

# 多镜两把锁：主体登记 + 氛围锁定

## R — 原文要点 (Reading)

来源方法（MIT，整理自 shortfilm-prompt project-planner）：3+ 镜剪辑片开写前必走两节——**Section 1 主体登记表**：为每个主体登记不可变特征（脸型/发型发色/服装单品/标志配件/体型），后续每镜的身份块从登记表抄；**Section 2 氛围锁定**：锁定全片色调（色板+色温）、光线基调（主光性质/对比度）、质感（胶片/数字/颗粒度）——后续每镜的氛围词从锁定区抄。这两步是「多镜片撑得住还是第 3-4 镜就漂」的**最大单一预测因子**。

## I — 方法论骨架 (Interpretation)

1. **登记表是唯一身份源**：每镜身份块从登记表抄，不现场编——现场编 = 漂移起点。
2. **氛围词是封闭集**：全片氛围词从锁定区取，不引入锁外词——锁外词 = 气氛破裂。
3. **镜头内可变/片间不变**：主体与氛围跨镜锁死，动作与机位镜内自由。
4. **与上游工具链对齐**：登记表可映射为参考图集（@图N 身份锚）+ 每镜提示词重抄（配 vis-video-universal-rules U7）。

## A1 — 应用案例 (Past Application)

- 来源实践：宠物一生叙事 full worked example 中，主体（狗）的五项不变特征逐镜重抄，跨 6 镜零漂移。
- 反例：无登记表现场编外貌——第 3 镜狗从中型犬变大型犬。

## A2 — 触发场景 (Future Trigger)

- 任何 3 镜以上的多镜叙事/广告/短剧。
- 跨镜一致性出问题后的补锁。
- 影策 Agent 生成多镜提示词序列前的准备步骤。

## E — 可执行步骤 (Execution)

1. **建主体登记表**：每主体列不变特征（≥5 项）。
   *完成标准*：登记表覆盖全部出场主体。
2. **锁氛围三件**：色板+光线基调+质感。
   *完成标准*：氛围锁定区成文。
3. **逐镜抄锁**：每镜身份块与氛围词从两锁区抄写。
   *完成标准*：逐镜可溯源到锁定区。
4. **锁外词扫描**：检查每镜无锁外氛围词。
   *完成标准*：零锁外词。
5. **漂移回查**：成片对照登记表验收，漂移即补锁重生。
   *完成标准*：验收记录在案。
