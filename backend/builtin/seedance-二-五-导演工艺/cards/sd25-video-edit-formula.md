---
name: sd25-video-edit-formula
description: 当用户要修改已有视频（改剧情/换角色/加元素/去物体），或编辑结果"改了一大片不该改的也动了/没改到点上"时调用。核心能力：定向编辑公式（标注位置+精确目标+增删改换+有效时间）+ 不变清单显式列明 + 无标注版省略规则。关键触发：视频编辑、智能编辑、标记编辑、换角色、加元素、去物体、定向修改、video edit。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: Mode-specific invariants — Video edit
tags: [视频编辑, 定向修改, 不变清单, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "编辑的最小作用域：说清改哪、改成什么、什么时候生效、什么不许动"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-video-edit-formula
evidence: E4

---

# 定向编辑公式

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director Video edit 不变量）：编辑提示词公式——**`annotation/location（标注或位置）+ exact target（精确目标）+ add/remove/replace/change（增删改换）+ effective time（有效时间）`**；同时**显式列出一切必须保持不变的项**。无标注的编辑省略标注子句。配套纪律：修改目标必须可定位（说不清位置就先问）；「完全模仿原视频动作」类继承要写死（如换角色时动作完全模仿、不要切镜）。

## I — 方法论骨架 (Interpretation):

1. **四件套缺一不可**：位置/目标/操作/时段——缺时段=改全片，缺位置=改错对象。
2. **不变清单是护栏**：编辑任务最大的风险是误伤——显式不变项把误伤率压到底。
3. **目标可定位是前提**：定位不了的编辑不做，先问清。
4. **继承声明防漂移**：换角色/迁移时要写死继承什么（动作/节奏），否则自由发挥。
5. **无标注则省略**：没有位置标注需求时不硬加标注子句。

## A1 — 应用案例 (Past Application)

- 来源实践：「视频1中的女主唱换成图片1的男主唱，动作完全模仿原视频，不要出现切镜」——目标（女主唱）+操作（替换）+继承（动作模仿）+禁止（切镜）四要素齐。
- 反例：「把这个视频改好看点」——无位置无目标无时段，模型只能全片重抽。

## A2 — 触发场景 (Future Trigger)

- 任何已有视频的定向修改。
- 编辑结果误伤过多的修复（先补不变清单）。
- 影策画布视频资产的二次加工。

## E — 可执行步骤 (Execution)

1. **定位目标**：编辑对象可指认（标注或位置描述）。
   *完成标准*：目标定位句清晰。
2. **定操作**：增/删/改/换四选一（或组合但分别写清）。
   *完成标准*：操作类型明确。
3. **定时段**：有效时间范围写明。
   *完成标准*：时段非空且合理。
4. **列不变清单**：必须保持不变的项显式列出。
   *完成标准*：不变清单非空。
5. **继承声明**：涉及迁移时写死继承维度。
   *完成标准*：继承项在位。
