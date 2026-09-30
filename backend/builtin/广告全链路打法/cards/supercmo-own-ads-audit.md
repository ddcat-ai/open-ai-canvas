---
name: supercmo-own-ads-audit
description: 当用户要复盘自己品牌在投的广告（什么在跑长/什么被停/已经覆盖了哪些角度），或想知道"我家的广告矩阵缺哪块"时调用。核心能力：自家广告七步审计（与竞品调研共用台账机工）+ 自有视角三问（什么在hold/已覆盖什么/与竞品差在哪）。关键触发：复盘我的广告、自家广告审计、在投广告分析、广告矩阵、缺什么角度。工位边界：只做审计不生成；决定下次做什么是策划技能的活。信息边界：影策 Agent 无视觉通道，看片拆解需用户提供逐秒笔记或转交视觉模型，不得声称看见画面。
source_book: "superCMO analyzing-own-ads（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-6
tags: [广告复盘, 自有广告审计, 投放时长, 覆盖矩阵, 证据纪律, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "审计自家=同一套台账机工换对象：结论仍须带 ref 和计数，且要回答'已覆盖什么'而不只是'什么在跑'"
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
source_card: superCMO 广告链路/supercmo-own-ads-audit
evidence: E4

---

# 自有广告审计：自家矩阵的台账复盘

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO analyzing-own-ads）：**Research only**。与竞品调研共用同一套台账机工（定范围一次问全→live/stopped 分开拉→建台账→批量看片→对照台账出模式→先答用户问题），深度档位相同（quick 保留 30+30 看 10+10 / detailed 60+60 看 20+20）。对象换成自家后的三个特有视角：①**什么在 hold**（长投的自家广告做对了什么——这是要被继承的资产）；②**已经覆盖什么**（自家矩阵已占的角度/格式/人群——避免下一步自产重复）；③**与竞品的差**（自家停掉的 vs 竞品在跑的，是市场信号不是内部意见）。同样纪律：模式必须对照台账、带 ref 和计数；看的是长投端样本要声明偏斜；覆盖段（coverage）的限额行原样进审计。

## I — 方法论骨架 (Interpretation)

1. **换对象不换机工**：审计自家不发明新流程——台账七步原样复用，本卡只补自有视角。
2. **已覆盖是和竞品报告的最大差**：竞品报告答"外面有什么"，自家审计先答"我有什么"——没有后者就会重复生产。
3. **自家停vs竞品在跑=市场判决**：自己投死的角度竞品还在跑，要么有你没看到的变量，要么是受众错配——值得逐条对照。
4. **长投是资产**：自家跑得久的是被钱验证过的，审计结论要能直接喂给下一步策划。

## A1 — 应用案例 (Past Application)

- 床垫客户：自家 46 条广告审计，live 集 80% 是"压力测试"类钩子 → 覆盖段明示此角度已饱和；同时 stopped 集里"夫妻分床"类被停而竞品 live 集有 3 条在跑 → 触发对该角度的二次审查（受众错配而非角度失效）。
- 反例：审计只数列了"在投 12 条"就结束——没有覆盖矩阵，下一步策划又做了一条压力测试，自家左兜掏右兜。

## A2 — 触发场景 (Future Trigger)

- 「帮我复盘下我投的广告」
- 「我的广告矩阵全不全？」
- 「这个角度我是不是做过了？」
- 「竞品在跑的我自己停过，为什么」

## E — 可执行步骤 (Execution)

1. **套用台账七步**（见竞品调研卡）：定范围→拉取→台账→看片→模式。完成标准：台账+拆解齐备。
2. **答三问**：什么在 hold / 已覆盖什么 / 与竞品差在哪。完成标准：三问各有 ref+计数支撑。
3. **写覆盖矩阵**：角度×格式×人群的已占空格。完成标准：矩阵无发明格。
4. **交付**：先答用户问题，2-3 个核心发现附计数。完成标准：结论可指回台账。

## B — 边界 (Boundary)

- **不生成不建议**：审计产物是事实，不是"你该做什么"。
- **不重造流程**：台账机工与竞品调研卡共用，本卡不复制其步骤细节。
- **影策适配边界**：同竞品调研卡——看片依赖用户笔记或视觉模型转交；拉取依赖用户提供的数据。
