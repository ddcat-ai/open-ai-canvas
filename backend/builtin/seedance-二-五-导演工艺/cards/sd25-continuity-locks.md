---
name: sd25-continuity-locks
description: 当用户要多镜/长视频/编辑任务保一致性，或"同一个角色在不同镜里服装变了/人数变了/光线方向乱了"，或要写连续性约束时调用。核心能力：连续性锁清单（身份/数量/服装/道具归属/地理/主体尺度/摄像机轴线/光线方向/色板/材质/声音/对白/受保护源片）+ 只锁相关不变量。关键触发：连续性锁、跨镜一致、轴线、光线方向、人数变化、continuity lock、invarIants。工位边界：本技能只做连续性锁清单编写，不产出分镜表生产；后者由上游市场技能『叙事短片导演分镜』等负责，两者接力不抢戏。
source_book: "seedance-2-5-video-director（GitHub: liyue-aigc/seedance-2-5-video-director，MIT License）"
source_chapter: Direction workflow Step 7
tags: [连续性锁, 跨镜一致, 轴线, 不变量, AI生成友好]
layer_confidence: "candidate"
pack: seedance-2.5 导演
core_stance: "只锁相关的不变量：全锁=没锁，锁单=精准防护"
skill_type: "checklist"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/liyue-aigc/seedance-2-5-video-director"
source_license: "MIT"
source_url: "https://github.com/liyue-aigc/seedance-2-5-video-director"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: seedance-2.5 导演/sd25-continuity-locks
evidence: E4

---

# 连续性锁清单

## R — 原文要点 (Reading)

来源方法（MIT，整理自 seedance-2-5-video-director workflow Step 7）：写连续性锁，**只覆盖相关不变量**——身份（identity）/数量（count）/服装（wardrobe）/道具归属（prop ownership）/地理（geography）/主体尺度（subject scale）/摄像机轴线（camera axis）/光线方向（light direction）/色板（palette）/材质（material）/声音（voice）/对白（dialogue）/受保护源片（protected source footage）。指令排序：全局意图→素材绑定→按时序执行→音频→连续性→禁止项。

## I — 方法论骨架 (Interpretation):

1. **相关性过滤**：单镜任务只锁身份+服装；多镜加数量/地理/轴线；长视频加声音/对白——不相关的不锁。
2. **轴线与光线最易漂**：多镜序列里轴线穿越与光线方向翻转是最高频穿帮，必锁。
3. **受保护源片**：编辑/延长任务里原片是受保护项，写进锁。
4. **指令排序即权重**：全局意图先行、禁止项垫后——与模型注意力分布对齐（配 vis-video-universal-rules U2）。
5. **锁可机检**：数量/服装/轴线类不变量可在分镜表机械核对。

## A1 — 应用案例 (Past Application)

- 来源实践：双人对话三镜锁「身份/轴线/光线方向/对白归属」——轴线不越、主光方向不变、台词不串人。
- 反例：10 项全锁进一个 5 秒单镜——权重被稀释，关键锁反而不牢。

## A2 — 触发场景 (Future Trigger)

- 多镜/长视频/编辑任务的连续性声明。
- 跨镜穿帮排查（对照锁清单定位漏锁项）。
- 影策 Agent 生成分镜序列时的约束组装。

## E — 可执行步骤 (Execution)

1. **判任务级**：单镜/多镜/长视频/编辑，定锁的范围档。
   *完成标准*：档位与任务匹配。
2. **选不变量**：从 13 项清单按相关性选。
   *完成标准*：锁项与任务相关无冗余。
3. **写锁句**：每锁项一句可判定约束。
   *完成标准*：锁句可机械核对。
4. **排指令序**：全局意图→素材→时序→音频→连续性→禁止。
   *完成标准*：顺序合规。
5. **穿帮回查**：成品对照锁清单验收。
   *完成标准*：验收记录在案。
