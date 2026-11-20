# AWS Bedrock InvokeModel 接口字段

## FORMA-TEXT-MULTIMODAL：显式模型专用请求体

创建为 POST /model/{{model}}/invoke。必须提供非空 JSON 对象 providerOptions.aws-bedrock-invoke-model.body 或 extra_body；body 优先。对象原样作为请求体，不合并 model/messages/input/parameters，也不把统一 prompt、instructions、采样值或媒体猜成某种模型协议。统一输入包含图片、音频、视频、未知或无效内容（包括历史）时明确拒绝，避免静默丢弃。调用方必须自行在显式对象中编码模型所需的文字和媒体；对象内的模型专用媒体是 opaque contract，插件不校验也不承诺跨模型兼容。

响应没有通用模型合同；本 profile 仅提取已列出的常见文本路径（包括 Titan results[0].outputText、content[0].text、generation、outputs[0].text），不保证任意模型均能归一。需要稳定统一的 messages 多模态接口时使用 Converse。同步入口拒绝 stream=true。

官方依据：[InvokeModel](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html)，其中 body/response 都明确按模型区分。


## 协议身份

- 插件 ID：`aws-bedrock-invoke-model`。
- Provider ID：`aws-bedrock-invoke-model`。
- 能力：`text`。
- 默认 Base URL：`https://bedrock-runtime.{region}.amazonaws.com`。
- 鉴权驱动：`aws-sigv4`。
- 创建：`POST /model/{{model}}/invoke`。
- 生命周期：同步响应。


## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | Access Key ID |
| `secretKey` | secret | 是 | Secret Access Key |


## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `explicit providerOptions body only` | 包含历史消息和当前用户输入。 |
| `instructions` | string | 否 | `system/instructions` | 系统指令。 |
| `temperature` | number | 否 | `temperature` | 采样温度。 |
| `top_p` | number | 否 | `top_p` | 核采样参数。 |
| `max_tokens` | integer | 否 | `max_tokens/max_output_tokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关；后台任务当前以最终响应归一。 |


## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/model/{{model}}/invoke"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$coalesce":[{"$ref":"request.providerOptions.aws-bedrock-invoke-model.body"},{"$ref":"request.providerOptions.aws-bedrock-invoke-model.extra_body"}]}` |


## Provider 扩展键

- `providerOptions.aws-bedrock-invoke-model.body`
- `providerOptions.aws-bedrock-invoke-model.extra_body`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.textPaths[0]` | `"results.0.outputText"` |
| `response.textPaths[1]` | `"content.0.text"` |
| `response.textPaths[2]` | `"generation"` |
| `response.textPaths[3]` | `"outputs.0.text"` |
| `response.textPaths[4]` | `"output.text"` |
| `response.textPaths[5]` | `"output_text"` |
| `response.textPaths[6]` | `"choices.0.message.content"` |
| `response.textPaths[7]` | `"result"` |
| `response.reasoningPaths[0]` | `"reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.errorPaths[1]` | `"code"` |
| `response.messagePaths[0]` | `"error.message"` |
| `response.messagePaths[1]` | `"message"` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "aws-bedrock-invoke-model",
  "name": "AWS Bedrock InvokeModel",
  "version": "2.0.1",
  "author": "AWS / 影策",
  "description": "AWS Bedrock InvokeModel 独立请求协议插件。",
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
        "label": "Access Key ID",
        "required": true
      },
      {
        "name": "secretKey",
        "type": "secret",
        "label": "Secret Access Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "aws-bedrock-invoke-model",
        "label": "AWS Bedrock InvokeModel",
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
        "baseUrl": "https://bedrock-runtime.{region}.amazonaws.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "aws-sigv4",
          "field": "apiKey",
          "secretField": "secretKey",
          "service": "bedrock"
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
            "mapping": "explicit providerOptions body only",
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
          "path": "/model/{{model}}/invoke",
          "contentType": "application/json",
          "body": {
            "$coalesce": [
              {
                "$ref": "request.providerOptions.aws-bedrock-invoke-model.body"
              },
              {
                "$ref": "request.providerOptions.aws-bedrock-invoke-model.extra_body"
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "results.0.outputText",
            "content.0.text",
            "generation",
            "outputs.0.text",
            "output.text",
            "output_text",
            "choices.0.message.content",
            "result"
          ],
          "reasoningPaths": [
            "reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ]
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.textInput.invalidCount"
                },
                0
              ]
            },
            "message": "输入或历史消息包含无效或未识别的内容块"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.textInput.parts"
                      },
                      "as": "p",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "p.type"
                            },
                            [
                              "text"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "该协议不支持输入或历史消息中的媒体类型"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.textMessages"
                      },
                      "as": "m",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "m.role"
                            },
                            [
                              "system",
                              "user",
                              "assistant"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "该协议只接受 system、user、assistant 消息"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.textMessages"
                      },
                      "as": "m",
                      "where": {
                        "$and": [
                          {
                            "$not": {
                              "$eq": [
                                {
                                  "$ref": "m.role"
                                },
                                "user"
                              ]
                            }
                          },
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$filter": {
                                    "from": {
                                      "$ref": "m.parts"
                                    },
                                    "as": "p",
                                    "where": {
                                      "$not": {
                                        "$eq": [
                                          {
                                            "$ref": "p.type"
                                          },
                                          "text"
                                        ]
                                      }
                                    }
                                  }
                                }
                              },
                              0
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "该协议仅支持 user 消息中的媒体"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.textInput.parts"
                      },
                      "as": "p",
                      "where": {
                        "$and": [
                          {
                            "$not": {
                              "$eq": [
                                {
                                  "$ref": "p.type"
                                },
                                "text"
                              ]
                            }
                          },
                          {
                            "$not": {
                              "$ref": "p.isInline"
                            }
                          },
                          {
                            "$not": {
                              "$in": [
                                {
                                  "$first": {
                                    "$split": [
                                      {
                                        "$ref": "p.value"
                                      },
                                      ":"
                                    ]
                                  }
                                },
                                [
                                  "http",
                                  "https"
                                ]
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "该协议仅支持 HTTP(S) 媒体 URL 或内联数据"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.aws-bedrock-invoke-model.body"
                      },
                      {
                        "$ref": "request.providerOptions.aws-bedrock-invoke-model.extra_body"
                      }
                    ]
                  }
                },
                0
              ]
            },
            "message": "InvokeModel 必须提供非空、模型专用的 providerOptions.aws-bedrock-invoke-model.body 或 extra_body"
          },
          {
            "assert": {
              "$not": {
                "$or": [
                  {
                    "$ref": "request.providerOptions.aws-bedrock-invoke-model.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-invoke-model.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-invoke-model.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-invoke-model.parameters.stream"
                  }
                ]
              }
            },
            "message": "该同步协议不支持 stream=true"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.aws-bedrock-invoke-model.body"
                    },
                    {
                      "$ref": "request.providerOptions.aws-bedrock-invoke-model.extra_body"
                    }
                  ]
                },
                {
                  "$merge": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.aws-bedrock-invoke-model.body"
                        },
                        {
                          "$ref": "request.providerOptions.aws-bedrock-invoke-model.extra_body"
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "InvokeModel body 必须是 JSON 对象"
          }
        ]
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
