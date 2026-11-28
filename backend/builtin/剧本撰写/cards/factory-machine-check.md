---
name: factory-machine-check
description: 当单集/全剧写完要交稿前机检，或要搭建剧本质量门禁，或反复出现同类低级错误时调用。核心能力：双机检脚本（单集 validate_episode + 全剧 validate_series）检查项清单 + FAIL 必修纪律 + 合规一票否决四类。关键触发：机检、质检、交稿前检查、validate、合规审核、一票否决。
source_book: "short-drama-factory（GitHub: lixiaoxiao9888-create/short-drama-factory，MIT License）"
source_chapter: SKILL.md Step 5-6 + scripts/
tags: [机检, 质量门, 合规, 交稿纪律, AI生成友好]
layer_confidence: "candidate"
pack: short-drama-factory 剧本工厂
core_stance: "机检 FAIL 不裸交：低级错误不配消耗用户的注意力"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
source_license: "MIT"
source_url: "https://github.com/lixiaoxiao9888-create/short-drama-factory"
first_seen: 2026-09-21
source_card: short-drama-factory 剧本工厂/factory-machine-check
evidence: E4

---

# 双机检与合规一票否决

## R — 原文要点 (Reading)

来源方法（MIT，整理自 short-drama-factory v3.1 Step 5-6）：**单集机检**（validate_episode.py）检查项：字数（实拍 350-500/漫剧 260-400）/句长/场景数（≤2）/钩子（前 3 秒）/断章/复读/开篇禁词/情绪流变词。**全剧机检**（validate_series.py）检查项：伏笔超期未收/死人开口/断章缺失/付费墙空缺。**纪律：机检 FAIL 必须修复后重跑，不得裸交**。合规一票否决四类不碰；敏感词转译表；暴力用「受力震飞/骨裂/倒地」写意替代直观血腥；字幕用中文括号包 + AIGC 标识（红果强制）。

## I — 方法论骨架 (Interpretation)

1. **机检是门禁不是参考**：FAIL=不许交，与创作质量无关——这是卫生问题。
2. **单集查格式、全剧查逻辑**：两层机检分工明确，别混。
3. **一票否决零谈判**：合规四类没有「打个擦边」选项。
4. **写意替代是技法不是妥协**：受力震飞比血腥特写更高级也更安全。
5. **可移植**：机检项可映射为影策 Agent 的交付前 checklist 或 nxf Gate 规则。

## A1 — 应用案例 (Past Application)

- 来源实践：连写模式每集过单集机检、每 5 集过全剧机检，穿帮率趋零。
- 反例：跳过机检裸交——伏笔超期+死人开口在读者眼中就是「作者忘了」。

## A2 — 触发场景 (Future Trigger)

- 任何剧本交付前（单集/全剧两级）。
- 建立剧本质量门禁流程。
- 影策 Agent 剧本产出后的自动质检项设计。

## E — 可执行步骤 (Execution)

1. **单集机检**：字数/句长/场景/钩子/断章/复读/禁词/流变词八项。
   *完成标准*：八项全过。
2. **全剧机检**：伏笔超期/死人开口/断章缺失/付费墙空缺四项。
   *完成标准*：四项全过。
3. **FAIL 处置**：修复→重跑→再过，循环到全绿。
   *完成标准*：无 FAIL 残留。
4. **合规四类扫**：一票否决类零命中；敏感词转译。
   *完成标准*：合规零命中。
5. **写意核**：暴力描写全为写意替代。
   *完成标准*：无直观血腥描写。
