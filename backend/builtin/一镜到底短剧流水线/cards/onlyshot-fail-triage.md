---
name: onlyshot-fail-triage
description: 当即梦/Seedance 生成失败要排查原因，或 prompt 被拒、报错、无结果返回，或写完 prompt 要做跑前自检时调用。核心能力：三类失败完全区分（字数超限/内容审核/网络限流）+ prompt 1500 字符硬上限与实测分布 + 字数必须程序实测。关键触发：生成失败、InvalidNode、generation failed、没有返回图、prompt 超字数、失败重试。
source_book: "OnlyShot 即梦失败模式与敏感词清单 v0.1.0（GitHub: A-cat-with-carrots/OnlyShot，MIT License）"
source_chapter: references/jimeng-failure-modes.md §0-§1
tags: [失败诊断, 字数上限, InvalidNode, 审核拦截, 限流, AI生成友好]
layer_confidence: "candidate"
pack: OnlyShot 短剧流水线
core_stance: "失败先分诊再动手：三类失败根因完全不同，看到没出图就改 prompt 是最常见的误诊"
skill_type: "framework"
consult_tier: "A（绿区·宽松许可开源库整理，署名可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/A-cat-with-carrots/OnlyShot"
source_license: "MIT"
source_url: "https://github.com/A-cat-with-carrots/OnlyShot"
first_seen: 2026-09-20
source_card: OnlyShot 短剧流水线/onlyshot-fail-triage
evidence: E4

---

# 生成失败三分诊 + 字数硬上限

## R — 原文要点 (Reading)

来源方法（MIT，整理自 OnlyShot jimeng-failure-modes §0-1，基于 36 分镜格三轮实测尸检）：三类失败——①`InvalidNode`（ret=1046）= prompt 字数超上限；②`generation failed` = 内容触发审核（敏感词/暧昧/反派词）；③无 image_url 无报错 = 网络或并发限流。字数实测分布（N=8，中英约 7:3）：<1300 字符通过率 100%；1300-1500 约 95%；1500-1600 约 70%；1600-1700 约 20%；>1700 为 0%。安全策略：理想 1200-1400，硬上限 1500，严禁超 1600。注意这是实测归纳值而非官方常数，换模型/语言比例需重新校准。

## I — 方法论骨架 (Interpretation)

1. **先分诊后行动**：必读完整 stderr/stdout，匹配 fail_reason 具体错误——「没出图」≠「被审核」，误诊会把字数问题当成敏感词问题瞎改。
2. **字数唯一可信来源是程序实测**：中文 1 字符=1 个 python `len()` 计数；目测/手算误差可达 ±20%，每个 prompt 改完必须实测。
3. **留缓冲**：按理想区间 1200-1400 写作，给后续增补留空间；逼近 1500 就是危险区。
4. **上限是经验值**：换模型（如纯英文 prompt token 化更细）时上限可能更低，需重新小样本校准。

## A1 — 应用案例 (Past Application)

- 来源实测：1920 字符 prompt 三次重试全部 InvalidNode——字数问题重试无意义，必须先压字数。
- 1583/1590 字符两条通过、1620/1664 两条失败——1600 附近是悬崖，不是渐变。

## A2 — 触发场景 (Future Trigger)

- 任何生成调用失败后的诊断第一步。
- prompt 组装完成、即将提交前的自检。
- 用户问「为什么我的 prompt 总被拒」。

## E — 可执行步骤 (Execution)

1. **取证据**：读完整错误输出，匹配具体 fail_reason 字样。
   *完成标准*：失败归入三类之一，有原文证据。
2. **分诊处置**：InvalidNode → 程序实测字数并压到 1400 以内；generation failed → 转敏感词替换卡处理；无 image_url → 降并发/串行重试。
   *完成标准*：处置动作与诊断类别对应。
3. **字数实测**：用程序（如 python len()）输出每个待提交 prompt 的字符数。
   *完成标准*：每个 prompt 有实测数字，非目测。
4. **重试纪律**：字数类失败不盲目重试；限流类失败加 2 次重试、拉长超时。
   *完成标准*：重试策略与失败类别匹配。
5. **回归校准**：更换模型或语言比例后，先小样本测字数上限再批量。
   *完成标准*：新模型有本校准数据或沿用保守区间。
