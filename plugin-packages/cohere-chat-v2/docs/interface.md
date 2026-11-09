# Cohere Chat v2 接口字段

## FORMA-TEXT-MULTIMODAL：原生同步合同

POST /v2/chat，正文 model/messages。request.textMessages 的纯文本转为字符串；user 图片转为 {type:"image_url",image_url:{url}}，URL 可以是 HTTP(S) 或内联 data URL。system/assistant 只接受文本；音频、视频、gs URL、未知或无效内容（包括历史）明确拒绝。图片兼容性由所选模型决定，不修改模型能力、限额或价格。

保留原有 temperature、stop_sequences、tools、tool_choice、response_format、documents、citation_options、safety_mode、seed 选项。原生 p 优先，其次统一 top_p，输出为 p 而不是 top_p；max_tokens 支持命名空间值并回退 request.extra.max_tokens。同步入口拒绝 stream=true。响应拼接 message.content 中全部 type=text 块；thinking 单独归一，不只读取第一个块，usage 保留原生对象。

官方依据：[Chat v2](https://docs.cohere.com/v2/reference/chat)。


## 协议身份

- 插件 ID：`cohere-chat-v2`。
- Provider ID：`cohere-chat-v2`。
- 能力：`text`。
- 默认 Base URL：`https://api.cohere.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v2/chat`。
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
| `top_p` | number | 否 | `p` | 核采样参数。 |
| `max_tokens` | integer | 否 | `max_tokens/max_output_tokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关；后台任务当前以最终响应归一。 |


## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v2/chat"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.messages` | `{"$map":{"from":{"$ref":"request.textMessages"},"as":"m","in":{"role":{"$ref":"m.role"},"content":{"$if":{"condition":{"$eq":[{"$len":{"$filter":{"from":{"$ref":"m.parts"},"as":"p","where":{"$not":{"$eq":[{"$ref":"p.type"},"text"]}}}}},0]},"then":{"$ref":"m.text"},"else":{"$map":{"from":{"$ref":"m.parts"},"as":"p","in":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"text"]},"then":{"type":"text","text":{"$ref":"p.text"}},"else":{"type":"image_url","image_url":{"url":{"$ref":"p.value"}}}}}}}}}}}}` |
| `create.body.temperature` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.temperature"}}` |
| `create.body.max_tokens` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.cohere-chat-v2.max_tokens"},{"$ref":"request.extra.max_tokens"}]}}` |
| `create.body.stop_sequences` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.stop_sequences"}}` |
| `create.body.tools` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.tools"}}` |
| `create.body.tool_choice` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.tool_choice"}}` |
| `create.body.response_format` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.response_format"}}` |
| `create.body.documents` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.documents"}}` |
| `create.body.citation_options` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.citation_options"}}` |
| `create.body.safety_mode` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.safety_mode"}}` |
| `create.body.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.seed"}}` |
| `create.body.stream` | `{"$omitEmpty":{"$ref":"request.providerOptions.cohere-chat-v2.stream"}}` |
| `create.body.p` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.cohere-chat-v2.p"},{"$ref":"request.providerOptions.cohere-chat-v2.top_p"}]}}` |


## Provider 扩展键

- `providerOptions.cohere-chat-v2.citation_options`
- `providerOptions.cohere-chat-v2.documents`
- `providerOptions.cohere-chat-v2.max_tokens`
- `providerOptions.cohere-chat-v2.p`
- `providerOptions.cohere-chat-v2.response_format`
- `providerOptions.cohere-chat-v2.safety_mode`
- `providerOptions.cohere-chat-v2.seed`
- `providerOptions.cohere-chat-v2.stop_sequences`
- `providerOptions.cohere-chat-v2.stream`
- `providerOptions.cohere-chat-v2.temperature`
- `providerOptions.cohere-chat-v2.tool_choice`
- `providerOptions.cohere-chat-v2.tools`
- `providerOptions.cohere-chat-v2.top_p`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.type"` |
| `response.messagePaths[0]` | `"message"` |
| `response.text` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.message.content"},"as":"part","where":{"$eq":[{"$ref":"part.type"},"text"]}}},"as":"part","in":{"$ref":"part.text"}}}` |
| `response.reasoning` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.message.content"},"as":"part","where":{"$eq":[{"$ref":"part.type"},"thinking"]}}},"as":"part","in":{"$ref":"part.thinking"}}}` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "cohere-chat-v2",
  "name": "Cohere Chat v2",
  "version": "2.0.1",
  "author": "Cohere / 影策",
  "description": "Cohere Chat v2 独立请求协议插件。",
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
        "id": "cohere-chat-v2",
        "label": "Cohere Chat v2",
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
        "baseUrl": "https://api.cohere.com",
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
            "mapping": "p",
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
          "path": "/v2/chat",
          "contentType": "application/json",
          "body": {
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
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.temperature"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.max_tokens"
                  },
                  {
                    "$ref": "request.extra.max_tokens"
                  }
                ]
              }
            },
            "stop_sequences": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.stop_sequences"
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.response_format"
              }
            },
            "documents": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.documents"
              }
            },
            "citation_options": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.citation_options"
              }
            },
            "safety_mode": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.safety_mode"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.seed"
              }
            },
            "stream": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cohere-chat-v2.stream"
              }
            },
            "p": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.p"
                  },
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.top_p"
                  }
                ]
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.type"
          ],
          "messagePaths": [
            "message"
          ],
          "text": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.message.content"
                  },
                  "as": "part",
                  "where": {
                    "$eq": [
                      {
                        "$ref": "part.type"
                      },
                      "text"
                    ]
                  }
                }
              },
              "as": "part",
              "in": {
                "$ref": "part.text"
              }
            }
          },
          "reasoning": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.message.content"
                  },
                  "as": "part",
                  "where": {
                    "$eq": [
                      {
                        "$ref": "part.type"
                      },
                      "thinking"
                    ]
                  }
                }
              },
              "as": "part",
              "in": {
                "$ref": "part.thinking"
              }
            }
          }
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
                    "$ref": "request.providerOptions.cohere-chat-v2.stream"
                  },
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.cohere-chat-v2.parameters.stream"
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
