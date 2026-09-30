---
name: vis-video-three-details
description: 当视频提示词"读着挺好但生成出来很糊/没有质感"，或用户写完提示词要做跑前自检时调用。核心能力：每镜三件套（环境压力+身体微动作+声音/视觉母题）+ 禁用词清单 + 情绪 2-4 个可观测线索。关键触发：生成很糊、没质感、三件套、细节检查、禁词、show don't tell、three-detail check。
source_book: "visual-skills video 参考库（GitHub: smixs/visual-skills，CC-BY-4.0，署名 Serge Shima）"
source_chapter: dramaturgy.md §2 + universal-rules.md §1/§3
tags: [细节三件套, 禁词, show-don't-tell, 提示词自检, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "模型渲染不出情绪名，只渲染得出身体；情绪词是偷懒的占位符，必须换成物理事实"
skill_type: "checklist"
consult_tier: "A（绿区·CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-video-three-details
evidence: E4

---

# 每镜三件套：细节定律与禁词

## R — 原文要点 (Reading)

来源方法（CC-BY-4.0，整理自 visual-skills dramaturgy §2 + universal-rules §1/§3）：**每个镜头必须拥有三个具体物理细节**——①一个环境压力（冰箱冷光/湿沥青/闪烁灯管/水壶蒸汽/一扇下雨的特定窗/空调嗡鸣/紧窄走廊/镜面反射）；②一个身体微动作（咬肌收紧/指节发白/嘴唇压平/眼睛低四分之一/吞咽/手指抵住门框）；③一个声音锚点或视觉母题（2.3 秒的肚子叫/每次转场前同一下荧光闪烁/黑暗玻璃上的倒影/空走廊脚步）。零件套=填充物，一件=单薄，三件齐=强镜。禁用词（偷懒标记）：cinematic / professional / high quality / masterpiece / stunning / epic / amazing / beautiful lighting / dynamic camera / intense moment / powerful scene，以及无身体的情绪名（he is sad / she is angry）。情绪→生理校准：一次情绪过渡用 **2-4 个可观测线索**（眼神、眉、嘴、呼吸、喉吞咽、手）即可，少了模型猜，多了像过演。

## I — 方法论骨架 (Interpretation)

1. **模型只渲染身体**：「他害怕」不可渲染；「咬肌收紧、停止呼吸一拍、手指抵住门框」可渲染——所有情绪必须做身体翻译。
2. **细节与功能对应**：场景公式→环境压力；三职法则→身体微动作；母题锚→声音/视觉母题。细节组与戏剧功能不匹配，功能就落不了屏。
3. **建立镜头/产品/转场镜无豁免**：「establishing」「hero product」「transition」恰恰是最先犯懒的镜头——禁词在这里密度最高。
4. **环境压力=角色的天气**：每场只挑一个环境压力让它扛情绪（闪烁灯=衰败，窗上雨=克制的悲，蒸汽=压住的怒，空调嗡鸣=解离，夜湿沥青=内疚，窄廊=四面收拢，镜面=自我清算）。

## A1 — 应用案例 (Past Application)

- 来源方法示范：坏「he is scared」→ 好「His jaw locks. He stops breathing for one beat. His fingers curl against the doorframe.」
- 空镜填细节：城市空镜配上「同一扇下雨的窗在每次转场出现」（母题锚），空镜从填充物变成结构部件。

## A2 — 触发场景 (Future Trigger)

- 任何提示词提交前的跑前自检（配合 seedance-7-pitfalls）。
- 生成结果「和写的方向对但就是没感觉」的诊断第一步。
- 影策 Agent 的提示词编译产物做三件套机械审计。

## E — 可执行步骤 (Execution)

1. **逐镜过三件套**：每镜检查环境压力/身体微动作/声音或母题锚是否各有一个。
   *完成标准*：三件套逐镜登记在案。
2. **扫禁用词**：cinematic 类 + 无身体情绪名全部替换成物理事实。
   *完成标准*：禁用词零残留。
3. **情绪线索计数**：每次情绪过渡 2-4 个可观测线索。
   *完成标准*：线索数在区间内。
4. **环境压力唯一性**：每场只保留一个环境压力。
   *完成标准*：无同场双压力。
5. **空镜补件**：establishing/transition/hero 镜优先补件。
   *完成标准*：无零件套镜头残留。
