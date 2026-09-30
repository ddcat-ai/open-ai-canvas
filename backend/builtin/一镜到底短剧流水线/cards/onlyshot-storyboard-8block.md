---
name: onlyshot-storyboard-8block
description: 当用户要写分镜图/首帧图的生成提示词，或拟物化 IP 出现"人穿建筑/塔当帽子"的 chibi 人体穿帮，或分镜图缺电影感时调用。核心能力：分镜图 8 段 prompt 模板 + 每个主角单独写 NOT humans 子句。关键触发：分镜图 prompt 怎么写、拟物穿帮、变成人形、chibi、塔戴头上、画面太平没戏剧光。
source_book: "OnlyShot AI短剧精细化IP创作 v0.6.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: references/storyboard-frame-industrial.md §5 + jimeng-failure-modes.md case E
tags: [分镜图, prompt模板, 拟物化, NOT humans, 戏剧光, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "分镜图 prompt 是工业模板不是灵感创作；拟物IP必须逐主角单独声明『身体就是建筑本身』，复数共用子句必然穿帮"
skill_type: "template"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-storyboard-8block
evidence: E4

---

# 分镜图 8 段 prompt 模板

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot storyboard-frame-industrial §5）：分镜图 prompt 按八段组装——CHARACTER（角色+ref 引用）/ BACKGROUND（背景）/ ACTION（动作）/ SCENE（场景关系）/ CAMERA（机位景别）/ LIGHT（灯光）/ TEXT（画面文字，如字幕弹幕）/ STYLE（风格+NOT humans 子句）。拟物化 IP 的 STYLE 段必须**每个主角单独**写「X 的整个身体 IS [建筑] 本身 NOT a human wearing X NOT a human with headpiece」。另配 25+ 戏剧光关键词库（dramatic rim light 等）。

## I — 方法论骨架 (Interpretation)

1. **八段职责分离**：每段只管一件事，段内不越界——尤其 CHARACTER 段引用 ref 后，正文**禁止再重描身体**（ref 引用约 70% 权重 vs 文字 30%，重描=冲突=角色变形）。
2. **NOT humans 必须逐主角单独成句**：实测教训——复数共用「characters ARE X and Y NOT humans」会被模型理解为全场背景规则而不施加到具体主角，产出「人头戴塔当帽子」的 chibi 穿帮（一致性 1.5/5）；改为逐主角单独声明后一致性 5/5。
3. **戏剧光显式声明**：分镜图要电影感，STYLE/LIGHT 段必须显式写 dramatic/cinematic 光词；若上游流水线会自动拼接「视觉指纹」（neutral/flat 的 ref 风格词），必须关闭该拼接，否则戏剧光被中和。
4. **TEXT 段单处原则**：字幕/弹幕只描述 1 处出现位置+滚动动效，写「N 次刷屏」会被字面理解为画 N 个字幕标。

## A1 — 应用案例 (Past Application)

- 来源项目 case E：上海塔+深圳楼双主角 CP 镜，共用子句版本一致性 1.5/5（chibi 人戴塔头盔）；逐主角单独声明版本 5/5（真塔身）。
- 反例：TEXT 段写弹幕文案重复三遍 → 画面上真的画出三个字标。

## A2 — 触发场景 (Future Trigger)

- 用户要生成某镜首帧/分镜图，需要组装 prompt。
- 生成结果出现「人形穿帮」「画面平」「字幕重复」。
- 影策 Agent 帮用户写即梦/Seedance 分镜 prompt 时套用此模板。

## E — 可执行步骤 (Execution)

1. **按八段填空**：CHARACTER→BACKGROUND→ACTION→SCENE→CAMERA→LIGHT→TEXT→STYLE 逐段填写，不跳段。
   *完成标准*：八段齐全，每段职责不越界。
2. **CHARACTER 段纪律**：只写 ref 引用+位置关系，身体细节零重描。
   *完成标准*：正文无任何与 ref 冲突的身体描述。
3. **拟物声明**：拟物 IP 逐主角单独写「X 的整个身体 IS [建筑] 本身 NOT a human…」。
   *完成标准*：每个拟物主角有独立 NOT humans 句。
4. **TEXT 单处**：画面文字只写一处位置+动效。
   *完成标准*：无重复刷屏式文字描述。
5. **字数与风格复核**：组完检查总长与戏剧光词在位（配合 onlyshot-fail-triage 卡的 1500 字上限）。
   *完成标准*：字数合规且 LIGHT/STYLE 含显式戏剧光词。
