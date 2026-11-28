---
name: dialogue-workshop-migration
description: "旧技能「对白工坊」的兼容索引；把对白直白、人物声音雷同、解释性大肚子等问题直达剧本撰写包内的现有对白卡。"
tags: [对白工坊, 对白诊断, 潜台词, 人物声音, 解释性大肚子]
evidence: E4
source: "原 对白工坊 (16000000000075)，作者：剧典技能库（itsWyatt-K）"
---

# 「对白工坊」旧名直达

旧技能 `对白工坊`（`16000000000075`）已并入 `剧本撰写`。这里只负责兼容旧名和高频任务，不再复制旧包全文。

## 按问题读卡

| 当前问题 | 直接读 |
|---|---|
| 台词太直白、全在解释心里话 | `cards/dialogue.md`、`cards/mckee-dialogue-as-action.md` |
| 人物说话都一个味、遮住名字认不出 | `cards/dialogue.md`、`cards/mckee-dialogue-in-character.md` |
| 背景和关系靠台词硬塞 | `cards/mckee-dialogue-exposition.md` |
| 斗嘴不够利落、缺少来回攻防 | `cards/pola-duibai.md`、`cards/yt-direct-clarity.md` |
| 需要对整段对白做系统问诊 | `cards/mckee-dialogue-clinic.md`、`cards/factory-dialogue-doctor.md` |

## 迁移约定

- 目标是“改成能演的对白”，一次先读 1 至 2 张最接近的卡，不整包通读。
- 旧名和旧 ID 由动态检索直达本卡；用户没有提旧名时，直接从 `剧本撰写` 的普通对白入口开始。
- 各方法卡的来源与许可以卡内 `source`、`source_book`、`license`、`attribution` 字段为准；本兼容索引自撰，MIT。
