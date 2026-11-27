# SenseNova U1.6 Lite Image 接口字段

## 协议身份

- 插件 ID：`sensenova-image`。
- Provider ID：`sensenova-image`。
- 能力：`image`。
- 默认 Base URL：`https://token.sensenova.cn`。
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
| `model` | string | 是 | `model` | 仅支持 sensenova-u1.6-lite。 |
| `prompt` | string | 是 | `prompt` | 非空图片提示词；编辑时描述期望最终画面，官方未说明最大长度。 |
| `images` | media[] | 否 | `images[].image_url` | 无参考图走 generations，有参考图走 edits；编辑总计 1–5 张，按 order 保持顺序，首张是主编辑图，支持公网 HTTP/HTTPS URL 或完整图片 Data URL，不支持 mask。 |
| `imageCount` | integer | 否 | `n` | 仅支持 1，未设置时同样发送 1。 |
| `aspectRatio` | string | 否 | `size` | auto 或宽x高：各边 512–4096 且为 32 倍数，比例 1:3–3:1；界面提供官方六个推荐尺寸，不把比例、2K、4K 字面量发送上游。 |
| `providerOptions` | object | 否 | `output_format / watermark / prompt_extend / self_correction` | 仅允许 sensenova-image 命名空间内四个文档化扩展字段；输出 png/jpeg/webp。watermark 缺失时发送 false；参数启用时按默认值或本次选择发送。prompt_extend/self_correction 默认 true；显式 false 保留。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/images/generations"` |
| `create.contentType` | `"application/json"` |
| `create.pathTemplate` | `{"$if":{"condition":{"$gt":[{"$len":{"$sortByOrder":{"$ref":"request.images"}}},0]},"then":"/v1/images/edits","else":"/v1/images/generations"}}` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$trim":{"$ref":"request.prompt"}}` |
| `create.body.size` | `{"$ref":"bindings.size"}` |
| `create.body.n` | `1` |
| `create.body.images` | `{"$if":{"condition":{"$gt":[{"$len":{"$sortByOrder":{"$ref":"request.images"}}},0]},"then":{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"image_url":{"$trim":{"$ref":"media.value"}}}}},"else":null}}` |
| `create.body.response_format` | `"url"` |
| `create.body.output_format` | `{"$coalesce":[{"$lower":{"$trim":{"$ref":"request.providerOptions.sensenova-image.output_format"}}},"png"]}` |
| `create.body.watermark` | `{"$coalesce":[{"$ref":"request.providerOptions.sensenova-image.watermark"},false]}` |
| `create.body.prompt_extend` | `{"$coalesce":[{"$ref":"request.providerOptions.sensenova-image.prompt_extend"},true]}` |
| `create.body.self_correction` | `{"$coalesce":[{"$ref":"request.providerOptions.sensenova-image.self_correction"},true]}` |

## Provider 扩展键

- `providerOptions.sensenova-image.output_format`
- `providerOptions.sensenova-image.prompt_extend`
- `providerOptions.sensenova-image.self_correction`
- `providerOptions.sensenova-image.watermark`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `{"$if":{"condition":{"$and":[{"$not":{"$ne":[{"$ref":"response.error"},null]}},{"$eq":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$gt":[{"$len":{"$trim":{"$ref":"item.url"}}},0]},{"$gt":[{"$len":{"$trim":{"$ref":"item.b64_json"}}},0]}]}}}},1]}]},"then":"succeeded","else":"failed"}}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$if":{"condition":{"$ne":[{"$ref":"response.error"},null]},"then":"SenseNova U1.6 Lite 返回错误对象","else":{"$if":{"condition":{"$eq":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$gt":[{"$len":{"$trim":{"$ref":"item.url"}}},0]},{"$gt":[{"$len":{"$trim":{"$ref":"item.b64_json"}}},0]}]}}}},0]},"then":"SenseNova U1.6 Lite 没有返回可用图片","else":{"$if":{"condition":{"$gt":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$gt":[{"$len":{"$trim":{"$ref":"item.url"}}},0]},{"$gt":[{"$len":{"$trim":{"$ref":"item.b64_json"}}},0]}]}}}},1]},"then":"SenseNova U1.6 Lite 返回图片数量违反 n=1 合同","else":null}}}}}}]}` |
| `response.images` | `{"$if":{"condition":{"$and":[{"$not":{"$ne":[{"$ref":"response.error"},null]}},{"$eq":[{"$len":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$gt":[{"$len":{"$trim":{"$ref":"item.url"}}},0]},{"$gt":[{"$len":{"$trim":{"$ref":"item.b64_json"}}},0]}]}}}},1]}]},"then":{"$map":{"from":{"$filter":{"from":{"$ref":"response.data"},"as":"item","where":{"$or":[{"$gt":[{"$len":{"$trim":{"$ref":"item.url"}}},0]},{"$gt":[{"$len":{"$trim":{"$ref":"item.b64_json"}}},0]}]}}},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.url"}},"dataUrl":{"$omitEmpty":{"$ref":"item.b64_json"}},"size":{"$omitEmpty":{"$coalesce":[{"$ref":"item.size"},{"$ref":"response.size"}]}},"output_format":{"$omitEmpty":{"$coalesce":[{"$ref":"response.output_format"},"png"]}}}}},"else":[]}}` |
| `response.usage` | `{"$merge":[{"$ref":"response.usage"},{"input_images":{"$omitEmpty":{"$ref":"response.usage.input_image_count"}},"generated_images":{"$omitEmpty":{"$ref":"response.usage.output_image_count"}}}]}` |
| `response.resultEphemeral` | `true` |
| `response.errorPaths[0]` | `"error"` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

官方平台 https://platform.sensenova.cn/docs#model-u1-6-lite；Base URL 为 https://token.sensenova.cn，Bearer API Key，模型 sensenova-u1.6-lite。无参考图 POST /v1/images/generations，有参考图 POST /v1/images/edits；两者 Content-Type 均为 application/json，不使用 multipart。编辑输入总计 1–5 张，按 order 顺序发送，首张为主图；公网 HTTP/HTTPS 图片 URL 或完整 data:image/{format};base64,...，不接受裸 Base64，不支持 mask。

size 为 auto 或宽x高：每边 512–4096、32 的倍数，宽高比 1:3–3:1。官方六个推荐尺寸是 2048x2048、2720x1536、1536x2720、1664x2496、2496x1664、4096x4096，界面默认提供这些尺寸与 auto；推荐值不是上游全部枚举，底层协议校验支持规则范围内的其他明确像素尺寸。auto 编辑适配主图，但文档没有保证保留原像素或裁切方式。n 仅 1。不发送 aspect_ratio、area、resolution、quality、background、mask、output_compression 或 stream。

固定 response_format=url，output_format 默认 png（支持 png/jpeg/webp）；图片协议 2.0.0 在官方水印参数禁用或取值缺失时明确发送 watermark=false，不回退为供应商默认 true；启用时按模型默认值（初始 true）或本次选择发送。prompt_extend/self_correction 默认 true；三个开关显式 false 均保留。已锁版模型需显式绑定新发行版，旧任务快照保持不变。无水印功能处于公测权益，不能据此保证整个模型免费。扩展字段只通过 providerOptions.sensenova-image 命名空间绑定。

同步响应，data[].url 为官方示例格式，根 size、output_format 和 usage 保留；只将已存在的 input_image_count/output_image_count 白名单映射为宿主 input_images/generated_images 供计费强校验使用，不填造缺失值，0 保留。24 小时临时 URL 声明为 ephemeral，由宿主立即下载持久化。宿主兼容 data[].b64_json，但本地此分支使用 synthetic fixture，仅证明宿主解析，不是供应商真实响应 schema 或实测。错误对象、空 data、未知响应或不符合 n=1 的有效图片数量保持失败；不定义轮询、异步任务或自动重发。同步 POST 超时/取消后结果和扣费可能未知，文档没有幂等保证，重发可能产生重复费用。

本实现只依据公开文档及本地 fixture，未调用真实供应商 API。未编造最大 prompt 长度、输入 MB/像素限制、输入完整格式枚举、费用、并发、延迟或 SLA；真实 Base64 schema、auto 编辑、多图质量、费用和下载时延仍需账户授权后验收。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "sensenova-image",
  "name": "SenseNova U1.6 Lite Image",
  "version": "2.0.0",
  "author": "SenseNova / 影策",
  "description": "SenseNova U1.6 Lite 同步 JSON 图片生成与编辑协议。",
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
        "id": "sensenova-image",
        "label": "SenseNova U1.6 Lite Image",
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
        "baseUrl": "https://token.sensenova.cn",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅 / 尺寸",
            "type": "string",
            "binding": "aspectRatio",
            "encoding": "pixels",
            "values": [
              "auto",
              "2048x2048",
              "2720x1536",
              "1536x2720",
              "1664x2496",
              "2496x1664",
              "4096x4096"
            ],
            "default": "auto",
            "pricing": true
          },
          {
            "name": "imageResolution",
            "label": "分辨率",
            "type": "string",
            "binding": "resolution",
            "enabled": false
          },
          {
            "name": "quality",
            "label": "图片质量",
            "type": "string",
            "binding": "quality",
            "enabled": false
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 1,
            "step": 1,
            "default": 1
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
            "binding": "providerOptions.sensenova-image.output_format",
            "values": [
              "png",
              "jpeg",
              "webp"
            ],
            "default": "png"
          },
          {
            "name": "watermark",
            "label": "官方水印",
            "type": "boolean",
            "binding": "providerOptions.sensenova-image.watermark",
            "default": true,
            "description": "禁用此参数时固定发送 false；启用后按默认值或本次选择发送。"
          },
          {
            "name": "promptExtend",
            "label": "提示词扩写",
            "type": "boolean",
            "binding": "providerOptions.sensenova-image.prompt_extend",
            "default": true
          },
          {
            "name": "selfCorrection",
            "label": "文字 / 画质自修正",
            "type": "boolean",
            "binding": "providerOptions.sensenova-image.self_correction",
            "default": true
          }
        ],
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "仅支持 sensenova-u1.6-lite。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "非空图片提示词；编辑时描述期望最终画面，官方未说明最大长度。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images[].image_url",
            "description": "无参考图走 generations，有参考图走 edits；编辑总计 1–5 张，按 order 保持顺序，首张是主编辑图，支持公网 HTTP/HTTPS URL 或完整图片 Data URL，不支持 mask。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "仅支持 1，未设置时同样发送 1。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size",
            "description": "auto 或宽x高：各边 512–4096 且为 32 倍数，比例 1:3–3:1；界面提供官方六个推荐尺寸，不把比例、2K、4K 字面量发送上游。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "output_format / watermark / prompt_extend / self_correction",
            "description": "仅允许 sensenova-image 命名空间内四个文档化扩展字段；输出 png/jpeg/webp。watermark 缺失时发送 false；参数启用时按默认值或本次选择发送。prompt_extend/self_correction 默认 true；显式 false 保留。"
          }
        ],
        "requestBindings": [
          {
            "name": "size",
            "value": {
              "$coalesce": [
                {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  }
                },
                "auto"
              ]
            }
          },
          {
            "name": "width",
            "value": {
              "$toFloat": {
                "$at": [
                  {
                    "$split": [
                      {
                        "$ref": "bindings.size"
                      },
                      "x"
                    ]
                  },
                  0
                ]
              }
            }
          },
          {
            "name": "height",
            "value": {
              "$toFloat": {
                "$at": [
                  {
                    "$split": [
                      {
                        "$ref": "bindings.size"
                      },
                      "x"
                    ]
                  },
                  1
                ]
              }
            }
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "sensenova-u1.6-lite"
              ]
            },
            "message": "SenseNova U1.6 Lite · 仅支持 sensenova-u1.6-lite。"
          },
          {
            "assert": {
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
            "message": "SenseNova U1.6 Lite · 提示词不能为空。"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 图片协议不接受视频或音频输入。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  }
                },
                5
              ]
            },
            "message": "SenseNova U1.6 Lite · 编辑最多接受 5 张图片（含首张主图）。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
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
            "message": "SenseNova U1.6 Lite · 不支持蒙版（mask），请使用提示词描述修改区域。"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$and": [
                            {
                              "$eq": [
                                {
                                  "$ref": "media.value"
                                },
                                {
                                  "$toString": {
                                    "$ref": "media.value"
                                  }
                                }
                              ]
                            },
                            {
                              "$eq": [
                                {
                                  "$countMatches": [
                                    {
                                      "$trim": {
                                        "$ref": "media.value"
                                      }
                                    },
                                    "^(?:https?://[^\\s]+|data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2})$"
                                  ]
                                },
                                1
                              ]
                            }
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "SenseNova U1.6 Lite · 图片须使用公网 HTTP/HTTPS URL 或带完整 MIME 前缀的 Base64 Data URL。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.imageCount"
                },
                {
                  "$literal": [
                    null,
                    0,
                    1
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 生成数量仅支持 1。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "bindings.size"
                    },
                    "auto"
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
                                "$ref": "bindings.size"
                              },
                              "x"
                            ]
                          }
                        },
                        2
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$countMatches": [
                            {
                              "$ref": "bindings.size"
                            },
                            "^[0-9]+x[0-9]+$"
                          ]
                        },
                        1
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$gte": [
                            {
                              "$ref": "bindings.width"
                            },
                            512
                          ]
                        },
                        {
                          "$lte": [
                            {
                              "$ref": "bindings.width"
                            },
                            4096
                          ]
                        }
                      ]
                    },
                    {
                      "$and": [
                        {
                          "$gte": [
                            {
                              "$ref": "bindings.height"
                            },
                            512
                          ]
                        },
                        {
                          "$lte": [
                            {
                              "$ref": "bindings.height"
                            },
                            4096
                          ]
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.width"
                        },
                        {
                          "$ceilStep": [
                            {
                              "$ref": "bindings.width"
                            },
                            32
                          ]
                        }
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "bindings.height"
                        },
                        {
                          "$ceilStep": [
                            {
                              "$ref": "bindings.height"
                            },
                            32
                          ]
                        }
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.width"
                        },
                        {
                          "$multiply": [
                            {
                              "$ref": "bindings.height"
                            },
                            3
                          ]
                        }
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "bindings.height"
                        },
                        {
                          "$multiply": [
                            {
                              "$ref": "bindings.width"
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
            "message": "SenseNova U1.6 Lite · size 须为 auto 或宽x高：各边 512–4096、32 的倍数，比例 1:3 到 3:1。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.quality"
                    }
                  }
                },
                {
                  "$literal": [
                    "",
                    "auto"
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 未声明 quality 质量档位，请移除该参数。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.extra.transparentBackground"
                },
                {
                  "$literal": [
                    null,
                    "",
                    false,
                    "false"
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 不支持透明背景，请关闭该参数。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.sensenova-image"
                    },
                    null
                  ]
                },
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.sensenova-image"
                    },
                    {
                      "output_format": {
                        "$ref": "request.providerOptions.sensenova-image.output_format"
                      },
                      "watermark": {
                        "$ref": "request.providerOptions.sensenova-image.watermark"
                      },
                      "prompt_extend": {
                        "$ref": "request.providerOptions.sensenova-image.prompt_extend"
                      },
                      "self_correction": {
                        "$ref": "request.providerOptions.sensenova-image.self_correction"
                      }
                    }
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 扩展参数包含未知键或空值。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.providerOptions.sensenova-image.output_format"
                        }
                      }
                    },
                    "png"
                  ]
                },
                {
                  "$literal": [
                    "png",
                    "jpeg",
                    "webp"
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · 输出格式仅支持 png、jpeg、webp。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.providerOptions.sensenova-image.watermark"
                },
                {
                  "$literal": [
                    null,
                    true,
                    false
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · watermark 必须为布尔值。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.providerOptions.sensenova-image.prompt_extend"
                },
                {
                  "$literal": [
                    null,
                    true,
                    false
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · prompt_extend 必须为布尔值。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.providerOptions.sensenova-image.self_correction"
                },
                {
                  "$literal": [
                    null,
                    true,
                    false
                  ]
                }
              ]
            },
            "message": "SenseNova U1.6 Lite · self_correction 必须为布尔值。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    }
                  },
                  0
                ]
              },
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$trim": {
                "$ref": "request.prompt"
              }
            },
            "size": {
              "$ref": "bindings.size"
            },
            "n": 1,
            "images": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
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
                        "$trim": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "response_format": "url",
            "output_format": {
              "$coalesce": [
                {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.providerOptions.sensenova-image.output_format"
                    }
                  }
                },
                "png"
              ]
            },
            "watermark": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.sensenova-image.watermark"
                },
                false
              ]
            },
            "prompt_extend": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.sensenova-image.prompt_extend"
                },
                true
              ]
            },
            "self_correction": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.sensenova-image.self_correction"
                },
                true
              ]
            },
            "quality": null,
            "background": null
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$not": {
                      "$ne": [
                        {
                          "$ref": "response.error"
                        },
                        null
                      ]
                    }
                  },
                  {
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
                                  "$gt": [
                                    {
                                      "$len": {
                                        "$trim": {
                                          "$ref": "item.url"
                                        }
                                      }
                                    },
                                    0
                                  ]
                                },
                                {
                                  "$gt": [
                                    {
                                      "$len": {
                                        "$trim": {
                                          "$ref": "item.b64_json"
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
                      1
                    ]
                  }
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
                "$if": {
                  "condition": {
                    "$ne": [
                      {
                        "$ref": "response.error"
                      },
                      null
                    ]
                  },
                  "then": "SenseNova U1.6 Lite 返回错误对象",
                  "else": {
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
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$trim": {
                                              "$ref": "item.url"
                                            }
                                          }
                                        },
                                        0
                                      ]
                                    },
                                    {
                                      "$gt": [
                                        {
                                          "$len": {
                                            "$trim": {
                                              "$ref": "item.b64_json"
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
                      "then": "SenseNova U1.6 Lite 没有返回可用图片",
                      "else": {
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
                                          "$gt": [
                                            {
                                              "$len": {
                                                "$trim": {
                                                  "$ref": "item.url"
                                                }
                                              }
                                            },
                                            0
                                          ]
                                        },
                                        {
                                          "$gt": [
                                            {
                                              "$len": {
                                                "$trim": {
                                                  "$ref": "item.b64_json"
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
                              1
                            ]
                          },
                          "then": "SenseNova U1.6 Lite 返回图片数量违反 n=1 合同",
                          "else": null
                        }
                      }
                    }
                  }
                }
              }
            ]
          },
          "images": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$not": {
                      "$ne": [
                        {
                          "$ref": "response.error"
                        },
                        null
                      ]
                    }
                  },
                  {
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
                                  "$gt": [
                                    {
                                      "$len": {
                                        "$trim": {
                                          "$ref": "item.url"
                                        }
                                      }
                                    },
                                    0
                                  ]
                                },
                                {
                                  "$gt": [
                                    {
                                      "$len": {
                                        "$trim": {
                                          "$ref": "item.b64_json"
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
                      1
                    ]
                  }
                ]
              },
              "then": {
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
                            "$gt": [
                              {
                                "$len": {
                                  "$trim": {
                                    "$ref": "item.url"
                                  }
                                }
                              },
                              0
                            ]
                          },
                          {
                            "$gt": [
                              {
                                "$len": {
                                  "$trim": {
                                    "$ref": "item.b64_json"
                                  }
                                }
                              },
                              0
                            ]
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
                    "size": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
                            "$ref": "item.size"
                          },
                          {
                            "$ref": "response.size"
                          }
                        ]
                      }
                    },
                    "output_format": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
                            "$ref": "response.output_format"
                          },
                          "png"
                        ]
                      }
                    }
                  }
                }
              },
              "else": []
            }
          },
          "usage": {
            "$merge": [
              {
                "$ref": "response.usage"
              },
              {
                "input_images": {
                  "$omitEmpty": {
                    "$ref": "response.usage.input_image_count"
                  }
                },
                "generated_images": {
                  "$omitEmpty": {
                    "$ref": "response.usage.output_image_count"
                  }
                }
              }
            ]
          },
          "resultEphemeral": true,
          "errorPaths": [
            "error"
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
