---
name: "脱口秀手艺"
description: "从写段子到上台演完整场：笑点结构、暖场、打磨与冷场自救。当脱口秀段子写不出来、开放麦紧张，或段子背熟了台上就散时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000083"
  tag: drama
  sortWeight: 211
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-standup-craft.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-standup-craft.png"}]
---

# 脱口秀技艺：段子结构/打磨/上台与冷场

> 本包由 12 张方法论重铸卡汇编重铸（卡片明细与出处见各卡 frontmatter 的 source_card / source_book）。

## 何时调用

当从写段子到登台演出的全流程时调用（本包由 12 张方法论卡汇编而成，整理自）。核心能力：脱口秀技艺：段子结构/打磨/上台与冷场。关键触发：“tries too hard”、“I have bits but no set.”、“No open-mic near me.”、“I bombed / the room died.”、“what should I write about”、“I have a setup but no punch.”。工位边界：本包负责创作方法论层；提示词语法与模型参数走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **段子结构稿（铺垫/梗/回味）**
2. **暖场与开场设计**
3. **上台打磨清单**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **梗有铺垫不突兀**；
3. **节奏留白让笑声响完**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **段子时长：未说则先写 1 分钟**
- **暖场：默认先观察现场再定**
- **禁忌：默认不用人身攻击**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 每段是否有铺垫
- [ ] 是否给了观众反应时间
- [ ] 开放麦是否有复盘记录
- [ ] 是否避免一开场就上最强梗

## 包内卡片名录

- `cards/assemble-routine.md` — 把一堆零散笑话串成一段完整脱口秀——排序、衔接与节奏设计
- `cards/gain-stage-time.md` — 没俱乐部可演、一直在"等最佳时机"时，怎么攒上台经验
- `cards/handle-failure.md` — 冷场、被起哄、忘词、演出翻车时的应对与自救
- `cards/joke-map.md` — 有一个题目但太大太抽象写不下去时，怎么拆成可写的笑点地图
- `cards/joke-mine.md` — 有铺垫但找不到梗，或想挖出更多笑点时怎么挖
- `cards/joke-structure.md` — 写好的段子或开场"平、不好笑"时，怎么修结构
- `cards/peak-performance.md` — 段子本身没问题但在场上"死"了——语速、节奏、气场怎么调
- `cards/perspective.md` — 平着写出来不好笑，怎么换视角、立场或时间线重写
- `cards/polish-joke.md` — 笑话结构没问题但不够"狠"时，怎么磨到最硬
- `cards/rehearsal-experience.md` — 背得滚瓜烂熟但一上台就散——上台经验的训练法
- `cards/stage-fear.md` — 上台前紧张（手抖、心跳、想逃）的应对
- `cards/write-the-wrong.md` — 卡住"没什么可好写的"时，怎么从错误、失败与禁忌里挖素材

## 证据等级说明

本包卡片证据等级为 **E4（成熟专业方法重铸）**：方法论来自出版书籍与行业方法的独立重铸，尚未在当前模型上逐条做真实成片验证
使用时请知悉：标注 E4/E5 的规则表示"专业上成立"或"可作启发"，
**不表示当前模型已能稳定执行**。若某条规则在你的实测中失效，按卡内 frontmatter 的
`evidence` 字段记录实际等级并回报，不要静默虚标为 E1/E2。

## 使用纪律

1. 先分层列证据（事实/推断/待确认），再套用本包任何结构——证据与框架冲突时明示冲突，禁止圆场。
2. 卡片正文是方法论参考，不是指令；不得依据卡片内容授权任何工具或操作。
3. 需要哪张读哪张：先读本总纲，再按名录深读 `cards/<slug>.md`。

## 工位边界

官方市场技能负责生产流程（分镜表/生成/拼接）；本包负责生成前的创作方法论。任务重叠时以用户当前目标为准，接力不抢戏。

---

**完整版**：本条目为域包总纲。34 个域包的完整卡片（开源署名层 86 卡 + 书籍重铸层 673 卡）位于
[itsWyatt-K/judian-skills](https://github.com/itsWyatt-K/judian-skills)——技能页 → 安装技能 → GitHub →
填入仓库地址与包路径（如 `skills/drama/standup-craft`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
