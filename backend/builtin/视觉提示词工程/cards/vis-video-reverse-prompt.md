---
name: vis-video-reverse-prompt
description: 当用户发来一条参考视频/竞品广告说"照这个结构拍一条我的"、"逐秒拆解这条片"、"把它的运镜节奏学过来"、"recreate like this"时调用。核心能力：逐秒定时拆解（读全片不读薄）→ 拆出镜头/时长/运镜/钩子/声音 → 换产品换台词保留工艺 → 结构可仿表达不可抄。关键触发：视频反推、竞品拆解、逐秒拆解、结构仿写、recreate、克隆广告、analyze this video。工位边界：本技能只做参考片逐秒拆解与结构提取，不产出分镜表生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "superCMO cloning-video-ads + visual-skills prompt audit（Apache-2.0 / CC-BY-4.0）"
source_chapter: cloning-video-ads Step 1-4 + video SKILL.md Output D
tags: [视频反推, 竞品拆解, 结构仿写, 逐秒分析, AI生成友好]
layer_confidence: "candidate"
pack: visual-skills 视觉叙事
core_stance: "结构、节奏、镜头、钩子可以学；台词、画面内容、品牌表达不可抄——学骨架不抄肉"
skill_type: "technique"
consult_tier: "A（绿区·Apache/CC-BY 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/smixs/visual-skills"
attribution: "Serge Shima — github.com/smixs/visual-skills (CC BY 4.0, 基于原作出修改)"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: visual-skills 视觉叙事/vis-video-reverse-prompt
evidence: E4

---

# 视频反推：逐秒拆解与结构仿写

## R — 原文要点 (Reading)

来源方法（Apache-2.0 整理自 superCMO cloning-video-ads + CC-BY 整理自 visual-skills 提示词审计）：**参考片是克隆重建的图纸，必须先完整读全——读薄了是唯一无法弥补的败因**。做法：对参考广告跑逐秒定时拆解（timed second-by-second breakdown），产出每镜的时间码/景别/运镜/动作/声音/钩子。然后读用户产品（材质/尺寸/视觉锚/机制）。**仿写边界**：保留参考片的结构、节奏、镜头、钩子；替换其产品、品牌、口播台词为用户自己的。**版权边界**：机制级仿写=结构可仿、表达不可抄。视觉提示词侧另有审计模式（D 模式）：给定用户提示词，返回 What works / What breaks generation / Missing direction / Continuity risks / Model-specific mismatches / Stronger version 六段诊断。访谈纪律：缺参考片或产品就问一次（捆绑成一条消息+留自由文本出口）；用户放弃提问则按参考片时长与画幅默认继续并一句话说明默认值。

## I — 方法论骨架 (Interpretation)

1. **读全片是硬前提**：拆解粒度到秒；没有逐秒表就没有重建图纸。
2. **拆的是工艺不是内容**：拆解表只记录可迁移的工艺维度（结构/节奏/运镜/钩子/声音设计）。
3. **产品描述一次写定全程复用**：换产品不换描述措辞（配 supercmo-product-description）。
4. **先批后渲**：重建方案先给用户确认，再进昂贵生成（影策审批卡同理）。
5. **诊断六段式**：提示词审计按固定六段输出，缺段=漏诊。

## A1 — 应用案例 (Past Application)

- 来源方法：竞品 30s 广告 → 逐秒表（0-3s 钩子/9s 产品落 drop/13-25s 卖点蒙太奇/25-30s 尾板）→ 用户床垫产品按同结构重建，钩子位置与卡点点位保留、台词全换。

## A2 — 触发场景 (Future Trigger)

- 用户发参考视频/竞品片链接或文件。
- 说「照这个拍一条」「学它的节奏」「拆解这条」。
- 影策 Agent 接到视频附件且意图为复用其结构时。
- ⚙️ 前置依赖：影策时间线转写需本机 ffmpeg + `CANVAS_WHISPER_BASE_URL` 指向本地 whisper.cpp 服务（当前未配置，见部署清单）。

## E — 可执行步骤 (Execution)

1. **读全片**：逐秒定时拆解参考片（时间码/景别/运镜/动作/声音/钩子）。
   *完成标准*：逐秒表覆盖全片时长。
1.5. **对白转写前置**（参考片有台词时）：走影策时间线转写（`POST /timeline/transcriptions`，本地 whisper.cpp，零费用）拿台词文本再拆——不要靠听写猜台词。
   *完成标准*：台词文本来自转写而非推测。
2. **读产品**：产品四要素（材质/尺寸/视觉锚/机制）一次写定。
   *完成标准*：产品描述成文且后续复用不改措辞。
3. **列迁移清单**：哪些维度继承（结构/节奏/运镜/钩子），哪些替换（产品/品牌/台词）。
   *完成标准*：继承/替换边界成表。
4. **方案先确认**：重建方案给用户确认后再生成。
   *完成标准*：确认记录在案。
5. **审计回检**：成品对照逐秒表核对工艺保留度；提示词审计走六段式。
   *完成标准*：保留度逐项可指认。
