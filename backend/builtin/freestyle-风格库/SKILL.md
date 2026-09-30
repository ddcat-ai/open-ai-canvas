---
name: "Freestyle 风格库"
description: "把风格库模板稳定落成最终提示词：模板匹配、六块组装与常见工件排查。当套模板出图风格飘了、提示词缺块导致模型自由发挥，或多概念图互相污染时调用。"
metadata:
  version: "1.0.0"
  author: "剧典技能库（itsWyatt-K）"
  owner: "community-itswyatt-k"
  skillId: "16000000000089"
  tag: creative
  sortWeight: 217
  source: 3
  createdAt: 1790049275000
  updatedAt: 1790049275000
  initialLikeCount: 0
  initialAddedCount: 0
  authorAvatarUrl: ""
  extraInfo: ""
  showcaseMedia: [{"type":"image","showcase_uri":"github:showcase/pack-freestyle-style-library.png","showcase_url":"https://raw.githubusercontent.com/itsWyatt-K/judian-skills/main/showcase/pack-freestyle-style-library.png"}]
---

# freestylefly 风格库：避坑/提示词积木/模板匹配

> 本包由 3 个开源方法论技能汇编（原卡全文见 `cards/` 目录，逐卡保留来源与许可）。

## 何时调用

当套用或改造 GPT Image 风格模板、排查生图质量问题时调用（本包由 3 个方法论技能汇编而成）。核心能力：freestylefly 风格库：避坑/提示词积木/模板匹配。工位边界：本包负责生成前的提示词工程与方法论；生产流程（分镜表/生成/拼接）走影策官方市场技能，两者接力不抢戏。

## 本包交付什么

用户提出需求时，本包最终交付：

1. **最终提示词（六块组装完成）**
2. **风格模板选择与理由**
3. **常见工件排查清单**

### 内容保真优先级

冲突时按此顺序裁决，禁止圆场：

1. **用户明确指定**（时长/风格/禁项/参考职责）；
2. **风格标签与画面元素不互相污染**；
3. **模板匹配先于自由发挥**；
4. 风格与质感装饰。

### 默认决策

用户未指定时采用，并在交付前用一句话说明选了什么：

- **模板：未说则由主题自动选最接近的**
- **概念数量：默认单概念，多概念需用户明确**
- **画幅：默认 16:9**

### 质量门槛

交付前逐项自检，任一项不过就改完再交：

- [ ] 六块是否齐全（无缺块导致模型自由发挥）
- [ ] 风格标签是否唯一主风格
- [ ] 是否有模板跑偏的典型工件
- [ ] 文字区域是否预留且不与主体重叠

## 包内卡片名录

- `cards/freestyle-pitfalls.md` — 模板陷阱清单（长段塞图/模块数超限/文字不可读/布局通用化/尺度框同质）+ 对应约束写法
- `cards/freestyle-prompt-blocks.md` — 六块组装（主体与任务/构图与布局/视觉风格与材质/文字与标签要求/画幅与输出格式/约束与负向细节）+ 多概念同模板复用变体法
- `cards/freestyle-template-match.md` — 四级匹配序（模板类目→视觉风格标签→场景标签→最近案例）+ 请求模糊时呈现 2-3 个方向让用户选 + 输出必带模板名

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
填入仓库地址与包路径（如 `skills/creative/freestyle-style-library`）即可安装，Agent 可按总纲名录逐卡深读。
来源与许可见各卡 frontmatter：开源署名层逐卡标注 source/license（MIT/Apache-2.0/CC-BY-4.0/官方文档署名）；
书籍重铸层标注 source_book + attribution（方法论自撰重写，不复制原文表达）。
