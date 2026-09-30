---
name: vis-video-universal-rules
description: 当用户要写任意视频模型的通用提示词，或多镜序列里角色长相漂移、提示词前后矛盾、一个 5 秒镜头塞了三种运镜时调用。核心能力：通用十层骨架 + 权重前置 + 一镜一运镜 + 镜头语言表 + 时长纪律 + 一致性锚块 + 禁矛盾。关键触发：通用规则、骨架、权重前置、一镜一动、镜头语言、矛盾、一致性锚、duration discipline。工位边界：本技能只做视频提示词通用规则，不产出风格资产库；后者由上游市场技能『名导十五秒视频风格资产引擎』等负责，两者接力不抢戏。
source_book: "visual-skills video 参考库（GitHub: smixs/visual-skills，CC-BY-4.0，署名 Serge Shima）"
source_chapter: universal-rules.md U1-U14
tags: [通用规则, 提示词骨架, 一致性锚, 镜头语言, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "模型没有跨次记忆：每个镜头都像给一个失忆的聪明实习生下简报——身份块每镜重抄"
skill_type: "framework"
consult_tier: "A（绿区·CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
upstream_defer: ["名导十五秒视频风格资产引擎"]
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-video-universal-rules
evidence: E4

---

# 视频提示词通用规则 U1-U14

## R — 原文要点 (Reading)

来源方法（CC-BY-4.0，整理自 visual-skills universal-rules.md）：**U1 十层骨架**（主体/人物→动作/运动→场景/环境→运镜/镜头/焦段→灯光/氛围→风格/情绪/色调→声音/音频→时长/画幅/分辨率→连续性规则→负向约束[仅模型支持时]）；**U2 权重前置**——生成器对前 30-40% token 注意力最高，主体与动作领先，风格修饰垫后，运镜灯光环境居中；**U4 自然语言胜过标签堆砌**——视频模型不是图像模型，masterpiece/4k/cinematic 堆叠必败，要写成给人类摄影指导下的简报；**U5 一镜一主运镜**——5 秒里别堆三种运镜，至多加一层微调（手持轻晃/轻微 rack focus）；**U6 精确镜头语言**——24mm 沉浸宽/35mm 纪实自然/50mm 亲密人视/85mm 人像压缩/100mm 微距质感/变形宽银幕 40mm；**U7 一致性锚**——身份块置每镜开头，多镜序列每镜重抄全量身份块（脸型/瞳色/肤色/发色长度造型/须/服装单品/标志性配件），视频生成器无跨次记忆；**U8 禁矛盾**——模型服从最强信号，「静水+流动」「特写+大风景」「安静时刻+爆炸动作」必出工件；**U10 时长纪律**——多数模型 5-10 秒一段，长叙事切段剪，别把 30 秒故事塞进 5 秒提示词；**U9 后果提示**——描述动作后果而非动作本身（轮胎溅起水幕/瓶盖真的被拧开/撞击把表面碎成蛛网）；**U13 参考纪律**——每个参考说清借什么不借什么。

## I — 方法论骨架 (Interpretation)

1. **骨架即优先级**：十层顺序不是排版是权重——前 30-40% token 决定模型主要注意力。
2. **每镜失忆假设**：身份块重抄不是冗余是保险；跨镜一致性靠重抄不靠记忆。
3. **矛盾检测可机械**：同镜内反义词对（静/动、特写/全景）可列表扫描。
4. **因果链即质检**：动作链环环相因（A 迫使 B），链断了就是生成失败的自检信号。
5. **模型语法叠在通用规则上**：模型专属骨架不替代通用规则（Seedance 11-block 为上置特化）。

## A1 — 应用案例 (Past Application)

- 来源示范：坏「He is scared」→ 好「His jaw locks. He stops breathing for one beat. His fingers curl against the doorframe.」（U3 show-don't-tell）
- 后果提示示范：「tires kick up water curtains」「the hand grips the jar and the lid actually unscrews」——动作有物理后果才可信。

## A2 — 触发场景 (Future Trigger)

- 写任何视频模型提示词的默认底座规则。
- 多镜序列一致性排查。
- 影策 Agent 编译多镜视频提示词时逐镜校验身份块。

## E — 可执行步骤 (Execution)

1. **骨架铺层**：按 U1 十层顺序组装，主体动作领先、风格垫后。
   *完成标准*：层序正确无缺层。
2. **身份块重抄**：多镜序列每镜开头重抄全量身份块。
   *完成标准*：逐镜身份块一致。
3. **运镜收敛**：每镜一个主运镜+至多一层微调。
   *完成标准*：单镜运镜数 ≤2。
4. **矛盾扫描**：同镜扫反义/互斥词对。
   *完成标准*：零矛盾对。
5. **因果链自检**：动作链每步有后果描述，链断即补。
   *完成标准*：动作链完整。
