---
name: sd25-mode-select
description: 当用户要用即梦 Seedance 2.5 做视频（新片/精确时间线/长视频/延长/编辑/黏土渲染/无缝转场/多格分镜），或模式拿捏不准导致提示词结构错时调用。核心能力：主模式单选（七选一）+ 专家能力附加 + 交付物锁定（full-direction/prompt-only/script-only/diagnosis-only/revision）。关键触发：seedance 2.5、模式选择、长视频、黏土渲染、无缝转场、多格分镜、只要提示词、只要脚本、mode select。工位边界：本技能只做Seedance 2.5 主模式与交付物决策，不产出完整分镜表与成片流程；后者由上游市场技能『一图成片-电影广告全能导演』等负责，两者接力不抢戏。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: SKILL.md Select one primary mode + Output modes
tags: [seedance2.5, 主模式, 交付物锁定, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "一次只选一个主模式；专家能力按需附加——混模式=提示词结构错"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
upstream_defer: ["一图成片-电影广告全能导演"]
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-mode-select
evidence: E4

---

# 主模式单选与交付物锁定

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director）：**七主模式单选**：basic-multimodal（新建 4-30s 无更严模式）/timestamp-30s（精确 30 秒时间线）/long-video（30-180s 长视频模式）/video-extension（向前或向后延长）/video-edit（智能编辑/标记编辑/编辑视频）/clay-renderer（3D 白模作运动/构图/渲染控制）/seamless-transition（保留两段源视频只生成连接桥）/multi-grid-storyboard（多格分镜动画化）。真人导演/多人锁定/音色参考/BGM 去除/创意迁移/局部移除替换/视角重建/绿幕合成是**专家能力不是主模式**。选模式顺序：用户明说→从时长/源素材/请求操作推断；两个主模式都讲得通且产出不同时，问一个紧凑问题（点名竞争模式），不猜。**交付物锁定**：full-direction（默认：导演方案+素材映射+连续性与禁止项+一份可直贴的最终提示词）/prompt-only（只一段围栏 text 块）/script-only（只可拍脚本）/diagnosis-only（只诊断不改写）/revision（保留结构+变更摘要）。「只要脚本」「只要提示词」「只诊断」是输出约束不是风格建议。**边界**：只规划与文本提示词，不调视频生成/不花积分/不提交任务。

## I — 方法论骨架 (Interpretation):

1. **模式决定结构**：不同主模式的提示词结构根本不同——选错模式=南辕北辙。
2. **单选纪律**：主模式唯一，专家能力叠加——没有「既延长又编辑」的主模式组合。
3. **交付物先锁**：用户要什么形态先锁死，别默认给大全套。
4. **推断有优先级**：明说>推断；推断不出就问一个紧凑问题。
5. **不越界花钱**：本技能止于提示词——生成是用户的决定。

## A1 — 应用案例 (Past Application)

- 来源实践：用户「把这片子延长 10 秒」→video-extension 主模式+交付物 prompt-only；问一句「新增片段放原片前还是后」再动笔（延长方向歧义是硬伤，见 sd25-extension-direction）。
- 反例：「延长+换个角色」当组合模式做——实际是 extension 主模式+角色替换专家能力。

## A2 — 触发场景 (Future Trigger)

- 任何 Seedance 2.5 任务的第一步。
- 用户请求同时像多个模式时。
- 影策 Agent 调度 2.5 任务前的决策点。

## E — 可执行步骤 (Execution)

1. **锁交付物**：用户要方案/提示词/脚本/诊断/修订哪一种。
   *完成标准*：交付物类型唯一确定。
2. **选主模式**：七选一（明说优先，推断次之）。
   *完成标准*：主模式唯一。
3. **附专家能力**：按需叠加（真人导演/音色/绿幕等）。
   *完成标准*：能力清单与请求对应。
4. **歧义裁决**：两模式都通则问一个紧凑问题。
   *完成标准*：无静默猜 mode。
5. **读蓝图**：只读所选主模式的蓝图章节。
   *完成标准*：蓝图加载且不读无关模式。
