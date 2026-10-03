# 电商套图 Agent 合同

这是产品套图批量生成的静态合同包，不绑定具体图片供应商，也不会发起网络请求。实际执行器应把每个套图项展开为一个普通 image provider 请求，并持久化本合同中的 `batchId`、`itemId` 和 `idempotencyKey`。

- `product-suite-contract`：manifest 中的合同摘要与错误边界，同时声明 `ecommerce-conversational` Agent 能力和 `ecommerce-style-planner` 风格规划能力。
- `docs/product-suite-contract.json`：批次、SKU、角度/场景、背景、尺寸矩阵、重试和恢复的 JSON Schema。
- `fixtures/product-suite.json`：部分成功与未知提交状态样例。

### 状态边界

`unknown_submitted` 表示上游可能已接受请求。它不能自动重试，恢复流程必须用同一个 `itemId` 和 `idempotencyKey` 查询或人工决策。只有明确的 `failed` 项可按 `retryPolicy` 重试；重试次数超过上限后保持 `failed`。

`partial_succeeded` 允许批次在部分 item 成功时交付已完成素材。重启后从 `recovery.resumeCursor` 继续，已经成功或未知提交的 item 不得换用新幂等键重复提交。

`styleLock` 是电商套图的统一风格合同。它保存稳定的 `fingerprint`、全局正向/负向约束、锚点 item 和共享提示词前缀；锚点 item 完成前最多只允许执行一张图，后续图片必须复用同一风格锁。

超时、退避和脱敏字段只作为合同边界；实际 HTTP timeout、retry/backoff、日志脱敏必须由宿主运行时实现并单独验收。

该包仍然是静态合同，不发起网络请求。宿主关闭或卸载该包后，套图编排能力应整体不可用，不影响原有普通图片生成。
