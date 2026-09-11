# Async Audio Tasks 接口字段

## 协议身份

- 插件 ID：`async-audio`。
- Provider ID：`async-audio`。
- 能力：`audio`。
- 默认 Base URL：`https://api.openai.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/audio/tasks`。
- 查询：`GET /v1/audio/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 音频模型 ID。 |
| `prompt` | string | 是 | `input` | 待合成文本。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/audio/tasks"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.input` | `{"$ref":"request.prompt"}` |
| `create.body.voice` | `{"$coalesce":[{"$ref":"request.extra.audioVoice"},{"$ref":"request.providerOptions.async-audio.voice"},"alloy"]}` |
| `create.body.response_format` | `{"$coalesce":[{"$ref":"request.extra.audioFormat"},{"$ref":"request.providerOptions.async-audio.response_format"},"mp3"]}` |
| `create.body.speed` | `{"$coalesce":[{"$if":{"condition":{"$ne":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},0]},"then":{"$toFloat":{"$ref":"request.extra.audioSpeed"}},"else":null}},{"$ref":"request.providerOptions.async-audio.speed"},1]}` |
| `create.body.instructions` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.extra.audioInstructions"},{"$ref":"request.providerOptions.async-audio.instructions"}]}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/audio/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |
| `result.method` | `"GET"` |
| `result.path` | `"/v1/audio/tasks/{{taskId}}/content"` |
| `result.contentType` | `"application/json"` |
| `result.headers.Accept` | `"audio/*"` |

## Provider 扩展键

- `providerOptions.async-audio.instructions`
- `providerOptions.async-audio.response_format`
- `providerOptions.async-audio.speed`
- `providerOptions.async-audio.voice`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"response.task_id"},{"$ref":"response.data.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},{"$ref":"response.data.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.audios` | `{"$coalesce":[{"$ref":"response.audio_url"},{"$ref":"response.audioUrl"},{"$ref":"response.result_url"},{"$ref":"response.url"},{"$ref":"response.data.audio_url"},{"$ref":"response.output.url"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

异步音频任务：创建 /v1/audio/tasks，轮询同一路径，结果优先 URL，否则下载 /content。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "async-audio",
  "name": "Async Audio Tasks",
  "version": "2.0.0",
  "author": "OpenAI compatible / 影策",
  "description": "Async Audio Tasks 独立请求协议插件。",
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
        "id": "async-audio",
        "label": "Async Audio Tasks",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.openai.com",
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
            "description": "音频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "input",
            "description": "待合成文本。"
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
          "path": "/v1/audio/tasks",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "$ref": "request.prompt"
            },
            "voice": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioVoice"
                },
                {
                  "$ref": "request.providerOptions.async-audio.voice"
                },
                "alloy"
              ]
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioFormat"
                },
                {
                  "$ref": "request.providerOptions.async-audio.response_format"
                },
                "mp3"
              ]
            },
            "speed": {
              "$coalesce": [
                {
                  "$if": {
                    "condition": {
                      "$ne": [
                        {
                          "$toFloat": {
                            "$ref": "request.extra.audioSpeed"
                          }
                        },
                        0
                      ]
                    },
                    "then": {
                      "$toFloat": {
                        "$ref": "request.extra.audioSpeed"
                      }
                    },
                    "else": null
                  }
                },
                {
                  "$ref": "request.providerOptions.async-audio.speed"
                },
                1
              ]
            },
            "instructions": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.audioInstructions"
                  },
                  {
                    "$ref": "request.providerOptions.async-audio.instructions"
                  }
                ]
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/audio/tasks/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/audio/tasks/{{taskId}}/content",
          "headers": {
            "Accept": "audio/*"
          }
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
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.audio_url"
              },
              {
                "$ref": "response.audioUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.audio_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "error.message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
