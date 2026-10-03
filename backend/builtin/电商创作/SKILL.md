---
name: 电商创作
description: 在首页创作 Agent 中规划 Amazon、拼多多、TikTok Shop、Shopify 等商品图片、视频和文案，先审阅整套再批量提交独立媒体任务。
agentSurfaces: ["creation"]
---

# 电商创作

1. 先确定用户要求的平台、站点、目标语言、交付数量与已有附件角色。未指定平台或站点保留 `unknown`/`UNKNOWN`；仅当这些信息确实阻塞规则或交付时才问一个问题。不要默认为 Amazon 美国站。
2. 把产品事实和证据资源 ID 分开记录。`competitor`、`style`、一般 `reference` 只能用于风格/构图，不能证明原产品材质、功效、认证、尺寸或品牌。无法证明的卖点列为假设，不写成确定文案。
3. 使用 `commerce_plan_submit` 提交版本 2 计划：稳定 `planId`/`version`、`productFacts`、逐项 `id`/`type`/`prompt`/`targetCopy`/`zhReviewCopy`/`factIds`/`attachmentResourceIds`/`dependencies`/`specs`、共享 `styleBible`。每张图或视频单独一项。中文审核对照只显示给用户，不放入目标语言画面提示词。
4. 平台规则由服务端可信目录回填；规则为空表示尚未核验，不能声称合规。Shopify 产品媒体类型见官方帮助 `https://help.shopify.com/en/manual/products/product-media/product-media-types`（2026-10-02 核对）。Amazon 卖家帮助需登录，拼多多与 TikTok Shop 当前可访问的官方规则未核验；不要编造尺寸或禁令。TikTok Shop 数字渲染图政策存在条件变化，不得使用旧的“一律禁止”说法。
5. 商品图片按 电商视觉设计流程规划共享产品母版、卖点优先级、本地化表达和逐图 `design`；4 张及以上至少 3 种版式，避免仅更换同一房间和标题。用 `commerce_plan_submit` 提交整套，服务端从已校验方案编译文案、附件和视觉结构；不要再逐项重复调用 `generate_media`。只读保存方案；审批模式等待一次同版本整套审批；自动模式仍受预算与模型能力限制。
6. 无依赖交付项整套一次入队，执行受 worker 并发限制；依赖项成功且可引用资源已就绪后才能提交下游项。结果在一张生成卡显示成功数/总数，最终聚合展示，任务仍独立。只在任务中心核对为失败后，才用 `generate_media` 的 `retryFailedTaskId` 指向该失败任务，重试同一计划项；即使原权限为自动模式，也要等待新的用户审批。断线、超时或未知提交结果先查任务，不重复生成；已成功的图片和原失败记录保留。
7. 商品图生成视频可选择真正支持图片参考的视频模型。源视频加人物/产品图的主体替换只有模型目录明确支持该操作才可执行；否则说明能力缺失，不能用普通提示词假装替换成功。
