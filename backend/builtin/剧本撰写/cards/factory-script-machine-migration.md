---
name: factory-script-machine-migration
description: "旧技能「剧本工业化机器」的兼容索引；用于一句创意扩成多集、情绪合同、分集规格、连续性台账和机器自检的卡片直达。"
tags: [剧本工业化机器, 剧本工厂, 多集剧本, 分集规格, 连续性台账]
evidence: E4
source: "原 剧本工业化机器 (16000000000076)，作者：剧典技能库（itsWyatt-K）"
---

# 「剧本工业化机器」旧名直达

旧技能 `剧本工业化机器`（`16000000000076`）已并入 `剧本撰写`。保留旧名是为了兼容既有说法，具体方法在现有卡片中。

## 按任务读卡

| 当前任务 | 直接读 |
|---|---|
| 一句创意扩成多集，先锁情绪走向 | `cards/factory-emotion-contract.md` |
| 定单集时长、场景数、字数与钩子 | `cards/factory-episode-specs.md` |
| 伏笔、人物、道具、规则要连续 | `cards/factory-ledger.md` |
| 写完做单集或全剧机器检查 | `cards/factory-machine-check.md` |
| 台词不符合人物、攻防回合不足 | `cards/factory-dialogue-doctor.md` |

## 迁移约定

- 先识别当前处在“定规格、写正文、查连续性、做验收”的哪一步，只读对应卡。
- 用户只说“剧本工厂”时按多集量产处理；旧名和旧 ID 由动态检索直达本卡。
- 各方法卡的来源与许可保留在卡内 frontmatter；本兼容索引自撰，MIT。
