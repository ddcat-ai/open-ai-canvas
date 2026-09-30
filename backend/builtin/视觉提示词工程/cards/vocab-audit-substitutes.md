---
name: vocab-audit-substitutes
description: 当用户提示词写完要做词汇级质检，或生成结果"某些元素总不对/风格词不生效/画面油腻"，或提示词里有文学化抽象词、生僻词、情绪名、增压词时调用。核心能力：三类问题词审查（增压词/拗口罕用词/歧义与情绪名）+ 替代词表（每个问题词给功能等价替代）+ 替代后功能核对。关键触发：词汇审查、拗口词、替代词、禁词、增压词、抽象词、词汇替换、vocab audit、substitute。
source_book: "visual-skills 禁词表 + OnlyShot 敏感词替换表 + short-drama-factory 台词纪律（CC-BY-4.0 / MIT）"
source_chapter: universal-rules 禁词 + jimeng-failure-modes 替换表 + dialogue-doctor
tags: [词汇审查, 替代词, 增压词, 拗口词, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "换词必须功能等价：替代不是美化，是把同一个戏剧功能从坏载体搬到好载体"
skill_type: "checklist"
consult_tier: "A（绿区·CC-BY/MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vocab-audit-substitutes
evidence: E4

---

# 生图词汇审查与替代词表

## R — 原文要点 (Reading)

综合方法（整理自 visual-skills 禁词表 + OnlyShot 替换表 + short-drama-factory 台词纪律）：**三类问题词**——①**增压词**（零渲染信息，只占权重）：cinematic / professional / high quality / masterpiece / stunning / epic / amazing / beautiful lighting / dynamic camera / intense moment / powerful scene / 4k；②**拗口罕用词与过度文学化表达**（token 化不一致，模型自由发挥）：生僻词、自造复合词、拉丁术语、「岁月的痕迹」类散文词；③**歧义词与无身体情绪名**（模型无法渲染或渲染不稳定）：he is sad / she is angry / dark X 系列颜色词 / extreme close-up 面部 / blush on cheeks / strolls past camera。**替代词表（功能等价替换）**：cinematic → slow push-in, shallow depth of field, 50mm；beautiful lighting → soft key from window, rim light；dynamic camera → slow dolly-in / tracking shot（具体运镜）；epic → 具体规模（vast scale, hundreds of figures）；岁月的痕迹 → located imperfections（specific wear at a specific spot）；he is sad → jaw locks, eyes drop a quarter-inch；dark cyan → deep cyan；sinister → moody；extreme close-up face → medium close-up；blush on cheeks → rose tint on surface；strolls past camera → walks across stage center。中文场景注意：中文 1 字符=1 计数，分词粒度影响 token 化——中文 prompt 优先短句+常用词。

## I — 方法论骨架 (Interpretation)

1. **词汇审计先于结构审计**：坏词占着权重位置，结构再好也出不来——先扫词再查结构。
2. **功能等价是替换底线**：替代词必须触发同一戏剧/视觉功能，不许为换而换丢信息。
3. **具体即真实**：所有抽象词的出路是「可拍摄的物理事实」——这是唯一方向。
4. **拗口词三策**：生僻→同义常用；自造复合→拆分描述；术语→通俗英语。
5. **审核词单列**：触发审核的词（反派/暧昧/街拍）走 onlyshot-sensitive-words 全表，本卡只管渲染质量维度。

## A1 — 应用案例 (Past Application)

- 来源实测：sinister + dark intent + possessive 三连 generation failed；全换 moody + quiet + focused 一次过（功能等价：都表达「危险感」，载体从审核词换成氛围词）。
- 来源实测：extreme close-up + blush on cheeks 触发面部审核；改 medium shot + rose tint 保留「亲密特写」功能且过审。

## A2 — 触发场景 (Future Trigger)

- 任何提示词提交前的词汇级自检（第一道关）。
- 生成结果局部失控/风格词不生效的归因。
- 中文 prompt 写英文前的用词校对。

## E — 可执行步骤 (Execution)

1. **扫三类词**：增压词→拗口文学词→歧义/情绪名，逐个标出。
   *完成标准*：问题词清单成表。
2. **查表替换**：按替代词表逐个换（无表内项按「可拍摄物理事实」原则自撰）。
   *完成标准*：每个问题词有替代记录。
3. **功能核对**：替代前后戏剧/视觉功能一致，无信息丢失。
   *完成标准*：功能等价可说明。
4. **审核词分流**：命中审核类的转 onlyshot-sensitive-words 全表处理。
   *完成标准*：审核类词单独处置。
5. **复测**：替换后重新提交；仍异常回退查结构层。
   *完成标准*：复测通过或转结构诊断。
