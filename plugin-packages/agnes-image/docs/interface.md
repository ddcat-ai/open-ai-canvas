# Agnes Image 接口字段

## 协议身份

- 插件 ID：`agnes-image`。
- Provider ID：`agnes-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.agnes-ai.cn`。
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
| `create.body.size` | `{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$len":{"$split":[{"$trim":{"$ref":"request.aspectRatio"}},"x"]}},2]},"then":{"$trim":{"$ref":"request.aspectRatio"}},"else":{"$switch":{"cases":[{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["1k","low","standard"]]},"then":"1K"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["2k","medium","hd","high"]]},"then":"2K"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["3k"]]},"then":"3K"},{"when":{"$in":[{"$lower":{"$trim":{"$ref":"request.quality"}}},["4k"]]},"then":"4K"}],"default":"1K"}}}}}` |
| `create.body.ratio` | `{"$omitEmpty":{"$if":{"condition":{"$in":[{"$trim":{"$ref":"request.aspectRatio"}},["1:1","3:4","4:3","16:9","9:16","2:3","3:2","21:9"]]},"then":{"$trim":{"$ref":"request.aspectRatio"}},"else":null}}}` |
| `create.body.extra_body` | `{"$omitEmpty":{"image":{"$omitEmpty":{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"$coalesce":[{"$ref":"media.dataUrl"},{"$ref":"media.url"}]}}}},"response_format":{"$coalesce":[{"$ref":"request.providerOptions.agnes-image.response_format"},"url"]}}}` |

## Provider 扩展键

- `providerOptions.agnes-image.response_format`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$map":{"from":{"$ref":"response.data"},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.url"}},"dataUrl":{"$if":{"condition":{"$ref":"item.b64_json"},"then":{"$concat":["data:image/png;base64,",{"$ref":"item.b64_json"}]},"else":null}}}}}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.errorPaths[1]` | `"code"` |
| `response.messagePaths[0]` | `"error.message"` |
| `response.messagePaths[1]` | `"message"` |
| `response.messagePaths[2]` | `"msg"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

Agnes 官方图像端点，同步返回。文生图与图生图共用 /v1/images/generations：不传 image 为文生图，传 image 为图生图或多图合成。size 必填，取 1K/2K/3K/4K 档位或 WxH 精确尺寸；画面比例走独立的 ratio 字段。参考图放在 extra_body.image，支持公共 HTTPS URL 或 Data URI Base64。顶层 response_format 是官方明确列出的错误写法，输出格式只能声明在 extra_body.response_format。该端点不接受 n，单次请求固定返回一张图片，需要多张时由上层拆分为多个任务。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "agnes-image",
  "name": "Agnes Image",
  "version": "2.0.0",
  "author": "Agnes AI / 影策",
  "description": "Agnes Image 独立请求协议插件。",
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
        "id": "agnes-image",
        "label": "Agnes Image",
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
        "baseUrl": "https://api.agnes-ai.cn",
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
        "validations": [
          {
            "assert": {
              "$or": [
                {
                  "$in": [
                    {
                      "$trim": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    [
                      "",
                      "auto",
                      "1:1",
                      "3:4",
                      "4:3",
                      "16:9",
                      "9:16",
                      "2:3",
                      "3:2",
                      "21:9"
                    ]
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$split": [
                          {
                            "$trim": {
                              "$ref": "request.aspectRatio"
                            }
                          },
                          "x"
                        ]
                      }
                    },
                    2
                  ]
                }
              ]
            },
            "message": "Agnes 图像只支持 1:1、3:4、4:3、16:9、9:16、2:3、3:2、21:9 比例或 WxH 像素尺寸"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
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
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$split": [
                            {
                              "$trim": {
                                "$ref": "request.aspectRatio"
                              }
                            },
                            "x"
                          ]
                        }
                      },
                      2
                    ]
                  },
                  "then": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  "else": {
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
                                "1k",
                                "low",
                                "standard"
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
                                  "$trim": {
                                    "$ref": "request.quality"
                                  }
                                }
                              },
                              [
                                "2k",
                                "medium",
                                "hd",
                                "high"
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
                                  "$trim": {
                                    "$ref": "request.quality"
                                  }
                                }
                              },
                              [
                                "3k"
                              ]
                            ]
                          },
                          "then": "3K"
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
                          "then": "4K"
                        }
                      ],
                      "default": "1K"
                    }
                  }
                }
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      },
                      [
                        "1:1",
                        "3:4",
                        "4:3",
                        "16:9",
                        "9:16",
                        "2:3",
                        "3:2",
                        "21:9"
                      ]
                    ]
                  },
                  "then": {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  "else": null
                }
              }
            },
            "extra_body": {
              "$omitEmpty": {
                "image": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "in": {
                        "$coalesce": [
                          {
                            "$ref": "media.dataUrl"
                          },
                          {
                            "$ref": "media.url"
                          }
                        ]
                      }
                    }
                  }
                },
                "response_format": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.agnes-image.response_format"
                    },
                    "url"
                  ]
                }
              }
            }
          },
          "originPath": true
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
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message",
            "msg"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
