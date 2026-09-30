---
name: shortfilm-5stage-structure
description: 当用户要做一条电影感短片/多镜叙事视频（Seedance/可灵/Veo/即梦/Sora 通用），或写好提示词但"没有电影感、结构散"时调用。核心能力：五段式结构（核心主题|角色与场景|氛围与质感|镜头规则|分镜）+ 模型无关核心+模型尾注一行。关键触发：五段式、短片提示词、电影感、多镜叙事、five-stage、cinematic prompt。工位边界：本技能只做短片提示词五段式骨架，不产出风格化分镜生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "shortfilm-prompt（GitHub: jnMetaCode/ai-shortfilm-prompts，MIT License）"
source_chapter: SKILL.md Step 3 五段式结构
tags: [五段式, 短片提示词, 电影感, 模型无关, AI生成友好]
layer_confidence: "candidate"
pack: shortfilm-prompt 短片五段式
core_stance: "五段式是模型无关的骨架：模型只影响最后一行注，不影响结构本身"
skill_type: "template"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
source_license: "MIT"
source_url: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: shortfilm-prompt 短片五段式/shortfilm-5stage-structure
evidence: E4

---

# 短片提示词五段式结构

## R — 原文要点 (Reading)

来源方法（MIT，整理自 jnMetaCode/ai-shortfilm-prompts）：一条电影感 AI 短片提示词按五段组装——①**核心主题**（3-6 个标签，用 `|` 分隔）；②**角色与场景**（脸/服装/场景）；③**氛围与质感**（视觉基底/色调/风格核心）；④**镜头规则**（单镜还是多镜/角度/呼吸感）；⑤**分镜**（按秒切片或按镜切片）。**模型无关核心**：五段式结构在所有模型上相同，输出末尾只追加一行模型特定建议（Sora 偏好简洁/可灵对 IP 名更宽松/Seedance 屏蔽 IP 名等）。工作流纪律：先判断用户是否已给全五类信息（类型/时长/主体/场景/风格）——不全则最多问 2-3 个关键问题，**不过度提问**（先写一版再迭代胜过一次问十个细节）；写完后只解释 2-3 个最可能被调参的写作选择，不说教。

## I — 方法论骨架 (Interpretation)

1. **结构先行**：五段是组装顺序也是检查表——缺段即缺指令。
2. **模型差异后置**：模型特性只影响一行注，别让模型语法绑架内容结构。
3. **少问多写**：默认先产出一版可迭代的草稿，把提问留给真正影响成败的分叉。
4. **解释要吝啬**：只点用户最可能要调的 2-3 处，不逐段讲解。
5. **分镜粒度按时长**：≤10s 按镜切，>10s 按秒切。

## A1 — 应用案例 (Past Application)

- 来源实践：Mx-Shell 的《僵尸清道夫》首次验证该五段式；21 类型模板库均按五段式展开。
- 尾注示例：「触发短语写成自创音节而非具体 IP 词——Seedance 屏蔽 IP 名」。

## A2 — 触发场景 (Future Trigger)

- 用户要「电影感短片/预告片/产品微电影」类视频。
- 已有提示词「结构散、没电影感」的重组。
- 影策 Agent 生成多镜视频提示词的默认骨架。

## E — 可执行步骤 (Execution)

1. **信息盘点**：类型/时长/主体/场景/风格五类是否齐全。
   *完成标准*：五类已盘点，缺项进提问或假设。
2. **五段组装**：主题标签→角色场景→氛围质感→镜头规则→分镜。
   *完成标准*：五段齐全无空段。
3. **分镜切片**：按时长选按镜或按秒。
   *完成标准*：切片方式与时长匹配。
4. **模型尾注**：末尾一行模型特定建议。
   *完成标准*：尾注非空且具体。
5. **两点解释**：只讲 2-3 个最可能被调的决策。
   *完成标准*：解释 ≤3 点。
