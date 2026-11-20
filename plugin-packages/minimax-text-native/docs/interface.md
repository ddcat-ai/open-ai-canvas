# MiniMax Text Native 接口字段

## FORMA-TEXT-MULTIMODAL：原生同步合同

POST /v1/text/chatcompletion_v2，正文 model/messages，不发送通用 input/parameters 包装。request.textMessages 转为文本字符串或 user 的 {type:"text",text}、{type:"image_url",image_url:{url}} 数组。HTTP(S) 图片与内联 data URL 均可；非 user 媒体、gs URL、音频、视频、未知或无效内容（包括历史）明确拒绝。

保留命名空间 parameters/body/extra_body 的原生字段，直接选项 temperature/top_p/max_tokens/tools/tool_choice/response_format 作为默认值；messages 最终由统一投影生成。max_tokens 是官方已弃用但仍接受字段；新配置优先在原生对象中使用 max_completion_tokens，插件不改模型上限、不推断 tokens_to_generate。同步入口拒绝 stream=true。

响应读取 choices[0].message.content、reasoning_content 与 usage。HTTP 200 下 base_resp.status_code 非零仍为失败，base_resp.status_msg 保留；零或缺省不据此报错。

官方依据：[Text generation](https://platform.minimax.io/docs/api-reference/text-post)。其图片示例使用 MiniMax-Text-01，而当前模型列表不同；这只能证明 image_url 线格式，不能证明所有当前模型支持图片。音频响应字段不证明支持音频输入。默认域名沿用现有渠道，未迁移账号/鉴权；官方国际示例使用 api.minimax.io，可在渠道中显式配置。


## 协议身份

- 插件 ID：`minimax-text-native`。
- Provider ID：`minimax-text-native`。
- 能力：`text`。
- 默认 Base URL：`https://api.minimax.chat`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/text/chatcompletion_v2`。
- 生命周期：同步响应。


## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |


## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `messages` | 包含历史消息和当前用户输入。 |
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
| `create.path` | `"/v1/text/chatcompletion_v2"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"temperature":{"$omitEmpty":{"$ref":"request.providerOptions.minimax-text-native.temperature"}},"top_p":{"$omitEmpty":{"$ref":"request.providerOptions.minimax-text-native.top_p"}},"max_tokens":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.minimax-text-native.max_tokens"},{"$ref":"request.extra.max_tokens"}]}},"tools":{"$omitEmpty":{"$ref":"request.providerOptions.minimax-text-native.tools"}},"tool_choice":{"$omitEmpty":{"$ref":"request.providerOptions.minimax-text-native.tool_choice"}},"response_format":{"$omitEmpty":{"$ref":"request.providerOptions.minimax-text-native.response_format"}}},{"$coalesce":[{"$ref":"request.providerOptions.minimax-text-native.parameters"},{}]},{"$coalesce":[{"$ref":"request.providerOptions.minimax-text-native.body"},{"$ref":"request.providerOptions.minimax-text-native.extra_body"},{}]},{"model":{"$ref":"request.model"},"messages":{"$map":{"from":{"$ref":"request.textMessages"},"as":"m","in":{"role":{"$ref":"m.role"},"content":{"$if":{"condition":{"$eq":[{"$len":{"$filter":{"from":{"$ref":"m.parts"},"as":"p","where":{"$not":{"$eq":[{"$ref":"p.type"},"text"]}}}}},0]},"then":{"$ref":"m.text"},"else":{"$map":{"from":{"$ref":"m.parts"},"as":"p","in":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"text"]},"then":{"type":"text","text":{"$ref":"p.text"}},"else":{"type":"image_url","image_url":{"url":{"$ref":"p.value"}}}}}}}}}}}},"stream":false}]}` |


## Provider 扩展键

- `providerOptions.minimax-text-native.body`
- `providerOptions.minimax-text-native.extra_body`
- `providerOptions.minimax-text-native.max_tokens`
- `providerOptions.minimax-text-native.parameters`
- `providerOptions.minimax-text-native.response_format`
- `providerOptions.minimax-text-native.temperature`
- `providerOptions.minimax-text-native.tool_choice`
- `providerOptions.minimax-text-native.tools`
- `providerOptions.minimax-text-native.top_p`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `{"$if":{"condition":{"$and":[{"$not":{"$eq":[{"$ref":"response.base_resp.status_code"},null]}},{"$not":{"$eq":[{"$ref":"response.base_resp.status_code"},0]}}]},"then":"failed","else":"succeeded"}}` |
| `response.textPaths[0]` | `"choices.0.message.content"` |
| `response.reasoningPaths[0]` | `"choices.0.message.reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"base_resp.status_msg"` |
| `response.messagePaths[1]` | `"error.message"` |
| `response.messagePaths[2]` | `"message"` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "minimax-text-native",
  "name": "MiniMax Text Native",
  "version": "2.0.1",
  "author": "MiniMax / 影策",
  "description": "MiniMax Text Native 独立请求协议插件。",
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
        "id": "minimax-text-native",
        "label": "MiniMax Text Native",
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
        "baseUrl": "https://api.minimax.chat",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "messages",
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
          "path": "/v1/text/chatcompletion_v2",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "temperature": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.minimax-text-native.temperature"
                  }
                },
                "top_p": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.minimax-text-native.top_p"
                  }
                },
                "max_tokens": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.minimax-text-native.max_tokens"
                      },
                      {
                        "$ref": "request.extra.max_tokens"
                      }
                    ]
                  }
                },
                "tools": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.minimax-text-native.tools"
                  }
                },
                "tool_choice": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.minimax-text-native.tool_choice"
                  }
                },
                "response_format": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.minimax-text-native.response_format"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-text-native.parameters"
                  },
                  {}
                ]
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.minimax-text-native.body"
                  },
                  {
                    "$ref": "request.providerOptions.minimax-text-native.extra_body"
                  },
                  {}
                ]
              },
              {
                "model": {
                  "$ref": "request.model"
                },
                "messages": {
                  "$map": {
                    "from": {
                      "$ref": "request.textMessages"
                    },
                    "as": "m",
                    "in": {
                      "role": {
                        "$ref": "m.role"
                      },
                      "content": {
                        "$if": {
                          "condition": {
                            "$eq": [
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
                          },
                          "then": {
                            "$ref": "m.text"
                          },
                          "else": {
                            "$map": {
                              "from": {
                                "$ref": "m.parts"
                              },
                              "as": "p",
                              "in": {
                                "$if": {
                                  "condition": {
                                    "$eq": [
                                      {
                                        "$ref": "p.type"
                                      },
                                      "text"
                                    ]
                                  },
                                  "then": {
                                    "type": "text",
                                    "text": {
                                      "$ref": "p.text"
                                    }
                                  },
                                  "else": {
                                    "type": "image_url",
                                    "image_url": {
                                      "url": {
                                        "$ref": "p.value"
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                },
                "stream": false
              }
            ]
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$not": {
                      "$eq": [
                        {
                          "$ref": "response.base_resp.status_code"
                        },
                        null
                      ]
                    }
                  },
                  {
                    "$not": {
                      "$eq": [
                        {
                          "$ref": "response.base_resp.status_code"
                        },
                        0
                      ]
                    }
                  }
                ]
              },
              "then": "failed",
              "else": "succeeded"
            }
          },
          "textPaths": [
            "choices.0.message.content"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "base_resp.status_msg",
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
                              "text",
                              "image"
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
              "$not": {
                "$or": [
                  {
                    "$ref": "request.providerOptions.minimax-text-native.stream"
                  },
                  {
                    "$ref": "request.providerOptions.minimax-text-native.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.minimax-text-native.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.minimax-text-native.parameters.stream"
                  }
                ]
              }
            },
            "message": "该同步协议不支持 stream=true"
          }
        ]
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
