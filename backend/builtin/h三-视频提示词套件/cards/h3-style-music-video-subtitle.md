---
name: h3-style-music-video-subtitle
description: 当用户要做"音乐 MV/歌词贴字视频/卡点 MV/情绪短片/多镜头拼接"时使用。触发词：MV、music video、歌词贴字、字幕MV、卡点、多镜头拼接、Beat-Sync、Trap、Dark-pop、Cyber-grunge。本卡只提炼官方 skill 的剪辑与衔接技法要素。工位边界：本技能只做H3 MV 字幕风格模板，不替代上游市场技能的生产流程，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 music-video-subtitle-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "music-video-subtitle-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, mv, music-video, 歌词贴字, 卡点, beat-sync, 多镜头拼接, 硬切]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "MV 风格的核心是'五大衔接锁'——人声口型、节奏卡拍、美学调色、空间转场、文字动效全部对齐 Master Audio。>15s 必须多镜头拆解 + 首尾帧接续 + 鼓点硬切。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-music-video-subtitle
evidence: E4

---

## R — 风格定义（Reading）

音乐美学 MV = 随节奏变化的空间字幕 + 多镜头拼接的情绪短片。核心难点是**长视频拼接自然**——当超过模型单次生成上限（如 15s），必须用"多分镜拆解 + 首尾帧接续 + 鼓点硬切 + 全局主音轨对齐"工作流。

适用边界：
- ✅ 风格化音乐视觉、动态字幕 MV、情绪短片、卡点视频
- ❌ 普通字幕校对、照搬已有 IP、完全手工后期剪辑

## O — 视觉技法要素（技法萃取）

### 1. 五大衔接锁（拼接自然的关键）
- **人声口型锁**：切替点落在歌词句间停顿/强鼓点，不切在元音中途
- **节奏卡拍锁**：剪辑点精准落在 1/4 或 1/8 拍，用 Speed Ramping 微调头点拍/手势踩鼓点
- **美学调色锁**：跨镜携带相同 Aesthetic Header（颗粒度/色调 LUT/光影方向），全局叠 35mm Film Grain + 统一 LUT
- **空间转场锁**：长镜延伸用上一镜末帧(Tail Frame)作下一镜首帧(Head Frame)；硬切用同向运镜/Match Cut
- **文字动效锁**：前镜文字随 Bass Hit 破碎/扫出，后镜文字重音砸入，动能连贯传递

### 2. 剪辑语言（快节奏 MV）
- 纯硬切（Hard Cut），严禁淡入淡出/溶解/柔转
- 画面强响应鼓点：hi-hat 微震跳帧、snare 放大硬切、808 bass hit 低频压屏
- 快节奏片全片多近景场景快速切换，切换由音乐冲击触发

### 3. 文字包装规则
- 文字是空间动态图形主体（非字幕条），可前景/中景/背景或被遮挡
- 绝不遮挡眼睛/主要面部表情；对嘴时避遮挡嘴部
- 有人声时显示文字须逐字匹配表演歌词，每镜一主文字事件

### 4. 参考卡分工（角色隔离）
- 文字卡只控文字样式/质感/排版/动效，禁人物场景
- 人物卡只控形象/脸/发型/服装/比例
- 场景卡只控视觉风格/空间/光影气质

### 5. 调性与禁止项
- 调性：rhythmic / stylized / energetic / editorial
- 禁止：淡入淡出、油亮 AI 美颜脸、单镜硬撑变形、文字遮挡眼睛

## A — 与 H3 六段式映射
- `detailed_description`：按 Shot 模块化写时间戳+歌词映射+转场逻辑（鼓点硬切）
- `overall_mood`：rhythmic / stylized
- `overall_soundscape`：锁 Master Audio 对齐；`non_diegetic_music` 即全局音轨
- 气闸段（airlock）在此风格尤关键：多镜拼接接缝处用 airlock 钉尾帧防漂移

## S — 自写示例片段（原创）
> detailed_description: [Shot 1] 0.0-3.5s vocal line "...", typography slams in on snare; [Transition] bass-hit hard cut to Shot 2, same aesthetic header, tail frame of Shot1 = head frame of Shot2.
> overall_mood: rhythmic, stylized, energetic.

## H — 红线
- >15s 必须多镜头拆解，单镜硬撑 = 变形失败
- 剪辑纯硬切，任何柔转 = 风格错误
- 文字绝不遮挡眼睛/嘴部，逐字匹配歌词
