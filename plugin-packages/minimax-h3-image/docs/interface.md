# MiniMax H3 Image 接口字段

## 协议身份

- 插件 ID：`minimax-h3-image`。
- Provider ID：`minimax-h3-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.minimax.cn`。
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
| `model` | string | 是 | `model` | MiniMax-H3-Image 或 MiniMax-H3-Image-Highspeed。 |
| `prompt` | string | 是 | `prompt` | 图片提示词，去除首尾空白后不能为空，最长 32000 个字符。 |
| `images` | media[] | 否 | `images[].image_url` | 参考图，1 到 16 张，按 order 顺序下发；有参考图时改走 /v1/images/edits。不支持 mask。 |
| `imageCount` | integer | 否 | `n` | 输出数量，1 到 10，未设置时为 1。 |
| `aspectRatio` | string | 否 | `aspect_ratio / size` | X:Y 比例（1 到 300 的整数，1:3 到 3:1）映射到 aspect_ratio，并固定 size=auto；宽x高像素尺寸映射到 size，不再发送 aspect_ratio 和 area。 |
| `resolution` | string | 否 | `area` | 分辨率档位 1K、2K、4K；未设置时为 2K，避免落到上游默认的 4K。 |
| `providerOptions` | object | 否 | `output_format / output_compression` | 仅开放 providerOptions.minimax-h3-image.output_format（jpeg/png/webp）与 output_compression（0-100）。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/images/generations"` |
| `create.pathTemplate` | `{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},0]},"then":"/v1/images/edits","else":"/v1/images/generations"}}` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.n` | `{"$if":{"condition":{"$gt":[{"$ref":"request.imageCount"},0]},"then":{"$ref":"request.imageCount"},"else":1}}` |
| `create.body.size` | `{"$if":{"condition":{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},"then":{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"else":"auto"}}` |
| `create.body.aspect_ratio` | `{"$if":{"condition":{"$or":[{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},{"$in":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},["","auto"]]}]},"then":null,"else":{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}}}}` |
| `create.body.area` | `{"$if":{"condition":{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},"then":null,"else":{"$if":{"condition":{"$in":[{"$upper":{"$trim":{"$ref":"request.resolution"}}},["1K","2K","4K"]]},"then":{"$upper":{"$trim":{"$ref":"request.resolution"}}},"else":"2K"}}}}` |
| `create.body.images` | `{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},0]},"then":{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"image_url":{"$ref":"media.value"}}}},"else":null}}` |
| `create.body.response_format` | `"url"` |
| `create.body.output_format` | `{"$omitEmpty":{"$lower":{"$trim":{"$ref":"request.providerOptions.minimax-h3-image.output_format"}}}}` |
| `create.body.output_compression` | `{"$if":{"condition":{"$ne":[{"$ref":"request.providerOptions.minimax-h3-image.output_compression"},null]},"then":{"$toInt":{"$ref":"request.providerOptions.minimax-h3-image.output_compression"}},"else":null}}` |

## Provider 扩展键

- `providerOptions.minimax-h3-image.output_compression`
- `providerOptions.minimax-h3-image.output_format`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `{"$if":{"condition":{"$gt":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$ref":"item.url"},{"$ref":"item.b64_json"}]}}}},0]},"then":"succeeded","else":"failed"}}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$first":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$ref":"item.error"}}},"as":"item","in":{"$ref":"item.error.message"}}}},{"$if":{"condition":{"$eq":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$ref":"item.url"},{"$ref":"item.b64_json"}]}}}},0]},"then":"MiniMax H3 Image 没有返回可用图片","else":null}}]}` |
| `response.images` | `{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$ref":"item.url"},{"$ref":"item.b64_json"}]}}},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.url"}},"dataUrl":{"$omitEmpty":{"$ref":"item.b64_json"}},"output_format":{"$omitEmpty":{"$ref":"response.output_format"}}}}}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.resultEphemeral` | `true` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.errorPaths[1]` | `"error.type"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

适配 MiniMax 开放平台 H3 图片接口，模型为 MiniMax-H3-Image 与 MiniMax-H3-Image-Highspeed（参数和限制相同）。默认 Base URL 为国内站 https://api.minimax.cn，国际站可改为 https://api.minimax.io；API Key 需与站点对应。

无参考图走 POST /v1/images/generations，有参考图走 POST /v1/images/edits（JSON，images[].image_url），参考图 1 到 16 张、按 order 保持顺序，支持公网 URL 或 data URI；请求体总大小上限 64 MiB。不支持 mask、透明背景和质量档位：mask 会在校验阶段明确拒绝，quality/background 不会发送。区域改色等局部修改只能通过提示词描述实现。

比例输入发送 size=auto + aspect_ratio + area；「宽x高」像素输入只发送 size（总像素 655360 到 20000000，比例 1:3 到 3:1），不发送 aspect_ratio 与 area。area 未设置时固定发送 2K，避免落到上游默认的 4K。output_format 与 output_compression 只能通过本插件 providerOptions 命名空间设置，默认不发送（上游默认 jpeg、95）。

同步返回，response_format 固定为 url；图片 URL 不保证长期可用，已声明 resultEphemeral，由宿主立即下载持久化。data[] 中只有 error 的失败项会被跳过，至少一张成功即成功；全部失败时上游返回 402/422/500，按 HTTP 错误失败。usage 原样保留供核对，不改写本地计费规则。

风险：上游最长处理 600 秒，而宿主请求超时固定为 5 分钟，4K 多图可能先超时；上游接口不幂等，客户端超时或断开后仍会完成生成并对成功图片扣费，重试会再次扣费。

官方接口：[文生图](https://platform.minimax.io/docs/api-reference/image-generation-h3-generations)、[图片编辑](https://platform.minimax.io/docs/api-reference/image-generation-h3-edits)、[国内站图片生成指南](https://platform.minimax.cn/docs/guides/image-generation)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "minimax-h3-image",
  "name": "MiniMax H3 Image",
  "version": "2.0.0",
  "author": "MiniMax / 影策",
  "description": "MiniMax H3 Image 独立请求协议插件。",
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
        "id": "minimax-h3-image",
        "label": "MiniMax H3 Image",
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
        "baseUrl": "https://api.minimax.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅比例",
            "type": "string",
            "binding": "aspectRatio",
            "encoding": "ratio",
            "values": [
              "1:1",
              "4:3",
              "3:4",
              "16:9",
              "9:16",
              "3:2",
              "2:3",
              "21:9",
              "3:1",
              "1:3"
            ],
            "default": "1:1",
            "pricing": true
          },
          {
            "name": "imageResolution",
            "label": "分辨率",
            "type": "string",
            "binding": "resolution",
            "values": [
              "1K",
              "2K",
              "4K"
            ],
            "default": "2K",
            "pricing": true
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 10,
            "step": 1,
            "default": 1
          },
          {
            "name": "quality",
            "label": "图片质量",
            "type": "string",
            "binding": "quality",
            "enabled": false
          },
          {
            "name": "transparentBackground",
            "label": "透明背景",
            "type": "boolean",
            "binding": "transparentBackground",
            "default": false,
            "enabled": false
          },
          {
            "name": "outputFormat",
            "label": "输出格式",
            "type": "string",
            "binding": "providerOptions.minimax-h3-image.output_format",
            "values": [
              "jpeg",
              "png",
              "webp"
            ],
            "default": "jpeg",
            "enabled": false
          },
          {
            "name": "outputCompression",
            "label": "压缩质量",
            "type": "integer",
            "binding": "providerOptions.minimax-h3-image.output_compression",
            "min": 0,
            "max": 100,
            "step": 1,
            "enabled": false
          }
        ],
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "MiniMax-H3-Image 或 MiniMax-H3-Image-Highspeed。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词，去除首尾空白后不能为空，最长 32000 个字符。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[].image_url",
            "description": "参考图，1 到 16 张，按 order 顺序下发；有参考图时改走 /v1/images/edits。不支持 mask。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "输出数量，1 到 10，未设置时为 1。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio / size",
            "description": "X:Y 比例（1 到 300 的整数，1:3 到 3:1）映射到 aspect_ratio，并固定 size=auto；宽x高像素尺寸映射到 size，不再发送 aspect_ratio 和 area。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "area",
            "description": "分辨率档位 1K、2K、4K；未设置时为 2K，避免落到上游默认的 4K。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "output_format / output_compression",
            "description": "仅开放 providerOptions.minimax-h3-image.output_format（jpeg/png/webp）与 output_compression（0-100）。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "MiniMax-H3-Image",
                  "MiniMax-H3-Image-Highspeed"
                ]
              ]
            },
            "message": "MiniMax H3 Image 仅支持 MiniMax-H3-Image 或 MiniMax-H3-Image-Highspeed"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gt": [
                    {
                      "$len": {
                        "$trim": {
                          "$ref": "request.prompt"
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$trim": {
                          "$ref": "request.prompt"
                        }
                      }
                    },
                    32000
                  ]
                }
              ]
            },
            "message": "MiniMax H3 Image 提示词不能为空且不能超过 32000 个字符"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                16
              ]
            },
            "message": "MiniMax H3 Image 最多支持 16 张参考图"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
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
                  }
                },
                0
              ]
            },
            "message": "MiniMax H3 Image 不支持蒙版（mask）局部编辑，请改用提示词描述需要修改的区域"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.imageCount"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.imageCount"
                    },
                    0
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.imageCount"
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.imageCount"
                        },
                        10
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "MiniMax H3 Image 生成数量必须为 1 到 10"
          },
          {
            "assert": {
              "$or": [
                {
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
                              ":"
                            ]
                          }
                        },
                        2
                      ]
                    },
                    {
                      "$gte": [
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
                                  ":"
                                ]
                              },
                              0
                            ]
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
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
                                  ":"
                                ]
                              },
                              0
                            ]
                          }
                        },
                        300
                      ]
                    },
                    {
                      "$gte": [
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
                                  ":"
                                ]
                              },
                              1
                            ]
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$lte": [
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
                                  ":"
                                ]
                              },
                              1
                            ]
                          }
                        },
                        300
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
                                  ":"
                                ]
                              },
                              0
                            ]
                          }
                        },
                        {
                          "$toInt": {
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
                                    ":"
                                  ]
                                },
                                0
                              ]
                            }
                          }
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
                                  ":"
                                ]
                              },
                              1
                            ]
                          }
                        },
                        {
                          "$toInt": {
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
                                    ":"
                                  ]
                                },
                                1
                              ]
                            }
                          }
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$lte": [
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
                                      ":"
                                    ]
                                  },
                                  0
                                ]
                              }
                            },
                            {
                              "$multiply": [
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
                                          ":"
                                        ]
                                      },
                                      1
                                    ]
                                  }
                                },
                                3
                              ]
                            }
                          ]
                        },
                        {
                          "$lte": [
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
                                      ":"
                                    ]
                                  },
                                  1
                                ]
                              }
                            },
                            {
                              "$multiply": [
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
                                          ":"
                                        ]
                                      },
                                      0
                                    ]
                                  }
                                },
                                3
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
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
                          "$toInt": {
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
                          }
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
                              1
                            ]
                          }
                        },
                        {
                          "$toInt": {
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
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$multiply": [
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
                        655360
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$multiply": [
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
                        20000000
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$lte": [
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
                              "$multiply": [
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
                                3
                              ]
                            }
                          ]
                        },
                        {
                          "$lte": [
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
                            {
                              "$multiply": [
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
                                3
                              ]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "MiniMax H3 Image 比例须在 1:3 到 3:1 之间；像素尺寸须为「宽x高」整数，总像素 655360 到 20000000"
          },
          {
            "assert": {
              "$in": [
                {
                  "$upper": {
                    "$trim": {
                      "$ref": "request.resolution"
                    }
                  }
                },
                [
                  "",
                  "AUTO",
                  "1K",
                  "2K",
                  "4K"
                ]
              ]
            },
            "message": "MiniMax H3 Image 分辨率仅支持 1K、2K、4K"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.providerOptions.minimax-h3-image.output_format"
                        }
                      }
                    },
                    "jpeg"
                  ]
                },
                [
                  "jpeg",
                  "jpg",
                  "png",
                  "webp"
                ]
              ]
            },
            "message": "MiniMax H3 Image 输出格式仅支持 jpeg、png、webp"
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
            "size": {
              "$if": {
                "condition": {
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
                "then": {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  }
                },
                "else": "auto"
              }
            },
            "aspect_ratio": {
              "$if": {
                "condition": {
                  "$or": [
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
                    }
                  ]
                },
                "then": null,
                "else": {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  }
                }
              }
            },
            "area": {
              "$if": {
                "condition": {
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
                "then": null,
                "else": {
                  "$if": {
                    "condition": {
                      "$in": [
                        {
                          "$upper": {
                            "$trim": {
                              "$ref": "request.resolution"
                            }
                          }
                        },
                        [
                          "1K",
                          "2K",
                          "4K"
                        ]
                      ]
                    },
                    "then": {
                      "$upper": {
                        "$trim": {
                          "$ref": "request.resolution"
                        }
                      }
                    },
                    "else": "2K"
                  }
                }
              }
            },
            "images": {
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
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "image_url": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "response_format": "url",
            "output_format": {
              "$omitEmpty": {
                "$lower": {
                  "$trim": {
                    "$ref": "request.providerOptions.minimax-h3-image.output_format"
                  }
                }
              }
            },
            "output_compression": {
              "$if": {
                "condition": {
                  "$ne": [
                    {
                      "$ref": "request.providerOptions.minimax-h3-image.output_compression"
                    },
                    null
                  ]
                },
                "then": {
                  "$toInt": {
                    "$ref": "request.providerOptions.minimax-h3-image.output_compression"
                  }
                },
                "else": null
              }
            },
            "quality": null,
            "background": null
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$filter": {
                        "from": {
                          "$ref": "response.data"
                        },
                        "as": "item",
                        "where": {
                          "$or": [
                            {
                              "$ref": "item.url"
                            },
                            {
                              "$ref": "item.b64_json"
                            }
                          ]
                        }
                      }
                    }
                  },
                  0
                ]
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$first": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "response.data"
                        },
                        "as": "item",
                        "where": {
                          "$ref": "item.error"
                        }
                      }
                    },
                    "as": "item",
                    "in": {
                      "$ref": "item.error.message"
                    }
                  }
                }
              },
              {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "response.data"
                            },
                            "as": "item",
                            "where": {
                              "$or": [
                                {
                                  "$ref": "item.url"
                                },
                                {
                                  "$ref": "item.b64_json"
                                }
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": "MiniMax H3 Image 没有返回可用图片",
                  "else": null
                }
              }
            ]
          },
          "images": {
            "$map": {
              "from": {
                "$filter": {
                  "from": {
                    "$ref": "response.data"
                  },
                  "as": "item",
                  "where": {
                    "$or": [
                      {
                        "$ref": "item.url"
                      },
                      {
                        "$ref": "item.b64_json"
                      }
                    ]
                  }
                }
              },
              "as": "item",
              "in": {
                "url": {
                  "$omitEmpty": {
                    "$ref": "item.url"
                  }
                },
                "dataUrl": {
                  "$omitEmpty": {
                    "$ref": "item.b64_json"
                  }
                },
                "output_format": {
                  "$omitEmpty": {
                    "$ref": "response.output_format"
                  }
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true,
          "errorPaths": [
            "error.code",
            "error.type"
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
