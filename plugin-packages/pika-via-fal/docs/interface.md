# Pika via fal.ai 接口字段

## 协议身份

- 插件 ID：`pika-via-fal`。
- Provider ID：`pika-via-fal`。
- 能力：`video`。
- 默认 Base URL：`https://queue.fal.run`。
- 鉴权驱动：`bearer`。
- 创建：`POST /{{model}}`。
- 查询：`GET /{{request.providerOptions.pika-via-fal.statusPath}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 视频模型 ID。 |
| `prompt` | string | 是 | `prompt/content/input` | 视频提示词。 |
| `images` | media[] | 否 | `first/last/reference image` | 显式 role 图片输入。 |
| `videos` | media[] | 否 | `reference video` | 参考视频。 |
| `audios` | media[] | 否 | `reference audio/voice` | 参考音频或音色。 |
| `duration` | integer | 否 | `duration/seconds` | 时长秒数。 |
| `aspectRatio` | string | 否 | `ratio/aspect_ratio/size` | 画幅比例或尺寸。 |
| `resolution` | string | 否 | `resolution` | 分辨率档位。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成音频。 |
| `watermark` | boolean | 否 | `watermark` | 水印开关。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/{{model}}"` |
| `create.contentType` | `"application/json"` |
| `create.body.version` | `{"$omitEmpty":{"$ref":"request.providerOptions.pika-via-fal.version"}}` |
| `create.body.model` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.pika-via-fal.model"},{"$ref":"request.model"}]}}` |
| `create.body.input` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.pika-via-fal.input"},{"prompt":{"$ref":"request.prompt"},"images":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}},"videos":{"$map":{"from":{"$ref":"request.videos"},"as":"media","in":{"$ref":"media.value"}}},"audios":{"$map":{"from":{"$ref":"request.audios"},"as":"media","in":{"$ref":"media.value"}}}}]}}` |
| `create.body.prompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.pika-via-fal.workflow"}}` |
| `create.body.client_id` | `{"$omitEmpty":{"$ref":"request.providerOptions.pika-via-fal.client_id"}}` |
| `create.body.webhook` | `{"$omitEmpty":{"$ref":"request.providerOptions.pika-via-fal.webhook"}}` |
| `create.body.webhook_events_filter` | `{"$omitEmpty":{"$ref":"request.providerOptions.pika-via-fal.webhook_events_filter"}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/{{request.providerOptions.pika-via-fal.statusPath}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.pika-via-fal.client_id`
- `providerOptions.pika-via-fal.input`
- `providerOptions.pika-via-fal.model`
- `providerOptions.pika-via-fal.statusPath`
- `providerOptions.pika-via-fal.version`
- `providerOptions.pika-via-fal.webhook`
- `providerOptions.pika-via-fal.webhook_events_filter`
- `providerOptions.pika-via-fal.workflow`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"response.request_id"},{"$ref":"response.prompt_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},{"$ref":"response.state"},{"$ref":"response.data.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.videos` | `{"$ref":"response.video"}` |
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
  "id": "pika-via-fal",
  "name": "Pika via fal.ai",
  "version": "2.0.0",
  "author": "fal.ai / 影策",
  "description": "Pika via fal.ai 独立请求协议插件。",
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
        "id": "pika-via-fal",
        "label": "Pika via fal.ai",
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
        "baseUrl": "https://queue.fal.run",
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
            "description": "视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt/content/input",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "first/last/reference image",
            "description": "显式 role 图片输入。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference video",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference audio/voice",
            "description": "参考音频或音色。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration/seconds",
            "description": "时长秒数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio/size",
            "description": "画幅比例或尺寸。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "水印开关。"
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
          "path": "/{{model}}",
          "contentType": "application/json",
          "body": {
            "version": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.pika-via-fal.version"
              }
            },
            "model": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.pika-via-fal.model"
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
                    "$ref": "request.providerOptions.pika-via-fal.input"
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
                "$ref": "request.providerOptions.pika-via-fal.workflow"
              }
            },
            "client_id": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.pika-via-fal.client_id"
              }
            },
            "webhook": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.pika-via-fal.webhook"
              }
            },
            "webhook_events_filter": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.pika-via-fal.webhook_events_filter"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/{{request.providerOptions.pika-via-fal.statusPath}}"
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
          "videos": {
            "$ref": "response.video"
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
