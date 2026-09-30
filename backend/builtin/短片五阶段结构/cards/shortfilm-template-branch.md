---
name: shortfilm-template-branch
description: 当用户要做某一具体类型的短片（变形/情感叙事/产品广告/ASMR/动物Vlog/预告片/赛博城市/黏土动画/自然延时/伪纪录恐怖/动画改真人/MV/运动慢动作/时尚片/旅拍/无人机FPV/竖屏短剧/科幻太空/汽车广告）时调用。核心能力：21 类型模板分支选择 + 3+ 镜剪辑片必走的两把锁（主体登记+氛围锁定）。关键触发：模板选择、什么类型、竖屏短剧、产品广告片、ASMR、伪纪录、黏土动画、变形镜头、micro-drama、template branch。工位边界：本技能只做短片类型模板分支选择，不产出IP 孵化全流程；后者由上游市场技能『治愈系原创IP孵化助手』等负责，两者接力不抢戏。
source_book: "shortfilm-prompt（GitHub: jnMetaCode/ai-shortfilm-prompts，MIT License）"
source_chapter: SKILL.md Template library
tags: [模板分支, 类型选择, 竖屏短剧, 微电影, AI生成友好]
layer_confidence: "candidate"
pack: shortfilm-prompt 短片五段式
core_stance: "模板是深骨架不是覆盖：SKILL 规则永远赢，模板供深度不供覆盖"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
source_license: "MIT"
source_url: "https://github.com/jnMetaCode/ai-shortfilm-prompts"
upstream_defer: ["治愈系原创IP孵化助手"]
first_seen: 2026-09-21
source_card: shortfilm-prompt 短片五段式/shortfilm-template-branch
evidence: E4

---

# 21 类型模板分支与两把锁

## R — 原文要点 (Reading)

来源方法（MIT，整理自 shortfilm-prompt 模板库）：21 个类型模板各带深骨架与类型专用措辞——15s 单镜变形（15s-transformation）/多镜剪辑叙事（multi-shot-narrative）/情感叙事（宠物一生 full worked example）/产品广告（beat-driven）/食物 ASMR（原生同步音频）/动物 Vlog（自拍 POV 同步对白）/电影预告（递进多镜）/赛博城市氛围/黏土动画（风格化，刻意打破呼吸规则）/自然延时（时间压缩+锁定调色）/CCTV 伪纪录恐怖（ degraded 镜头，打破呼吸规则）/动画改真人（媒介转译，重 IP 安全）/MV 表演（卡点，音乐是必需的）/运动慢动作（Phantom 高帧率）/时尚片（运动即主体）/旅拍 Vlog（手持蒙太奇）/无人机 FPV（连续飞行）/竖屏短剧（钩子+正反打+断章）/科幻太空（失重物理+真空静默）/汽车广告（反光表面+汽车 Rig）。**两把锁（3+ 镜剪辑片必走）**：写第一镜前先走主体登记（subject registry）+ 氛围锁定（atmosphere lock）——这是「多镜片能不能撑住不漂」的最大单一预测因子。

## I — 方法论骨架 (Interpretation)

1. **分支即骨架**：每个类型模板预置了该类型的节拍与措辞，选错分支=用错骨架。
2. **规则 > 模板**：SKILL 规则永远赢，模板供深度不供覆盖——冲突时回规则。
3. **呼吸规则可破**：黏土/伪纪录等类型刻意打破常规呼吸感——破例是类型特性不是失误。
4. **两把锁前置**：多镜片先锁主体与氛围，再写第一镜——锁不牢，第 3-4 镜必漂。
5. **IP 安全分级**：Seedance 屏蔽 IP 名；动画改真人等类型最需要 IP 安全处理。

## A1 — 应用案例 (Past Application)

- 来源实践：竖屏短剧模板 = 钩子+正反打+断章三件套，直接对应红果短剧形态。
- 伪纪录恐怖：CCTV 画质+ degraded 镜头语言是类型本体，不是画质事故。

## A2 — 触发场景 (Future Trigger)

- 用户说出具体短片类型/参考片类型。
- 多镜剪辑片开写前的两把锁。
- 影策 Agent 匹配类型模板时的分支选择。

## E — 可执行步骤 (Execution)

1. **判类型**：从 21 分支中选最强匹配；多个合理则呈现 2-3 个+理由让用户选。
   *完成标准*：分支唯一确定或已呈现选项。
2. **装深骨架**：读该类型模板的骨架与措辞。
   *完成标准*：骨架已加载。
3. **两把锁**（3+ 镜必做）：主体登记+氛围锁定。
   *完成标准*：两锁落档后才写第一镜。
4. **规则校验**：模板与 SKILL 规则冲突处回规则。
   *完成标准*：无规则违例。
5. **IP 安全**：涉及 IP 名的类型做触发短语自创处理。
   *完成标准*：无裸露 IP 名。
