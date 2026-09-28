---
name: "喜剧 Mechanics"
description: "把平淡素材磨成好笑的段子与喜剧桥段：铺垫、升级、规则三连与角色笑点。当写喜剧桥段/段子、设计笑点与包袱，或素材明明有冲突却不好笑时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000074"
  tag: creative
  sortWeight: 202
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-comedy-mechanics.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-comedy-mechanics.png"}]
---

# 喜剧机制：前提/反差/反转/包袱与幽默生成

> 本包由 67 张方法论重铸卡汇编重铸（卡片明细与出处见各卡 frontmatter 的 source_card / source_book）。

## 何时调用

当写喜剧内容或表演喜剧时调用（本包由 67 张方法论卡汇编而成，整理自《超棒喜剧这样写》、《Step by Step to Stand-Up Comedy》、《The NEW Comedy Bible (Judy Carter, 2020)》、《崔凯文集·喜剧小品卷》、《王朔作品精选（套装共6册）》）。核心能力三层：① 创作——前提/反差/反转/包袱/三叠/配方齐不齐；② 表演——act-out 把「说」变「演」、timing 与停顿、排练与临场、砸场应对、脑内自我批评；③ 职业化——整场排序、段子串联、写作纪律、喜剧人设与冒犯边界。关键触发：“这段为什么不好笑”、“写不出梗 / 素材攒了一堆没成文”、“停顿把握不好 / 观众笑时我该不该说话”、“上台就僵 / 背稿就忘”、“整场怎么排序”、“这段能不能这么写（冒犯边界）”。工位边界：本包负责喜剧创作与表演方法论；提示词语法与模型参数走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **笑点结构拆解（铺垫/升级/梗）**
2. **桥段排序与节奏图**
3. **角色笑点配置**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **笑点有铺垫有兑现**；
3. **升级沿同一逻辑递进，不跳频道**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **笑点密度：未说则三段一梗**
- **角色：默认一主笑一冷面**
- **禁忌：默认不用贬低型笑点**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 每个梗是否有铺垫
- [ ] 升级是否沿同一逻辑
- [ ] 是否避免解释笑点（ Kill the joke ）
- [ ] 节奏是否有呼吸不连炸

## 包内卡片名录

- `cards/act-out.md` — 用于把"说"的笑话变成"演"的笑话——当你写的是陈述、观众没画面、或想让笑点更立体有戏
- `cards/act-outs-pov.md` — 当用户"讲段子像念稿、观众不投入""想把讲述改成表演""不懂 scene work / 走位 / 三视角"时调用
- `cards/act-outs-povs.md` — 当用户"讲段子像念稿、观众不投入""想把讲述改成表演""不懂 scene work / 走位"时调用
- `cards/bca-show-order.md` — 当用户"整场演出怎么排序""演完不知道怎么改""想建立持续进步的闭环"时调用
- `cards/chunwan-wuduan.md` — 春晚小品五段式结构
- `cards/comedy-buddy-seinfeld.md` — 用于建立写作纪律、对抗"断更/拖延/不敢拿出去"——当你素材攒了一堆却没成文、或写好了不敢演
- `cards/comedy-persona.md` — 用于打造一个可辨识、可记住的"台上的我"——当你要立喜剧人设、或觉得自己"台上台下一个样"没特点
- `cards/comic-timing.md` — 当用户"把握不好停顿""观众笑时我该不该说话""想理解什么是好 timing""麦克风举多高、站哪最合适"时调用
- `cards/critic-performer-space.md` — 当用户"排练时不断自我否定""上台后发挥不出、脑中持续自我批评""想分开'创造'与'打磨'"时调用
- `cards/ctb-comic-character.md` — 当用户说"怎么造一个好笑的角色"、"我的角色为什么不好笑"、"喜剧人设怎么立"时调用
- `cards/ctb-comic-premise.md` — 当用户说"喜剧前提怎么设"、"这个世界设定为什么不好笑"、"喜剧冲突有几种"时调用
- `cards/ctb-local-tactics.md` — 当用户说"三叠怎么写"、"先写个不好笑的占位再改"、"怎么 callback 收尾"时调用
- `cards/ctb-raise-stakes.md` — 当用户说"怎么让这段更紧张更好笑"、"这段为什么平淡"、"怎么设计紧张感"时调用
- `cards/ctb-tension-release.md` — 当用户说"怎么让包袱更响"、"笑点节奏怎么控"、"关键笑词放哪"时调用
- `cards/ctb-throughline.md` — 当用户说"怎么把点子长成完整喜剧故事"、"故事骨架怎么搭"、"喜剧主线九步"时调用
- `cards/ctb-tools-context.md` — 当用户说"怎么把不搭的东西凑一起"、"写个离谱回应"、"设计一对欢喜冤家"时调用
- `cards/ctb-truth-and-pain.md` — 当用户说"幽默到底是什么"、"为什么这个梗只有我懂别人不懂"、"怎么让笑话有共鸣"时调用
- `cards/cuowei-wuhui.md` — 误会与错位层层加码
- `cards/cws-brainstorm-edit.md` — 当用户说"创作流/破冰"、"成品成分诊断"、"写不出"时调用
- `cards/cws-exaggeration-shock.md` — 当用户说"夸张"时调用
- `cards/cws-mapp-targeting.md` — 当用户说"对谁讲才笑"、"受众定位"、"表演者人设"时调用
- `cards/cws-pow-wordplay.md` — 当用户说"字音/文字"、"意义/预期"、"形式/结构"时调用
- `cards/cws-reverse.md` — 当用户说"意义/预期"、"字音/文字"、"反转"时调用
- `cards/cws-simple-truth-takeoff.md` — 当用户说"简单真相"、"人人都懂的铺垫"、"借形改编"时调用
- `cards/cws-threes-formula.md` — 当用户说"我写的段子没人笑/不对劲，帮我看看"、"配方齐不齐"、"幽默到底由哪些成分构成"时调用
- `cards/cws-triple.md` — 当用户说"三单位节奏"、"误导+翻转"、"三叠"时调用
- `cards/fangaochao-liubai.md` — 冷幽默留白 / 反高潮结尾
- `cards/fearless-bombing.md` — 当用户"上台怯场""忘词/砸场/被起哄""不敢找机会演""担心喜剧越过伤痛线"时调用
- `cards/huangdan-jiangjie.md` — 荒诞降格解构
- `cards/jingwei-yugan.md` — 京味口语语感训练
- `cards/joke-binary-structure.md` — 当用户在写笑话/段子、或分析"为什么这个梗不好笑"时调用
- `cards/joke-economy.md` — 当用户"铺垫太长观众冷场""想让 punch 更响""改词时想让笑果更强"时调用
- `cards/joke-prospector-map.md` — 当用户"不知道写什么""素材想不出梗""选题太宽泛写不出来"时调用
- `cards/joke-prospector-mine.md` — 当用户"已经有一个 setup / 话题句，但挖不出包袱""punch 想不出来"时调用
- `cards/kom-active-emotion.md` — 动态情绪
- `cards/kom-archetype.md` — 原型
- `cards/kom-comedy-equation.md` — 喜剧方程式
- `cards/kom-comic-premise.md` — 喜剧前提
- `cards/kom-expectation-gap.md` — 期待与现实落差
- `cards/kom-funny-vs-comedy.md` — 好笑 vs 喜剧 辨析
- `cards/kom-joke-four-requirements.md` — 叙事笑话四要件
- `cards/kom-non-hero.md` — 非英雄
- `cards/kom-not-knowing.md` — 不知道
- `cards/kom-perspective-lens.md` — 隐喻关系 + 世界观 + 框架
- `cards/kom-positive-action.md` — 正向行为
- `cards/kom-rewriting.md` — 喜剧重写
- `cards/kom-sitcom-family.md` — 迷人的失能家庭
- `cards/kom-straight-wavy-line.md` — 直线 / 波浪型曲线
- `cards/kom-tools-for-repair.md` — 工具只在"坏掉时"用于维修
- `cards/kom-winning.md` — 获胜
- `cards/mixes.md` — 用于给任何笑话"追加"一个低成本高产的扩展笑点——当你素材不够、或想把一个梗撑大
- `cards/piwei-kaichang.md` — 痞味第一人称开场
- `cards/premise-opposition.md` — 当用户"写不出 punch-premise""punch 与 setup 像同调重述不好笑""分不清 punch-pre
- `cards/rehearsal-process.md` — 当用户"背稿上台就僵""排练时总忘词""想让表演自然不机械"时调用
- `cards/reveal-at-end.md` — 当用户"抖包袱时观众先笑了我还没说完""punch 的笑点被自己提前泄了""想知道为什么包袱要放最后"时调用
- `cards/routine-builder.md` — 当用户"有一堆零散笑话但串不成段子""段子之间衔接生硬""不知道怎么排序和存档"时调用
- `cards/rule-of-three.md` — 当用户"写列表/排比想埋笑点""段子里有'一、二、三'但不好笑""想用节奏制造 punch"时调用
- `cards/self-mocking-formula.md` — 用于把"弱点/尴尬/惨"变成素材和安全讨喜的人设——当你想自嘲、立亲和力人设、或避免嘲他踩雷
- `cards/shijing-duizui.md` — 市井对白节奏与斗嘴
- `cards/stand-up-structure.md` — 用于从零搭一个笑话/段子结构，或诊断"为什么不好笑""这到底算不算笑话""铺垫写不出来"
- `cards/tag-jokes.md` — 当用户"一个 setup 只拿到一次笑，想多拿""笑话讲完还能再追一句吗""想提高每分钟笑声 LPM"时调用
- `cards/ten-commandments.md` — 用于把握喜剧行业的职业立场与冒犯边界——当你写冒犯/敏感/政治正确相关内容，想既犀利又不翻车
- `cards/turn-list-of-three.md` — 用于给笑话"转向"制造惊喜落点——当你写的 punch 太平、或想学 List of Three 的节奏型笑点
- `cards/waici-baofu.md` — 方言谐音与"歪词"包袱库
- `cards/zhoujin-renshe.md` — 乡土"轴劲"人物塑造
- `cards/zichao-fanzhao.md` — 反讽自嘲人设
- `cards/zichao-redian.md` — 荒诞自嘲人设 × 时代热点嫁接

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
填入仓库地址与包路径（如 `skills/drama/comedy-mechanics`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
