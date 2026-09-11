# OpenAI Audio Speech 接口字段

## 协议身份

- 插件 ID：`openai-audio`。
- Provider ID：`openai-audio`。
- 能力：`audio`。
- 默认 Base URL：`https://api.openai.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/audio/speech`。
- 生命周期：同步响应。

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
| `create.path` | `"/v1/audio/speech"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.input` | `{"$ref":"request.prompt"}` |
| `create.body.voice` | `{"$coalesce":[{"$ref":"request.extra.audioVoice"},{"$ref":"request.providerOptions.openai-audio.voice"},"alloy"]}` |
| `create.body.response_format` | `{"$coalesce":[{"$ref":"request.extra.audioFormat"},{"$ref":"request.providerOptions.openai-audio.response_format"},"mp3"]}` |
| `create.body.speed` | `{"$coalesce":[{"$if":{"condition":{"$ne":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},0]},"then":{"$toFloat":{"$ref":"request.extra.audioSpeed"}},"else":null}},{"$ref":"request.providerOptions.openai-audio.speed"},1]}` |
| `create.body.instructions` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.extra.audioInstructions"},{"$ref":"request.providerOptions.openai-audio.instructions"}]}}` |

## Provider 扩展键

- `providerOptions.openai-audio.instructions`
- `providerOptions.openai-audio.response_format`
- `providerOptions.openai-audio.speed`
- `providerOptions.openai-audio.voice`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.binaryPayload` | `true` |
| `response.resultKind` | `"audio"` |
| `response.status` | `"succeeded"` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

同步 /v1/audio/speech 返回原始音频流，由 binaryPayload 包装为统一音频结果。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "openai-audio",
  "name": "OpenAI Audio Speech",
  "version": "2.0.0",
  "author": "OpenAI / 影策",
  "description": "OpenAI Audio Speech 独立请求协议插件。",
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
        "id": "openai-audio",
        "label": "OpenAI Audio Speech",
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
          "path": "/v1/audio/speech",
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
                  "$ref": "request.providerOptions.openai-audio.voice"
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
                  "$ref": "request.providerOptions.openai-audio.response_format"
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
                  "$ref": "request.providerOptions.openai-audio.speed"
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
                    "$ref": "request.providerOptions.openai-audio.instructions"
                  }
                ]
              }
            }
          }
        },
        "response": {
          "binaryPayload": true,
          "resultKind": "audio",
          "status": "succeeded",
          "errorPaths": [
            "error.code"
          ],
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
