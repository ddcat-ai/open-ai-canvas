---
name: shortfilm-ip-safety
description: 当用户提示词里要写具体 IP 名/品牌名/明星名/电影名，或生成报错疑似 IP 屏蔽，或要做动画改真人、同人二创类内容时调用。核心能力：IP 安全三级处置（自创触发短语替代/保留结构去专名/平台差异表）+ Seedance 屏蔽 IP 名的事实。关键触发：IP名、品牌名、明星名、被屏蔽、报错、侵权风险、IP safety、同人。
source_book: "shortfilm-prompt（GitHub: jnMetaCode/ai-shortfilm-prompts，MIT License）"
source_chapter: SKILL.md Step 4 + anime-to-real 模板
tags: [IP安全, 平台差异, 自创短语, 合规, AI生成友好]
layer_confidence: "candidate"
pack: shortfilm-prompt 短片五段式
core_stance: "用自创触发短语达到同样的戏剧功能，而不是裸写被屏蔽的专名"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
source_license: "MIT"
source_url: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
first_seen: 2026-09-21
source_card: shortfilm-prompt 短片五段式/shortfilm-ip-safety
evidence: E4

---

# IP 安全处置与平台差异

## R — 原文要点 (Reading)

来源方法（MIT，整理自 shortfilm-prompt）：模型对 IP 名态度各异——**Seedance 屏蔽 IP 名**；可灵（Kling）对 IP 名更宽松；Sora 偏好简洁提示词。处置手法——**自创触发短语**：把具体 IP 词换成自造的咒语式短语（如把某招式名写成「whispered self-coined syllable」自吟音节），达到同样的戏剧触发功能但不裸写专名。**保留结构去专名**：参考某作品的桥段时，保留节拍结构、去掉专名与标志性台词。平台合规另有一票否决类（暴力用写意替代等，见 factory-machine-check）。

## I — 方法论骨架 (Interpretation)

1. **功能等价替代**：IP 词在提示词里的作用是触发模型的风格/动作先验——用自创短语触发同类先验即可。
2. **结构可仿表达不抄**：节拍/机位/节奏可以学；专名/台词/标志性画面元素不抄。
3. **平台差异表常备**：同一提示词在不同平台的 IP 容忍度不同，出多平台版本时按平台改写。
4. **报错归因**：generation failed 且文案涉审核时，先查 IP 词与敏感词（配 onlyshot-sensitive-words）。

## A1 — 应用案例 (Past Application)

- 来源实践：触发短语写成「whispered self-coined syllable」而非具体 IP 词——Seedance 通过且功能等价。
- 动画改真人：保留原作节拍结构，角色名与标志性台词全部自创替换。

## A2 — 触发场景 (Future Trigger)

- 用户提示词含 IP/品牌/明星/电影名。
- 多平台分发同一内容前的平台化改写。
- generation failed 的审核归因排查。

## E — 可执行步骤 (Execution)

1. **扫专名**：IP/品牌/明星/电影/游戏名逐个标出。
   *完成标准*：专名清单成表。
2. **自创替代**：每个专名写自创触发短语（保留戏剧功能）。
   *完成标准*：替代短语与功能对应。
3. **结构剥离**：参考桥段保留节拍、去专名与标志台词。
   *完成标准*：无标志性表达残留。
4. **平台适配**：按目标平台 IP 容忍度出对应版本。
   *完成标准*：平台版本分明。
5. **归因回查**：若失败，先查专名与敏感词再查其他。
   *完成标准*：归因顺序正确。
