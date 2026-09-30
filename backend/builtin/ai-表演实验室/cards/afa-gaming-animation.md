---
name: afa-gaming-animation
description: "动画表演在游戏中的独特挑战：玩家输入不可预测、动作需无缝循环与中断、表演必须模块化可组合。涵盖状态机思维、预动作缓冲、动作融合(blending)、以及「表演预算」(performance budget)管理。"
tags: ["游戏动画", "状态机", "动作融合", "交互表演", "预动作", "表演预算"]
metadata:
  source_book: "Acting for Animators (Ed Hooks, 3rd ed., Routledge)"
  attribution: "Methodological framework re-derived and rewritten by the Judian project from published-book methodology notes; inspired by the cited books, no original expression reproduced."
  source_card: "story-recipes\\04-人物弧光与角色设定\\Acting for Animators\\expert\\afa-gaming-animation\\SKILL.md"
evidence: E4

---
## I — 实操清单
- [ ] 为每个动作状态定义「意图帧」(哪怕2帧准备)
- [ ] 检查所有状态转换是否平滑(无跳变)
- [ ] 标注每个动作的中断优先级
- [ ] 测试极端输入序列(狂按/乱按)是否崩坏
- [ ] 在帧预算内最大化表演(不是越多越好)

## A1 — 正例
✅ 塞尔达旷野之息：林克每个动作都有自然预备+可中断→ 操作如行云流水
✅ 战神(2018)：奎托斯攻击有清晰意图帧→ 打击感强
✅ 只狼：弹反动作的精确帧窗口→ 硬核但公平

## A2 — 反例
❌ 无预备直接出招：像机器人发射
❌ 状态切换硬切：视觉跳变破坏沉浸
❌ 不可中断动作：玩家被困在动画中(愤怒来源)

## E — 边界与变体
- 适用：所有实时交互内容(游戏/VR/虚拟主播)
- 变体：移动端小游戏预算更紧(动作更简)
- 关系：afa-acting-fundamentals的TPE在游戏里=实时求解

## B — 书目溯源
📖 **Acting for Animators** (3rd ed.) · 新增游戏动画章节(本书最大更新之一)
