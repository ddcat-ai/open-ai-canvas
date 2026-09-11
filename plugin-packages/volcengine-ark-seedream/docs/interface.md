# Volcengine Ark Seedream Images 接口字段

## 协议身份

- 插件 ID：`volcengine-ark-seedream`。
- Provider ID：`volcengine-ark-image`。
- 能力：`image`。
- 默认 Base URL：`https://ark.cn-beijing.volces.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v3/images/generations`。
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
| `create.path` | `"/api/v3/images/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.size` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$eq":[{"$ref":"request.aspectRatio"},"auto"]},"then":"2k"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1:1"]},"then":"2048x2048"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"4:3"]},"then":"2304x1728"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"3:4"]},"then":"1728x2304"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"16:9"]},"then":"2560x1440"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"9:16"]},"then":"1440x2560"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"3:2"]},"then":"2496x1664"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"2:3"]},"then":"1664x2496"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"21:9"]},"then":"3024x1296"}],"default":{"$ref":"request.aspectRatio"}}}}` |
| `create.body.image` | `{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$len":{"$ref":"request.images"}},1]},"then":{"$first":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}}},"else":{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},1]},"then":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}},"else":null}}}}}` |
| `create.body.sequential_image_generation` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-image.sequential_image_generation"}}` |
| `create.body.sequential_image_generation_options` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-image.sequential_image_generation_options"}}` |
| `create.body.watermark` | `{"$coalesce":[{"$ref":"request.providerOptions.volcengine-ark-image.watermark"},{"$ref":"request.watermark"},false]}` |
| `create.body.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-image.seed"}}` |
| `create.body.response_format` | `{"$coalesce":[{"$ref":"request.providerOptions.volcengine-ark-image.response_format"},"b64_json"]}` |

## Provider 扩展键

- `providerOptions.volcengine-ark-image.response_format`
- `providerOptions.volcengine-ark-image.seed`
- `providerOptions.volcengine-ark-image.sequential_image_generation`
- `providerOptions.volcengine-ark-image.sequential_image_generation_options`
- `providerOptions.volcengine-ark-image.watermark`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$ref":"response.data"}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该包只代表上述线协议 profile；同一品牌的其他 endpoint、云区域或网关包装必须使用独立插件，不能根据模型名猜测。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-ark-seedream",
  "name": "Volcengine Ark Seedream Images",
  "version": "2.0.0",
  "author": "Volcengine / 影策",
  "description": "Volcengine Ark Seedream Images 独立请求协议插件。",
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
        "id": "volcengine-ark-image",
        "label": "Volcengine Ark Seedream Images",
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
        "baseUrl": "https://ark.cn-beijing.volces.com",
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
          "path": "/api/v3/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$omitEmpty": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "auto"
                        ]
                      },
                      "then": "2k"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "1:1"
                        ]
                      },
                      "then": "2048x2048"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "4:3"
                        ]
                      },
                      "then": "2304x1728"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "3:4"
                        ]
                      },
                      "then": "1728x2304"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "16:9"
                        ]
                      },
                      "then": "2560x1440"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "9:16"
                        ]
                      },
                      "then": "1440x2560"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "3:2"
                        ]
                      },
                      "then": "2496x1664"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "2:3"
                        ]
                      },
                      "then": "1664x2496"
                    },
                    {
                      "when": {
                        "$eq": [
                          {
                            "$ref": "request.aspectRatio"
                          },
                          "21:9"
                        ]
                      },
                      "then": "3024x1296"
                    }
                  ],
                  "default": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "image": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.images"
                            }
                          },
                          1
                        ]
                      },
                      "then": {
                        "$map": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "in": {
                            "$ref": "media.value"
                          }
                        }
                      },
                      "else": null
                    }
                  }
                }
              }
            },
            "sequential_image_generation": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation"
              }
            },
            "sequential_image_generation_options": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.sequential_image_generation_options"
              }
            },
            "watermark": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.watermark"
                },
                {
                  "$ref": "request.watermark"
                },
                false
              ]
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-image.seed"
              }
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-image.response_format"
                },
                "b64_json"
              ]
            }
          }
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$ref": "response.data"
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
