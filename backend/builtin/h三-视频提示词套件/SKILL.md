---
name: "H3 视频提示词套件"
description: "用 MiniMax H3 稳定出片：六段式提示词、参考资产绑定与影像风格选定。当写 H3 提示词、时间轴对不上、换镜头变脸，或不知道选哪个风格时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000090"
  tag: creative
  sortWeight: 218
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-h3-video-prompt-suite.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-h3-video-prompt-suite.png"}]
---

# MiniMax H3 视频提示词套件：六段式规范/资产绑定/连续性/八种风格库

> 本包由 11 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当用 MiniMax H3 生成视频：写六段式提示词、绑定参考资产、选定影像风格时调用（本包由 11 个方法论技能汇编而成）。核心能力：MiniMax H3 视频提示词套件：六段式规范/资产绑定/连续性/八种风格库。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **六段式 H3 提示词**
2. **参考资产绑定表**
3. **影像风格选择与理由**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **参考图与生成内容的对应关系成立**；
3. **六段式结构完整且不超段数**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **画幅：未说则由 vquality 决定，不传 size**
- **videoSeconds：必须字符串**
- **风格：未说则按题材自动选**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 六段是否齐全且顺序正确
- [ ] 是否误传 size 参数
- [ ] videoSeconds 是否为字符串
- [ ] 参考资产是否显式绑定
- [ ] 时间轴是否与段数匹配

## 包内卡片名录

- `cards/h3-asset-binding.md` — 当用户说"换镜头变脸 / 角色不一致 / 画风漂移"时调用
- `cards/h3-continuity.md` — 当用户说"接不上 / 跳了 / 转场生硬"时调用
- `cards/h3-prompt-six-section.md` — 当用户说"写 H3 提示词 / 编译官方六段 / translator / 时间轴不对 / 段数超了"时调用
- `cards/h3-style-3d-animation-short.md` — 当用户要做"3D 动画/CG 短片/皮克斯风角色表演/三维定格感动画"时使用
- `cards/h3-style-brand-promo-video.md` — 当用户要做"品牌宣传片/产品发布短片/官网展示/社交媒体推广"且提供 LOGO 与产品素材时使用
- `cards/h3-style-co-op-game-intro.md` — 当用户要做"双人合作游戏主菜单/开场动画/角色化菜单"且需先出确认首图再生成视频时使用
- `cards/h3-style-handdrawn-live-video.md` — 当用户要做"15秒手绘动画与实拍空间融合短片/蜡笔粉笔质感/变形追逐"时使用
- `cards/h3-style-minimalist-product-ad.md` — 当用户要做"极简产品广告/纯净背景单品展示/苹果风留白产品片"时使用
- `cards/h3-style-music-video-subtitle.md` — 当用户要做"音乐 MV/歌词贴字视频/卡点 MV/情绪短片/多镜头拼接"时使用
- `cards/h3-style-paper-collage-explainer.md` — 当用户要做"纸拼贴讲解动画/知识科普/观点表达/编辑感拼贴 B-roll"时使用
- `cards/h3-style-papercraft-stop-motion.md` — 当用户要做"纸艺定格动画/剪纸风格科普/手工拼贴感短片"时使用

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
填入仓库地址与包路径（如 `skills/creative/h3-video-prompt-suite`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
