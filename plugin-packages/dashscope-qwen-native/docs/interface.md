# DashScope Qwen Native 接口字段

## FORMA-TEXT-MULTIMODAL：原生同步合同

纯文本为 POST /api/v1/services/aigc/text-generation/generation，正文为 {model,input:{messages},parameters}，不是顶层 messages 或字符串 input。request.textMessages 含历史和当前输入；纯文本 content 为字符串。任何历史或当前 image/video 都切到 /api/v1/services/aigc/multimodal-generation/generation，所有消息 content 转为原生块数组 {text}、{image:URL或dataURL}、{video:URL或dataURL}。不发送 X-DashScope-Async，也不打开 SSE；stream=true 明确拒绝。

temperature、top_p、max_tokens 和原生 parameters 合并；parameters.result_format 默认 message，可由原生 parameters 配置。命名空间 input 的其他字段及 body/extra_body 的其他顶层扩展保留；最终 input.messages 由统一投影产生，不能覆盖绕过检查。视频使用服务默认 fps，不猜测帧率。模型/地域的能力由渠道及上游校验，不推测模型名称。

图片与视频支持 HTTP(S) 和内联 data URL；gs URL、非 user 媒体、音频、未知类型与无效内容（包括历史）明确拒绝。音频另有 Qwen Omni 等模型合同，本 profile 尚未实现，不等于 DashScope 无音频能力。

响应支持 output.choices[0].message.content 的文本字符串或全部 {text} 块，以及文本模式 output.text；reasoning_content 和 usage 保留。

官方依据：[DashScope 文本](https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope)、[视觉理解](https://help.aliyun.com/zh/model-studio/vision)。Base URL 保持渠道配置，工作区/地域新域名由管理员配置，不改账号配置或鉴权。


## 协议身份

- 插件 ID：`dashscope-qwen-native`。
- Provider ID：`dashscope-qwen-native`。
- 能力：`text`。
- 默认 Base URL：`https://dashscope.aliyuncs.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v1/services/aigc/text-generation/generation`。
- 生命周期：同步响应。


## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |


## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `input.messages` | 包含历史消息和当前用户输入。 |
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
| `create.path` | `"/api/v1/services/aigc/text-generation/generation"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.body"},{"$ref":"request.providerOptions.dashscope-qwen-native.extra_body"},{}]},{"model":{"$ref":"request.model"},"input":{"$merge":[{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.body.input"},{"$ref":"request.providerOptions.dashscope-qwen-native.extra_body.input"},{}]},{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.input"},{}]},{"messages":{"$map":{"from":{"$ref":"request.textMessages"},"as":"m","in":{"role":{"$ref":"m.role"},"content":{"$if":{"condition":{"$or":[{"$in":["image",{"$ref":"request.textInput.types"}]},{"$in":["video",{"$ref":"request.textInput.types"}]}]},"then":{"$map":{"from":{"$ref":"m.parts"},"as":"p","in":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"text"]},"then":{"text":{"$ref":"p.text"}},"else":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"image"]},"then":{"image":{"$ref":"p.value"}},"else":{"video":{"$ref":"p.value"}}}}}}}},"else":{"$ref":"m.text"}}}}}}}]},"parameters":{"$merge":[{"temperature":{"$omitEmpty":{"$ref":"request.providerOptions.dashscope-qwen-native.temperature"}},"top_p":{"$omitEmpty":{"$ref":"request.providerOptions.dashscope-qwen-native.top_p"}},"max_tokens":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.max_tokens"},{"$ref":"request.extra.max_tokens"}]}},"result_format":"message"},{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.body.parameters"},{"$ref":"request.providerOptions.dashscope-qwen-native.extra_body.parameters"},{}]},{"$coalesce":[{"$ref":"request.providerOptions.dashscope-qwen-native.parameters"},{}]}]}}]}` |
| `create.pathTemplate` | `{"$if":{"condition":{"$or":[{"$in":["image",{"$ref":"request.textInput.types"}]},{"$in":["video",{"$ref":"request.textInput.types"}]}]},"then":"/api/v1/services/aigc/multimodal-generation/generation","else":"/api/v1/services/aigc/text-generation/generation"}}` |


## Provider 扩展键

- `providerOptions.dashscope-qwen-native.body`
- `providerOptions.dashscope-qwen-native.body.input`
- `providerOptions.dashscope-qwen-native.body.parameters`
- `providerOptions.dashscope-qwen-native.extra_body`
- `providerOptions.dashscope-qwen-native.extra_body.input`
- `providerOptions.dashscope-qwen-native.extra_body.parameters`
- `providerOptions.dashscope-qwen-native.input`
- `providerOptions.dashscope-qwen-native.max_tokens`
- `providerOptions.dashscope-qwen-native.parameters`
- `providerOptions.dashscope-qwen-native.temperature`
- `providerOptions.dashscope-qwen-native.top_p`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.text` | `{"$map":{"from":{"$ref":"response.output.choices.0.message.content"},"as":"part","in":{"$coalesce":[{"$ref":"part.text"},{"$ref":"part"}]}}}` |
| `response.textPaths[0]` | `"output.text"` |
| `response.reasoningPaths[0]` | `"output.choices.0.message.reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"code"` |
| `response.errorPaths[1]` | `"error.code"` |
| `response.messagePaths[0]` | `"message"` |
| `response.messagePaths[1]` | `"error.message"` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "dashscope-qwen-native",
  "name": "DashScope Qwen Native",
  "version": "2.0.1",
  "author": "Alibaba Cloud / 影策",
  "description": "DashScope Qwen Native 独立请求协议插件。",
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
        "id": "dashscope-qwen-native",
        "label": "DashScope Qwen Native",
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
        "baseUrl": "https://dashscope.aliyuncs.com",
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
            "mapping": "input.messages",
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
          "path": "/api/v1/services/aigc/text-generation/generation",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.dashscope-qwen-native.body"
                  },
                  {
                    "$ref": "request.providerOptions.dashscope-qwen-native.extra_body"
                  },
                  {}
                ]
              },
              {
                "model": {
                  "$ref": "request.model"
                },
                "input": {
                  "$merge": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.body.input"
                        },
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.extra_body.input"
                        },
                        {}
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.input"
                        },
                        {}
                      ]
                    },
                    {
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
                                  "$or": [
                                    {
                                      "$in": [
                                        "image",
                                        {
                                          "$ref": "request.textInput.types"
                                        }
                                      ]
                                    },
                                    {
                                      "$in": [
                                        "video",
                                        {
                                          "$ref": "request.textInput.types"
                                        }
                                      ]
                                    }
                                  ]
                                },
                                "then": {
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
                                          "text": {
                                            "$ref": "p.text"
                                          }
                                        },
                                        "else": {
                                          "$if": {
                                            "condition": {
                                              "$eq": [
                                                {
                                                  "$ref": "p.type"
                                                },
                                                "image"
                                              ]
                                            },
                                            "then": {
                                              "image": {
                                                "$ref": "p.value"
                                              }
                                            },
                                            "else": {
                                              "video": {
                                                "$ref": "p.value"
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                },
                                "else": {
                                  "$ref": "m.text"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                },
                "parameters": {
                  "$merge": [
                    {
                      "temperature": {
                        "$omitEmpty": {
                          "$ref": "request.providerOptions.dashscope-qwen-native.temperature"
                        }
                      },
                      "top_p": {
                        "$omitEmpty": {
                          "$ref": "request.providerOptions.dashscope-qwen-native.top_p"
                        }
                      },
                      "max_tokens": {
                        "$omitEmpty": {
                          "$coalesce": [
                            {
                              "$ref": "request.providerOptions.dashscope-qwen-native.max_tokens"
                            },
                            {
                              "$ref": "request.extra.max_tokens"
                            }
                          ]
                        }
                      },
                      "result_format": "message"
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.body.parameters"
                        },
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.extra_body.parameters"
                        },
                        {}
                      ]
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.dashscope-qwen-native.parameters"
                        },
                        {}
                      ]
                    }
                  ]
                }
              }
            ]
          },
          "pathTemplate": {
            "$if": {
              "condition": {
                "$or": [
                  {
                    "$in": [
                      "image",
                      {
                        "$ref": "request.textInput.types"
                      }
                    ]
                  },
                  {
                    "$in": [
                      "video",
                      {
                        "$ref": "request.textInput.types"
                      }
                    ]
                  }
                ]
              },
              "then": "/api/v1/services/aigc/multimodal-generation/generation",
              "else": "/api/v1/services/aigc/text-generation/generation"
            }
          }
        },
        "response": {
          "status": "succeeded",
          "text": {
            "$map": {
              "from": {
                "$ref": "response.output.choices.0.message.content"
              },
              "as": "part",
              "in": {
                "$coalesce": [
                  {
                    "$ref": "part.text"
                  },
                  {
                    "$ref": "part"
                  }
                ]
              }
            }
          },
          "textPaths": [
            "output.text"
          ],
          "reasoningPaths": [
            "output.choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "code",
            "error.code"
          ],
          "messagePaths": [
            "message",
            "error.message"
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
                              "image",
                              "video"
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
                    "$ref": "request.providerOptions.dashscope-qwen-native.stream"
                  },
                  {
                    "$ref": "request.providerOptions.dashscope-qwen-native.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.dashscope-qwen-native.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.dashscope-qwen-native.parameters.stream"
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
