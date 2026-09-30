---
name: h3-style-3d-animation-short
description: 当用户要做"3D 动画/CG 短片/皮克斯风角色表演/三维定格感动画"时使用。触发词：3D 动画、CG 短片、皮克斯风、C4D、Octane、卡通渲染、三维角色表演、squash and stretch。本卡只提炼官方 skill 的视觉技法要素。工位边界：本技能只做H3 3D 动画短片风格模板，不产出完整分镜表与成片流程；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 3d-animation-short-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "3d-animation-short-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, 3d, cg, animation, 皮克斯, octane, 卡通渲染, 角色表演]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "3D 动画风格靠'全局视觉风格锁'统一：渲染器质感（C4D+Octane/SSS 皮肤）+ 卡通表演定律（挤压伸展）+ 每秒指令密度。风格一致性是生死线。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-3d-animation-short
evidence: E4

---

## R — 风格定义（Reading）

3D 动画短片 = 三维渲染的卡通/半写实动画，角色有弹性表演、世界有统一光照与材质。核心难点不是"做出 3D"，而是**全片视觉风格锁死不漂移**——每一镜共享同一套渲染参数、色彩 LUT、角色比例。

适用边界：
- ✅ 角色动画、产品 3D 演示、可爱/奇幻 CG 短片、解释类 3D 可视化
- ❌ 写实电影感、手绘/纸艺/实拍融合等非三维路线

## O — 视觉技法要素（技法萃取）

### 1. 全局视觉风格锁（必写）
- 渲染器质感：Cinema 4D + Octane render / Pixar-style CGI，明确写
- 材质：subsurface scattering 皮肤（透光感）、柔和 GI 全局光照、干净阴影
- 色彩：统一调色 LUT，避免每镜换色温
- 角色比例：固定头身比，跨界别变形

### 2. 卡通表演定律（squash & stretch）
- 角色动作遵循挤压-伸展：起跳前压扁、落地拉伸
- 次级运动：头发/衣物/配件跟随主体延迟摆动
- 表情夸张但可控，避免恐怖谷（眼睛不过大、无裂口牙齿）

### 3. 每秒指令（Per-Second Directives）
- 把 15s 拆为约 0-3 / 3-6 / 6-10 / 10-13 / 13-15 的节奏段，每段给明确动作指令
- 每段一主事件，避免同屏多动作打架
- 高潮段给"冲击+制动"对比（先快后稳）

### 4. 运镜
- 多由角色动作驱动镜头，非炫技运镜
- 可用缓慢 orbit / dolly-in 展示三维体积
- 避免手持抖动（那是实拍融合风格，非纯 3D）

### 5. 调性与禁止项
- 调性：playful / polished / imaginative / family-friendly
- 禁止：平面感、塑料硬边、无 SSS 的死白皮肤、恐怖谷五官、风格漂移

## A — 与 H3 六段式映射
- `subject_definitions`：角色锚 + 世界材质锚（写渲染器/光照）
- `detailed_description`：按每秒指令写挤压伸展+次级运动，动作驱动镜头
- `overall_mood`：playful / polished / whimsical
- `overall_soundscape`：卡通音效 + ambient；`non_diegetic_music` 可选轻量

## S — 自写示例片段（原创）
> subject_definitions: <Subject 1> a round blue creature, big eyes but no uncanny gap, soft SSS skin, Pixar-style CGI; <Picture 1> character sheet.
> detailed_description: [Shot 1] At 00:00 the creature crouches (squash), at 00:02 springs up (stretch), ears lag behind with secondary motion; camera slow dolly-in.
> overall_mood: playful, polished, whimsical.

## H — 红线
- 全局视觉风格锁必须写在每条 prompt 头部，漏写 = 跨镜漂移
- SSS / 渲染器质感词不可省，否则出"塑料死白 3D"
- 恐怖谷五官（巨眼/裂齿）一律禁止
