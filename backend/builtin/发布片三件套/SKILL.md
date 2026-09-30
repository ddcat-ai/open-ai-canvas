---
name: "发布片三件套"
description: "一条素材打全平台：A/B 变体、卡点揭晓与多画幅适配。当新品发布片平铺直叙、要一素材多发，或竖屏版主体被裁时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000101"
  tag: ecommerce
  sortWeight: 230
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-iart-launch-trio.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-iart-launch-trio.png"}]
---

# iart 发布三件套：A/B 变体/卡点揭晓/发布弧光/多画幅

> 本包由 4 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当为发布片做 A/B 素材变体、卡点揭晓剪辑、多画幅适配时调用（本包由 4 个方法论技能汇编而成）。核心能力：iart 发布三件套：A/B 变体/卡点揭晓/发布弧光/多画幅。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **A/B 素材变体组（变量唯一可归因）**
2. **卡点揭晓剪辑点表**
3. **多画幅适配方案（16:9/9:16/1:1）**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **变体之间只差测试变量**；
3. **卡点落在音乐节拍与爆点上**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **变体数量**：未说则先出 3 个
- **画幅**：默认横版打底再适配竖版
- **安全区**：竖版必须预留字幕位

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 变体之间是否只有一个变量不同
- [ ] 卡点是否精确落拍
- [ ] 竖屏版主体是否被裁
- [ ] 字幕是否被 UI 遮挡

## 包内卡片名录

- `cards/iart-ab-batch-variants.md` — 单变量隔离纪律 + 钩子-CTA 配对律 + 数据驱动模板（variant 对象+帧函数确定性渲染）+ 广告解剖五拍表
- `cards/iart-beat-sync-reveal.md` — 卡点三律（先测 drop 时间码/切在瞬态上/撞击前 ramp 后硬切）+ 蒙太奇节拍驱动法（0.6-1.0s 一拍一卖点）
- `cards/iart-launch-arc.md` — 发布片五拍弧线（hook→tease→reveal→feature montage→end card）+ 30s 比例分配表 + 15s/6
- `cards/iart-multi-aspect.md` — 中心安全区法则（关键内容装 1:1 中心方区）+ 三画幅安全区参数表 + 母版渲染后重构（非信箱）法则

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
填入仓库地址与包路径（如 `skills/ecommerce/iart-launch-trio`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
