---
name: vis-video-scene-formula
description: 当用户写视频提示词但"写出来像壁纸/没有戏剧感/不知道场景 ready 没有"，或写了一个很美但没有冲突的镜头时调用。核心能力：场景五要素公式（欲望+障碍+空间几何+受控注视+剪辑节奏）+ 齐备才可开写。关键触发：场景公式、没戏剧感、像壁纸、冲突弱、场景 ready 检查、scene formula。工位边界：本技能只做场景五要素自检，不产出分镜表生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "visual-skills video 参考库（GitHub: smixs/visual-skills，CC-BY-4.0，署名 Serge Shima）"
source_chapter: dramaturgy.md §1
tags: [场景公式, 戏剧, 五要素, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "缺一个要素场景就塌成布景——开写前先把五要素各用一句话说清"
skill_type: "framework"
consult_tier: "A（绿区·CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-video-scene-formula
evidence: E4

---

# 场景五要素公式

## R — 原文要点 (Reading)

来源方法（CC-BY-4.0，整理自 smixs/visual-skills dramaturgy §1）：场景 = 英雄的欲望（这一秒具体想要什么）+ 障碍（挡住他的是什么：物/人/恐惧/距离/规则）+ 空间几何（谁站哪、谁占权力位、威胁与逃逸各在哪个方向）+ 受控注视（观众的眼睛被逼去看哪，每帧一个焦点）+ 剪辑节奏（每镜活多久、停顿落哪、切口咬在哪）。**五要素缺一，场景塌成装饰**。开写提示词前，先用一句话分别命名这五个；说不出任何一个，场景就没 ready。

## I — 方法论骨架 (Interpretation)

1. **欲望是"这一秒"的**：不是人物总目标，是此刻此地想要的具体东西——这让每个镜头都有即时张力。
2. **障碍四选一皆可**：物体、他人、恐惧、规则、距离——关键是具体，不能是"生活所迫"这类空词。
3. **空间即权力**：站位本身就是信息——谁居高、谁临门、谁在镜中、谁在阴影。
4. **受控注视是导演指令**：AI 生成没有"焦点"概念，必须在提示词里指定视线落点。
5. **节奏是场景的呼吸**：多镜场景里镜长分配就是情绪曲线（配 vis-video-shot-card 的节奏阶梯用）。

## A1 — 应用案例 (Past Application)

- 好案例：妻子想查丈夫手机（欲望）→ 丈夫翻身挡住（障碍）→ 妻子站床边居高、丈夫坐床沿偏低（空间）→ 观众视线被锁在丈夫挡手机的手（注视）→ 一镜长一镜短（节奏）。
- 反例：男主站在窗边很美——无欲望无障碍无权力关系，纯壁纸。

## A2 — 触发场景 (Future Trigger)

- 用户给一个"很美但不知道在演什么"的分镜/提示词。
- 写多镜叙事前的结构自检。
- 影策 Agent 生成分镜后做场景 ready 校验。

## E — 可执行步骤 (Execution)

1. **命名欲望**：一句话写「谁，在这一秒，想要什么」。
   *完成标准*：欲望句有主体、有时限、有具体对象。
2. **命名障碍**：从物/人/恐惧/距离/规则中选定一个并写实。
   *完成标准*：障碍句可画进画面。
3. **画空间几何**：一句话说清站位与权力关系。
   *完成标准*：几何句含位置对比。
4. **指定注视点**：每帧给一个焦点。
   *完成标准*：焦点句非空且唯一。
5. **配节奏**：给该场景的镜长分配（长/短/停/切）。
   *完成标准*：五要素齐全，开写。
