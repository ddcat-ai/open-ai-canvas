---
name: h3-style-handdrawn-live-video
description: 当用户要做"15秒手绘动画与实拍空间融合短片/蜡笔粉笔质感/变形追逐"时使用。触发词：手绘发光动画实拍融合、蜡笔粉笔质感、15秒变形追逐、手绘接触真实物体、可爱手绘。本卡只提炼官方 skill 的影像结构与技法要素。工位边界：本技能只做H3 手绘直播风格模板，不替代上游市场技能的生产流程，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 handdrawn-live-video-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "handdrawn-live-video-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, handdrawn, live-action, 手绘, 实拍融合, 蜡笔, 变形追逐]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "手绘实拍融合 = 平面手绘发光动画出现在真实空间，与实拍手/物体明确接触，作为同一实体连续变形逃跑，由慢半拍手持镜头追随。结构是铁律：0-3s 必须接触，每区间有新变形。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-handdrawn-live-video
evidence: E4

---

## R — 风格定义（Reading）

手绘实拍融合 = 15秒、16:9，平面手绘发光动画出现在真实空间中，与实拍手/物体接触后作为同一实体连续变形、逃跑，慢半拍手持手机镜头追随。核心是**接触真实感 + 连续变形可追溯 + 镜头延迟**三者缺一不可。

适用边界：
- ✅ 单场景创意短片、手绘实拍融合、可爱生活感变形
- ❌ 精致 CG、恐怖跳吓、毛绒角色、多场景剪辑

## O — 视觉技法要素（技法萃取）

### 1. 固定影像结构（铁律）
- 实拍空间中出现平面手绘发光动画
- 0-3s 内与实拍手或物体明确接触（缠手指/落掌心/被抓逃跑/指尖诞生）
- 同一实体连续变形，保留前一形态痕迹（线/尾巴/色彩拖痕/图案母题）
- 全片同一空间或相邻范围连续展开，不剪辑跳地点
- 拍摄者参与：伸手/抓/追/接住/后退/被恶作剧

### 2. 时间轴分段（每区间必有新动作）
- 0-3s：接触建立融合
- 3-6s：第一次变形/移动
- 6-10s：追逐路线展开
- 10-13s：拍摄者反应/恶作剧
- 13-15s：空间级变形（线扩散到墙/地/天花板→巨大花/星空/夕阳/丝带）+ 感动余韵+可爱笑点

### 3. 手绘质感
- 蜡笔/粉笔/彩色铅笔/粉彩/粗糙笔刷
- 线条轻微抖动，涂抹不均、毛边、逐帧重画感
- 禁用：3DCG、毛绒玩具感、均匀矢量线、平滑霓虹

### 4. 相机追随（慢半拍）
- 镜头不把动画稳定居中
- 实体已离开画面边缘后，镜头才平移/俯仰/前进
- 像拍摄者真在边走边追

### 5. 调性与禁止项
- 调性：cute / life-feel / nostalgic / gentle / 略带切（非恐怖）
- 禁止：恐怖怪物、巨大眼睛、裂口、牙齿、威吓、扑咬、突然黑屏、跳吓、另一全新角色突然出现

## A — 与 H3 六段式映射
- `subject_definitions`：实拍空间锚 + 手绘实体锚（注明 crayon/chalk 质感）
- `detailed_description`：严格按 0-3/3-6/6-10/10-13/13-15 五段写连续变形+接触+追逐
- `overall_mood`：cute / life-feel / gentle
- `overall_soundscape`：环境音（实拍空间声）；`non_diegetic_music` 轻量或空

## S — 自写示例片段（原创）
> subject_definitions: <Subject 1> a hand-drawn glowing line creature, crayon texture, on a real kitchen counter; <Picture 1> live-action counter.
> detailed_description: [Shot 1] 0-3s the creature lands on the counter and wraps a finger; 3-6s stretches into a small plant; 6-10s flees as the hand chases; 13-15s the line spreads to the wall becoming a huge flower.
> overall_mood: cute, life-feel, gentle.

## H — 红线
- 0-3s 必须实拍接触，无接触 = 结构失败
- 变形必须可追溯（保留前形态痕迹），突变新角色禁止
- 慢半拍镜头铁律，稳定居中 = 破坏真实感
- 任何恐怖编码（巨眼/裂齿/跳吓）一律禁止
