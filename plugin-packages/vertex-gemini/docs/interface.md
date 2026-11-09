# Vertex AI Gemini 接口字段

## 协议身份

- 插件 ID：`vertex-gemini`。
- Provider ID：`vertex-gemini`。
- 能力：`text`。
- 默认 Base URL：`https://{location}-aiplatform.googleapis.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent`。
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

## 原生文本多模态合同（2.0.1）

<!-- 规范化投影到 Gemini 原生 contents/parts。 -->
宿主保持 `request.messages` 原合同，并提供只读 `request.textMessages` 和 `request.textInput` 投影。插件按消息和内容块原顺序构造 `contents[].parts[]`：文本使用 `text`，内联图片/视频/音频使用 `inlineData: { mimeType, data }`（data 为原始 Base64），远程媒体使用 `fileData: { mimeType, fileUri }`。assistant 映射 model，user 保持 user。纯文本、纯媒体、多素材及历史媒体均走同一映射，不把内容数组塞入 text。

system 消息仅允许文本，统一移入一次 `systemInstruction`；显式 instructions 优先，否则保留所有规范化 system 消息的文本顺序。不支持的角色、内容类型、非法 Base64 或 MIME 不匹配在 HTTP 构建前拒绝，不静默降级成纯文本。此创建 profile 不承载工具调用历史。

远程 URI 接受 http/https/gs；Cloud Storage 对象须公开或属于调用项目，HTTP 媒体须公开可读。权限、大小、VPC Service Controls 限制及具体模型媒体能力由 Vertex 校验。项目、区域路径及 Bearer 鉴权不变。generationConfig 优先，原 parameters 作为 generationConfig 的后备；safetySettings、tools、toolConfig、cachedContent 原样透传。body/extra_body 保持原有最后覆盖语义，调用方须提供合法的原生 Gemini 字段。默认请求不再发送 model/messages/input/parameters 这类非 Vertex 字段。响应从 candidates[0].content.parts 的文本块合并，usage 读取 usageMetadata。

官方参考：[Vertex generateContent](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)。

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"contents":{"$map":{"from":{"$filter":{"from":{"$ref":"request.textMessages"},"as":"message","where":{"$ne":[{"$ref":"message.role"},"system"]}}},"as":"message","in":{"role":{"$if":{"condition":{"$eq":[{"$ref":"message.role"},"assistant"]},"then":"model","else":"user"}},"parts":{"$map":{"from":{"$ref":"message.parts"},"as":"part","in":{"$if":{"condition":{"$eq":[{"$ref":"part.type"},"text"]},"then":{"text":{"$ref":"part.text"}},"else":{"$if":{"condition":{"$ref":"part.isInline"},"then":{"inlineData":{"mimeType":{"$ref":"part.mimeType"},"data":{"$ref":"part.data"}}},"else":{"fileData":{"mimeType":{"$ref":"part.mimeType"},"fileUri":{"$ref":"part.value"}}}}}}}}}}}},"systemInstruction":{"$omitEmpty":{"$if":{"condition":{"$ref":"request.instructions"},"then":{"parts":[{"text":{"$ref":"request.instructions"}}]},"else":{"$if":{"condition":{"$gt":[{"$len":{"$filter":{"from":{"$ref":"request.textMessages"},"as":"message","where":{"$eq":[{"$ref":"message.role"},"system"]}}}},0]},"then":{"parts":{"$map":{"from":{"$filter":{"from":{"$ref":"request.textMessages"},"as":"message","where":{"$eq":[{"$ref":"message.role"},"system"]}}},"as":"system","in":{"text":{"$ref":"system.text"}}}}},"else":null}}}}},"generationConfig":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.vertex-gemini.generationConfig"},{"$ref":"request.providerOptions.vertex-gemini.parameters"}]}},"safetySettings":{"$omitEmpty":{"$ref":"request.providerOptions.vertex-gemini.safetySettings"}},"tools":{"$omitEmpty":{"$ref":"request.providerOptions.vertex-gemini.tools"}},"toolConfig":{"$omitEmpty":{"$ref":"request.providerOptions.vertex-gemini.toolConfig"}},"cachedContent":{"$omitEmpty":{"$ref":"request.providerOptions.vertex-gemini.cachedContent"}}},{"$coalesce":[{"$ref":"request.providerOptions.vertex-gemini.body"},{"$ref":"request.providerOptions.vertex-gemini.extra_body"},{}]}]}` |

## Provider 扩展键

- `providerOptions.vertex-gemini.body`
- `providerOptions.vertex-gemini.cachedContent`
- `providerOptions.vertex-gemini.extra_body`
- `providerOptions.vertex-gemini.generationConfig`
- `providerOptions.vertex-gemini.location`
- `providerOptions.vertex-gemini.parameters`
- `providerOptions.vertex-gemini.project`
- `providerOptions.vertex-gemini.safetySettings`
- `providerOptions.vertex-gemini.toolConfig`
- `providerOptions.vertex-gemini.tools`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.text` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.candidates.0.content.parts"},"as":"part","where":{"$ne":[{"$ref":"part.thought"},true]}}},"as":"part","in":{"$omitEmpty":{"$ref":"part.text"}}}}` |
| `response.reasoning` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.candidates.0.content.parts"},"as":"part","where":{"$eq":[{"$ref":"part.thought"},true]}}},"as":"part","in":{"$omitEmpty":{"$ref":"part.text"}}}}` |
| `response.usage` | `{"$ref":"response.usageMetadata"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该包仅代表 Vertex Gemini generateContent 原生协议，不代表 OpenAI 兼容网关。providerOptions.vertex-gemini 的 body/extra_body 为显式厂商对象覆盖入口；parameters 是 generationConfig 的后备。未实现云签名鉴权，不将其他云协议伪装为 Bearer。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "vertex-gemini",
  "name": "Vertex AI Gemini",
  "version": "2.0.1",
  "author": "Google Cloud / 影策",
  "description": "Vertex AI Gemini 独立请求协议插件。",
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
        "id": "vertex-gemini",
        "label": "Vertex AI Gemini",
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
        "baseUrl": "https://{location}-aiplatform.googleapis.com",
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
          "path": "/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "contents": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.textMessages"
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
                      "parts": {
                        "$map": {
                          "from": {
                            "$ref": "message.parts"
                          },
                          "as": "part",
                          "in": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "part.type"
                                  },
                                  "text"
                                ]
                              },
                              "then": {
                                "text": {
                                  "$ref": "part.text"
                                }
                              },
                              "else": {
                                "$if": {
                                  "condition": {
                                    "$ref": "part.isInline"
                                  },
                                  "then": {
                                    "inlineData": {
                                      "mimeType": {
                                        "$ref": "part.mimeType"
                                      },
                                      "data": {
                                        "$ref": "part.data"
                                      }
                                    }
                                  },
                                  "else": {
                                    "fileData": {
                                      "mimeType": {
                                        "$ref": "part.mimeType"
                                      },
                                      "fileUri": {
                                        "$ref": "part.value"
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
                "systemInstruction": {
                  "$omitEmpty": {
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
                      "else": {
                        "$if": {
                          "condition": {
                            "$gt": [
                              {
                                "$len": {
                                  "$filter": {
                                    "from": {
                                      "$ref": "request.textMessages"
                                    },
                                    "as": "message",
                                    "where": {
                                      "$eq": [
                                        {
                                          "$ref": "message.role"
                                        },
                                        "system"
                                      ]
                                    }
                                  }
                                }
                              },
                              0
                            ]
                          },
                          "then": {
                            "parts": {
                              "$map": {
                                "from": {
                                  "$filter": {
                                    "from": {
                                      "$ref": "request.textMessages"
                                    },
                                    "as": "message",
                                    "where": {
                                      "$eq": [
                                        {
                                          "$ref": "message.role"
                                        },
                                        "system"
                                      ]
                                    }
                                  }
                                },
                                "as": "system",
                                "in": {
                                  "text": {
                                    "$ref": "system.text"
                                  }
                                }
                              }
                            }
                          },
                          "else": null
                        }
                      }
                    }
                  }
                },
                "generationConfig": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.vertex-gemini.generationConfig"
                      },
                      {
                        "$ref": "request.providerOptions.vertex-gemini.parameters"
                      }
                    ]
                  }
                },
                "safetySettings": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.vertex-gemini.safetySettings"
                  }
                },
                "tools": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.vertex-gemini.tools"
                  }
                },
                "toolConfig": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.vertex-gemini.toolConfig"
                  }
                },
                "cachedContent": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.vertex-gemini.cachedContent"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.vertex-gemini.body"
                  },
                  {
                    "$ref": "request.providerOptions.vertex-gemini.extra_body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "text": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.candidates.0.content.parts"
                  },
                  "as": "part",
                  "where": {
                    "$ne": [
                      {
                        "$ref": "part.thought"
                      },
                      true
                    ]
                  }
                }
              },
              "as": "part",
              "in": {
                "$omitEmpty": {
                  "$ref": "part.text"
                }
              }
            }
          },
          "reasoning": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.candidates.0.content.parts"
                  },
                  "as": "part",
                  "where": {
                    "$eq": [
                      {
                        "$ref": "part.thought"
                      },
                      true
                    ]
                  }
                }
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
            "message": "Invalid text multimodal input; check media data and MIME type."
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
                      "as": "part",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "part.type"
                            },
                            [
                              "text",
                              "image",
                              "video",
                              "audio"
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
            "message": "Unsupported media type for this native text profile."
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
                      "as": "message",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$ref": "message.role"
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
            "message": "Unsupported message role; use the native Agent path for tool conversations."
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$ref": "request.textMessages"
                          },
                          "as": "message",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "message.role"
                              },
                              "system"
                            ]
                          }
                        }
                      },
                      "as": "system",
                      "where": {
                        "$gt": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$ref": "system.parts"
                                },
                                "as": "part",
                                "where": {
                                  "$ne": [
                                    {
                                      "$ref": "part.type"
                                    },
                                    "text"
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "System instructions accept text only."
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
                      "as": "part",
                      "where": {
                        "$and": [
                          {
                            "$ne": [
                              {
                                "$ref": "part.type"
                              },
                              "text"
                            ]
                          },
                          {
                            "$not": {
                              "$ref": "part.isInline"
                            }
                          },
                          {
                            "$not": {
                              "$in": [
                                {
                                  "$first": {
                                    "$split": [
                                      {
                                        "$ref": "part.value"
                                      },
                                      ":"
                                    ]
                                  }
                                },
                                [
                                  "http",
                                  "https",
                                  "gs"
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
            "message": "Unsupported media URI scheme for this native Gemini profile."
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
                      "as": "part",
                      "where": {
                        "$and": [
                          {
                            "$ne": [
                              {
                                "$ref": "part.type"
                              },
                              "text"
                            ]
                          },
                          {
                            "$not": {
                              "$ref": "part.mimeType"
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
            "message": "Gemini media requires an explicit MIME type; provide media metadata."
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
                      "as": "part",
                      "where": {
                        "$and": [
                          {
                            "$ne": [
                              {
                                "$ref": "part.type"
                              },
                              "text"
                            ]
                          },
                          {
                            "$ne": [
                              {
                                "$first": {
                                  "$split": [
                                    {
                                      "$ref": "part.mimeType"
                                    },
                                    "/"
                                  ]
                                }
                              },
                              {
                                "$ref": "part.type"
                              }
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
            "message": "Media MIME type must match the declared image, video or audio content type."
          }
        ]
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
