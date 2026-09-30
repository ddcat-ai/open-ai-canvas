---
name: h3-style-paper-collage-explainer
description: 当用户要做"纸拼贴讲解动画/知识科普/观点表达/编辑感拼贴 B-roll"时使用。触发词：纸拼贴、paper collage、拼贴科普、定格拼贴、halftone collage、拼贴动画。本卡只提炼官方 skill 的视觉技法要素。工位边界：本技能只做H3 拼图解说风格模板，不替代上游市场技能的生产流程，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 paper-collage-explainer-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "paper-collage-explainer-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, paper-collage, halftone, 拼贴, 科普, 编辑感, 定格]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "纸拼贴讲解 = 高级半调纸拼贴的'视觉隐喻'动画。核心是'不用屏幕文字也能懂'的物件化隐喻 + 触感停格组装 + 默认拼贴音效（不默认 BGM/旁白/字幕）。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-paper-collage-explainer
evidence: E4

---

## R — 风格定义（Reading）

纸拼贴讲解 = 用触感纸拼贴语言表现口播句/知识点/观点的动画。视觉语言：大色块纸面、黑白半调照片剪影、选择性彩色卡纸点缀、暖白描边、柔和纸影、触感定格组装。区别于纸艺定格（更立体纸偶），纸拼贴更**平面编辑感 + 半调剪影 + 隐喻物件化**。

适用边界：
- ✅ 知识讲解、观点表达、故事配画、社交 B-roll
- ❌ 真人口播广告、精确可编辑图层、复杂文字排版、仅输出提示词

## O — 视觉技法要素（技法萃取）

### 1. 风格签名（必写）
- flat bold color field + black-and-white halftone photographic cut-outs + selective colored cardstock accents + warm cream keylines + soft paper shadows + fine uncoated-paper grain + premium editorial paper collage + clean hand-torn paper edges + subtle fibrous edges + layered paper seams

### 2. 隐喻物件化（核心）
- 每条句子/概念提炼为 3-6 个大而易读纸片组
- 视觉隐喻不靠屏幕文字表达，靠具体画面
- 色彩语义：焦橙=紧迫、芥末黄=警示、墨绿=认知/重置、深紫=记忆/神秘、青绿=协作、玫红=荒诞

### 3. 运动法则（停格）
- 从干净纸色场开始 → 基础结构滑入/弹入 → 角色物件入场 → 次要物件逐个组装（回弹/压平/暂停）→ 锁定 → 短暂停留
- 绝无：平滑数字移动、全局淡入、快速旋转、混乱飞散、运镜/缩放/变形

### 4. 音频策略（默认）
- 默认保留触感拼贴音效（纸片滑动/弹入/压平轻敲/摩擦/脆响）
- 默认不添加 BGM / 旁白口播 / 字幕，除非用户明确要求
- 无声视觉叙事节奏替代旁白稿

### 5. 调性与禁止项
- 调性：editorial / tactile / clever / calm
- 禁止：可读文字/假字母/数字/UI/水印/Logo（除非要求）、牛皮纸棕黄底（除非确认）、过旧过脏纸质、钴蓝作默认色

## A — 与 H3 六段式映射
- `subject_definitions`：纸片组锚，注明 halftone collage 材质
- `detailed_description`：按停格顺序写物件组装，无运镜无文字
- `overall_mood`：editorial / tactile / clever
- `overall_soundscape`：拼贴音效优先；`non_diegetic_music` 默认空（除非用户要）

## S — 自写示例片段（原创）
> subject_definitions: <Subject 1> three large paper groups: a clock, a stack of papers, a red alert tag; halftone collage style; <Picture 1> collage still.
> detailed_description: [Shot 1] At 00:00 clean cream field, clock slides in, papers pop in and bounce, red tag presses flat and locks; no camera move, no text.
> overall_mood: editorial, tactile, clever.

## H — 红线
- 隐喻必须物件化，靠文字表达 = 失败
- 默认无 BGM/旁白/字幕，用户不要求不加
- 纸张不可太平/太旧/偏棕，撕边毛边必写
