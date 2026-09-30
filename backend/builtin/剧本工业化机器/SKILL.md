---
name: "剧本工业化机器"
description: "把剧本从手工活变成流水线：情绪合同、分集规格、对白问诊与机器自检。当剧本量产慢、每集质量波动大，或想建立可验收的分集标准时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000076"
  tag: drama
  sortWeight: 204
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-factory-script-machine.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-factory-script-machine.png"}]
---

# 剧本工厂：一句创意→多集剧本的对白/情绪/规格/台账/机器检查

> 本包由 5 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当把一句创意扩成多集付费墙剧本、做对白与情绪契约检查时调用（本包由 5 个方法论技能汇编而成）。核心能力：剧本工厂：一句创意→多集剧本的对白/情绪/规格/台账/机器检查。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **情绪合同（每集情绪曲线）**
2. **分集规格（字段与验收标准）**
3. **对白问诊记录**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **每集情绪目标可验收**；
3. **规格先于写作，不边写边定**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **集数：未说则按平台规格定**
- **情绪点密度：默认每 30 秒一个**
- **验收：先过规格再过文采**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 每集是否有明确情绪目标
- [ ] 规格字段是否齐全
- [ ] 情绪曲线是否有峰值不平板
- [ ] 是否可机器自检而非只靠人读

## 包内卡片名录

- `cards/factory-dialogue-doctor.md` — 台词七维诊断（语言指纹/反向灌输死刑/攻防回合制/单句字数）+ 改写案例法
- `cards/factory-emotion-contract.md` — 情绪契约单元链——契约贯穿全剧、矛盾按单元跑（单矛盾 20-30 集必闭环）、换矛盾不换情绪、付费墙挂单元接缝
- `cards/factory-episode-specs.md` — 单集硬规格（90-120 秒/实拍 350-500 字/漫剧 260-400/场景≤2/语速 3.5-4.5 字每秒/前 3 秒钩/往返回合
- `cards/factory-ledger.md` — 连续性台账四类账（伏笔/人物/道具/规则）+ 读写规程（写前读台账、写后更新，无台账不开写）
- `cards/factory-machine-check.md` — 双机检脚本（单集 validate_episode + 全剧 validate_series）检查项清单 + FAIL 必修纪律 + 合规一

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
填入仓库地址与包路径（如 `skills/drama/factory-script-machine`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
