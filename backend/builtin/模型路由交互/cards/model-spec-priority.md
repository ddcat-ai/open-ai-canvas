---
name: model-spec-priority
description: 当用户要生成任何模型提示词，或把通用模板/技能套到具体模型时调用。核心能力：三层优先级（官方硬要求 > 通用方法论 > 个人习惯）+ 已核实的六大模型官方要求清单 + 官方字段准入制（缺官方必填=不合格）。关键触发：官方要求、模型规范、权重、必填字段、模型语法、套模板、model spec、official requirements。
source_book: 剧典原创综合（整理自 seedance2-skill / visual-skills 模型选择器 / seedance-2-5-video-director / OnlyShot 实测约束）
source_chapter: 多源综合
tags: [官方规范, 模型优先级, 准入制, 提示词组装, AI生成友好]
layer_confidence: "candidate"
pack: 创作路由与交互
core_stance: "官方硬要求是准入不是优化：先过模型的规矩，再谈创作的方法"
skill_type: "framework"
consult_tier: "A（绿区·剧典原创，可公开）"
verify_state: raw
card_type: original
publish_tier: tier-self
source_repo: ""
source_license: ""
first_seen: 2026-09-21
source_card: 创作路由与交互/model-spec-priority
evidence: E4

---

# 模型官方规范优先制

## R — 原文要点 (Reading)

剧典原创综合方法（多源整理）：提示词组装的三层优先级——**①目标模型的官方硬要求（字段/语法/上限/禁忌）权重最高；②通用方法论（结构/细节/节奏）；③个人习惯与模板偏好**。冲突时官方赢，模板让位。已核实的官方硬要求清单：**Seedance 2.0**——@引用必须显式职责（首帧/运镜/特效…）；输入上限图≤9/视频≤3（各<50MB、总时长2-15s）/音频≤3/总文件≤12；生成时长4-15s；禁写实真人脸素材。**Seedance 2.5**——主模式单选+素材锁表（label|role|time|preserve|don't inherit）+@Image N 标签规范化；延长方向二值化（prepend/append）；编辑四件套（位置+目标+操作+时段）。**Kling**——1.x-2.x 用 Element Binding 3-4 张参考图；3.0 用提示词内 `[Character A: ...]` 标签+原生对白唇形；有专用负向提示词字段。**Veo**——JSON 结构化场景连续性；对白唇形与同步音效。**Nano Banana**——图像接地锚真实地点；支持极端画幅（1:8/8:1/4:1）；**禁写 50mm/f-stop/ISO 等镜头数字**；5+ 元素用 JSON；最多 14 张参考图。**GPT Image 2.5**——五槽模板（Scene/Subject/Details/UseCase/Constraints）；quality 低到 max 是保真旋钮；尺寸为 16 的倍数、最大 3:1、最高 4K；画面文字走 EXACT TEXT 纪律（引号包精确文字）；最多 16 张参考图且显式角色。

## I — 方法论骨架 (Interpretation)

1. **官方字段是准入制**：官方必填/必禁项缺失或违禁=提示词直接不合格，不是「可以更好」——先补官方再优化。
2. **模板让位官方**：通用模板（如五槽位、MCSLA）与官方语法冲突时改模板，不改官方。
3. **权重提高的操作含义**：官方字段排在提示词最前（与模型注意力分布对齐）；官方禁忌做终检最后一道。
4. **模型切换=重检**：同一内容换目标模型必须重拉官方清单——A 模型的优点写法可能是 B 模型的禁忌。
5. **上限是硬约束**：文件数/时长/尺寸/参考数超限在上游就被拒，与提示词质量无关。

## A1 — 应用案例 (Past Application)

- 反例：把电影镜头模板套 Nano Banana 写「shot on 50mm」——违反 NB 官方禁忌（禁镜头数字），且 NB 的强项是图像接地+极端画幅，模板用错场。
- 正例：GPT Image 任务先定 quality 档位+尺寸 16 倍数+文字引号纪律，再套五槽——保真度可控、文字不乱码。
- 反例：Seedance 2.0 任务上传 5 张图只引用 3 张——违反「素材无归属」纪律，未引用素材随机渗入画面。

## A2 — 触发场景 (Future Trigger)

- 任何提示词生成的第一步（定模型后先拉官方清单）。
- 通用技能/模板套用到具体模型时。
- 上游报错归因（先查官方上限与禁忌，再查内容质量）。

## E — 可执行步骤 (Execution)

1. **定目标模型**：明确到具体型号（Seedance 2.0/2.5、Kling 1.x/2.x/3.0、Veo、Nano Banana NBP/NB2、GPT Image Flare/Sunburst）。
   *完成标准*：型号唯一确定。
2. **拉官方清单**：调出该模型的字段/语法/上限/禁忌四项清单。
   *完成标准*：四类清单成文。
3. **补官方必填**：官方必填字段优先排入提示词前部。
   *完成标准*：官方必填零缺失。
4. **套通用层**：官方满足后再套结构/细节/节奏方法论。
   *完成标准*：无官方违例前提下完成通用层。
5. **禁忌终检**：官方禁忌（镜头数字/人脸/文件数/尺寸倍数…）逐项过最后一道。
   *完成标准*：禁忌零违例，可提交。
