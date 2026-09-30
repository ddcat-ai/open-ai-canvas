---
name: shortfilm-micro-drama
description: 当用户要做竖屏短剧/微短剧片段（9:16，红果/抖音形态），或要"钩子+正反打+断章"结构的竖屏叙事时调用。核心能力：竖屏短剧三件套——黄金 3 秒钩子 + 正反打对话 + 集尾断章，含竖屏构图约束。关键触发：竖屏短剧、微短剧、红果短剧、抖音短剧片段、正反打、断章、vertical drama、micro-drama。
source_book: "shortfilm-prompt（GitHub: jnMetaCode/ai-shortfilm-prompts，MIT License）"
source_chapter: templates/micro-drama.md
tags: [竖屏短剧, 微短剧, 钩子, 正反打, 断章, AI生成友好]
layer_confidence: "candidate"
pack: shortfilm-prompt 短片五段式
core_stance: "竖屏短剧的呼吸是钩子-对峙-断章：三秒不留人，后面全是成本"
skill_type: "technique"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
source_license: "MIT"
source_url: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
first_seen: 2026-09-21
source_card: shortfilm-prompt 短片五段式/shortfilm-micro-drama
evidence: E4

---

# 竖屏短剧三件套

## R — 原文要点 (Reading)

来源方法（MIT，整理自 shortfilm-prompt micro-drama 模板）：竖屏短剧（9:16）提示词三件套——①**黄金 3 秒钩子**：开场即冲突/悬念/反差，零铺垫（红果形态：外力施压或反常识状态）；②**正反打对话**（shot-reverse-shot）：对话戏按正反打机位写，每镜一个方向一个主体，轴线不越界；③**集尾断章**（cliffhanger）：结尾停在悬念/反转前一刻/狠话/神秘细节，逼下集。竖屏构图约束：主体居中偏上，关键信息避开底部 UI 区（约 18%）与顶部（约 12%）。

## I — 方法论骨架 (Interpretation)

1. **钩子是唯一KPI**：前 3 秒决定留存——钩子必须可见可听，不能是铺垫。
2. **正反打是短剧呼吸**：对话戏默认正反打；每镜单方向，遵守 180° 轴线。
3. **断章是商业模型**：不断章=无下集=无付费墙/无追更——断章位置就是钩位。
4. **竖屏安全区**：构图按平台 UI 遮挡设计，字幕与主体在安全区内。
5. **与节奏系统衔接**：单集时长变奏与 7 节点配 onlyshot-redfruit-7beats / onlyshot-duration-variation。

## A1 — 应用案例 (Past Application)

- 来源实践：竖屏短剧模板的断章位置设计直接服务红果付费墙集数（一卡/二卡/三卡）。
- 正反打示范：A 左朝右 / B 右朝左，轴线稳定，特写只给反应方。

## A2 — 触发场景 (Future Trigger)

- 用户做红果/抖音竖屏短剧的单集片段。
- 对话戏分镜编写。
- 影策 Agent 生成竖屏短剧分镜与提示词。

## E — 可执行步骤 (Execution)

1. **写钩子**：前 3 秒冲突/悬念/反差，零铺垫。
   *完成标准*：钩子句可见可听。
2. **排正反打**：对话镜按方向分配机位，检查轴线。
   *完成标准*：无越轴镜。
3. **设断章**：结尾停在悬念位（反转前/狠话/神秘细节）。
   *完成标准*：断章类型明确。
4. **竖屏安全区**：主体与字幕避开顶 12% 底 18%。
   *完成标准*：安全区合规。
5. **节奏挂接**：时长分配挂变奏分布与 7 节点。
   *完成标准*：节奏参数对齐。
