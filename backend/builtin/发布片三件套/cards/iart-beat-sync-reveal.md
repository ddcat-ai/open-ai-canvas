---
name: iart-beat-sync-reveal
description: 当用户要"卡点视频/踩点剪辑/音乐卡点"，或"切在不该切的地方/画面节奏和音乐两张皮"，或 reveal/爆点要精确落拍时调用。核心能力：卡点三律（先测 drop 时间码/切在瞬态上/撞击前 ramp 后硬切）+ 蒙太奇节拍驱动法（0.6-1.0s 一拍一卖点）。关键触发：卡点、踩点、beat sync、drop、瞬态、切在拍上、音乐同步、time-remap。工位边界：本技能只做卡点剪辑技法，不产出风格资产库；后者由上游市场技能『名导十五秒视频风格资产引擎』等负责，两者接力不抢戏。
source_book: "ad-video-skills launch-video（GitHub: iart-ai/ad-video-skills，MIT License）"
source_chapter: Beat-synced reveal + Kinetic feature montage
tags: [卡点, 音乐同步, drop, 瞬态切点, AI生成友好]
layer_confidence: "candidate"
pack: iart 广告三件套
core_stance: "切点长在音乐的瞬态上，不长在秒数网格上"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/iart-ai/ad-video-skills"
source_license: "MIT"
source_url: "https://github.com/iart-ai/ad-video-skills"
upstream_defer: ["名导十五秒视频风格资产引擎"]
first_seen: 2026-09-21
source_card: iart 广告三件套/iart-beat-sync-reveal
evidence: E4

---

# 卡点发布：瞬态切点与砸点

## R — 原文要点 (Reading)

来源方法（MIT，整理自 iart launch-video 卡点章节）：**测 drop 精确时间码**——在音频里找到 drop 的确切位置，让品牌标在那个帧上 snap 满（配微过冲：scale 1.18→1.0 用 0.18s power3.out 回弹+白色闪光 0.25s）。**切在瞬态上，不切在固定网格**——最重的切点落在 kick/snare 敲击上；进 drop 前用 time-remap  ramp 速度，出 drop 硬切。**蒙太奇节拍驱动**：一拍一卖点，每拍 0.6-1.0s，硬切在拍上；beats 数组（13.0/13.8/14.6/15.4/16.2…）逐拍调度镜头。**运动语言统一**：整个蒙太奇同一进场曲线同一退场——速度读出来是自信不是混乱。参考实现（Remotion 思路）：所有动画值是 `useCurrentFrame()` 的纯函数，禁 CSS transition 与库计时器（会失步）；variant 对象驱动一切可变项。

## I — 方法论骨架 (Interpretation):

1. **时间码先于剪辑**：drop 与瞬态是测量出来的，不是听出来的。
2. **重切配重拍**：kick/snare 位放大切点力度，轻拍位放过渡。
3. **ramp-then-hardcut**：进 drop 加速、出 drop 硬切——张弛结构。
4. **一拍一信息**：0.6-1.0s 一拍，每拍只讲一个卖点（关键词+单一支撑画面）。
5. **确定性渲染**：帧函数式动画=逐帧确定，禁时间器类失步源。

## A1 — 应用案例 (Past Application)

- 来源实践：beats 数组逐拍调度 feature 卡（pop 0.35s cubic-bezier(.22,1,.36,1)）——速度感来自统一曲线而非快切本身。
- 反例：按 1s 整数网格切——画面节奏与音乐长期微漂移，观感「两张皮」。

## A2 — 触发场景 (Future Trigger)

- 任何要卡点的广告/短片/MV。
- 「画面音乐不合拍」的修复（先查瞬态切点）。
- 影策 Agent 生成卡点结构的分镜参数。

## E — 可执行步骤 (Execution)

1. **测时间码**：记录 drop 与主要瞬态位置。
   *完成标准*：时间码表成文。
2. **排砸点**：品牌标 snap 于 drop 帧+微过冲+白闪。
   *完成标准*：砸点=drop 帧。
3. **配瞬态切**：重切落 kick/snare，过渡落轻拍。
   *完成标准*：切点-拍点对应表成立。
4. **ramp 进出**：进 drop ramp，出 drop 硬切。
   *完成标准*：ramp 与硬切在位。
5. **蒙太奇拍驱**：0.6-1.0s 一拍一卖点+统一运动曲线。
   *完成标准*：拍-卖点对应且曲线统一。
