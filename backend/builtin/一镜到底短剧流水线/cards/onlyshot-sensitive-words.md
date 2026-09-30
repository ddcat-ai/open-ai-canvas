---
name: onlyshot-sensitive-words
description: 当 prompt 反复报"generation failed/内容审核"类失败，或 prompt 里有反派、暴力、暧昧、面部特写描述时调用。核心能力：四类敏感词替换表（反派词/暧昧词/中文敏感词/街拍词）+ 颜色词 dark 改 deep 可消除约九成误触。关键触发：审核不过、内容被拦、敏感词、反派描写被拒、面部特写被拒。
source_book: "OnlyShot 即梦失败模式与敏感词清单 v0.1.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: references/jimeng-failure-modes.md §2
tags: [敏感词, 内容审核, 替换表, 反派词, 暧昧词, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "反派戏不靠反派词靠氛围词；写凶狠不如写阴沉——审核模型拦的是词不是戏"
skill_type: "checklist"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-sensitive-words
evidence: E4

---

# 四类敏感词替换表

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot jimeng-failure-modes §2）：四类高频审核触发词——①反派/邪恶词：sinister→moody、menacingly→leans forward、dark intent→quiet/focused、possessive→focused、cold smirk→subtle smirk、dark shadows engulf→shadows along edges；颜色类 dark X→deep X 可消除约 90% 触发。②暧昧/亲密词：blush on cheeks→rose tint on surface、extreme close-up（面部）→medium shot、internal warm glow→删除、pulsing softly→glowing steadily。③中文敏感词：「反派」「磕」「不死心」等直接删或改写。④街拍/拟真词：strolls past camera→walks across stage center。关键洞察：`extreme close-up`+面部细节描述（blush/cheeks/lips）= 必触发面部审核。

## I — 方法论骨架 (Interpretation)

1. **氛围替换原则**：反派戏的「凶」用氛围词表达（moody/cool/quiet/focused/dramatic），不用语义直白的反派词——要的是「观众觉得危险」，不是「模型认识的危险词」。
2. **触发看语境**：同一个词在不同位置触发率不同（如 sinister 用于角色描述必触发、用于光影描述偶发）——替换优先处理「角色/情感」语境。
3. **面部特写高危**：镜头语言与面部细节描述组合是审核重灾区，特写需求改用中近景或把细节词中性化。
4. **中文也审**：字幕/弹幕段的中文词同样触发，最后再清一遍中文。

## A1 — 应用案例 (Past Application)

- 来源 case B：`sinister + dark intent + possessive + 中文「反派」`三连败；全换 `moody + quiet + focused + 「还在惦记」`一次过。
- 来源 case A：`extreme close-up + blush on cheeks + internal glow` 三连败；改 `medium shot`+删除红晕词一次过。

## A2 — 触发场景 (Future Trigger)

- generation failed 类失败确诊为内容审核后。
- 写反派戏、冲突戏、面部特写镜头的 prompt 时预防性替换。
- 影策 Agent 组装分镜 prompt 后的跑前自检项。

## E — 可执行步骤 (Execution)

1. **扫描四类词**：按反派词→暧昧词→中文敏感词→街拍词顺序扫 prompt。
   *完成标准*：扫描有清单记录，命中词逐个标出。
2. **查表替换**：严格按替换表改写，不自由发挥同义词（发挥词可能同样触发）。
   *完成标准*：每个命中词有查表替换记录。
3. **颜色降级**：所有「dark X」颜色改「deep X」。
   *完成标准*：prompt 无 dark+颜色组合。
4. **面部降险**：特写+面部细节组合改为中景或删除细节词。
   *完成标准*：无 extreme close-up 与面部细节词并存的句子。
5. **复测**：替换后重新提交验证；仍失败则回失败分诊卡重新归因。
   *完成标准*：替换后通过或转回分诊流程。
