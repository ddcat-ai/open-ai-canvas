---
name: supercmo-ugc-mode-select
description: 当用户要做 UGC 素人带货视频，或分不清"这条该按开箱/试穿/教程还是测评做"，或多人出镜时角色分配混乱时调用。核心能力：UGC 四模式选择器（review/unboxing/try-on/tutorial + 优先规则）+ 出厂默认集（9:16/seedance-2.0-fast 带音频/硬切无转场）+ 访谈捆绑纪律。关键触发：UGC、素人口播、开箱、试穿、教程、测评、模式选择、talking head。工位边界：本技能只做UGC 模式选择与默认参数，不产出带货视频全流程；后者由上游市场技能『TikTok网红带货视频』等负责，两者接力不抢戏。
source_book: "superCMO generating-ugc-videos（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-3
tags: [UGC, 模式选择, 默认参数, 访谈纪律, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "模式按内容本质判不按语气判：拆封就是开箱，最终穿上身就是试穿，编号步骤就是教程"
skill_type: "framework"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
upstream_defer: ["TikTok网红带货视频"]
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-ugc-mode-select
evidence: E4

---

# UGC 四模式选择器

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO generating-ugc-videos）：**范围界定**：画面里必须有人拿着产品——无人出镜走通用视频技能；品牌声量的精制广告（主持人扮演角色）走品牌广告技能，即使有人出镜。**出厂默认集（每次必守，不重复问）**：交付 9:16 除非用户要 16:9；clip 模型 seedance-2.0-fast 带音频除非用户点名；分镜表 gpt-image-2 16:9；片段数由时长定；片段间**硬切、无转场**。**四模式**：①review 测评（手持产品讲）②unboxing 开箱（拆到达包装）③try-on 试穿（穿上身：服装鞋履配饰）④tutorial 教程（编号步骤/怎么用）。**相撞优先规则**：封包装在镜头前被拆→开箱；产品最终穿上身→试穿（哪怕为拿它先拆了包）；编号步骤或「怎么用」→教程；没得拆没得穿没步骤→review。**访谈纪律**：brief 已定就跳过提问；否则一次问全（产品/时长/照片里的人是否出镜/有无包裹照片，各带情境）并留自由文本出口；用户弃问则取 15 秒+一句话声明默认值继续。**素材事实纪律**：每张图的用途由 brief 定不由内容定（画面里有人不等于选角照）；没有产品不猜——它成为第一个要问的事。

## I — 方法论骨架 (Interpretation)

1. **模式按本质判**：拆封/上身/步骤/手持是内容结构，不是语气标签。
2. **默认集是效率**：已决事项不重复问——每次重新决定已决参数是噪音。
3. **捆绑提问**：关键缺口一条消息问全，禁挤牙膏。
4. **用途由 brief 定**：素材角色是导演决定不是模型猜。
5. **产品图优先**：拍到的产品胜过描述的产品——等图到了再动工。

## A1 — 应用案例 (Past Application)

- 来源实践：床垫 30 秒素人口播→无拆无穿无步骤→review 模式；开场 3 秒钩子按 hook-patterns 选型。
- 相撞裁决：服饰品牌「拆包裹+穿上身」→按优先规则定 try-on，开箱仅作为前置画面。

## A2 — 触发场景 (Future Trigger)

- 用户要做 UGC/带货/素人视频。
- 模式拿捏不准（拆+穿+步骤混合）。
- 影策 Agent 生成 UGC 视频前的参数决策。

## E — 可执行步骤 (Execution)

1. **定范围**：有人持产品？是→继续；否→转通用视频路线。
   *完成标准*：范围判定明确。
2. **套默认集**：9:16/seedance-2.0-fast 音频/硬切，用户明确参数优先。
   *完成标准*：默认集套用+例外已声明。
3. **判模式**：按四模式+相撞优先规则定唯一模式。
   *完成标准*：模式唯一且理由可述。
4. **捆绑访谈**：缺口一条消息问全（或弃问答默认）。
   *完成标准*：单轮问全或默认声明。
5. **素材核籍**：每张图用途由 brief 定，无产品则先要图。
   *完成标准*：素材用途表成文。
