---
name: vis-video-shot-card
description: 当用户要把一个想法拆成分镜表，或分镜表缺字段、镜头间衔接乱、节奏一马平川时调用。核心能力：三层分镜法（戏剧节拍→镜头功能→剪辑节奏）+ 14 字段镜头卡 + 节奏阶梯 + 60-90 秒节拍图。关键触发：分镜表、shot card、14字段、节拍图、节奏阶梯、镜头功能、拆镜。
source_book: "visual-skills video 参考库（GitHub: smixs/visual-skills，CC-BY-4.0，署名 Serge Shima）"
source_chapter: dramaturgy.md §10-§12
tags: [分镜表, 镜头卡, 节拍图, 节奏阶梯, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "分镜是三层建筑：先节拍后功能再节奏——跳层施工出来的都是漂亮空壳"
skill_type: "template"
consult_tier: "A（绿区·CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/smixs/visual-skills"
source_license: "CC-BY-4.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-video-shot-card
evidence: E4

---

# 三层分镜法与 14 字段镜头卡

## R — 原文要点 (Reading)

来源方法（CC-BY-4.0，整理自 visual-skills dramaturgy §10-12）。**三层分镜法，按序施工**：第一层戏剧节拍（60-90 秒可靠节拍图：0-5s 钩子主角已在张力中/5-15s 语境/15-30s 压力/30-45s 破裂（一个细节打破主角立场）/45-60s 加速切口变短/60-75s 撞击决定/75-90s 余波；破裂与撞击永不可跳）；第二层镜头功能（Establish 建立/Power 权力/Pressure 压力/Detail 细节/Reaction 反应/Shift 转变/Impact 决定帧/Aftermath 余波/Exit 结尾像——这是电影语法，其余皆装饰壁纸）；第三层剪辑节奏（阶梯式：长-更短-更短-停顿-撞击；8-10 秒蒙太奇内部结构示例 4s→2s→1s→0.5s→0.33s→0.25s→2s 静默→1s 决定；**撞击前的停顿比切得快更重要**，无停顿的速度是绞肉机）。**14 字段镜头卡**：镜头 ID/节拍/情绪/景别/构图/运镜/运动理由（回答「什么变了」）/动作/视线轨迹/时长/切型（匹配切/碎切/动作切/J-cut/L-cut）/声音/光色/制作备注——字段空=指令缺，要么填要么删镜头。节奏阶梯：慢燃剧 4s-4s-3s-2s-1s-停顿-2s；商业产品弧另档。

## I — 方法论骨架 (Interpretation)

1. **节拍图是因果脊**：节拍图假定故事有因果脊；若故事形状未定（无对手/单一顶点时刻/刻意开放结尾），先选故事弧再铺节拍——把因果节拍图铺在没有脊的故事上，就会忙而空。
2. **功能标签是检索键**：给每镜打功能标签，后续 AI 生成可按功能匹配运镜与景别，也为删减提供依据（配 vis-video-three-jobs）。
3. **运动理由必填**：每个运镜必须回答「什么变了」——没变就是固定镜头（芬奇法则）。
4. **停顿是设计**：节奏阶梯里停顿是独立节拍，不是没有节奏。
5. **14 字段是检查表**：空字段=缺指令，这是机械可检的。

## A1 — 应用案例 (Past Application)

- 来源 8-10 秒蒙太奇内部结构：宽 4s 进入→中 2s 注意物件→特写 1s 眼睛→宏观插入 0.5s→手 0.33s→细节 0.25s→2s 突然静默→1s 决定——撞击前 2 秒停顿让后面 1 秒的决定有重量。

## A2 — 触发场景 (Future Trigger)

- 用户给一句话创意，要拆成可执行分镜表。
- 已有分镜表节奏平/镜头衔接怪。
- 影策 Agent 生成分镜数据（多维表格分镜行）时的字段完备性校验。

## E — 可执行步骤 (Execution)

1. **铺节拍图**：按时长比例铺 0-5/5-15/15-30/30-45/45-60/60-75/75-90 节拍（缩短比例压缩）。
   *完成标准*：破裂与撞击位有内容。
2. **标镜头功能**：每镜打九类功能标签之一。
   *完成标准*：功能标签全覆盖。
3. **配节奏阶梯**：按长-短-短-停-撞分配时长，撞击前留停顿。
   *完成标准*：阶梯形态成立且停顿在位。
4. **填 14 字段**：逐镜填全镜头卡。
   *完成标准*：零空字段（或删镜头）。
5. **理由终查**：每个运镜有「什么变了」的理由句。
   *完成标准*：理由句非空。
