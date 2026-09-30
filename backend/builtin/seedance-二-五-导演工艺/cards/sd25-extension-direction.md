---
name: sd25-extension-direction
description: 当用户要延长已有视频（"再长一点/接着演/往前补"），或延长结果"接不上/方向错了/原片被改"时调用。核心能力：延长方向归一化（prepend-before/append-after 二选一必问）+ 只描述新增区间 + 首尾帧交接规则 + 禁模糊方位词。关键触发：延长视频、续写、往前补、往后接、extend、方向歧义、接不上。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: Mode-specific invariants — Extension
tags: [视频延长, 方向归一化, 首尾帧交接, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "方向不问清不动笔：『向前续写』这类歧义短语是延长任务的第一杀手"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-extension-direction
evidence: E4

---

# 延长方向归一化与交接规则

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director Extension 不变量）：**方向必须归一化**为 `prepend-before-source`（新增在原片前）或 `append-after-source`（新增在原片后）——**严禁依赖「向前续写/前向续写/往前延长/向后续写/后向续写」等歧义短语**。用户没有明说新增片段放前还是放后、没有连首帧还是连尾帧时，**必须问**「新增片段放在原片之前，还是原片之后？」——不答不动笔，不凭剧情推断。**交接规则**：prepend 的新增区间必须结束在原片第一帧并交接进去；append 的新增区间必须从原片最后一帧开始。**只描述新增区间**：写明放置位置与新增时长；原区间必须保持原样；要求自然的动作/运镜/光线/声音/空间连接；禁止无解释的重置与凭空出现的物件。另：生成时长参数选「新增部分」时长（配 seedance-extend-edit）。

## I — 方法论骨架 (Interpretation):

1. **歧义短语零容忍**：中文方位词在时序上是模糊的，必须二值化。
2. **不问不动笔**：方向错=整段白生成——这是必须问的少数问题之一。
3. **交接帧是物理锚**：prepend 对首帧、append 对尾帧，交接点写死。
4. **原片不动**：延长任务的原区间是常量，只有增量在变量区。
5. **自然连接四要素**：动作/运镜/光线/声音的连续性都要在新增区间收尾或起头处理。

## A1 — 应用案例 (Past Application)

- 来源实践：用户「延长 5 秒」→ 问「放前还是放后？」→ 答「后」→ append 模式，新增 5s 从原片尾帧起，原片零改动。
- 反例：把「向前续写」自行理解为 append——用户本要前置补因，成片因果倒置。

## A2 — 触发场景 (Future Trigger)

- 任何延长/续写任务。
- 「接不上」的诊断（先查方向与交接帧）。
- 影策 Agent 调度延长任务前的必问项。

## E — 可执行步骤 (Execution)

1. **归一化方向**：prepend/append 二值确认（用户明说或必问）。
   *完成标准*：方向二值确定，无歧义短语。
2. **定时长**：新增区间时长=生成长度参数。
   *完成标准*：参数与新增时长一致。
3. **定交接帧**：prepend 对首帧/append 对尾帧。
   *完成标准*：交接帧写进提示词。
4. **只写增量**：只描述新增区间+放置位置，原片不动。
   *完成标准*：无对原区间的内容描述。
5. **连接四要素**：动作/运镜/光线/声音连续性声明+禁凭空物件。
   *完成标准*：四要素在位。
