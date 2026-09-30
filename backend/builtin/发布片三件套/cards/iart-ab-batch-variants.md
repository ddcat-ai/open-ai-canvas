---
name: iart-ab-batch-variants
description: 当用户要"批量产广告变体/A-B 测试素材/一个模板出 N 条"，或变体之间"除了测试变量还变了别的导致无法归因"，或钩子与 CTA 不对应时调用。核心能力：单变量隔离纪律 + 钩子-CTA 配对律 + 数据驱动模板（variant 对象+帧函数确定性渲染）+ 广告解剖五拍表。关键触发：A/B测试、批量变体、单变量、数据驱动、message-match、广告解剖、variant。工位边界：本技能只做批量变体测试纪律，不产出广告片整体导演；后者由上游市场技能『顶级波普视觉广告导演』等负责，两者接力不抢戏。
source_book: "ad-video-skills ad-creative-video（GitHub: iart-ai/ad-video-skills，MIT License）"
source_chapter: SKILL.md 全文
tags: [A/B测试, 单变量, 数据驱动, 钩子CTA配对, AI生成友好]
layer_confidence: "candidate"
pack: iart 广告三件套
core_stance: "一次只改一个变量：混改两个变量的胜者，是一份读不懂的报告"
skill_type: "framework"
consult_tier: "A（绿区·MIT 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/iart-ai/ad-video-skills"
source_license: "MIT"
source_url: "https://github.com/iart-ai/ad-video-skills"
upstream_defer: ["顶级波普视觉广告导演"]
first_seen: 2026-09-21
source_card: iart 广告三件套/iart-ab-batch-variants
evidence: E4

---

# 批量变体：单变量与钩 CTA 配对

## R — 原文要点 (Reading)

来源方法（MIT，整理自 iart ad-creative-video）：**两条让变体值得跑的规则**：①**单变量隔离**——测试只有在一个东西变化时才教得会东西；布局/运镜/颜色/时长全锁定，只换被测字段（钩子/优惠/CTA）；混改两个变量，胜者无法解读。②**钩子-CTA 配对（message-match）**——前三秒的承诺必须由按钮兑现：「每天浪费 2 小时」的钩子结尾是「Save 2 hours — try free」而不是通用「Shop now」；钩子与 CTA 在数据表每一行里是配对关系。**广告解剖（15-30s）**：Hook 0-3s（停滑，抛问题或模式打断）→Context 3-8s（放大痛点）→Payoff 8-18s（产品即解，一个清晰收益）→Proof 18-25s（一个具体数字/演示/结果）→CTA 末 3s（单一行动，与钩子配对，定格 ≥2s）。钩子情绪触发要在 **2 秒标记前**落地（判断约 1.7 秒形成且划速递增）。**钩子先测**：钩子对 CPA 的影响大于其他一切元素。**数据驱动模板**：一切营销者可能测的都不硬编码——构图读单一 variant 对象（hook/benefit/proof/cta/bg/accent），渲染器永不改组件；每个动画值是帧的纯函数（禁 CSS transition/库计时器，会失步）。

## I — 方法论骨架 (Interpretation):

1. **变量隔离是科学底线**：A/B 的价值在归因，混改=放弃归因。
2. **承诺要闭环**：钩 CTA 不配对=观众被承诺吸引、被陌生 CTA 劝退。
3. **2 秒死线**：情绪触发晚于 2 秒=观众已划走。
4. **数据驱动=工业化**：变体从表里长出来，不从设计稿里长出来。
5. **钩子是第一测试对象**：预算有限先测钩子。

## A1 — 应用案例 (Past Application)

- 来源实践：5-10 条钩子串×同一正片=一版一条，最干净的钩子测试；变体表每行 hook/CTA 成对。
- 反例：变体同时换了钩子和背景色——点击高 20% 但无法归因给谁，测试白跑。

## A2 — 触发场景 (Future Trigger)

- 投放素材批量生产与测试设计。
- 「测了但不知道为啥赢」的复盘（先查变量隔离）。
- 影策 Agent 批量生成素材任务的结构设计。

## E — 可执行步骤 (Execution)

1. **定测试变量**：本轮只测一个字段（钩子/优惠/CTA）。
   *完成标准*：变量唯一。
2. **锁其余**：布局/运镜/颜色/时长全锁定。
   *完成标准*：非变量项零变化。
3. **钩 CTA 配对**：数据表逐行检查承诺-兑现对应。
   *完成标准*：配对率 100%。
4. **2 秒核**：钩子情绪触发 <2s 标记。
   *完成标准*：触发点位达标。
5. **表驱生产**：变体从 variant 表渲染，帧函数确定。
   *完成标准*：变体逐行可追溯。
