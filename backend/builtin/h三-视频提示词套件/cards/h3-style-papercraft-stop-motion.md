---
name: h3-style-papercraft-stop-motion
description: 当用户要做"纸艺定格动画/剪纸风格科普/手工拼贴感短片"时使用。触发词：纸艺、papercraft、定格动画、剪纸、手工拼贴、stop-motion paper、纸偶。本卡只提炼官方 skill 的视觉技法要素。工位边界：本技能只做H3 纸模定格风格模板，不替代上游市场技能的生产流程，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 papercraft-stop-motion-explainer（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "papercraft-stop-motion-explainer/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, papercraft, stop-motion, 纸艺, 定格, 剪纸, 手工]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "纸艺定格的灵魂是'手工可触感'——纸片分层、撕边毛边、软阴影、逐帧微动；运动是'一片片出现→压平→锁定'，绝不可平滑数字移动。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-papercraft-stop-motion
evidence: E4

---

## R — 风格定义（Reading）

纸艺定格 = 用剪纸/卡纸层叠构建的世界，模拟逐帧拍摄的停格动画。视觉关键词：分层纸片、撕边毛边、暖白描边、柔和纸影、手工质感。区别于纸拼贴（paper-collage，更平面编辑感），纸艺更强调**立体纸偶的定格组装**。

适用边界：
- ✅ 儿童向科普、温暖故事、手作感品牌片、节日动画
- ❌ 写实、酷炫科技感、快速剪辑 MV

## O — 视觉技法要素（技法萃取）

### 1. 材质签名（必写）
- layered paper / cut-paper / hand-torn edges / soft paper shadows
- 轻微纤维质感，不可太旧太脏太棕（除非用户要求做旧）
- 暖白描边区分纸片层

### 2. 运动法则（停格）
- 逐片出现 → 滑入/弹入 → 轻微回弹 → 压平 → 暂停 → 锁定
- 绝无：平滑数字平移/缩放、全局淡入、快速旋转、混乱飞散
- 每段像手工拼装，不是整体浮现

### 3. 构图与层级
- 前景/中景/背景纸片组分明，主体层级强
- 留白可控，不可一屏碎片

### 4. 色彩
- 协调纸色谱，避免突兀对比
- 强调色只用于关键物件点睛

### 5. 调性与禁止项
- 调性：warm / handmade / tactile / gentle
- 禁止：塑料感、平滑数字运镜、脏旧棕黄底、可读文字/UI/水印（除非用户要求）

## A — 与 H3 六段式映射
- `subject_definitions`：纸偶/纸片组锚，注明 layered paper 材质
- `detailed_description`：按停格节奏写"纸片入场→压平锁定"，无平滑运动
- `overall_mood`：warm / handmade / tactile
- `overall_soundscape`：纸艺触感音效（滑动/弹入/压平轻敲）优先；`non_diegetic_music` 可选

## S — 自写示例片段（原创）
> subject_definitions: <Subject 1> a paper fox assembled from layered orange cardstock, torn edges, soft shadow; <Picture 1> papercraft still.
> detailed_description: [Shot 1] At 00:00 paper pieces slide in one by one, the fox body pops in and bounces slightly, presses flat and locks; no camera move.
> overall_mood: warm, handmade, tactile.

## H — 红线
- 运动是停格组装，平滑数字运镜 = 风格崩坏
- 纸张质感不可太平/太脏，撕边毛边必写
- 默认无文字无 UI，除非用户明确要
