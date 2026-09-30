---
name: supercmo-brand-analysis
description: 当用户给了品牌官网要从头建品牌档，或后续生成需要品牌的色彩/字体/摄影风格基准，或担心"生成出来的不像这个品牌"时调用。核心能力：品牌五件套提取（卖什么/色板/字体/slogan/人群）+ 摄影风格研判（detailed 模式）+ 无证据不编造纪律。关键触发：分析这个品牌、建品牌档、品牌色、字体、摄影风格、不像这个品牌、brand.md。工位边界：本技能只产出品牌事实档；单款产品的事实归一是产品分析技能的活，生成走各生产技能。信息边界：影策 Agent 读不到图——摄影风格一步需用户描述或跳过，色板字体以页面声明为准。
source_book: "superCMO analyzing-brand（GitHub: SupercmoHQ/superCMO-skills，Apache-2.0）"
source_chapter: SKILL.md Step 1-5
tags: [品牌分析, 品牌档, 色板, 摄影风格, 无证据不编造, AI生成友好]
layer_confidence: "candidate"
pack: superCMO 广告链路
core_stance: "没有证据的章节写 unconfirmed——品牌档是读出来的，不是想出来的"
skill_type: "technique"
consult_tier: "A（绿区·Apache-2.0 署名整理，可公开）"
verify_state: raw
card_type: open-source-skill
publish_tier: tier-attrib
source_repo: "https://github.com/SupercmoHQ/superCMO-skills"
source_license: "Apache-2.0"
source_url: "https://github.com/SupercmoHQ/superCMO-skills"
upstream_defer: ["叙事短片导演分镜"]
first_seen: 2026-09-21
source_card: superCMO 广告链路/supercmo-brand-analysis
evidence: E4

---

# 品牌分析：从官网到品牌事实档

## R — 原文要点 (Reading)

来源方法（Apache-2.0，整理自 superCMO analyzing-brand）：**缓存优先**——brand.md 已有这个品牌就交回、停止（重查要再花钱且没有新信息）。路由：给官网→继续；给单品页（Amazon/Shopify 单个 listing）→转交产品分析技能；什么都没给或 URL 打不开→要官网（凭记忆描述的品牌是发明的不是读的）。模式二选一：quick（纯文本提取）/ detailed（额外用视觉模型读站内照片拿摄影风格——贵且慢，先推荐 quick）。读站：url_extraction 提严格 JSON（品牌名/卖什么/色板 hex/字体/slogan/文案口吻/人群/差异化/证据）；调用失败（空/未授权/4xx/反爬墙）不中止——照片步和终检照跑，改为一条消息问用户色板/字体/slogan。摄影风格（仅 detailed）：取首屏大图≤10 张一批读，问全套问题（ shot 类型/光线/构图取景/场景背景/选角造型/调色情绪/什么反复出现/什么从不入画）；站点无图就明说没有。落档 brand.md：按 Name/Sells/Source/Palette/Typography/Tagline/Audience/Differentiator/Proof 分节，**无证据的节写 `unconfirmed — needs user input`，绝不发明事实、数字、颜色或主张**；色板要区分页面声明的还是渲染读出的；无彩色品牌是真色板不是缺失。

## I — 方法论骨架 (Interpretation)

1. **缓存即省钱**：任何调研类技能的第一步都是查档，重复调研是纯浪费。
2. **路由先于执行**：输入形态决定用哪个技能——单品页和官网是两种工件。
3. **摄影风格是生成的锚**：色板字体管"对不对"，摄影风格管"像不像这个家的"——detailed 模式的价值全在后者。
4. **unconfirmed 是合法值**：品牌档允许有空节，不允许有编节。
5. **失败不中止**：提取挂了还能问、还能看图、还能终检——单点失败不拖垮全流程。

## A1 — 应用案例 (Past Application)

- 床垫品牌：quick 模式提取出色板（页面声明 3 色）+slogan+人群；摄影风格一节标 unconfirmed → 后续生成时用户补了"暖光卧室实拍"一句，全部素材沿用，一致性一次到位。
- 反例：站点反爬，模型凭品牌名"猜"了一套性冷淡色板——用户官网实际是暖橙系，整批素材带错色调全部作废。

## A2 — 触发场景 (Future Trigger)

- 「分析一下我这个品牌」+ 官网链接
- 「以后生成都按这个品牌的色系来」
- 「做出来的图不像我们品牌的调性」
- 任何生成任务前的品牌基准缺失

## E — 可执行步骤 (Execution)

1. **查档**：brand.md 已有即交回。完成标准：命中即停、未命才继续。
2. **路由**：官网→继续；单品页→转交；空→索要。完成标准：输入形态确认。
3. **读站**：提取品牌 JSON。完成标准：九类字段有则有、无则 unconfirmed。
4. **看照片**（仅 detailed）：≤10 张一批问全套。完成标准：风格结论覆盖八问。
5. **落档**：分节写入、无证据标 unconfirmed。完成标准：全文无发明事实。

## B — 边界 (Boundary)

- **不凭记忆填档**：URL 打不开就问用户，不猜。
- **不把零售商当竞品**（本技能不产竞对，只产品牌事实）。
- **影策适配边界**：读站依赖用户提供页面文本或可访问 URL；摄影风格一步 Agent 无视觉通道，需用户描述或明确标注信息缺口。
