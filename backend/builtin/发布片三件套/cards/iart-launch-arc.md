---
name: iart-launch-arc
description: 当用户要做新品发布片/sizzle 片/预告式广告（15-60s），或片子"平铺直叙没有高潮/品牌时刻没砸中"时调用。核心能力：发布片五拍弧线（hook→tease→reveal→feature montage→end card）+ 30s 比例分配表 + 15s/60s 缩放规则。关键触发：发布片、新品广告、sizzle、预告、reveal、end card、launch video、产品上市。
source_book: "ad-video-skills launch-video（GitHub: iart-ai/ad-video-skills，MIT License）"
source_chapter: SKILL.md The arc
tags: [发布片, 五拍弧线, 品牌时刻, AI生成友好]
layer_confidence: "candidate"
pack: iart 广告三件套
core_stance: "发布片是砸点艺术：reveal 落在音乐 drop 上，end card 静够两秒——其他都为这两秒服务"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/iart-ai/ad-video-skills"
source_license: "MIT"
source_url: "https://github.com/iart-ai/ad-video-skills"
first_seen: 2026-09-21
source_card: iart 广告三件套/iart-launch-arc
evidence: E4

---

# 发布片五拍弧线

## R — 原文要点 (Reading)

来源方法（MIT，整理自 iart ad-video-skills launch-video）：15-60s 高级感发布片弧线——①**Hook（0-3s）**：一个停滑的帧或运动；②**Tease（3-9s）**：暗示产品，建立好奇，卡点建立；③**Reveal（9-13s）**：产品/logo 砸在音乐 drop 上；④**Feature montage（13-25s）**：快节奏运动感，一镜一卖点；⑤**End card（25-30s）**：logo+slogan+CTA 干净定格。**30s 比例分配表**即上表；15s 收紧、60s 加长蒙太奇（**绝不加长 hook**）。两条铁律：①**声音设计引领画面**——先锁音轨、标出 beats 与 drop，再让画面切在标记上；永远不要给剪好的片子配乐（reveal 要落在 drop 上不是附近）。②**质量胜过数量**——几个完美镜头胜一堆平庸镜头，不高级的镜头全砍。

## I — 方法论骨架 (Interpretation):

1. **比例即结构**：五拍占比是骨架——15s/60s 只缩放中段，hook 恒定 3s。
2. **先锁轨后剪画面**：声音是时间轴的主人，画面是客人。
3. **Reveal 是唯一高潮**：全片为品牌砸点服务，蒙太奇不许抢戏。
4. **End card 要静**：定格 ≥2 秒，让品牌落地——CTA 区禁忙动。
5. **高级感=减法**：砍镜头是发布片的主要创作手段。

## A1 — 应用案例 (Past Application)

- 来源实践：新品发布片先锁 30s 音轨标 drop@9.0s→reveal 精确落点+微过冲（scale 1.18→1.0，0.18s 回弹）→品牌记忆点成立。
- 反例：先剪画面后配乐——reveal 落在 drop 附近而非点上，冲击力减半。

## A2 — 触发场景 (Future Trigger)

- 新品上市/功能发布/sizzle 片。
- 「品牌时刻没砸中」的重剪（先查锁轨顺序）。
- 影策 Agent 生成发布片结构的默认骨架。

## E — 可执行步骤 (Execution)

1. **定总长**：15/30/60s，按比例表铺五拍。
   *完成标准*：五拍占比合规（hook 恒 3s）。
2. **锁音轨**：先选轨标 beats/drop。
   *完成标准*：drop 时间码已记录。
3. **排 reveal**：品牌砸点对 drop+微过冲。
   *完成标准*：砸点=drop 帧。
4. **铺蒙太奇**：一镜一卖点，运动语言统一。
   *完成标准*：卖点-镜头一一对应。
5. **静尾板**：end card 定格 ≥2s 无竞争动效。
   *完成标准*：尾板静置达标。
