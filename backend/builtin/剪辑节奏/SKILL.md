---
name: "剪辑节奏"
description: "把静态对话戏剪得有节奏：连续性、平行剪辑与转场。当片子拖沓、对话戏闷、转场生硬时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000088"
  tag: drama
  sortWeight: 216
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-editing-rhythm.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-editing-rhythm.png"}]
---

# 剪辑节奏：连续性/转场/平行剪辑与 montage

> 本包由 4 张方法论重铸卡汇编重铸（卡片明细与出处见各卡 frontmatter 的 source_card / source_book）。

## 何时调用

当用剪辑控制节奏与信息释放时调用（本包由 4 张方法论卡汇编而成，整理自《导演功课》）。核心能力：剪辑节奏：连续性/转场/平行剪辑与 montage。关键触发：“静态对话怎么剪得流畅”、“两条故事线怎么交替叙述”、“场景间怎么转场/时间过渡”、“为什么要用 re-establishing 镜头”、“动作与反应怎么并置剪”、“叠化 dissolve 和淡入淡出区别”。工位边界：本包负责创作方法论层；提示词语法与模型参数走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **静态对话戏的剪辑方案（机位与剪切点）**
2. **平行剪辑的交叉点设计**
3. **转场方式与时机**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **动作与视线的连续性不被切断**；
3. **剪切点落在信息或情绪的变化处**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **剪切节奏：未说则先按台词呼吸切**
- **转场：默认用匹配剪辑而非特效**
- **平行线数量：最多两条，避免观众迷失**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 每次剪切是否改变了信息或关系
- [ ] 屏幕方向是否全程一致
- [ ] 转场是否有叙事理由而非装饰
- [ ] 是否保留必要的反应镜头

## 包内卡片名录

- `cards/dm-montage-narrative.md` — 
- `cards/gfl-continuity.md` — 当用户说"静态对话怎么剪得流畅"、"为什么要用 re-establishing 镜头"、"静默反应怎么用"时调用
- `cards/gfl-parallel-editing.md` — 当用户说"两条故事线怎么交替叙述"、"动作与反应怎么并置剪"、"平行剪辑和交叉剪辑区别"时调用
- `cards/gfl-transitions.md` — 当用户说"场景间怎么转场/时间过渡"、"叠化 dissolve 和淡入淡出区别"、"划变 wipe 怎么用"时调用

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
填入仓库地址与包路径（如 `skills/creative/editing-rhythm`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
