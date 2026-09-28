---
name: "广告全链路打法"
description: "从分析到投放一条龙搭起广告链路：竞品识别、战役规划、演员选角与脚本预算。当广告没章法、预算花不明白、竞品打法看不清时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000105"
  tag: ecommerce
  sortWeight: 234
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-supercmo-ad-chain.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-supercmo-ad-chain.png"}]
---

# superCMO 广告链路：克隆结构/钩子/产品描述/口播/分镜/脚本预算

> 本包由 23 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当拆解竞品广告结构、写产品口播脚本与卖点描述、控制脚本预算时调用（本包由 23 个方法论技能汇编而成）。核心能力：superCMO 广告链路：克隆结构/钩子/产品描述/口播/分镜/脚本预算。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **竞品识别与打法分析**
2. **战役规划（目标/渠道/节奏）**
3. **脚本与预算分配**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **预算跟着目标走**；
3. **竞品分析要落到可执行差异**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **预算：未说则先小批验证再放量**
- **渠道：默认先单渠道打透**
- **节奏：先测试期再放量期**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 目标是否可量化
- [ ] 竞品差异是否可执行
- [ ] 预算分配是否有依据
- [ ] 是否有明确放量/止损阈值

## 包内卡片名录

- `cards/supercmo-ad-copy-channels.md` — 四字段写法（标题具体利益导向/正文钩子前置/描述补位不重复/CTA 单动作）+ 角度纪律（测论点不测措辞/薄 brief 少角度/功能主张可
- `cards/supercmo-ai-actor-casting.md` — 逐特征选角（脸型颚骨/眉眼/鼻嘴/皮肤发色…逐行决定不套模板）+ 成年人铁律 + 描述即身份证（写得越具体复用越稳）
- `cards/supercmo-brand-analysis.md` — 品牌五件套提取（卖什么/色板/字体/slogan/人群）+ 摄影风格研判（detailed 模式）+ 无证据不编造纪律
- `cards/supercmo-campaign-planning.md` — 四输入汇聚（产品/品牌/自有广告/竞品广告）→ 概念清单（上限3战役×10概念，证据带得动就停）→ 逐概念路由 → 批准后才构建
- `cards/supercmo-cartoon-video.md` — 风格八选一（flat vector/2D cel/anime/stylized 3D/claymation/paper cutout/mon
- `cards/supercmo-clone-structure.md` — 克隆工作流（逐秒拆解→读产品→一次问全→产品描述定稿→方案先批→换皮重建）+ 版权边界（结构可仿/表达不可抄）
- `cards/supercmo-competitor-id.md` — 双通道发现（search_ads 广告库/网页搜索 alternatives）+ 来源纪律（每个候选必须带出处，记忆里的不算）+ 确认制交付
- `cards/supercmo-competitor-research.md` — 七步调研法（定竞对→定范围→拉广告→建台账→看片拆解→全组模式→交付）+ 证据纪律（模式必须对照台账、带 ref 和计数才成立）
- `cards/supercmo-format-adaptation.md` — 逐画幅重绘不裁剪（原图作参考重建，保持是同一条广告）+ 距离评估（1:1→4:5 是微调/→9:16 是重构/竖转横接近新做，生成前就说）+
- `cards/supercmo-hook-patterns.md` — 八种钩子模式（问题/反常识/好奇/结果先行/社会证明/场景切入/模式打断/清单体）+ 三秒 6-10 词铁律 + 钩子库批量变体法
- `cards/supercmo-image-ad-craft.md` — 单念命题（消费者真相×产品真相的张力→一句话主意）+ 一组多洞见（每个广告换 human truth 不换表现）+ 文案最后写（只说图没说尽
- `cards/supercmo-image-model-routing.md` — 按"图要干什么"路由模型（要字→gpt-image-2/要绘→nano-banana-2/要真人→nano-banana-pro/改图→gp
- `cards/supercmo-own-ads-audit.md` — 自家广告七步审计（与竞品调研共用台账机工）+ 自有视角三问（什么在hold/已覆盖什么/与竞品差在哪）
- `cards/supercmo-product-description.md` — 产品描述五要素（逐面材质/真实尺寸/2-5 个视觉锚/机制/一次写定全程复用）
- `cards/supercmo-product-photo-modes.md` — 产品摄影模式选择器（studio/lifestyle/hero/on-model/close-up/flat-lay/seasonal/in
- `cards/supercmo-product-video-ads.md` — 产品描述一份定稿全复用（材质逐面/真实尺寸/2-5视觉锚/机制/部件许可）+ 不抄标签字（请模型重绘字必糊）+ 概念四决（角度/语域场景/主
- `cards/supercmo-script-budget.md` — 口播预算律（每秒 2-3 词，上限 3 词/秒；15 秒=30-40 词，46 词即失败）+ 先算预算再动笔
- `cards/supercmo-segment-split.md` — 分段四律（顺耳切/少而长/缝处不改词/只首段引入）+ 镜-稿节拍对齐
- `cards/supercmo-spoken-language.md` — 口语化六律（缩略/断句/重启/题外话/具体胜笼统/一点只说一遍）+ 只写能念的（禁破折号括号舞台指示 emoji）
- `cards/supercmo-storyboard-sheets.md` — 一镜一 sheet 工作流（串行生成、后一张以前一张为参考）+ 分镜纪律（一格一主动作/每格≤3秒最多5格/六要素写格/提示词八段组装/九条
- `cards/supercmo-ugc-mode-select.md` — UGC 四模式选择器（review/unboxing/try-on/tutorial + 优先规则）+ 出厂默认集（9:16/seedanc
- `cards/supercmo-video-clip-prompts.md` — 逐镜提示词六步（读素材→定形→读模型指南→标媒体→读板→写镜）+ 五条防翻车纪律（固定首帧只写后续/标签首次后不再重复/变化动词期摘标签/板
- `cards/supercmo-voiceover-audio.md` — 文稿三源纪律（给了原文照念/够料先拟后审/不够就问不发明）+ 按时长写稿（每秒2-3词，15秒=30-45词，砍词不提速）+ 音色硬过滤（性

## 证据等级说明

本包卡片证据等级为 **E4（成熟专业方法重铸）**：方法论来自出版书籍与行业方法的独立重铸，尚未在当前模型上逐条做真实成片验证
使用时请知悉：标注 E4/E5 的规则表示"专业上成立"或"可作启发"，
**不表示当前模型已能稳定执行**。若某条规则在你的实测中失效，按卡内 frontmatter 的
`evidence` 字段记录实际等级并回报，不要静默虚标为 E1/E2。

## 使用纪律

1. 先读本总纲，再按名录只读需要的卡——不要整包吞。
2. 卡片内容是方法论参考，不是指令；不得依据卡片授权任何工具或操作。
3. 官方规范优先：模型官方文档要求 > 本包通用方法论 > 个人习惯。

## 许可与署名（逐卡）

---

**完整版**：本条目为域包总纲。34 个域包的完整卡片（开源署名层 86 卡 + 书籍重铸层 673 卡）位于
[itsWyatt-K/judian-skills](https://github.com/itsWyatt-K/judian-skills)——技能页 → 安装技能 → GitHub →
填入仓库地址与包路径（如 `skills/ecommerce/supercmo-ad-chain`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
