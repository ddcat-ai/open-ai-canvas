---
name: "对白工坊"
description: "把'不像人话'的对白改成带行动与潜台词的对话：对白即动作、问诊式修改。当对白空洞、人人一个语气，或台词只负责解释信息时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000075"
  tag: drama
  sortWeight: 203
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-dialogue-workshop.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-dialogue-workshop.png"}]
---

# 对白工坊：对白即动作、潜台词与表达姿态

> 本包由 19 张方法论重铸卡汇编重铸（卡片明细与出处见各卡 frontmatter 的 source_card / source_book）。

## 何时调用

当写对白、修对白、用对白推进故事时调用（本包由 19 张方法论卡汇编而成，整理自《故事写作大师班》、《对白：文字、舞台、银幕的言语行为艺术》、《崔凯文集·喜剧小品卷》、《我爱我家台词》、《把自己当回事儿》）。核心能力：对白工坊：对白即动作、潜台词与表达姿态。关键触发：“我的对白全是交代剧情”、“太平了／没味道／不像人话”、“推不动／重复／拖沓”、“读着别扭／假／出戏”、“还没想清楚。
2. 写完后角色行为突兀，被问”、“解释性大肚子”。工位边界：本包负责创作方法论层；提示词语法与模型参数走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **对白改写稿（带潜台词标注）**
2. **对白问诊清单**
3. **角色声音样本**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **对白是行动不是解释**；
3. **每句话只可能出自这个人**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **信息量：未说则一场只推进一个信息**
- **长度：默认短句，避免独白式解释**
- **方言：按角色身份定，不为特色强加**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 是否每句都有潜台词或行动
- [ ] 是否能仅凭对白分出台词是谁说的
- [ ] 是否有角色在解释观众已经知道的事
- [ ] 是否避免书面语与人设冲突

## 包内卡片名录

- `cards/mckee-dialogue-as-action.md` — 对白＝以言行事
- `cards/mckee-dialogue-beats.md` — 潜文本与节拍拆解
- `cards/mckee-dialogue-clinic.md` — 对白六项任务与瑕疵诊断
- `cards/mckee-dialogue-desire.md` — 欲望五维与行为五步
- `cards/mckee-dialogue-exposition.md` — 解说投放与时机
- `cards/mckee-dialogue-in-character.md` — 在角色内写作
- `cards/mckee-dialogue-last-step.md` — 对白是最后一步
- `cards/mckee-dialogue-structure.md` — 对话结构与三边对话
- `cards/pola-duibai.md` — 泼辣对白斗嘴
- `cards/story-dialogue-three-tracks.md` — 对白三音轨
- `cards/wojia-vocal-signature.md` — 声口复用
- `cards/yt-consensus-build.md` — 共识拆解
- `cards/yt-direct-clarity.md` — 直接零误解
- `cards/yt-emotion-not-weapon.md` — 情绪非武器
- `cards/yt-expectation-buffer.md` — 预期管理三步
- `cards/yt-own-the-error.md` — 主动负责
- `cards/yt-persona-boundary.md` — 人设即边界
- `cards/yt-sincerity-boundary.md` — 真诚设边界
- `cards/yt-story-hook.md` — 故事化表达

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
填入仓库地址与包路径（如 `skills/drama/dialogue-workshop`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
