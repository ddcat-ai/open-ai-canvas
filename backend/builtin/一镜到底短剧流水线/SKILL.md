---
name: "一镜到底短剧流水线"
description: "把一镜到底从想法推到成片：三阶段成本、时长变化与失败排查。当拍一镜到底超预算、节奏单调，或拍废了不知道怎么救时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000077"
  tag: drama
  sortWeight: 205
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-onlyshot-shortform-pipeline.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-onlyshot-shortform-pipeline.png"}]
---

# OnlySHOT 短剧流水线：三阶段成本/时长变体/失败分诊/八块分镜

> 本包由 9 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当用 OnlySHOT 方法论跑短剧生产：成本控制、分镜、参考一致性、失败排查时调用（本包由 9 个方法论技能汇编而成）。核心能力：OnlySHOT 短剧流水线：三阶段成本/时长变体/失败分诊/八块分镜。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **三阶段成本估算表**
2. **一镜到底的分镜与走位**
3. **失败排查与抢救方案**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **时空连续不被切断**；
3. **成本先估算后开拍**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **时长：未说则先做 15 秒验证**
- **阶段：默认三阶段逐步推进**
- **预算超支：先砍景不砍连续性**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 时空是否连续可判
- [ ] 成本是否分阶段列明
- [ ] 失败是否有分级抢救方案
- [ ] 节奏是否单调（有无变化设计）

## 包内卡片名录

- `cards/onlyshot-3phase-cost.md` — 三阶段成本分层——创作（剧本+ref图）→分镜图（每镜静态首帧）→出片（视频），用静态图先锁构图再烧视频钱
- `cards/onlyshot-duration-variation.md` — 时长变奏分布铁律（快切4s×11 + 默认5s×14 + 慢推6s×5 + 特写7s×3 + 慢镜8-10s×3）与配套 7 条内容铁律
- `cards/onlyshot-fail-triage.md` — 三类失败完全区分（字数超限/内容审核/网络限流）+ prompt 1500 字符硬上限与实测分布 + 字数必须程序实测
- `cards/onlyshot-redfruit-7beats.md` — 红果必爆 7 节点节奏骨架——0-3s 对抗开场、25-32s 爆破、55-65s 首爽、85-95s 反转、115-125s 大爽、145
- `cards/onlyshot-ref-consistency.md` — 多 ref 一致性衰减规律 + ref 引用与文字描述的权重冲突 + 长 prompt 必须串行的并发参数
- `cards/onlyshot-ref-identity-block.md` — ref 图 6 段 identity block 写法 + 视觉指纹放 prompt 开头 + 警惕四视图水印陷阱
- `cards/onlyshot-sensitive-words.md` — 四类敏感词替换表（反派词/暧昧词/中文敏感词/街拍词）+ 颜色词 dark 改 deep 可消除约九成误触
- `cards/onlyshot-storyboard-8block.md` — 分镜图 8 段 prompt 模板 + 每个主角单独写 NOT humans 子句
- `cards/onlyshot-video-mode-picker.md` — 四种视频生成模式按文件条件自动选择

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
填入仓库地址与包路径（如 `skills/drama/onlyshot-shortform-pipeline`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
