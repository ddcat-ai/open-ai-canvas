# AWS Bedrock Converse 接口字段

## FORMA-TEXT-MULTIMODAL：原生同步合同

创建为 POST /model/{{model}}/converse；model 仅在路径中。request.textMessages 的 system 文本转为 system[].text，其余 user/assistant 转为 messages[].content。temperature、top_p、max_tokens 分别进入 inferenceConfig.temperature、topP、maxTokens；max_tokens 可从 request.extra.max_tokens 读取。命名空间 inferenceConfig、toolConfig、additionalModelRequestFields 及 body/extra_body 保留原生配置，最终 messages/system 仍由统一输入生成，不能覆盖后绕过媒体检查。

文本块为 {text}；内联图片、音频、视频分别为 {image|audio|video:{format,source:{bytes}}}。bytes 是剥去 data URL 前缀的 Base64，而不是 URL。全部当前输入和历史内容一起验证；非 user 媒体、无效 Base64、未知类型、未知格式和远端 HTTP(S)/gs URL 明确拒绝。插件不下载远端媒体，也不推测 S3 bucket/key。

AWS ImageBlock 格式为 png/jpeg/gif/webp；AudioBlock 为 mp3/opus/wav/aac/flac/mp4/ogg/mkv/mka/x-aac/m4a/mpeg/mpga/pcm/webm；VideoBlock 为 mkv/mov/mp4/webm/flv/mpeg/mpg/wmv/three_gp。实际可输入集合还须与宿主 MIME→format 投影取交集；例如宿主未映射的 opus/pcm 和 AWS 不支持的 avi 会明确拒绝，不代表 AWS 全面不支持音视频。模型与区域是否支持该模态仍由所选渠道能力和 AWS 判断，不按模型名猜测。

响应拼接 output.message.content 中全部 text，reasoningContent.reasoningText.text 单独归一；usage 原样保留。同步入口拒绝 stream=true。

官方依据：[Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)、[ImageBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html)、[AudioBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_AudioBlock.html)、[AudioSource](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_AudioSource.html)、[VideoBlock](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_VideoBlock.html)。


## 协议身份

- 插件 ID：`aws-bedrock-converse`。
- Provider ID：`aws-bedrock-converse`。
- 能力：`text`。
- 默认 Base URL：`https://bedrock-runtime.{region}.amazonaws.com`。
- 鉴权驱动：`aws-sigv4`。
- 创建：`POST /model/{{model}}/converse`。
- 生命周期：同步响应。


## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | Access Key ID |
| `secretKey` | secret | 是 | Secret Access Key |


## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `path model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `messages` | 包含历史消息和当前用户输入。 |
| `instructions` | string | 否 | `system[].text` | 系统指令。 |
| `temperature` | number | 否 | `inferenceConfig.temperature` | 采样温度。 |
| `top_p` | number | 否 | `inferenceConfig.topP` | 核采样参数。 |
| `max_tokens` | integer | 否 | `inferenceConfig.maxTokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关；后台任务当前以最终响应归一。 |


## 上游请求模板逐字段清单

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/model/{{model}}/converse"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"inferenceConfig":{"$merge":[{"temperature":{"$omitEmpty":{"$ref":"request.providerOptions.aws-bedrock-converse.temperature"}},"topP":{"$omitEmpty":{"$ref":"request.providerOptions.aws-bedrock-converse.top_p"}},"maxTokens":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.aws-bedrock-converse.max_tokens"},{"$ref":"request.extra.max_tokens"}]}}},{"$coalesce":[{"$ref":"request.providerOptions.aws-bedrock-converse.inferenceConfig"},{}]}]},"toolConfig":{"$omitEmpty":{"$ref":"request.providerOptions.aws-bedrock-converse.toolConfig"}},"additionalModelRequestFields":{"$omitEmpty":{"$ref":"request.providerOptions.aws-bedrock-converse.additionalModelRequestFields"}}},{"$coalesce":[{"$ref":"request.providerOptions.aws-bedrock-converse.body"},{"$ref":"request.providerOptions.aws-bedrock-converse.extra_body"},{}]},{"messages":{"$map":{"from":{"$filter":{"from":{"$ref":"request.textMessages"},"as":"m","where":{"$not":{"$eq":[{"$ref":"m.role"},"system"]}}}},"as":"m","in":{"role":{"$ref":"m.role"},"content":{"$map":{"from":{"$ref":"m.parts"},"as":"p","in":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"text"]},"then":{"text":{"$ref":"p.text"}},"else":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"image"]},"then":{"image":{"format":{"$ref":"p.format"},"source":{"bytes":{"$ref":"p.data"}}}},"else":{"$if":{"condition":{"$eq":[{"$ref":"p.type"},"audio"]},"then":{"audio":{"format":{"$ref":"p.format"},"source":{"bytes":{"$ref":"p.data"}}}},"else":{"video":{"format":{"$ref":"p.format"},"source":{"bytes":{"$ref":"p.data"}}}}}}}}}}}}}}},"system":{"$omitEmpty":{"$map":{"from":{"$filter":{"from":{"$ref":"request.textMessages"},"as":"m","where":{"$eq":[{"$ref":"m.role"},"system"]}}},"as":"m","in":{"text":{"$ref":"m.text"}}}}}}]}` |


## Provider 扩展键

- `providerOptions.aws-bedrock-converse.additionalModelRequestFields`
- `providerOptions.aws-bedrock-converse.body`
- `providerOptions.aws-bedrock-converse.extra_body`
- `providerOptions.aws-bedrock-converse.inferenceConfig`
- `providerOptions.aws-bedrock-converse.max_tokens`
- `providerOptions.aws-bedrock-converse.temperature`
- `providerOptions.aws-bedrock-converse.toolConfig`
- `providerOptions.aws-bedrock-converse.top_p`


## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.text` | `{"$map":{"from":{"$ref":"response.output.message.content"},"as":"part","in":{"$ref":"part.text"}}}` |
| `response.reasoning` | `{"$map":{"from":{"$ref":"response.output.message.content"},"as":"part","in":{"$ref":"part.reasoningContent.reasoningText.text"}}}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"__type"` |
| `response.errorPaths[1]` | `"error.code"` |
| `response.messagePaths[0]` | `"message"` |
| `response.messagePaths[1]` | `"error.message"` |

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "aws-bedrock-converse",
  "name": "AWS Bedrock Converse",
  "version": "2.0.1",
  "author": "AWS / 影策",
  "description": "AWS Bedrock Converse 独立请求协议插件。",
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
        "id": "aws-bedrock-converse",
        "label": "AWS Bedrock Converse",
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
            "mapping": "path model",
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
            "mapping": "system[].text",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "inferenceConfig.temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "inferenceConfig.topP",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "inferenceConfig.maxTokens",
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
          "path": "/model/{{model}}/converse",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "inferenceConfig": {
                  "$merge": [
                    {
                      "temperature": {
                        "$omitEmpty": {
                          "$ref": "request.providerOptions.aws-bedrock-converse.temperature"
                        }
                      },
                      "topP": {
                        "$omitEmpty": {
                          "$ref": "request.providerOptions.aws-bedrock-converse.top_p"
                        }
                      },
                      "maxTokens": {
                        "$omitEmpty": {
                          "$coalesce": [
                            {
                              "$ref": "request.providerOptions.aws-bedrock-converse.max_tokens"
                            },
                            {
                              "$ref": "request.extra.max_tokens"
                            }
                          ]
                        }
                      }
                    },
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.aws-bedrock-converse.inferenceConfig"
                        },
                        {}
                      ]
                    }
                  ]
                },
                "toolConfig": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.aws-bedrock-converse.toolConfig"
                  }
                },
                "additionalModelRequestFields": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.aws-bedrock-converse.additionalModelRequestFields"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.body"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.extra_body"
                  },
                  {}
                ]
              },
              {
                "messages": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.textMessages"
                        },
                        "as": "m",
                        "where": {
                          "$not": {
                            "$eq": [
                              {
                                "$ref": "m.role"
                              },
                              "system"
                            ]
                          }
                        }
                      }
                    },
                    "as": "m",
                    "in": {
                      "role": {
                        "$ref": "m.role"
                      },
                      "content": {
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
                                      "format": {
                                        "$ref": "p.format"
                                      },
                                      "source": {
                                        "bytes": {
                                          "$ref": "p.data"
                                        }
                                      }
                                    }
                                  },
                                  "else": {
                                    "$if": {
                                      "condition": {
                                        "$eq": [
                                          {
                                            "$ref": "p.type"
                                          },
                                          "audio"
                                        ]
                                      },
                                      "then": {
                                        "audio": {
                                          "format": {
                                            "$ref": "p.format"
                                          },
                                          "source": {
                                            "bytes": {
                                              "$ref": "p.data"
                                            }
                                          }
                                        }
                                      },
                                      "else": {
                                        "video": {
                                          "format": {
                                            "$ref": "p.format"
                                          },
                                          "source": {
                                            "bytes": {
                                              "$ref": "p.data"
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
                    }
                  }
                },
                "system": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$filter": {
                          "from": {
                            "$ref": "request.textMessages"
                          },
                          "as": "m",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "m.role"
                              },
                              "system"
                            ]
                          }
                        }
                      },
                      "as": "m",
                      "in": {
                        "text": {
                          "$ref": "m.text"
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "text": {
            "$map": {
              "from": {
                "$ref": "response.output.message.content"
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
                "$ref": "response.output.message.content"
              },
              "as": "part",
              "in": {
                "$ref": "part.reasoningContent.reasoningText.text"
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "__type",
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
                              "audio",
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
                          }
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Converse 媒体必须是内联 Base64；不能把 HTTP URL 当作 source.bytes"
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
                            "$eq": [
                              {
                                "$ref": "p.type"
                              },
                              "image"
                            ]
                          },
                          {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "p.format"
                                },
                                [
                                  "png",
                                  "jpeg",
                                  "gif",
                                  "webp"
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
            "message": "Converse 不支持该image格式"
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
                            "$eq": [
                              {
                                "$ref": "p.type"
                              },
                              "audio"
                            ]
                          },
                          {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "p.format"
                                },
                                [
                                  "mp3",
                                  "opus",
                                  "wav",
                                  "aac",
                                  "flac",
                                  "mp4",
                                  "ogg",
                                  "mkv",
                                  "mka",
                                  "x-aac",
                                  "m4a",
                                  "mpeg",
                                  "mpga",
                                  "pcm",
                                  "webm"
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
            "message": "Converse 不支持该audio格式"
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
                            "$eq": [
                              {
                                "$ref": "p.type"
                              },
                              "video"
                            ]
                          },
                          {
                            "$not": {
                              "$in": [
                                {
                                  "$ref": "p.format"
                                },
                                [
                                  "mkv",
                                  "mov",
                                  "mp4",
                                  "webm",
                                  "flv",
                                  "mpeg",
                                  "mpg",
                                  "wmv",
                                  "three_gp"
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
            "message": "Converse 不支持该video格式"
          },
          {
            "assert": {
              "$not": {
                "$or": [
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.extra_body.stream"
                  },
                  {
                    "$ref": "request.providerOptions.aws-bedrock-converse.parameters.stream"
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
