---
name: "短片五阶段结构"
description: "在几分钟里讲完一个故事：五阶段结构、微短剧形态与多镜锁定。当短片结构散、讲不完一个完整故事，或想在极短时长里留住人时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000080"
  tag: drama
  sortWeight: 208
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-shortfilm-structure.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-shortfilm-structure.png"}]
---

# 短片五段式结构：阶段/微短剧/多镜锁定/模板分支/IP 安全

> 本包由 5 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当搭短片或微短剧的叙事结构、锁多镜一致性、查 IP 风险时调用（本包由 5 个方法论技能汇编而成）。核心能力：短片五段式结构：阶段/微短剧/多镜锁定/模板分支/IP 安全。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **五阶段结构表**
2. **微短剧形态选择**
3. **多镜锁定方案**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **极短时长内完成一个变化**；
3. **五阶段不省略但可压缩**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **时长：未说则按 1-3 分钟**
- **阶段：默认五阶段全走，压缩不跳**
- **结尾：默认留一个可回味收口**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 是否有明确的变化发生
- [ ] 五阶段是否可指认
- [ ] 是否能在时长内讲完
- [ ] 结尾是否不解释过多

## 包内卡片名录

- `cards/shortfilm-5stage-structure.md` — 五段式结构（核心主题|角色与场景|氛围与质感|镜头规则|分镜）+ 模型无关核心+模型尾注一行
- `cards/shortfilm-ip-safety.md` — IP 安全三级处置（自创触发短语替代/保留结构去专名/平台差异表）+ Seedance 屏蔽 IP 名的事实
- `cards/shortfilm-micro-drama.md` — 竖屏短剧三件套——黄金 3 秒钩子 + 正反打对话 + 集尾断章，含竖屏构图约束
- `cards/shortfilm-multi-shot-lock.md` — 两把锁——主体登记表（每个主体的不变特征清单）+ 氛围锁定（色调/光线/质感基调），写第一镜前必落
- `cards/shortfilm-template-branch.md` — 21 类型模板分支选择 + 3+ 镜剪辑片必走的两把锁（主体登记+氛围锁定）

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
填入仓库地址与包路径（如 `skills/drama/shortfilm-structure`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
