# MUSE2API 异步视频接口

## 协议身份

- 插件 ID：`muse2api-video`。
- Provider ID：`muse2api-video`。
- 能力：`video`。
- 默认 Base URL：`http://156.225.18.215:18610`。
- 鉴权：`Authorization: Bearer <API Key>`。
- 创建：`POST /v1/videos`，JSON。
- 查询：`GET /v1/videos/{task_id}`，JSON。

## 参数映射

| 影策参数 | 必填 | 上游字段 | 说明 |
| --- | --- | --- | --- |
| `model` | 是 | 不发送 | 影策渠道的模型标识；所给上游请求样例没有 `model` 字段。 |
| `prompt` | 是 | `prompt` | 顶层字符串字段，不放入 `input` 或 `parameters`。 |
| `duration` | 是 | `duration` | 正整数秒。 |
| `aspectRatio` | 是 | `size` | 例如 `16:9`。 |

创建请求体示例：

```json
{
  "prompt": "一只小猫在草地上走动",
  "duration": 5,
  "size": "16:9"
}
```

## 异步任务

创建响应中的 `id` 作为任务 ID；`queued` 映射为等待状态。插件轮询 `GET /v1/videos/{id}`，直到返回终态。成功状态读取 `result.url`，并由宿主下载后持久化。

上游可能返回 `/v1/media/xxx.mp4` 这样的站点根相对地址。宿主会按渠道 Base URL 解析该地址，再下载媒体。

```bash
curl -X POST "$MUSE2API_BASE_URL/v1/videos" \
  -H "Authorization: Bearer $MUSE2API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"一只小猫在草地上走动","duration":5,"size":"16:9"}'

curl "$MUSE2API_BASE_URL/v1/videos/task_xxx" \
  -H "Authorization: Bearer $MUSE2API_KEY"
```

默认 Base URL 使用用户提供的 HTTP 地址；若上游同时提供 HTTPS 地址，可在渠道配置中替换为 HTTPS。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "muse2api-video",
  "name": "MUSE2API Async Video",
  "version": "1.0.0",
  "author": "影策",
  "description": "适配 MUSE2API 的 JSON 异步视频生成接口。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "muse2api-video",
        "label": "MUSE2API 视频生成",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "http://156.225.18.215:18610",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "影策渠道中的模型标识；当前上游请求样例不发送 model 字段。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词，作为 JSON 顶层 prompt 发送。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "视频时长，整数秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": true,
            "mapping": "size",
            "description": "画幅比例，例如 16:9；映射到上游 size。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gt": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "MUSE2API 视频时长必须是正整数秒"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$ref": "request.aspectRatio"
                  }
                },
                0
              ]
            },
            "message": "MUSE2API 视频 size 不能为空"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$ref": "request.duration"
            },
            "size": {
              "$ref": "request.aspectRatio"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.data.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.result.url"
              },
              {
                "$ref": "response.data.result.url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.url"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
