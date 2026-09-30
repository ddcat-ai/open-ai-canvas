---
name: h3-style-minimalist-product-ad
description: 当用户要做"极简产品广告/纯净背景单品展示/苹果风留白产品片"时使用。触发词：极简产品广告、minimalist product ad、纯净背景、单品展示、留白、苹果风、无干扰产品片。本卡只提炼官方 skill 的「视觉技法要素」，不复制其工作流原文。工位边界：本技能只做H3 极简产品广告风格模板，不产出完整分镜表与成片流程；后者由上游市场技能『顶级波普视觉广告导演』等负责，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 minimalist-product-ad-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "minimalist-product-ad-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, minimalist, product-ad, 留白, 单品展示, 纯净背景]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "极简广告的核心不是'少画'，而是'把全部注意力锁死在产品本体'——纯净背景+受控光影+零干扰元素，靠精准的材质与运动细节撑住高级感。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
upstream_defer: ["顶级波普视觉广告导演"]
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-minimalist-product-ad
evidence: E4

---

## R — 风格定义（Reading）

极简产品广告 = 纯净无干扰的视觉舞台，让产品本体成为唯一主角。区别于普通广告的"场景叙事"，它刻意剥离环境、人物、剧情，用**受控光影 + 材质特写 + 克制运动**建立高级感。适合消费电子、护肤、家居、饮品等"产品即明星"的品类。

适用边界：
- ✅ 单品展示、新品发布静帧/短片、电商主视觉动态化
- ❌ 需要人物故事、使用场景叙事、品牌情绪片的任务（那该走 brand-promo 或剧情向）

## O — 视觉技法要素（技法萃取，非原文照搬）

### 1. 背景与舞台
- 纯净单色或极简渐变背景（白/浅灰/品牌主色低饱和），杜绝环境杂物
- 产品居中或遵循明确三分/居中构图，留白充足
- 可接受的"背景动态"仅限于：柔和光晕、缓慢色场呼吸、粒子微浮（必须不抢主体）

### 2. 光影语言
- 主光来自顶部或单侧，软阴影/接触阴影清晰（显体积）
- 材质决定打光：金属用高光窄光带，玻璃用透射光，磨砂塑料用柔漫射
- 避免平光（显塑料感）、避免多色杂乱补光

### 3. 材质与细节（高级感来源）
- 明确写材质词：brushed metal / matte ceramic / frosted glass / soft-touch plastic
- 微距级表面细节：指纹不可有，但纹理/倒角/接缝要真
- 反射可控：只在产品自身表面做反射，背景保持干净

### 4. 运镜（克制）
- 缓慢 push-in / 极慢 orbit / 静态微距特写交替
- 单镜运动不超过一种主轴，避免快速变焦或抖动
- 旋转展示时保持产品中轴稳定

### 5. 调性与禁止项
- 调性：calm / premium / clean / confident
- 禁止：杂乱背景、过多文字、夸张特效、廉价光晕、人物抢镜、场景叙事干扰

## A — 与 H3 六段式的映射
- `subject_definitions`：只放产品本体 + 必要材质锚（无人物则省角色段）
- `overall_mood`：写 calm / premium / minimalist，不堆形容词
- `detailed_description`：按时间轴写"材质特写→缓慢运镜→光影变化"，动作单一清晰
- `overall_soundscape`：可留白或用极简 ambient / 产品自身机械音（开盖/按键）
- `non_diegetic_music`：轻量 pad 或留空，不盖过产品

## S — 自写示例片段（原创，非官方原文）
> subject_definitions: <Subject 1> a matte ceramic diffuser, soft-touch surface, centered on a warm off-white background; <Picture 1> reference render of the product.
> detailed_description: [Shot 1] At 00:00, a slow push-in from medium to close-up reveals the fine speckled glaze; at 00:04 the light rakes across the rim, a thin highlight travels the edge.
> overall_mood: calm, premium, minimalist.

## H — 红线（Hard rules）
- 背景零干扰是铁律，任何环境杂物 = 风格失败
- 运动必须克制，快剪/抖动/变焦 = 破坏极简调性
- 材质词不可省，否则出"塑料感 AI 产品片"
