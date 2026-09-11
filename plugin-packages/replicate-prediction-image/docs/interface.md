# Replicate Predictions Image 接口字段

## 协议身份

- 插件 ID：`replicate-prediction-image`。
- Provider ID：`replicate-prediction-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.replicate.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/predictions`。
- 查询：`GET /v1/predictions/{{taskId}}`。
- 取消：`POST /v1/predictions/{{taskId}}/cancel`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `provider image/reference fields` | 参考图或编辑源图，role 由业务层确定。 |
| `imageCount` | integer | 否 | `n/sample_count` | 输出数量。 |
| `aspectRatio` | string | 否 | `size/aspect_ratio` | 比例或尺寸，语义按协议说明。 |
| `resolution` | string | 否 | `resolution/imageSize` | 分辨率档位。 |
| `quality` | string | 否 | `quality` | 质量档位。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/predictions"` |
| `create.contentType` | `"application/json"` |
| `create.body.version` | `{"$omitEmpty":{"$ref":"request.providerOptions.replicate-prediction-image.version"}}` |
| `create.body.model` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.replicate-prediction-image.model"},{"$ref":"request.model"}]}}` |
| `create.body.input` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.replicate-prediction-image.input"},{"prompt":{"$ref":"request.prompt"},"images":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}},"videos":{"$map":{"from":{"$ref":"request.videos"},"as":"media","in":{"$ref":"media.value"}}},"audios":{"$map":{"from":{"$ref":"request.audios"},"as":"media","in":{"$ref":"media.value"}}}}]}}` |
| `create.body.prompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.replicate-prediction-image.workflow"}}` |
| `create.body.client_id` | `{"$omitEmpty":{"$ref":"request.providerOptions.replicate-prediction-image.client_id"}}` |
| `create.body.webhook` | `{"$omitEmpty":{"$ref":"request.providerOptions.replicate-prediction-image.webhook"}}` |
| `create.body.webhook_events_filter` | `{"$omitEmpty":{"$ref":"request.providerOptions.replicate-prediction-image.webhook_events_filter"}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/predictions/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |
| `cancel.method` | `"POST"` |
| `cancel.path` | `"/v1/predictions/{{taskId}}/cancel"` |
| `cancel.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.replicate-prediction-image.client_id`
- `providerOptions.replicate-prediction-image.input`
- `providerOptions.replicate-prediction-image.model`
- `providerOptions.replicate-prediction-image.version`
- `providerOptions.replicate-prediction-image.webhook`
- `providerOptions.replicate-prediction-image.webhook_events_filter`
- `providerOptions.replicate-prediction-image.workflow`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"response.request_id"},{"$ref":"response.prompt_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},{"$ref":"response.state"},{"$ref":"response.data.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.images` | `{"$ref":"response.output"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

这是运行时/工作流协议，模型字段由 endpoint、version 或 workflow schema 决定。插件不伪造固定模型字段；providerOptions.input/workflow/prompt 是完整请求对象，并由 conformance fixture 锁定实际接入版本。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "replicate-prediction-image",
  "name": "Replicate Predictions Image",
  "version": "2.0.0",
  "author": "Replicate / 影策",
  "description": "Replicate Predictions Image 独立请求协议插件。",
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
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
        "id": "replicate-prediction-image",
        "label": "Replicate Predictions Image",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.replicate.com",
        "requiresPublicMediaUrls": false,
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
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/predictions",
          "contentType": "application/json",
          "body": {
            "version": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.replicate-prediction-image.version"
              }
            },
            "model": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.replicate-prediction-image.model"
                  },
                  {
                    "$ref": "request.model"
                  }
                ]
              }
            },
            "input": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.replicate-prediction-image.input"
                  },
                  {
                    "prompt": {
                      "$ref": "request.prompt"
                    },
                    "images": {
                      "$map": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    },
                    "videos": {
                      "$map": {
                        "from": {
                          "$ref": "request.videos"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    },
                    "audios": {
                      "$map": {
                        "from": {
                          "$ref": "request.audios"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                ]
              }
            },
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.replicate-prediction-image.workflow"
              }
            },
            "client_id": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.replicate-prediction-image.client_id"
              }
            },
            "webhook": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.replicate-prediction-image.webhook"
              }
            },
            "webhook_events_filter": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.replicate-prediction-image.webhook_events_filter"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/predictions/{{taskId}}"
        },
        "cancel": {
          "method": "POST",
          "path": "/v1/predictions/{{taskId}}/cancel"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.prompt_id"
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
                "$ref": "response.state"
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
          "images": {
            "$ref": "response.output"
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
