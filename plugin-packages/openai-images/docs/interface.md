# OpenAI Images 接口字段

## 协议身份

- 插件 ID：`openai-images`。
- Provider ID：`openai-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.openai.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/images/generations`。
- 生命周期：同步响应。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `provider image/reference fields` | 参考图或编辑源图，role 由业务层确定。 |
| `imageCount` | integer | 否 | `n/sample_count` | 输出数量。 |
| `aspectRatio` | string | 否 | `size/aspect_ratio` | 比例或尺寸，语义按协议说明。 |
| `resolution` | string | 否 | `resolution/imageSize` | 分辨率档位。 |
| `quality` | string | 否 | `quality` | 质量档位。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/images/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.n` | `{"$omitEmpty":{"$if":{"condition":{"$gt":[{"$ref":"request.imageCount"},0]},"then":{"$ref":"request.imageCount"},"else":1}}}` |
| `create.body.size` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},["","auto"]]},"then":null,"else":{"$ref":"request.aspectRatio"}}}}` |
| `create.body.quality` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["1k"]]},"then":"low"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["2k"]]},"then":"medium"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["4k"]]},"then":"high"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["","auto"]]},"then":null}],"default":{"$ref":"request.quality"}}}}` |
| `create.body.background` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.openai-image.background"},{"$if":{"condition":{"$eq":[{"$ref":"request.extra.transparentBackground"},"true"]},"then":"transparent","else":null}}]}}` |
| `create.body.output_format` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.openai-image.output_format"},"png"]}}` |
| `create.body.output_compression` | `{"$omitEmpty":{"$ref":"request.providerOptions.openai-image.output_compression"}}` |
| `create.body.moderation` | `{"$omitEmpty":{"$ref":"request.providerOptions.openai-image.moderation"}}` |
| `create.body.response_format` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.openai-image.response_format"},"b64_json"]}}` |
| `create.body.style` | `{"$omitEmpty":{"$ref":"request.providerOptions.openai-image.style"}}` |
| `create.body.user` | `{"$omitEmpty":{"$ref":"request.providerOptions.openai-image.user"}}` |
| `create.files[0].name` | `"image"` |
| `create.files[0].source` | `{"$filter":{"from":{"$ref":"request.images"},"as":"media","where":{"$ne":[{"$ref":"media.role"},"mask"]}}}` |
| `create.files[0].filename` | `"source.png"` |
| `create.files[1].name` | `"mask"` |
| `create.files[1].source` | `{"$filter":{"from":{"$ref":"request.images"},"as":"media","where":{"$eq":[{"$ref":"media.role"},"mask"]}}}` |
| `create.files[1].filename` | `"mask.png"` |

## Provider 扩展键

- `providerOptions.openai-image.background`
- `providerOptions.openai-image.moderation`
- `providerOptions.openai-image.output_compression`
- `providerOptions.openai-image.output_format`
- `providerOptions.openai-image.response_format`
- `providerOptions.openai-image.style`
- `providerOptions.openai-image.user`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$map":{"from":{"$ref":"response.data"},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.url"}},"dataUrl":{"$if":{"condition":{"$ref":"item.b64_json"},"then":{"$concat":["data:image/png;base64,",{"$ref":"item.b64_json"}]},"else":null}}}}}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

无参考图走 JSON generations；有参考图或蒙版走 multipart edits。quality 的 1k/2k/4k 映射为 OpenAI low/medium/high。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "openai-images",
  "name": "OpenAI Images",
  "version": "2.0.0",
  "author": "OpenAI / 影策",
  "description": "OpenAI Images 独立请求协议插件。",
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
        "id": "openai-image",
        "label": "OpenAI Images",
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
            "description": "图片模型 ID。"
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
          "path": "/v1/images/generations",
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
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
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
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      },
                      [
                        "",
                        "auto"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "quality": {
              "$omitEmpty": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.quality"
                              }
                            }
                          },
                          [
                            "1k"
                          ]
                        ]
                      },
                      "then": "low"
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.quality"
                              }
                            }
                          },
                          [
                            "2k"
                          ]
                        ]
                      },
                      "then": "medium"
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.quality"
                              }
                            }
                          },
                          [
                            "4k"
                          ]
                        ]
                      },
                      "then": "high"
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.quality"
                              }
                            }
                          },
                          [
                            "",
                            "auto"
                          ]
                        ]
                      },
                      "then": null
                    }
                  ],
                  "default": {
                    "$ref": "request.quality"
                  }
                }
              }
            },
            "background": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.openai-image.background"
                  },
                  {
                    "$if": {
                      "condition": {
                        "$eq": [
                          {
                            "$ref": "request.extra.transparentBackground"
                          },
                          "true"
                        ]
                      },
                      "then": "transparent",
                      "else": null
                    }
                  }
                ]
              }
            },
            "output_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.openai-image.output_format"
                  },
                  "png"
                ]
              }
            },
            "output_compression": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.openai-image.output_compression"
              }
            },
            "moderation": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.openai-image.moderation"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.openai-image.response_format"
                  },
                  "b64_json"
                ]
              }
            },
            "style": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.openai-image.style"
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.openai-image.user"
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
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
