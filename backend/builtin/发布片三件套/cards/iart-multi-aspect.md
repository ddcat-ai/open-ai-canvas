---
name: iart-multi-aspect
description: 当用户要"一条素材多平台发"（16:9/9:16/1:1 多画幅），或竖屏版"主体被裁/字幕被 UI 挡"，或要设计安全区时调用。核心能力：中心安全区法则（关键内容装 1:1 中心方区）+ 三画幅安全区参数表 + 母版渲染后重构（非信箱）法则。关键触发：多画幅、横竖版、安全区、裁切、9:16、被 UI 挡、multi-aspect、reframe。
source_book: "ad-video-skills launch-video（GitHub: iart-ai/ad-video-skills，MIT License）"
source_chapter: Multi-aspect export
tags: [多画幅, 安全区, 裁切, 重构, AI生成友好]
layer_confidence: "candidate"
pack: iart 广告三件套
core_stance: "为最小公共画幅设计，不是为母版设计：装在 1:1 中心方区里的内容才活得过所有裁切"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/iart-ai/ad-video-skills"
source_license: "MIT"
source_url: "https://github.com/iart-ai/ad-video-skills"
first_seen: 2026-09-21
source_card: iart 广告三件套/iart-multi-aspect
evidence: E4

---

# 多画幅安全区法则

## R — 原文要点 (Reading)

来源方法（MIT，整理自 iart launch-video 多画幅章节）：**中心安全区构图**——一条母版干净裁到所有画幅。三画幅参数：①**16:9**（YouTube/落地 hero/X）1920×1080，关键内容在中心 90%；②**9:16**（Reels/TikTok/Shorts/Stories）1080×1920，文字在中心 80% 高内，**避开顶部 12% 与底部 18%（平台 UI 区）**；③**1:1**（Feed）1080×1080，即 16:9 帧的中心方区。**核心法则：hero/logo/CTA 全部设计在 1:1 中心方区内**——这样才活得过每次裁切。**母版渲染后重构，不是加黑边**：渲 16:9 母版，再从同一项目重构 9:16 与 1:1（reframe 而非 letterbox）。

## I — 方法论骨架 (Interpretation):

1. **为交集设计**：母版构图按三画幅交集（1:1 中心方区）布关键元素。
2. **UI 区是禁区**：竖屏的顶 12% 底 18% 永远不放关键信息——平台会挡。
3. **重构≠信箱**：多画幅是重新构图不是加黑边——黑边版是懒惰税。
4. **一源多版**：同一项目出多画幅，保风格一致（配 iart-ab-batch-variants 的模板数据驱动）。
5. **文字最脆弱**：字幕/CTA 是裁切第一受害者，优先护文字。

## A1 — 应用案例 (Past Application)

- 来源实践：hero logo+CTA 锁在 1:1 中心方区→16:9/9:16/1:1 三版裁切后品牌元素全存活。
- 反例：CTA 放 16:9 右下角→9:16 裁切后 CTA 整个消失。

## A2 — 触发场景 (Future Trigger)

- 一素材多平台投放（千川/Reels/TikTok/YouTube）。
- 竖屏版主体被裁的修复。
- 影策 Agent 生成多规格素材时的构图约束。

## E — 可执行步骤 (Execution)

1. **锁交集**：关键元素（hero/logo/CTA/字幕）布进 1:1 中心方区。
   *完成标准*：关键元素全在交集内。
2. **标禁区**：竖屏顶 12% 底 18% 无关键信息。
   *完成标准*：禁区零占用。
3. **渲母版**：16:9 母版先出。
   *完成标准*：母版达标。
4. **重构多版**：9:16/1:1 重新构图（非信箱）。
   *完成标准*：三版无黑边且关键元素存活。
5. **跨版验收**：逐版对照关键元素清单。
   *完成标准*：三版全存活。
