# xAI Grok Images 接口字段

## 协议身份

- 插件 ID：`xai-grok-images`。
- Provider ID：`grok-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.x.ai`。
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
| `create.body.image` | `{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},0]},"then":{"url":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["edit_source","reference_image",""]]}}},"as":"media","in":{"$ref":"media.value"}}}}},"else":null}}` |
| `create.body.n` | `{"$if":{"condition":{"$gt":[{"$ref":"request.imageCount"},0]},"then":{"$ref":"request.imageCount"},"else":1}}` |
| `create.body.response_format` | `{"$coalesce":[{"$ref":"request.providerOptions.grok-image.response_format"},"url"]}` |
| `create.body.aspect_ratio` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},["","auto"]]},"then":null},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},["1:1","3:4","4:3","9:16","16:9","2:3","3:2","9:19.5","19.5:9","1:2","2:1"]]},"then":{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}}},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$eq":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]}]},"then":"1:1"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gte":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.7]},{"$lte":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.8]}]},"then":"16:9"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gte":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.5555555555555556]},{"$lte":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.5882352941176471]}]},"then":"9:16"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.2]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.4]}]},"then":"4:3"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.7]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.85]}]},"then":"3:4"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gte":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.6]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.72]}]},"then":"2:3"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.35]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.6]}]},"then":"3:2"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.45]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},0.55]}]},"then":"1:2"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},1.85]},{"$lt":[{"$divide":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]},2.2]}]},"then":"2:1"},{"when":{"$and":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}}]}]},"then":"16:9"},{"when":{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},"then":"9:16"}],"default":null}}}` |
| `create.body.resolution` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.resolution"},{"$ref":"request.quality"}]}}},["1k","low","standard"]]},"then":"1k"},{"when":{"$in":[{"$lower":{"$trim":{"$coalesce":[{"$ref":"request.resolution"},{"$ref":"request.quality"}]}}},["2k","medium","hd","high","4k"]]},"then":"2k"}],"default":null}}}` |
| `create.body.user` | `{"$omitEmpty":{"$ref":"request.providerOptions.grok-image.user"}}` |

## Provider 扩展键

- `providerOptions.grok-image.response_format`
- `providerOptions.grok-image.user`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$map":{"from":{"$ref":"response.data"},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.url"}},"dataUrl":{"$if":{"condition":{"$ref":"item.b64_json"},"then":{"$concat":["data:image/png;base64,",{"$ref":"item.b64_json"}]},"else":null}}}}}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

有参考图时改走 /v1/images/edits；resolution 只接受 1k/2k；像素尺寸会换算为 aspect_ratio。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "xai-grok-images",
  "name": "xAI Grok Images",
  "version": "2.0.0",
  "author": "xAI / 影策",
  "description": "xAI Grok Images 独立请求协议插件。",
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
        "id": "grok-image",
        "label": "xAI Grok Images",
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
        "baseUrl": "https://api.x.ai",
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
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "image": {
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
                "then": {
                  "url": {
                    "$first": {
                      "$map": {
                        "from": {
                          "$filter": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "edit_source",
                                  "reference_image",
                                  ""
                                ]
                              ]
                            }
                          }
                        },
                        "as": "media",
                        "in": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "n": {
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
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.grok-image.response_format"
                },
                "url"
              ]
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
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
                      "then": null
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$ref": "request.aspectRatio"
                              }
                            }
                          },
                          [
                            "1:1",
                            "3:4",
                            "4:3",
                            "9:16",
                            "16:9",
                            "2:3",
                            "3:2",
                            "9:19.5",
                            "19.5:9",
                            "1:2",
                            "2:1"
                          ]
                        ]
                      },
                      "then": {
                        "$lower": {
                          "$trim": {
                            "$ref": "request.aspectRatio"
                          }
                        }
                      }
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$eq": [
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    0
                                  ]
                                }
                              },
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    1
                                  ]
                                }
                              }
                            ]
                          }
                        ]
                      },
                      "then": "1:1"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gte": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.7
                            ]
                          },
                          {
                            "$lte": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.8
                            ]
                          }
                        ]
                      },
                      "then": "16:9"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gte": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.5555555555555556
                            ]
                          },
                          {
                            "$lte": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.5882352941176471
                            ]
                          }
                        ]
                      },
                      "then": "9:16"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.2
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.4
                            ]
                          }
                        ]
                      },
                      "then": "4:3"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.7
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.85
                            ]
                          }
                        ]
                      },
                      "then": "3:4"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gte": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.6
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.72
                            ]
                          }
                        ]
                      },
                      "then": "2:3"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.35
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.6
                            ]
                          }
                        ]
                      },
                      "then": "3:2"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.45
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              0.55
                            ]
                          }
                        ]
                      },
                      "then": "1:2"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              1.85
                            ]
                          },
                          {
                            "$lt": [
                              {
                                "$divide": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  }
                                ]
                              },
                              2.2
                            ]
                          }
                        ]
                      },
                      "then": "2:1"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$and": [
                              {
                                "$eq": [
                                  {
                                    "$len": {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    }
                                  },
                                  2
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  0
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$toFloat": {
                                      "$at": [
                                        {
                                          "$split": [
                                            {
                                              "$lower": {
                                                "$trim": {
                                                  "$ref": "request.aspectRatio"
                                                }
                                              }
                                            },
                                            "x"
                                          ]
                                        },
                                        1
                                      ]
                                    }
                                  },
                                  0
                                ]
                              }
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    0
                                  ]
                                }
                              },
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    1
                                  ]
                                }
                              }
                            ]
                          }
                        ]
                      },
                      "then": "16:9"
                    },
                    {
                      "when": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$len": {
                                  "$split": [
                                    {
                                      "$lower": {
                                        "$trim": {
                                          "$ref": "request.aspectRatio"
                                        }
                                      }
                                    },
                                    "x"
                                  ]
                                }
                              },
                              2
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    0
                                  ]
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$toFloat": {
                                  "$at": [
                                    {
                                      "$split": [
                                        {
                                          "$lower": {
                                            "$trim": {
                                              "$ref": "request.aspectRatio"
                                            }
                                          }
                                        },
                                        "x"
                                      ]
                                    },
                                    1
                                  ]
                                }
                              },
                              0
                            ]
                          }
                        ]
                      },
                      "then": "9:16"
                    }
                  ],
                  "default": null
                }
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$switch": {
                  "cases": [
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.resolution"
                                  },
                                  {
                                    "$ref": "request.quality"
                                  }
                                ]
                              }
                            }
                          },
                          [
                            "1k",
                            "low",
                            "standard"
                          ]
                        ]
                      },
                      "then": "1k"
                    },
                    {
                      "when": {
                        "$in": [
                          {
                            "$lower": {
                              "$trim": {
                                "$coalesce": [
                                  {
                                    "$ref": "request.resolution"
                                  },
                                  {
                                    "$ref": "request.quality"
                                  }
                                ]
                              }
                            }
                          },
                          [
                            "2k",
                            "medium",
                            "hd",
                            "high",
                            "4k"
                          ]
                        ]
                      },
                      "then": "2k"
                    }
                  ],
                  "default": null
                }
              }
            },
            "user": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.grok-image.user"
              }
            }
          }
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
