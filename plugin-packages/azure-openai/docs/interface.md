# Azure OpenAI 接口字段

## FORMA-TEXT-MULTIMODAL：部署型同步合同

POST /openai/deployments/{{model}}/chat/completions，model 是 deployment ID。保留 api-key 鉴权及 api-version 查询（默认 2024-10-21），不迁移到新版 /openai/v1。正文为标准 model/messages 与采样/工具选项，不发送无效 input 或 parameters 包装。命名空间 parameters/body/extra_body 的原生选项合并到正文；最终 messages 使用 request.textMessages，纯文本为字符串，user 图片为 image_url.url（HTTP(S) 或内联 data URL）。

本 profile 明确只实现该部署型端点的文本与图片输入：system/assistant 媒体、音频、视频、gs URL、未知或无效内容（包括历史）会拒绝。此边界不代表 Azure 的实时/音频专用或其他版本接口没有音视频能力；不能仅凭同品牌或 OpenAI 兼容性把它们映射到当前端点。图片能力仍由实际 deployment 和版本验证，不修改模型声明。同步入口拒绝 stream=true；响应读取 choices[0].message.content、reasoning_content、usage 与 error。

官方依据：[Azure REST reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference)、[Vision-enabled models](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/gpt-with-vision)。未做真实部署调用。


## 协议身份

- 插件 ID：`azure-openai`。
- Provider ID：`azure-openai`。
- 能力：`text`。
- 默认 Base URL：`https://{resource}.openai.azure.com`。
- 鉴权驱动：`header`。
- 创建：`POST /openai/deployments/{{model}}/chat/completions`。
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
| `create.path` | `"/openai/deployments/{{model}}/chat/completions"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"temperature":{"$omitEmpty":{"$ref":"request.providerOptions.azure-openai.temperature"}},"top_p":{"$omitEmpty":{"$ref":"request.providerOptions.azure-openai.top_p"}},"max_tokens":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.azure-openai.max_tokens"},{"$ref":"request.extra.max_tokens"}]}},"tools":{"$omitEmpty":{"$ref":"request.providerOptions.azure-openai.tools"}},"tool_choice":{"$omitEmpty":{"$ref":"request.providerOptions.azure-openai.tool_choice"}},"response_format":{"$omitEmpty":{"$ref":"request.providerOptions.azure-openai.response_format"}}},{"$coalesce":[{"$ref":"request.providerOptions.azure-openai.parameters"},{}]},{"$coalesce":[{"$ref":"request.providerOptions.azure-openai.body"},{"$ref":"request.providerOptions.azure-openai.extra_body"},{}]},{"model":{"$ref":"request.model"},"messages":{"$map":{"from":{"$ref":"request.textMessages"},"as":"m","in":{"role":{"$ref":"m.role"},"content":{"$if":{"condition":{"$eq":[{"$len":{"$filter":{"from":{"$ref":"m.parts"},"as":"p","where":{"$not":{"$eq":[{"$ref":"p.type"},"text"]}}}}},0]},"then":{"$ref":"m.text"},"else":{"$map":{"from":{"$ref":"m.parts"},"as":"p","in":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"text"]},"then":{"type":"text","text":{"$ref":"p.text"}},"else":{"type":"image_url","image_url":{"url":{"$ref":"p.value"},"detail":{"$omitEmpty":{"$ref":"p.raw.image_url.detail"}}}}}}}}}}}}},"stream":false}]}` |
| `create.query.api-version` | `{"$coalesce":[{"$ref":"request.providerOptions.azure-openai.api-version"},"2024-10-21"]}` |


## Provider 扩展键

- `providerOptions.azure-openai.api-version`
- `providerOptions.azure-openai.body`
- `providerOptions.azure-openai.extra_body`
- `providerOptions.azure-openai.max_tokens`
- `providerOptions.azure-openai.parameters`
- `providerOptions.azure-openai.response_format`
- `providerOptions.azure-openai.temperature`
- `providerOptions.azure-openai.tool_choice`
- `providerOptions.azure-openai.tools`
- `providerOptions.azure-openai.top_p`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.textPaths[0]` | `"choices.0.message.content"` |
| `response.reasoningPaths[0]` | `"choices.0.message.reasoning_content"` |
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
  "id": "azure-openai",
  "name": "Azure OpenAI",
  "version": "2.0.1",
  "author": "Microsoft Azure / 影策",
  "description": "Azure OpenAI 独立请求协议插件。",
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
        "id": "azure-openai",
        "label": "Azure OpenAI",
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
        "baseUrl": "https://{resource}.openai.azure.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "api-key"
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
          "path": "/openai/deployments/{{model}}/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "temperature": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.azure-openai.temperature"
                  }
                },
                "top_p": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.azure-openai.top_p"
                  }
                },
                "max_tokens": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.azure-openai.max_tokens"
                      },
                      {
                        "$ref": "request.extra.max_tokens"
                      }
                    ]
                  }
                },
                "tools": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.azure-openai.tools"
                  }
                },
                "tool_choice": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.azure-openai.tool_choice"
                  }
                },
                "response_format": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.azure-openai.response_format"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.azure-openai.parameters"
                  },
                  {}
                ]
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.azure-openai.body"
                  },
                  {
                    "$ref": "request.providerOptions.azure-openai.extra_body"
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
                                      },
                                      "detail": {
                                        "$omitEmpty": {
                                          "$ref": "p.raw.image_url.detail"
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
                  }
                },
                "stream": false
              }
            ]
          },
          "query": {
            "api-version": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.azure-openai.api-version"
                },
                "2024-10-21"
              ]
            }
          }
        },
        "response": {
          "status": "succeeded",
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
                    "$ref": "request.providerOptions.azure-openai.stream"
                  },
                  {
                    "$ref": "request.providerOptions.azure-openai.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.azure-openai.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.azure-openai.parameters.stream"
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
