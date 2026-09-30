---
name: onlyshot-3phase-cost
description: 当用户要"做一部短剧/AI短剧/漫剧"，或问"出片为什么贵/怎么省钱/一致性为什么崩"，或准备直接文字生视频时调用。核心能力：三阶段成本分层——创作（剧本+ref图）→分镜图（每镜静态首帧）→出片（视频），用静态图先锁构图再烧视频钱。关键触发：做短剧、出片太贵、视频改不起、构图随机、一致性崩、分镜怎么定。不适用于：单条口播视频、纯图文内容。工位边界：本技能只做三阶段成本分层决策，不产出具体分镜与视频生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "OnlyShot AI短剧精细化IP创作 v0.6.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: SKILL.md 核心架构 2 Phase + storyboard-frames-craft
tags: [短剧, 成本控制, 分镜图, 首帧, 一致性, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "AI短剧的真正成本不是创作而是出片；把钱花在静态首帧确认上，视频试错成本砍半"
skill_type: "framework"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-3phase-cost
evidence: E4

---

# 三阶段成本分层：先锁首帧再烧视频钱

## R — 原文要点 (Reading)

来源方法（MIT 许可，署名整理自 OnlyShot v0.6.0）：AI 短剧流水线拆成三层，成本从低到高——Phase 1 创作（剧本+ref 图，反复迭代几乎不花钱）；Phase 1.5 分镜图（每镜生成 1-4 张候选静态图，作为视频首帧，实测约 3 积分/张）；Phase 2 出片（每段视频约 55 积分）。**分镜图与视频段修改成本差约 18 倍**；静态首帧确认后，视频构图不再随机。

## I — 方法论骨架 (Interpretation)

1. **分层原则**：越便宜的层越先迭代。剧本/ref 不满意 → 在 Phase 1 反复改，不烧视频钱；构图不满意 → 改分镜图 prompt 重出（3 积分级）；只有全部确认后才进 Phase 2。
2. **分镜图 = 视频首帧**：静态图是 image2video 的输入，视频构图由首帧锁定，不再"抽奖"。
3. **按集解锁**：Phase 2 出片按集进行，每集验收后再出下一集；首集试水（优先第 1 集，其次首个付费点集数）。
4. **完成判定前置**：每层有明确验收（Phase 1：自评达标+ref 确认；Phase 1.5：人工选图；Phase 2：用户验收），不过关不进下层。

## A1 — 应用案例 (Past Application)

- 来源项目 SD-002《城市恋综》EP01：36 个分镜格三轮迭代（v2.5→v2.7），把「16/36 灾难级一致性破损」修到「0 灾难 / 60% ≥4 分」——修复全部发生在分镜图层，视频段零浪费。
- 反例：直接文字生视频 → 构图随机，同一角色每段长相不同，修改只能整段重生成。

## A2 — 触发场景 (Future Trigger)

- 用户说「做一部短剧」「出一集视频」「怎么省生成成本」。
- 用户抱怨「视频质量不稳定」「角色每段长得不一样」。
- 在影策 Agent 侧：用户准备批量发起视频生成任务前，先建议走分镜图确认层。

## E — 可执行步骤 (Execution)

1. **判层**：当前任务是剧本/ref/分镜图/视频中的哪层？
   *完成标准*：明确说出当前层与该层验收条件。
2. **低成本层迭代**：剧本与 ref 问题在文字层解决；构图问题先出静态分镜图（每镜 1-4 张候选）。
   *完成标准*：未在构图未确认时发起任何视频生成。
3. **人工选图**：候选图人工挑选定稿，作为该镜首帧。
   *完成标准*：每镜有唯一确定首帧文件。
4. **按集出片**：视频生成按集解锁，单集验收后再续。
   *完成标准*：存在明确的单集验收记录。
5. **成本核算**：汇报当前层修改成本与下层烧钱成本对比，让用户知情决策。
   *完成标准*：用户在知晓成本差的前提下确认进入下一层。
