# A6api 接口说明

## 鉴权

`Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxxxxxx`

## 文本对话

POST `https://api.a6api.com/chat/completions`

请求体 OpenAI Chat Completions 格式：`model`、`messages`、`temperature`、`max_tokens`、`tools`、`tool_choice`、`response_format`、`stream` 等。

响应 `choices[0].message.content` 为正文，`choices[0].message.reasoning_content` 为推理内容，`usage` 为用量。

## 图像生成

POST `https://api.a6api.com/images/generations`

请求体：`model`、`prompt`、`n`、`size`、`quality`、`response_format`。

响应 `data[].url` 或 `data[].b64_json`。

## 图像编辑

POST `https://api.a6api.com/images/edits`（multipart，带参考图时使用）

## 模型列表

GET `https://api.a6api.com/models`

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "a6api",
  "name": "A6api",
  "version": "1.0.0",
  "author": "A6api",
  "description": "A6api 模型网关协议插件：OpenAI 兼容对话与图像生成。",
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
        "id": "a6api-chat",
        "label": "A6api Chat",
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
        "baseUrl": "https://api.a6api.com",
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
            "description": "A6api 模型市场中的模型 ID。"
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
          "path": "/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.temperature"
              }
            },
            "top_p": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.top_p"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.max_tokens"
                  },
                  {
                    "$ref": "request.providerOptions.a6api-chat.max_tokens"
                  }
                ]
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.response_format"
              }
            },
            "stream": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.stream"
              }
            },
            "stop": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.stop"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.seed"
              }
            },
            "frequency_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.frequency_penalty"
              }
            },
            "presence_penalty": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.presence_penalty"
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-chat.user"
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
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
            "error.message"
          ]
        }
      },
      {
        "id": "a6api-image",
        "label": "A6api Image",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.a6api.com",
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
            "description": "A6api 模型市场中的图像模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
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
          "path": "/images/generations",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "/images/edits",
              "else": "/images/generations"
            }
          },
          "contentType": "application/json",
          "contentTypeTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$ref": "request.images"
                    }
                  },
                  0
                ]
              },
              "then": "multipart/form-data",
              "else": "application/json"
            }
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$ref": "request.imageCount"
                      },
                      0
                    ]
                  },
                  "then": {
                    "$ref": "request.imageCount"
                  },
                  "else": 1
                }
              }
            },
            "size": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "quality": {
              "$omitEmpty": {
                "$ref": "request.quality"
              }
            },
            "output_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.a6api-image.output_format"
                  },
                  "png"
                ]
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.a6api-image.response_format"
                  },
                  "b64_json"
                ]
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.a6api-image.user"
              }
            }
          },
          "files": [
            {
              "name": "image",
              "source": {
                "$filter": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "where": {
                    "$ne": [
                      {
                        "$ref": "media.role"
                      },
                      "mask"
                    ]
                  }
                }
              },
              "filename": "source.png"
            },
            {
              "name": "mask",
              "source": {
                "$filter": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "where": {
                    "$eq": [
                      {
                        "$ref": "media.role"
                      },
                      "mask"
                    ]
                  }
                }
              },
              "filename": "mask.png"
            }
          ]
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "url": {
                  "$omitEmpty": {
                    "$ref": "item.url"
                  }
                },
                "dataUrl": {
                  "$if": {
                    "condition": {
                      "$ref": "item.b64_json"
                    },
                    "then": {
                      "$concat": [
                        "data:image/png;base64,",
                        {
                          "$ref": "item.b64_json"
                        }
                      ]
                    },
                    "else": null
                  }
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
