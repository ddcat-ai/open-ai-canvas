# Agnes Video 2.5 / 2.5 Flash 接口字段

## 协议身份

- 插件 ID：`agnes-video-25`。
- Provider ID：`agnes-video`。
- 能力：`video`。
- 默认 Base URL：`https://apihub.agnes-ai.com/v1`。
- 鉴权驱动：`bearer`。
- 创建：`POST /videos`。
- 查询：`GET /agnesapi`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 视频模型 ID。 |
| `prompt` | string | 是 | `prompt/content/input` | 视频提示词。 |
| `images` | media[] | 否 | `first/last/reference image` | 显式 role 图片输入。 |
| `videos` | media[] | 否 | `reference video` | 参考视频。 |
| `audios` | media[] | 否 | `reference audio/voice` | 参考音频或音色。 |
| `duration` | integer | 否 | `duration/seconds` | 时长秒数。 |
| `aspectRatio` | string | 否 | `ratio/aspect_ratio/size` | 画幅比例或尺寸。 |
| `resolution` | string | 否 | `resolution` | 分辨率档位。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成音频。 |
| `watermark` | boolean | 否 | `watermark` | 水印开关。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/videos"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.mode` | `{"$if":{"condition":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]},"then":"reference","else":{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},0]},"then":"keyframe","else":"text"}}}}` |
| `create.body.seconds` | `{"$toString":{"$ref":"request.duration"}}` |
| `create.body.size` | `{"$upper":{"$coalesce":[{"$ref":"request.resolution"},"720P"]}}` |
| `create.body.aspect_ratio` | `{"$coalesce":[{"$ref":"request.aspectRatio"},"16:9"]}` |
| `create.body.n` | `{"$coalesce":[{"$ref":"request.output.count"},1]}` |
| `create.body.first_frame` | `{"$if":{"condition":{"$not":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]}},"then":{"$omitEmpty":{"$coalesce":[{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame"]]}}},"as":"media","in":{"$ref":"media.value"}}}},{"$first":{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"$ref":"media.value"}}}}]}},"else":null}}` |
| `create.body.last_frame` | `{"$if":{"condition":{"$not":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]}},"then":{"$omitEmpty":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["last_frame"]]}}},"as":"media","in":{"$ref":"media.value"}}}}},"else":null}}` |
| `create.body.images` | `{"$if":{"condition":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]},"then":{"$omitEmpty":{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"$ref":"media.value"}}}},"else":null}}` |
| `create.body.videos` | `{"$if":{"condition":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]},"then":{"$omitEmpty":{"$map":{"from":{"$sortByOrder":{"$ref":"request.videos"}},"as":"media","in":{"url":{"$ref":"media.value"}}}}},"else":null}}` |
| `create.body.audios` | `{"$if":{"condition":{"$or":[{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["reference_image","subject_reference","style_reference"]]}}}},0]},{"$gt":[{"$len":{"$ref":"request.videos"}},0]},{"$gt":[{"$len":{"$ref":"request.audios"}},0]}]},"then":{"$omitEmpty":{"$map":{"from":{"$sortByOrder":{"$ref":"request.audios"}},"as":"media","in":{"$ref":"media.value"}}}},"else":null}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/agnesapi"` |
| `poll.contentType` | `"application/json"` |
| `poll.query.video_id` | `{"$ref":"taskId"}` |
| `poll.query.model_name` | `{"$ref":"request.model"}` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.video_id"},{"$ref":"response.video_id"},{"$ref":"response.data.id"},{"$ref":"response.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.data.error.message"},{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.detail"}]}` |
| `response.videos` | `{"$coalesce":[{"$ref":"response.data.metadata.url"},{"$ref":"response.metadata.url"},{"$ref":"response.data.url"},{"$ref":"response.url"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |

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
  "id": "agnes-video-25",
  "name": "Agnes Video 2.5 / 2.5 Flash",
  "version": "2.0.0",
  "author": "Agnes AI / 影策",
  "description": "Agnes Video 2.5 / 2.5 Flash 独立请求协议插件。",
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
        "id": "agnes-video",
        "label": "Agnes Video 2.5 / 2.5 Flash",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://apihub.agnes-ai.com/v1",
        "requiresPublicMediaUrls": true,
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
            "description": "视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt/content/input",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "first/last/reference image",
            "description": "显式 role 图片输入。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference video",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference audio/voice",
            "description": "参考音频或音色。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration/seconds",
            "description": "时长秒数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio/size",
            "description": "画幅比例或尺寸。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "水印开关。"
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
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "agnes-video-2.5",
                  "agnes-video-2.5-flash"
                ]
              ]
            },
            "message": "Agnes 2.5 插件仅支持 agnes-video-2.5 与 agnes-video-2.5-flash"
          },
          {
            "assert": {
              "$and": [
                {
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                },
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    12
                  ]
                }
              ]
            },
            "message": "Agnes Video 2.5 时长必须在 4–12 秒之间"
          },
          {
            "assert": {
              "$in": [
                {
                  "$upper": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "720P"
                    ]
                  }
                },
                [
                  "720P",
                  "960P",
                  "2K"
                ]
              ]
            },
            "message": "Agnes Video 2.5 分辨率必须是 720P、960P 或 2K"
          },
          {
            "assert": {
              "$not": {
                "$and": [
                  {
                    "$gt": [
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
                              "$in": [
                                {
                                  "$ref": "media.role"
                                },
                                [
                                  "first_frame",
                                  "last_frame"
                                ]
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  {
                    "$or": [
                      {
                        "$gt": [
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
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "reference_image",
                                      "subject_reference",
                                      "style_reference"
                                    ]
                                  ]
                                }
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
                              "$ref": "request.videos"
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.audios"
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                ]
              }
            },
            "message": "Agnes Video 2.5 不能同时混用首尾帧和角色、视频或音频参考素材"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.model"
                    },
                    "agnes-video-2.5-flash"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$upper": {
                        "$coalesce": [
                          {
                            "$ref": "request.resolution"
                          },
                          "720P"
                        ]
                      }
                    },
                    "720P"
                  ]
                }
              ]
            },
            "message": "Agnes Video 2.5 Flash 仅支持 720P"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.model"
                    },
                    "agnes-video-2.5-flash"
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.images"
                      }
                    },
                    5
                  ]
                }
              ]
            },
            "message": "Agnes Video 2.5 Flash 最多支持 5 张参考图"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$ref": "request.model"
                    },
                    "agnes-video-2.5-flash"
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                }
              ]
            },
            "message": "Agnes Video 2.5 Flash 不支持参考视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "mode": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$gt": [
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
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "reference_image",
                                    "subject_reference",
                                    "style_reference"
                                  ]
                                ]
                              }
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
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$gt": [
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
                "then": "reference",
                "else": {
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
                    "then": "keyframe",
                    "else": "text"
                  }
                }
              }
            },
            "seconds": {
              "$toString": {
                "$ref": "request.duration"
              }
            },
            "size": {
              "$upper": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720P"
                ]
              }
            },
            "aspect_ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
            },
            "n": {
              "$coalesce": [
                {
                  "$ref": "request.output.count"
                },
                1
              ]
            },
            "first_frame": {
              "$if": {
                "condition": {
                  "$not": {
                    "$or": [
                      {
                        "$gt": [
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
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "reference_image",
                                      "subject_reference",
                                      "style_reference"
                                    ]
                                  ]
                                }
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
                              "$ref": "request.videos"
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.audios"
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                },
                "then": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
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
                                      "first_frame"
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
                      },
                      {
                        "$first": {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.images"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.value"
                            }
                          }
                        }
                      }
                    ]
                  }
                },
                "else": null
              }
            },
            "last_frame": {
              "$if": {
                "condition": {
                  "$not": {
                    "$or": [
                      {
                        "$gt": [
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
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "reference_image",
                                      "subject_reference",
                                      "style_reference"
                                    ]
                                  ]
                                }
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
                              "$ref": "request.videos"
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.audios"
                            }
                          },
                          0
                        ]
                      }
                    ]
                  }
                },
                "then": {
                  "$omitEmpty": {
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
                                  "last_frame"
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
            "images": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$gt": [
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
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "reference_image",
                                    "subject_reference",
                                    "style_reference"
                                  ]
                                ]
                              }
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
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$gt": [
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
                "then": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "videos": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$gt": [
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
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "reference_image",
                                    "subject_reference",
                                    "style_reference"
                                  ]
                                ]
                              }
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
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$gt": [
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
                "then": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.videos"
                        }
                      },
                      "as": "media",
                      "in": {
                        "url": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                },
                "else": null
              }
            },
            "audios": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$gt": [
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
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "reference_image",
                                    "subject_reference",
                                    "style_reference"
                                  ]
                                ]
                              }
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
                            "$ref": "request.videos"
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$gt": [
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
                "then": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.value"
                      }
                    }
                  }
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/agnesapi",
          "originPath": true,
          "query": {
            "video_id": {
              "$ref": "taskId"
            },
            "model_name": {
              "$ref": "request.model"
            }
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.video_id"
              },
              {
                "$ref": "response.video_id"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.id"
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
                "$ref": "response.data.error.message"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.detail"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.data.url"
              },
              {
                "$ref": "response.url"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
