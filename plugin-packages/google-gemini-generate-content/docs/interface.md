# Google Gemini generateContent 接口字段

## 协议身份

- 插件 ID：`google-gemini-generate-content`。
- Provider ID：`gemini-generate-content`。
- 能力：`text`。
- 默认 Base URL：`https://generativelanguage.googleapis.com`。
- 鉴权驱动：`google-api-key`。
- 创建：`POST /v1beta/models/{{model}}:generateContent`。
- Agent：`POST /v1beta/models/{{model}}:generateContent`。
- 生命周期：同步响应。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `provider message container` | 包含历史消息和当前用户输入。 |
| `instructions` | string | 否 | `system/instructions` | 系统指令。 |
| `temperature` | number | 否 | `temperature` | 采样温度。 |
| `top_p` | number | 否 | `top_p` | 核采样参数。 |
| `max_tokens` | integer | 否 | `max_tokens/max_output_tokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关；后台任务当前以最终响应归一。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1beta/models/{{model}}:generateContent"` |
| `create.contentType` | `"application/json"` |
| `create.body.contents` | `{"$map":{"from":{"$filter":{"from":{"$ref":"request.messages"},"as":"message","where":{"$ne":[{"$ref":"message.role"},"system"]}}},"as":"message","in":{"role":{"$if":{"condition":{"$eq":[{"$ref":"message.role"},"assistant"]},"then":"model","else":"user"}},"parts":[{"text":{"$ref":"message.content"}}]}}}` |
| `create.body.systemInstruction` | `{"$if":{"condition":{"$ref":"request.instructions"},"then":{"parts":[{"text":{"$ref":"request.instructions"}}]},"else":null}}` |
| `create.body.generationConfig` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-generate-content.generationConfig"}}` |
| `create.body.safetySettings` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-generate-content.safetySettings"}}` |
| `create.body.tools` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-generate-content.tools"}}` |
| `create.body.toolConfig` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-generate-content.toolConfig"}}` |
| `create.body.cachedContent` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-generate-content.cachedContent"}}` |
| `agent.method` | `"POST"` |
| `agent.path` | `"/v1beta/models/{{model}}:generateContent"` |
| `agent.contentType` | `"application/json"` |
| `agent.body` | `{"$ref":"request.extra.agent.gemini"}` |

## Provider 扩展键

- `providerOptions.gemini-generate-content.cachedContent`
- `providerOptions.gemini-generate-content.generationConfig`
- `providerOptions.gemini-generate-content.safetySettings`
- `providerOptions.gemini-generate-content.toolConfig`
- `providerOptions.gemini-generate-content.tools`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.text` | `{"$map":{"from":{"$ref":"response.candidates.0.content.parts"},"as":"part","in":{"$omitEmpty":{"$ref":"part.text"}}}}` |
| `response.usage` | `{"$ref":"response.usageMetadata"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |
| `agentResponse.textPaths[0]` | `"candidates.0.content.parts.0.text"` |
| `agentResponse.toolCallsPath` | `"candidates.0.content.parts"` |
| `agentResponse.toolCallIdPaths[0]` | `"functionCall.id"` |
| `agentResponse.toolCallNamePaths[0]` | `"functionCall.name"` |
| `agentResponse.toolCallArgumentsPaths[0]` | `"functionCall.args"` |
| `agentResponse.toolCallThoughtSignaturePaths[0]` | `"thoughtSignature"` |
| `agentResponse.toolCallThoughtSignaturePaths[1]` | `"thought_signature"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该包只代表上述线协议 profile；同一品牌的其他 endpoint、云区域或网关包装必须使用独立插件，不能根据模型名猜测。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "google-gemini-generate-content",
  "name": "Google Gemini generateContent",
  "version": "2.0.0",
  "author": "Google / 影策",
  "description": "Google Gemini generateContent 独立请求协议插件。",
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
        "id": "gemini-generate-content",
        "label": "Google Gemini generateContent",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://generativelanguage.googleapis.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "google-api-key",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "包含历史消息和当前用户输入。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system/instructions",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens/max_output_tokens",
            "description": "最大输出 token。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools/toolConfig",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format/text",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "流式开关；后台任务当前以最终响应归一。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "contents": {
              "$map": {
                "from": {
                  "$filter": {
                    "from": {
                      "$ref": "request.messages"
                    },
                    "as": "message",
                    "where": {
                      "$ne": [
                        {
                          "$ref": "message.role"
                        },
                        "system"
                      ]
                    }
                  }
                },
                "as": "message",
                "in": {
                  "role": {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$ref": "message.role"
                          },
                          "assistant"
                        ]
                      },
                      "then": "model",
                      "else": "user"
                    }
                  },
                  "parts": [
                    {
                      "text": {
                        "$ref": "message.content"
                      }
                    }
                  ]
                }
              }
            },
            "systemInstruction": {
              "$if": {
                "condition": {
                  "$ref": "request.instructions"
                },
                "then": {
                  "parts": [
                    {
                      "text": {
                        "$ref": "request.instructions"
                      }
                    }
                  ]
                },
                "else": null
              }
            },
            "generationConfig": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-generate-content.generationConfig"
              }
            },
            "safetySettings": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-generate-content.safetySettings"
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-generate-content.tools"
              }
            },
            "toolConfig": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-generate-content.toolConfig"
              }
            },
            "cachedContent": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-generate-content.cachedContent"
              }
            }
          }
        },
        "agent": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "$ref": "request.extra.agent.gemini"
          }
        },
        "response": {
          "status": "succeeded",
          "text": {
            "$map": {
              "from": {
                "$ref": "response.candidates.0.content.parts"
              },
              "as": "part",
              "in": {
                "$omitEmpty": {
                  "$ref": "part.text"
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usageMetadata"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "agentResponse": {
          "textPaths": [
            "candidates.0.content.parts.0.text"
          ],
          "toolCallsPath": "candidates.0.content.parts",
          "toolCallIdPaths": [
            "functionCall.id"
          ],
          "toolCallNamePaths": [
            "functionCall.name"
          ],
          "toolCallArgumentsPaths": [
            "functionCall.args"
          ],
          "toolCallThoughtSignaturePaths": [
            "thoughtSignature",
            "thought_signature"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
