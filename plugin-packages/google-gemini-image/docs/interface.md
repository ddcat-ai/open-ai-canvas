# Google Gemini Image 接口字段

## 协议身份

- 插件 ID：`google-gemini-image`。
- Provider ID：`gemini-image`。
- 能力：`image`。
- 默认 Base URL：`https://generativelanguage.googleapis.com`。
- 鉴权驱动：`google-api-key`。
- 创建：`POST /v1beta/models/{{model}}:generateContent`。
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
| `create.path` | `"/v1beta/models/{{model}}:generateContent"` |
| `create.contentType` | `"application/json"` |
| `create.body.contents[0].role` | `"user"` |
| `create.body.contents[0].parts` | `{"$concatArrays":[[{"text":{"$ref":"request.prompt"}}],{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$if":{"condition":{"$ref":"media.dataUrl"},"then":{"inlineData":{"mimeType":{"$dataMime":{"$ref":"media.dataUrl"}},"data":{"$dataPayload":{"$ref":"media.dataUrl"}}}},"else":{"fileData":{"mimeType":{"$omitEmpty":{"$ref":"media.mimeType"}},"fileUri":{"$ref":"media.url"}}}}}}}]}` |
| `create.body.generationConfig.responseModalities` | `{"$coalesce":[{"$ref":"request.providerOptions.gemini-image.responseModalities"},["TEXT","IMAGE"]]}` |
| `create.body.generationConfig.imageConfig.aspectRatio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.generationConfig.imageConfig.imageSize` | `{"$omitEmpty":{"$coalesce":[{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$ref":"request.quality"}},["1k","low"]]},"then":"1K"},{"when":{"$in":[{"$lower":{"$ref":"request.quality"}},["2k","medium"]]},"then":"2K"},{"when":{"$in":[{"$lower":{"$ref":"request.quality"}},["4k","high"]]},"then":"4K"}],"default":null}},{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$ref":"request.resolution"}},["1k","low"]]},"then":"1K"},{"when":{"$in":[{"$lower":{"$ref":"request.resolution"}},["2k","medium"]]},"then":"2K"},{"when":{"$in":[{"$lower":{"$ref":"request.resolution"}},["4k","high"]]},"then":"4K"}],"default":null}}]}}` |
| `create.body.generationConfig.temperature` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-image.temperature"}}` |
| `create.body.generationConfig.topP` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-image.topP"}}` |
| `create.body.generationConfig.topK` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-image.topK"}}` |
| `create.body.generationConfig.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-image.seed"}}` |
| `create.body.safetySettings` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-image.safetySettings"}}` |
| `create.body.systemInstruction` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.gemini-image.systemInstruction"},{"$if":{"condition":{"$ref":"request.instructions"},"then":{"parts":[{"text":{"$ref":"request.instructions"}}]},"else":null}}]}}` |

## Provider 扩展键

- `providerOptions.gemini-image.responseModalities`
- `providerOptions.gemini-image.safetySettings`
- `providerOptions.gemini-image.seed`
- `providerOptions.gemini-image.systemInstruction`
- `providerOptions.gemini-image.temperature`
- `providerOptions.gemini-image.topK`
- `providerOptions.gemini-image.topP`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.candidates.0.content.parts"},"as":"part","where":{"$or":[{"$ref":"part.inlineData"},{"$ref":"part.inline_data"}]}}},"as":"part","in":{"dataUrl":{"$concat":["data:",{"$coalesce":[{"$ref":"part.inlineData.mimeType"},{"$ref":"part.inline_data.mime_type"},"image/png"]},";base64,",{"$coalesce":[{"$ref":"part.inlineData.data"},{"$ref":"part.inline_data.data"}]}]}}}}` |
| `response.text` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.candidates.0.content.parts"},"as":"part","where":{"$ref":"part.text"}}},"as":"part","in":{"$ref":"part.text"}}}` |
| `response.usage` | `{"$ref":"response.usageMetadata"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

imageSize 只映射 1K/2K/4K；未知质量值（如视频清晰度 720）必须省略。多图输出由宿主按次创建，不映射 candidateCount。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "google-gemini-image",
  "name": "Google Gemini Image",
  "version": "2.0.0",
  "author": "Google / 影策",
  "description": "Google Gemini Image 独立请求协议插件。",
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
        "id": "gemini-image",
        "label": "Google Gemini Image",
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
          "path": "/v1beta/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "contents": [
              {
                "role": "user",
                "parts": {
                  "$concatArrays": [
                    [
                      {
                        "text": {
                          "$ref": "request.prompt"
                        }
                      }
                    ],
                    {
                      "$map": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "in": {
                          "$if": {
                            "condition": {
                              "$ref": "media.dataUrl"
                            },
                            "then": {
                              "inlineData": {
                                "mimeType": {
                                  "$dataMime": {
                                    "$ref": "media.dataUrl"
                                  }
                                },
                                "data": {
                                  "$dataPayload": {
                                    "$ref": "media.dataUrl"
                                  }
                                }
                              }
                            },
                            "else": {
                              "fileData": {
                                "mimeType": {
                                  "$omitEmpty": {
                                    "$ref": "media.mimeType"
                                  }
                                },
                                "fileUri": {
                                  "$ref": "media.url"
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  ]
                }
              }
            ],
            "generationConfig": {
              "responseModalities": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.gemini-image.responseModalities"
                  },
                  [
                    "TEXT",
                    "IMAGE"
                  ]
                ]
              },
              "imageConfig": {
                "aspectRatio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "imageSize": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$switch": {
                          "cases": [
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.quality"
                                    }
                                  },
                                  [
                                    "1k",
                                    "low"
                                  ]
                                ]
                              },
                              "then": "1K"
                            },
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.quality"
                                    }
                                  },
                                  [
                                    "2k",
                                    "medium"
                                  ]
                                ]
                              },
                              "then": "2K"
                            },
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.quality"
                                    }
                                  },
                                  [
                                    "4k",
                                    "high"
                                  ]
                                ]
                              },
                              "then": "4K"
                            }
                          ],
                          "default": null
                        }
                      },
                      {
                        "$switch": {
                          "cases": [
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.resolution"
                                    }
                                  },
                                  [
                                    "1k",
                                    "low"
                                  ]
                                ]
                              },
                              "then": "1K"
                            },
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.resolution"
                                    }
                                  },
                                  [
                                    "2k",
                                    "medium"
                                  ]
                                ]
                              },
                              "then": "2K"
                            },
                            {
                              "when": {
                                "$in": [
                                  {
                                    "$lower": {
                                      "$ref": "request.resolution"
                                    }
                                  },
                                  [
                                    "4k",
                                    "high"
                                  ]
                                ]
                              },
                              "then": "4K"
                            }
                          ],
                          "default": null
                        }
                      }
                    ]
                  }
                }
              },
              "temperature": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-image.temperature"
                }
              },
              "topP": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-image.topP"
                }
              },
              "topK": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-image.topK"
                }
              },
              "seed": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-image.seed"
                }
              }
            },
            "safetySettings": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gemini-image.safetySettings"
              }
            },
            "systemInstruction": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.gemini-image.systemInstruction"
                  },
                  {
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
                  }
                ]
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.candidates.0.content.parts"
                  },
                  "as": "part",
                  "where": {
                    "$or": [
                      {
                        "$ref": "part.inlineData"
                      },
                      {
                        "$ref": "part.inline_data"
                      }
                    ]
                  }
                }
              },
              "as": "part",
              "in": {
                "dataUrl": {
                  "$concat": [
                    "data:",
                    {
                      "$coalesce": [
                        {
                          "$ref": "part.inlineData.mimeType"
                        },
                        {
                          "$ref": "part.inline_data.mime_type"
                        },
                        "image/png"
                      ]
                    },
                    ";base64,",
                    {
                      "$coalesce": [
                        {
                          "$ref": "part.inlineData.data"
                        },
                        {
                          "$ref": "part.inline_data.data"
                        }
                      ]
                    }
                  ]
                }
              }
            }
          },
          "text": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.candidates.0.content.parts"
                  },
                  "as": "part",
                  "where": {
                    "$ref": "part.text"
                  }
                }
              },
              "as": "part",
              "in": {
                "$ref": "part.text"
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
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
