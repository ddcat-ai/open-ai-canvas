---
name: prompt-engineering-patterns-migration
description: "旧技能「提示词工程模式」的兼容索引；把约束、上下文、人格、引用、循环工程和安全边界直达视觉提示词工程包内的现有卡片。"
tags: [提示词工程模式, 系统提示词, 循环工程, 引用系统, 人格设定]
evidence: E4
source: "原 提示词工程模式 (16000000000103)，作者：剧典技能库（itsWyatt-K）"
---

# 「提示词工程模式」旧名直达

旧技能 `提示词工程模式`（`16000000000103`）已并入 `视觉提示词工程`。这一页只做旧名兼容与卡片分流。

## 按设计任务读卡

| 当前任务 | 直接读 |
|---|---|
| 需求总被模型自由发挥，要锁边界 | `cards/constraint-engine.md` |
| 上下文太长、信息遗忘或顺序混乱 | `cards/context-management.md` |
| 设计稳定人格与角色行为 | `cards/persona-design.md` |
| 让引用、来源和结论可追溯 | `cards/citation-system.md` |
| 想搭自动循环，但不确定值不值得 | `cards/loop-worthiness-test.md`、`cards/loop-5plus1-architecture.md` |
| 用独立 Agent 审核产出 | `cards/maker-checker.md` |
| 需要防提示词注入和越权 | `cards/injection-defense.md`、`cards/safety-guardrails.md` |

## 迁移约定

- 先识别是“约束、上下文、人格、循环、审查、安全”中的哪一类，再读 1 至 2 张卡。
- 旧名和旧 ID 由动态检索直达本卡；未提旧名时走 `视觉提示词工程` 的普通入口。
- 各方法卡的来源与许可保留在卡内 frontmatter；本兼容索引自撰，MIT。
