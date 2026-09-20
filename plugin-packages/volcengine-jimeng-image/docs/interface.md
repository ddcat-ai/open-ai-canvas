# Volcengine Jimeng Image 接口字段

## 协议身份

- 插件 ID：`volcengine-jimeng-image`。
- Provider ID：`volcengine-jimeng-image`。
- 能力：`image`。
- 默认 Base URL：`https://visual.volcengineapi.com`。
- 鉴权驱动：`volcengine-v4`。
- 创建：`POST /`。
- 查询：`POST /`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |
| `secretKey` | secret | 是 | Secret Key |

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
| `create.path` | `"/"` |
| `create.contentType` | `"application/json"` |
| `create.body.req_key` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.force_single` | `true` |
| `create.body.binary_data_base64` | `{"$omitEmpty":{"$map":{"from":{"$filter":{"from":{"$ref":"request.images"},"as":"media","where":{"$ref":"media.dataUrl"}}},"as":"media","in":{"$dataPayload":{"$ref":"media.dataUrl"}}}}}` |
| `create.body.image_urls` | `{"$omitEmpty":{"$map":{"from":{"$filter":{"from":{"$ref":"request.images"},"as":"media","where":{"$and":[{"$not":{"$ref":"media.dataUrl"}},{"$ref":"media.url"}]}}},"as":"media","in":{"$ref":"media.url"}}}}` |
| `create.body.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-jimeng-image.seed"}}` |
| `create.body.width` | `{"$omitEmpty":{"$if":{"condition":{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},"then":{"$toInt":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},"else":{"$ref":"request.output.width"}}}}` |
| `create.body.height` | `{"$omitEmpty":{"$if":{"condition":{"$and":[{"$eq":[{"$len":{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]}},2]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},0]}},0]},{"$gt":[{"$toFloat":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},0]}]},"then":{"$toInt":{"$at":[{"$split":[{"$lower":{"$trim":{"$ref":"request.aspectRatio"}}},"x"]},1]}},"else":{"$ref":"request.output.height"}}}}` |
| `create.body.req_json` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-jimeng-image.req_json"}}` |
| `create.query.Action` | `"CVSync2AsyncSubmitTask"` |
| `create.query.Version` | `"2022-08-31"` |
| `poll.method` | `"POST"` |
| `poll.path` | `"/"` |
| `poll.contentType` | `"application/json"` |
| `poll.body.req_key` | `{"$ref":"request.model"}` |
| `poll.body.task_id` | `{"$ref":"taskId"}` |
| `poll.body.req_json` | `"{\"return_url\":true}"` |
| `poll.query.Action` | `"CVSync2AsyncGetResult"` |
| `poll.query.Version` | `"2022-08-31"` |

## Provider 扩展键

- `providerOptions.volcengine-jimeng-image.req_json`
- `providerOptions.volcengine-jimeng-image.seed`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.task_id"},{"$ref":"response.task_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.images` | `{"$coalesce":[{"$ref":"response.data.image_urls"},{"$ref":"response.data.binary_data_base64"}]}` |
| `response.errorPaths[0]` | `"code"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

本地参考图走 binary_data_base64；公网 URL 走 image_urls。WxH 尺寸拆成 width/height。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-jimeng-image",
  "name": "Volcengine Jimeng Image",
  "version": "2.0.0",
  "author": "Volcengine / 影策",
  "description": "Volcengine Jimeng Image 独立请求协议插件。",
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
      },
      {
        "name": "secretKey",
        "type": "secret",
        "label": "Secret Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "volcengine-jimeng-image",
        "label": "Volcengine Jimeng Image",
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
        "baseUrl": "https://visual.volcengineapi.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "volcengine-v4",
          "field": "apiKey",
          "secretField": "secretKey",
          "service": "cv",
          "region": "cn-north-1"
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
          "path": "/",
          "contentType": "application/json",
          "body": {
            "req_key": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "force_single": true,
            "binary_data_base64": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$ref": "media.dataUrl"
                      }
                    }
                  },
                  "as": "media",
                  "in": {
                    "$dataPayload": {
                      "$ref": "media.dataUrl"
                    }
                  }
                }
              }
            },
            "image_urls": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$not": {
                              "$ref": "media.dataUrl"
                            }
                          },
                          {
                            "$ref": "media.url"
                          }
                        ]
                      }
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.url"
                  }
                }
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-jimeng-image.seed"
              }
            },
            "width": {
              "$omitEmpty": {
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
                    "$toInt": {
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
                  "else": {
                    "$ref": "request.output.width"
                  }
                }
              }
            },
            "height": {
              "$omitEmpty": {
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
                    "$toInt": {
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
                  "else": {
                    "$ref": "request.output.height"
                  }
                }
              }
            },
            "req_json": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-jimeng-image.req_json"
              }
            }
          },
          "originPath": true,
          "query": {
            "Action": "CVSync2AsyncSubmitTask",
            "Version": "2022-08-31"
          }
        },
        "poll": {
          "method": "POST",
          "path": "/",
          "originPath": true,
          "contentType": "application/json",
          "query": {
            "Action": "CVSync2AsyncGetResult",
            "Version": "2022-08-31"
          },
          "body": {
            "req_key": {
              "$ref": "request.model"
            },
            "task_id": {
              "$ref": "taskId"
            },
            "req_json": "{\"return_url\":true}"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.data.status"
              },
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "images": {
            "$coalesce": [
              {
                "$ref": "response.data.image_urls"
              },
              {
                "$ref": "response.data.binary_data_base64"
              }
            ]
          },
          "errorPaths": [
            "code"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
