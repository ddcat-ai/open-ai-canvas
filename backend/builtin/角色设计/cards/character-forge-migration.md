---
name: character-forge-migration
description: "旧技能「角色锻造工坊」的兼容索引；把人物内核、弧光、维度、关系网、视觉编码和角色资产直达角色设计包内的现有卡片。"
tags: [角色锻造工坊, 人物弧光, 角色维度, 关系网, 特质设计]
evidence: E4
source: "原 角色锻造工坊 (16000000000073)，作者：剧典技能库（itsWyatt-K）"
---

# 「角色锻造工坊」旧名直达

旧技能 `角色锻造工坊`（`16000000000073`）已并入 `角色设计`。兼容入口只保留旧名和常用卡片路线。

## 按人物问题读卡

| 当前问题 | 直接读 |
|---|---|
| 人物只有标签，没有欲望、矛盾和信念 | `cards/core-and-mechanisms.md` |
| 主角没有成长、弧光像走过场 | `cards/mckee-character-arc.md`、`cards/tct-fatal-flaw-arc.md` |
| 人物太扁、特质像列表 | `cards/tct-build-balanced-character.md` |
| 配角彼此雷同，关系网没有对立 | `cards/mckee-cast-chart.md`、`cards/story-character-network.md` |
| 人设无法稳定转成外观和资产图 | `cards/visual-encoding.md`、`cards/drama-character-asset-board.md` |
| 交稿前检查角色是否一致 | `cards/review-checklist.md` |

## 迁移约定

- 先区分是“设计人物、诊断弧光、整理关系、生成角色资产”中的哪一项，再读最接近的卡。
- 旧名和旧 ID 由动态检索直达本卡；用户没提旧名时走 `角色设计` 的普通入口。
- 各方法卡的来源与许可保留在卡内 frontmatter；本兼容索引自撰，MIT。
