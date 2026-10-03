# 电商套图 Agent 合同

这是电商套图 Agent 的静态合同插件。它描述批次、SKU、角度/场景、背景、尺寸矩阵、统一风格锁、幂等键、重试与恢复边界，不发起网络请求，也不替代实际图片 provider。

## 批次与响应

- 创建与执行由宿主的套图编排器负责，实际图片生成 provider 由每个批次项单独选择。
- 每个批次项必须保留稳定的 `itemId` 和 `idempotencyKey`，恢复时复用原幂等键。
- `unknown_submitted` 表示上游提交结果未知，不允许自动重试，避免重复计费或重复生成。
- 响应状态使用 `queued`、`running`、`succeeded`、`failed`、`unknown_submitted`，批次状态使用 `partial_succeeded` 等合同枚举。
- 超时、重试、脱敏和恢复游标均由合同字段明确表达；敏感凭证不得进入日志或任务正文。
- `styleLock` 必须在规划阶段生成，所有图片共享同一风格指纹和提示词前缀；锚点图完成前不并发生成其余图片。

## 执行边界

该包是静态合同，不提供可执行的 HTTP 操作。实际执行器接入前，宿主必须拒绝将其当作图片 provider 直接发起请求。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "product-suite-contract",
  "name": "电商套图 Agent 合同",
  "version": "1.1.0",
  "author": "iGO Studio",
  "description": "电商套图 Agent 的风格锁、批次状态与恢复合同；不发起网络请求。",
  "surfaces": [
    "fullscreen",
    "hybrid"
  ],
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": []
  },
  "contributes": {
    "agents": [
      "ecommerce-conversational"
    ],
    "aiCapabilities": [
      "ecommerce-style-planner"
    ],
    "providers": [
      {
        "id": "product-suite-contract",
        "label": "Product Suite Batch Contract",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "canvas",
          "creation"
        ],
        "baseUrl": "https://product-suite-contract.invalid",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "none"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": false,
            "mapping": "model",
            "description": "由实际图片 provider 选择。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "prompt",
            "description": "由套图模板展开后的单项提示词。"
          }
        ],
        "batchContract": {
          "version": "1.0",
          "required": [
            "batchId",
            "product",
            "items",
            "retryPolicy",
            "recovery",
            "styleLock"
          ],
          "itemRequired": [
            "itemId",
            "idempotencyKey",
            "angle",
            "scene",
            "background",
            "size",
            "status",
            "retry"
          ],
          "status": [
            "queued",
            "running",
            "succeeded",
            "failed",
            "unknown_submitted"
          ],
          "batchStatus": [
            "queued",
            "running",
            "partial_succeeded",
            "succeeded",
            "failed",
            "recovering"
          ],
          "retry": {
            "unknownSubmittedIsRetryable": false,
            "failedIsRetryable": true
          },
          "redaction": {
            "sensitivePaths": [
              "credentials.apiKey",
              "credentials.secretKey",
              "headers.authorization"
            ]
          },
          "timeout": {
            "perItemMsRequired": true,
            "batchMsRequired": true,
            "timeoutOutcome": "failed"
          },
          "recovery": {
            "resumeCursorRequired": true,
            "replayRequiresSameIdempotencyKey": true
          },
          "styleLock": {
            "required": [
              "version",
              "fingerprint",
              "globalPrompt",
              "negativePrompt",
              "anchorItemId",
              "sharedPromptPrefix"
            ],
            "anchorFirst": true,
            "maxParallelBeforeAnchor": 1
          }
        },
        "create": {
          "method": "NONE",
          "path": "/contract-only",
          "contentType": "application/json"
        },
        "response": {
          "status": "succeeded"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
