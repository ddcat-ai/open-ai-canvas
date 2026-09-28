---
name: "系列弧光规划"
description: "让一部剧越看越想看：季弧规划、试播集设计与分集人物刻画。当系列中段疲软、观众追不下去，或试播集留不住人时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000079"
  tag: drama
  sortWeight: 207
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-series-arc-planning.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-series-arc-planning.png"}]
---

# 系列叙事规划：分集大纲/季弧光/剧集圣经

> 本包由 16 张方法论重铸卡汇编重铸（卡片明细与出处见各卡 frontmatter 的 source_card / source_book）。

## 何时调用

当把单集变成留得住观众的系列时调用（本包由 16 张方法论卡汇编而成，整理自《Writing the TV Drama Series, 3rd Edition》）。核心能力：系列叙事规划：分集大纲/季弧光/剧集圣经。关键触发：“但每条线散、看不到哪条线在某幕断了，需要颜色卡片式追踪多线分布。
3. 用户纠结”、“温吞/没张力”、“这集过一遍质检 / 质量清单”、“人格跳变”、“借用设定的独立电影”、“能不能做长系列”。工位边界：本包负责创作方法论层；提示词语法与模型参数走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **季弧规划（主线/副线/关键节点）**
2. **试播集设计**
3. **分集人物刻画表**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **人物关系随季度演进**；
3. **试播集独立成立又勾住长线**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **季长**：未说则按平台规格定
- **试播集**：默认先立人物再抛主线
- **副线**：最多两条

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 每集是否推进至少一条线
- [ ] 试播集是否留得住人
- [ ] 人物是否随季度改变
- [ ] 是否避免中段疲软（有无节点设计）

## 包内卡片名录

- `cards/tvd-a-b-c-stories.md` — tvd-a-b-c-stories — A-B-C 并行故事线
- `cards/tvd-dramatic-beat.md` — tvd-dramatic-beat — 戏剧节拍
- `cards/tvd-episode-quality-checklist.md` — 单集质量质检清单
- `cards/tvd-episodic-characterization.md` — tvd-episodic-characterization — 系列角色塑造与无尽弧光
- `cards/tvd-finding-stories-filter.md` — 选故事四准则过滤器
- `cards/tvd-franchise-springboards.md` — tvd-franchise-springboards — 特许经营边界 + 弹簧板引擎 + 续航力
- `cards/tvd-grid-reverse-engineering.md` — tvd-grid-reverse-engineering — 网格 + 反向工程
- `cards/tvd-long-narrative-types.md` — tvd-long-narrative-types — 长叙事三型与混合结构
- `cards/tvd-original-within-franchise.md` — tvd-original-within-franchise — 在类型内原创的悖论
- `cards/tvd-outline-color-cards.md` — 大纲 + 颜色卡片多线追踪
- `cards/tvd-pilot-design.md` — Pilot 设计
- `cards/tvd-platform-agnostic-pendulum.md` — 钟摆中心 / 平台无关性
- `cards/tvd-season-arc-planning.md` — 季弧规划
- `cards/tvd-season-bible.md` — Season Bible / Overview 总纲文档
- `cards/tvd-tent-poles-worst-case.md` — tvd-tent-poles-worst-case — 三帐篷柱 / 最坏情况锚定
- `cards/tvd-world-extension-canon.md` — 故事世界延展

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
填入仓库地址与包路径（如 `skills/drama/series-arc-planning`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
