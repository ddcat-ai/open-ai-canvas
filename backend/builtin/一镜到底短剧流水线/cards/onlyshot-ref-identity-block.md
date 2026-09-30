---
name: onlyshot-ref-identity-block
description: 当用户要为角色/场景/道具生成参考图（ref 图），或角色在不同镜头里长相漂移、服装变色，或 ref 图带水印脏字时调用。核心能力：ref 图 6 段 identity block 写法 + 视觉指纹放 prompt 开头 + 警惕四视图水印陷阱。关键触发：角色参考图、角色不一致、脸变了、衣服变色、ref 图怎么做、三视图水印。
source_book: "OnlyShot AI短剧精细化IP创作 v0.6.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: references/ref-prompt-industrial.md
tags: [参考图, 角色一致性, identity block, 视觉指纹, ref库, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "一致性是 ref 层决定的，不是分镜图层补救的；ref prompt 的前 200 token 决定整库视觉基调"
skill_type: "template"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-ref-identity-block
evidence: E4

---

# ref 图 6 段 identity block

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot ref-prompt-industrial）：角色 ref 图 prompt 用六段 identity block——IDENTITY（身份定位）/ BODY（体型，拟物 IP 写「IS the object NOT humanoid」）/ FACE（脸型特征）/ ATTIRE（服装配色）/ LAYOUT（构图，如 9:16 半身像）/ STYLE（风格）。**视觉指纹（整部剧的统一风格词）放 prompt 开头前 200 token**（开头权重最高）。警惕「4 distinct angles / 四视图」类标签会生成水印脏字。ref 库分层六类：①master 风格 ②角色基础多角度 ③角色表情库 ④关键动作 ⑤场景多角度 ⑥道具细节，工业级目标 80-150 张。

## I — 方法论骨架 (Interpretation)

1. **identity block 六段齐**：缺段=留白给模型自由发挥=漂移起点。
2. **视觉指纹前置**：风格词放开头 200 token 内；这与「分镜图层要关掉指纹拼接」配套（指纹属于 ref 层，不进分镜层）。
3. **拟物声明在 BODY 段**：物体拟人化 IP 在 ref 阶段就写「IS the object NOT humanoid」，否则下游分镜层加 NOT humans 也救不回（ref 工艺是分镜工艺的上游）。
4. **ref 库是资产**：按六层规划（风格/多角度/表情/动作/场景/道具），不是临时抱佛脚单张生成；每张 ref 生成后必须人工确认脸型/服装/氛围。
5. **水印陷阱**：要求「四视图/多角度」字样会画进画面成脏字，多角度改用多张单图实现。

## A1 — 应用案例 (Past Application)

- 来源项目：ref 库从 v0.1.x 的 22 张扩到工业级 80-150 张后，跨 36 镜的一致性破损率显著下降——一致性投资在 ref 层最划算。
- 反例：ref 图带「4 views」标签 → 画面四格+脏字水印，不可用。

## A2 — 触发场景 (Future Trigger)

- 用户开新短剧项目，要建角色/场景 ref 库。
- 已有项目出现跨镜头角色漂移。
- 影策 Agent 规划生图任务清单时，按六层补齐 ref 缺口。

## E — 可执行步骤 (Execution)

1. **六段填空**：为该角色/场景/道具写全 IDENTITY/BODY/FACE/ATTIRE/LAYOUT/STYLE。
   *完成标准*：六段齐全，无空段。
2. **指纹前置**：把全剧统一风格词放进 prompt 开头 200 token 内。
   *完成标准*：风格词位置在 prompt 前 1/3。
3. **拟物声明**：拟物 IP 在 BODY 段写「IS the object NOT humanoid」。
   *完成标准*：拟物主体有显式非人类声明。
4. **避水印**：不写「四视图/distinct angles」类标签，多角度拆多张。
   *完成标准*：prompt 无视图标签词。
5. **入库归层**：产出 ref 按六层归档并编号，登记入 ref 库清单。
   *完成标准*：ref 库清单更新，人工确认记录在案。
