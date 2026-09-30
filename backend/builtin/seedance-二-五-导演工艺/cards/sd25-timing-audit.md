---
name: sd25-timing-audit
description: 当用户做精确时间线视频（timestamp-30s）或长视频，或"动作挤在一起不自然/台词念不完/情绪在触发前就出现"，或要审计时序合理性时调用。核心能力：时序审计六律（时段连续不重叠且等于总时长/每段给足动作时间/台词容量核算/因果时序/运镜物理兼容/参考只借该借的）。关键触发：时序审计、时间线、台词容量、因果时序、动作太挤、timing audit、对白时长。工位边界：本技能只做时序审计，不产出分镜表生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: Timing and reference rules
tags: [时序审计, 时间线, 台词容量, 因果时序, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "反应永远在听到之后：情绪先于触发出现，就是时序穿帮"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-timing-audit
evidence: E4

---

# 时序审计六律

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director Timing rules）：①**时段连续不重叠且总长等于请求时长**，用一种边界约定（如 0-5s, 5-10s）贯穿；②**每段给足动作时间**——事件太多就减事件，不许把动作压进不可能短的区间；③**台词容量核算**——按可用表演时间审台词，留出听、理解、呼吸、打断、反应的空间；台词太长就删词，不许硬塞不自然语速；④**因果时序**——情绪与物理结果必须有因果：脸在听到台词之后才有反应，身体在接触/受力之后才动；眼泪/笑/脸红/跌倒/恢复不许早于触发出现；⑤**运镜物理兼容**——运镜运动与构图变化、主体运动物理相容；每拍一个主运镜；⑥**参考只借该借的**——重复引用只在要紧处，说清借与不借。

## I — 方法论骨架 (Interpretation):

1. **总时长守恒**：分段加起来必须等于总时长——这是可机械检查的第一条。
2. **事件密度物理上限**：几秒内能发生几件事有物理上限，超了删事件不压时间。
3. **台词要留反应时**：对白时长≠台词字数÷语速，还要听+想+反应。
4. **因果链即时序链**：A 触发 B 才有 B——先果后因是时序穿帮（动作链 QA 法，配 vis-video-universal-rules U9）。
5. **一拍一运镜**：时间线密了运镜必须收敛。

## A1 — 应用案例 (Past Application)

- 来源实践：30s 精确时间线分 6 段，台词容量核算后删掉 12 字——留出反应帧，成片不赶。
- 反例：0-3s 内安排「进门+转身+对话+哭」四事件——物理不可能，模型必糊。

## A2 — 触发场景 (Future Trigger)

- timestamp-30s / 长视频任务。
- 「动作挤/台词赶/反应提前」的修复。
- 影策 Agent 生成时间线后的审计项。

## E — 可执行步骤 (Execution)

1. **总长守恒核**：分段连续不重叠且和=总时长。
   *完成标准*：守恒成立。
2. **事件密度核**：每段事件数物理可行，超了删事件。
   *完成标准*：无超密度段。
3. **台词容量核**：删词保反应时，不塞语速。
   *完成标准*：容量达标。
4. **因果时序核**：反应晚于触发，动作晚于受力。
   *完成标准*：无先果后因。
5. **运镜兼容核**：运镜与构图/运动物理相容，一拍一主运镜。
   *完成标准*：运镜收敛且相容。
