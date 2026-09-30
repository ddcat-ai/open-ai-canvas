---
name: onlyshot-video-mode-picker
description: 当用户要生成视频但纠结"用哪种生成模式/要不要传尾帧/能不能多图参考"，或做关键爆点镜头、一镜到底、多素材融合时调用。核心能力：四种视频生成模式按文件条件自动选择。关键触发：视频模式怎么选、首尾帧、一镜到底、多参考图生成、爆点镜头。工位边界：本技能只做视频生成模式选择（4 模），不产出分镜表生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "OnlyShot AI短剧精细化IP创作 v0.6.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: SKILL.md Phase 2 + storyboard-frames-craft
tags: [视频生成, 模式选择, 首尾帧, 一镜到底, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "视频生成模式不是喜好问题，是手头素材文件决定的结构问题；默认用首帧+动作，爆点才上首尾帧"
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
source_card: OnlyShot 短剧流水线/onlyshot-video-mode-picker
evidence: E4

---

# 四模视频生成选择器

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot v0.3.0+）：四种视频生成模式按素材文件存在性自动选择，经验占比——image2video（分镜图首帧+动作 prompt，默认主用约 80%）；frames2video（首帧+尾帧锁定，关键爆点约 10%）；multiframe2video（2-20 张关键帧一镜到底，复杂动作约 5%）；multimodal2video（多图+视频+音频全能参考，fallback 约 5%）。

## I — 方法论骨架 (Interpretation)

1. **默认档 = image2video**：有首帧 + 动作描述即可，成本与稳定性最平衡。
2. **锁死档 = frames2video**：只有「画面必须精确落在某个状态」的镜头才用（爆点、反派定格、心声特写、音乐卡点）——因为尾帧约束会牺牲中间动作自由度。
3. **连续档 = multiframe2video**：动作跨越大空间/多阶段（上楼进屋上天台）用 2-20 张关键帧串一镜到底。
4. **兜底档 = multimodal2video**：多 ref 输入最稳但最贵，仅当前面三档素材不齐时用。
5. **选择算法**：按「手头有什么文件」判断，而非按「想要什么效果」硬选——素材不齐时先回分镜图层补素材。

## A1 — 应用案例 (Past Application)

- 常规对话镜头：分镜图首帧 + 动作 prompt（image2video），批量出片最稳。
- 爆点镜头「踢飞+玻璃碎裂」：首帧（起脚）+ 尾帧（碎裂瞬间）双锁（frames2video），爆点构图分毫不差。

## A2 — 触发场景 (Future Trigger)

- 用户问「这段用什么模式生成」「要不要做尾帧」「一镜到底怎么做」。
- 影策 Agent 组装视频任务时，按镜号素材清单自动分派模式。

## E — 可执行步骤 (Execution)

1. **盘点素材**：该镜有哪些文件？（首帧图？尾帧图？多关键帧？多参考？）
   *完成标准*：素材清单四项逐一判定有/无。
2. **按序匹配**：多关键帧≥2 → multiframe2video；有首帧+尾帧且属爆点 → frames2video；仅有首帧 → image2video；素材残缺 → multimodal2video 或回炉补图。
   *完成标准*：模式选定且与素材清单一致。
3. **爆点复核**：被标为爆点/反派/心声/卡点的镜头，确认是否需要升级为尾帧锁定。
   *完成标准*：关键镜逐个复核过锁定等级。
4. **登记**：把所选模式写进该镜的分镜数据字段。
   *完成标准*：每镜 video_mode 字段非空。
