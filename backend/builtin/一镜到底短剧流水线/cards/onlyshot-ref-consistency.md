---
name: onlyshot-ref-consistency
description: 当一个镜头要放多个角色/多张参考图，或多人同框出现脸盲、全员变形，或长 prompt 批量生成大面积失败时调用。核心能力：多 ref 一致性衰减规律 + ref 引用与文字描述的权重冲突 + 长 prompt 必须串行的并发参数。关键触发：多角色同框、脸盲、一致性崩、并发失败、批量生成挂一半。
source_book: "OnlyShot 即梦失败模式与敏感词清单 v0.1.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: references/jimeng-failure-modes.md §3-§4
tags: [多角色, 一致性, ref引用, 并发限流, 串行, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "一致性随 ref 数量指数衰减：一主 ref 是资产，三主 ref 是赌博；长 prompt 配高并发等于全灭"
skill_type: "framework"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-ref-consistency
evidence: E4

---

# 多 ref 一致性衰减 + 串行纪律

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot jimeng-failure-modes §3-4，实测数据）：多 ref 一致性——1 个主角 ref 约 95%（完美保 ref）；2 个主角（CP）约 80%（可接受）；3 个以上主角低于 50%（全员脸盲化）；6 个以上约 0%（全变通用 chibi 形）。ref 引用与文字的权重关系：图像引用约 70% vs 文字描述约 30%，两者冲突时文字反而赢但 ref 降级为风格参考→角色变形。并发实测：8 并发+短 prompt（约 300 字）100% 过；8 并发+长 prompt（约 1500 字）0% 过；4 并发+长 prompt 约 50%；串行+长 prompt（约 1300 字）100%。推荐参数：并发上限 4、单次超时 420 秒、重试 2 次。

## I — 方法论骨架 (Interpretation)

1. **单主 ref 原则**：一个镜头只给 1 个主角 ref；第二角色用「文字剪影描述 + 背景虚化」实现，不上第二张 ref——除非是 CP 戏且能接受 80% 一致性。
2. **禁重描**：引用 ref 后文字只写位置与动作，不重描外形——重描触发 70/30 权重冲突，ref 反被降级。
3. **长 prompt 串行**：超 1200 字的 prompt 逐条跑（并发 1）；短 prompt 才允许 4 并发。长 prompt+高并发=必死组合。
4. **超时与重试预算**：长 prompt 单次超时放宽到 420 秒，失败重试 2 次（即梦偶发限流）。

## A1 — 应用案例 (Past Application)

- 来源 case E 关联数据：双主角 CP 镜在逐主角声明+单 ref 控制下达一致性 5/5；多 ref 堆叠实验组 6+ ref 全员 chibi 化。
- 反例：8 并发跑 1500 字 prompt 通过率 0%——同一批改串行后恢复。

## A2 — 触发场景 (Future Trigger)

- 分镜表出现多人同框镜头，要决定 ref 分配。
- 批量生成任务失败率异常高，怀疑限流。
- 影策 Agent 规划批量生图/生视频任务的并发参数。

## E — 可执行步骤 (Execution)

1. **数 ref**：该镜含几个主角 ref？
   *完成标准*：ref 数量明确，≥3 个主角 ref 即触发重构。
2. **重构降载**：3+ 主角改为「1 主 ref + 其余文字剪影 + 背景虚化」。
   *完成标准*：任一镜头主角 ref ≤2。
3. **去重描**：检查 ref 引用句，删除外形重描文字，只留位置/动作。
   *完成标准*：引用句无身体细节描述。
4. **并发匹配**：prompt 超 1200 字→串行；短 prompt→并发≤4；配置超时 420 秒+重试 2 次。
   *完成标准*：任务配置与字数匹配。
5. **失败回查**：批量失败先查并发与字数组合，再查敏感词。
   *完成标准*：失败归因顺序正确（限流→字数→审核）。
