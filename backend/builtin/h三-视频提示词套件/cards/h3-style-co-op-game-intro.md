---
name: h3-style-co-op-game-intro
description: 当用户要做"双人合作游戏主菜单/开场动画/角色化菜单"且需先出确认首图再生成视频时使用。触发词：游戏开场、co-op intro、主菜单动画、双人游戏、游戏 UI、玩家信息卡。本卡只提炼官方 skill 的框架固定+风格动态技法要素。工位边界：本技能只做 H3 提示词规范，不替代上游市场技能的生产流程，后者由上游市场技能『治愈系原创IP孵化助手』等负责，两者接力不抢戏。工位边界：本技能只做H3 游戏介绍片风格模板，不替代上游市场技能的生产流程，两者接力不抢戏。
source: MiniMax 官方 skills 仓库 co-op-game-intro-generator（2026-08 克隆归档于 📦 原浆窖/raw/prompts/MiniMax-H3-skills/）
source_chapter: "co-op-game-intro-generator/SKILL.cn.md（整理：只借技法）"
tags: [h3, style, game-intro, co-op, 主菜单, 游戏UI, 角色化菜单]
layer_confidence: "candidate"
pack: MiniMax H3 提示词规范 · 风格技法
core_stance: "游戏开场片用'框架固定 + 风格动态填充 + 颜色联动'写法：布局/UI 框架锁死，风格词/色彩随用户选择推导，所有 UI 元素必须与色彩设计保持一致。"
skill_type: "style-method"
consult_tier: "B（只借技法结构，逐字案例仅作格式参考）"
verify_state: raw
card_type: prompt
upstream_defer: ["治愈系原创IP孵化助手"]
publish_tier: tier-attrib
source_repo: "MiniMax H3 官方技能文档（即梦 Dreamina 官方 skills 语料，raw-materials/MiniMax-H3-skills）"
source_license: "MiniMax 官方文档（署名引用）"
first_seen: 2026-08-24
source_card: MiniMax H3 提示词规范/h3-style-co-op-game-intro
evidence: E4

---

## R — 风格定义（Reading）

双人游戏开场 = 游戏主菜单 UI 与角色深度融合的宣传片。方法论亮点是**先出确认首图再生成视频**（框架固定+风格动态），以及**色彩联动**（所有 UI/按钮/图标/字体颜色从同一色彩设计推导）。

适用边界：
- ✅ 合作游戏概念展示、角色化菜单、社交内容
- ❌ 完整可玩游戏开发、复杂多页 UI、精确品牌标识复刻、无角色通用片头

## O — 视觉技法要素（技法萃取）

### 1. 框架固定 + 风格动态（首图提示词写法）
- **固定框架**：游戏主菜单 UI、UI 与角色深度融合、现代商业游戏 UI、强视觉冲击、简洁干净避免装饰
- **动态填充**：风格词/人物画风/穿搭/背景纹理按用户选择风格拓展
- **色彩联动**：主色/UI 色/文字色/功能强调色/危险色统一推导，后续所有 UI 段落保持一致
- **布局固定**：16:9、背景铺满、中央角色、UI 围绕不遮挡、左上玩家卡、右侧纵向菜单、底部警戒胶带、Z 字阅读路径

### 2. 色彩设计（5 色以内）
- 主体色 + UI 主体色 + 文字色 + 功能强调色 + 危险提示色（红）
- 高对比撞色、鲜明现代
- 所有按钮/图标/字体颜色从色彩设计推导

### 3. 灯光表现
- 顶部主光 + 左上冷暖补光 + 底部柔和环境反光 + 接触阴影 + 轮廓光
- GI 全局光照，人物自然融入背景

### 4. UI 排版规则
- 按钮统一尺寸/圆角，横向长条，标题单行禁换行
- 超粗无衬线大字、全部大写、字距紧凑（Anton/Impact 风）
- 玩家信息卡：不规则矩形、描边、左侧 Logo、右侧三级信息（名称/昵称/READY）

### 5. 调性与禁止项
- 调性：energetic / modern / punchy / readable
- 禁止：UI 遮挡角色、文字换行、色彩脱离联动、风格压过用户选择

## A — 与 H3 六段式映射
- `subject_definitions`：双角色锚（保留身份锚点重绘为用户风格）+ UI 锚
- `detailed_description`：按菜单布局写 UI 动效+角色入场，色彩联动
- `overall_mood`：energetic / modern / punchy
- `overall_soundscape`：UI 音效 + 菜单氛围；`non_diegetic_music` 可选游戏主题

## S — 自写示例片段（原创）
> subject_definitions: <Subject 1> Player1, explorer jacket, identity anchor kept; <Subject 2> Player2, green puffer, identity anchor kept; <Picture 1> menu frame.
> detailed_description: [Shot 1] At 00:00 menu UI fades in with brand blue, player cards slide from top-left, Continue button pulses.
> overall_mood: energetic, modern, punchy.

## H — 红线
- 框架固定不可动，改风格只动动态填充段
- 色彩必须联动，任何 UI 元素脱色 = 不一致
- 文字单行禁换行，标题两行 = 排版失败
