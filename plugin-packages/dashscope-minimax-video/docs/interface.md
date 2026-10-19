# 百炼 MiniMax H3 Video 接口字段

## 协议身份

- 插件 ID：`dashscope-minimax-video`。
- Provider ID：`dashscope-minimax-video`。
- 能力：`video`。
- 默认 Base URL：``。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v1/services/aigc/video-generation/video-synthesis`。
- 查询：`GET /api/v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 固定为 MiniMax/MiniMax-H3。 |
| `prompt` | string | 是 | `input.prompt` | 中英文提示词，最多 7000 个字符。 |
| `images` | media[] | 否 | `input.media` | 显式首帧、尾帧或参考图；支持仅尾帧。 |
| `videos` | media[] | 否 | `input.media[type=feature]` | 最多 3 个参考视频。 |
| `audios` | media[] | 否 | `input.media[type=driving_audio]` | 最多 3 个参考音频。 |
| `duration` | integer | 是 | `parameters.duration` | 4-15 秒整数，不沿用原生 MiniMax 的 30 秒上限。 |
| `aspectRatio` | string | 否 | `parameters.ratio` | 文生视频必须指定具体比例；首尾帧恒为 adaptive，多模态默认 adaptive。 |
| `resolution` | string | 是 | `parameters.resolution` | 768P 或 2K。 |
| `watermark` | boolean | 否 | `parameters.watermark` | 是否添加 AI 生成水印，默认关闭。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v1/services/aigc/video-generation/video-synthesis"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.input.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.input.media` | `{"$omitEmpty":{"$map":{"from":{"$sortByOrder":{"$coalesce":[{"$concatArrays":[{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"image"}]}}},{"$map":{"from":{"$ref":"request.videos"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"video"}]}}},{"$map":{"from":{"$ref":"request.audios"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"audio"}]}}}]},{"$ref":"request.inputs"}]}},"as":"media","in":{"type":{"$if":{"condition":{"$eq":[{"$ref":"media.kind"},"image"]},"then":{"$if":{"condition":{"$in":[{"$ref":"media.role"},["first_frame","last_frame"]]},"then":{"$ref":"media.role"},"else":"image_url"}},"else":{"$if":{"condition":{"$eq":[{"$ref":"media.kind"},"video"]},"then":"feature","else":"driving_audio"}}}},"url":{"$ref":"media.value"}}}}}` |
| `create.body.parameters.resolution` | `{"$upper":{"$ref":"request.output.resolution"}}` |
| `create.body.parameters.ratio` | `{"$if":{"condition":{"$gt":[{"$len":{"$filter":{"from":{"$coalesce":[{"$concatArrays":[{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"image"}]}}},{"$map":{"from":{"$ref":"request.videos"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"video"}]}}},{"$map":{"from":{"$ref":"request.audios"},"as":"media","in":{"$merge":[{"$ref":"media"},{"kind":"audio"}]}}}]},{"$ref":"request.inputs"}]},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame","last_frame"]]}}}},0]},"then":"adaptive","else":{"$coalesce":[{"$ref":"request.output.aspectRatio"},"adaptive"]}}}` |
| `create.body.parameters.duration` | `{"$ref":"request.output.duration"}` |
| `create.body.parameters.watermark` | `{"$coalesce":[{"$ref":"request.output.watermark"},false]}` |
| `create.headers.X-DashScope-Async` | `"enable"` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/api/v1/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.output.task_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$if":{"condition":{"$eq":[{"$ref":"response.output.task_status"},"UNKNOWN"]},"then":"failed","else":{"$ref":"response.output.task_status"}}}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.output.message"},{"$ref":"response.message"},{"$if":{"condition":{"$eq":[{"$ref":"response.output.task_status"},"UNKNOWN"]},"then":"百炼 MiniMax 任务不存在或已超过 24 小时查询有效期","else":null}}]}` |
| `response.videos` | `{"$ref":"response.output.video_url"}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"code"` |
| `response.errorPaths[1]` | `"output.code"` |
| `response.resultEphemeral` | `true` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

适配阿里云百炼 MiniMax/MiniMax-H3，渠道 Base URL 使用百炼业务空间 Endpoint。

首帧、尾帧各最多 1 张，支持仅尾帧；首尾帧与多模态参考互斥。参考图最多 9 张、每张 30 MB，JPG/JPEG/PNG/WEBP/HEIC/HEIF，宽高 256-5760、宽高比 0.4-2.5。参考视频最多 3 个、每个 50 MB、2-15 秒且总时长不超过 15 秒，MP4/MOV、23.976-60 fps，宽高和比例限制同图片。音频最多 3 个、每个 15 MB、2-15 秒且总时长不超过 15 秒，WAV/MP3。插件校验已提供的角色、数量、URL、提示词和生成规格；媒体编码、尺寸、帧率及参考总时长仍需满足上游限制，不在协议模板内执行媒体探测。

不发送原生 content[]、generate_audio、seed 或 prompt_optimizer，也不开放绕过统一媒体校验的 raw media 扩展。创建任务后仅轮询原 task_id，UNKNOWN 终止为失败；任务查询有效期 24 小时，结果 URL 有效期 30 天，宿主持久化临时结果。usage 保留输入视频、输出视频和图片计数，不把供应商统计直接改写为本地计费规则。

官方接口：[MiniMax 视频生成 API](https://docs.bailian.console.aliyun.com/zh/model-studio/minimax-video-generation-api-reference)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "dashscope-minimax-video",
  "name": "百炼 MiniMax H3 Video",
  "version": "2.0.0",
  "author": "Alibaba Cloud / 影策",
  "description": "百炼 MiniMax H3 Video 独立请求协议插件。",
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
        "id": "dashscope-minimax-video",
        "label": "百炼 MiniMax H3 Video",
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
        "baseUrl": "",
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
            "description": "固定为 MiniMax/MiniMax-H3。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "input.prompt",
            "description": "中英文提示词，最多 7000 个字符。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "input.media",
            "description": "显式首帧、尾帧或参考图；支持仅尾帧。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "input.media[type=feature]",
            "description": "最多 3 个参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "input.media[type=driving_audio]",
            "description": "最多 3 个参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "parameters.duration",
            "description": "4-15 秒整数，不沿用原生 MiniMax 的 30 秒上限。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "parameters.ratio",
            "description": "文生视频必须指定具体比例；首尾帧恒为 adaptive，多模态默认 adaptive。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": true,
            "mapping": "parameters.resolution",
            "description": "768P 或 2K。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "parameters.watermark",
            "description": "是否添加 AI 生成水印，默认关闭。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "MiniMax/MiniMax-H3"
              ]
            },
            "message": "百炼 MiniMax 视频仅支持 MiniMax/MiniMax-H3"
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
                        "$ref": "request.prompt"
                      }
                    },
                    7000
                  ]
                }
              ]
            },
            "message": "百炼 MiniMax 提示词不能为空且不能超过 7000 个字符"
          },
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.output.duration"
                },
                [
                  4,
                  5,
                  6,
                  7,
                  8,
                  9,
                  10,
                  11,
                  12,
                  13,
                  14,
                  15
                ]
              ]
            },
            "message": "百炼 MiniMax duration 必须为 4-15 秒整数"
          },
          {
            "assert": {
              "$in": [
                {
                  "$upper": {
                    "$ref": "request.output.resolution"
                  }
                },
                [
                  "768P",
                  "2K"
                ]
              ]
            },
            "message": "百炼 MiniMax resolution 仅支持 768P 或 2K"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$or": [
                            {
                              "$and": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "media.kind"
                                    },
                                    "image"
                                  ]
                                },
                                {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "",
                                      "first_frame",
                                      "last_frame",
                                      "reference_image",
                                      "subject_reference",
                                      "style_reference"
                                    ]
                                  ]
                                }
                              ]
                            },
                            {
                              "$and": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "media.kind"
                                    },
                                    "video"
                                  ]
                                },
                                {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "",
                                      "reference_video"
                                    ]
                                  ]
                                }
                              ]
                            },
                            {
                              "$and": [
                                {
                                  "$eq": [
                                    {
                                      "$ref": "media.kind"
                                    },
                                    "audio"
                                  ]
                                },
                                {
                                  "$in": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    [
                                      "",
                                      "reference_audio",
                                      "reference_voice"
                                    ]
                                  ]
                                }
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
            "message": "百炼 MiniMax 媒体类型或角色不受支持"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$in": [
                            {
                              "$first": {
                                "$split": [
                                  {
                                    "$ref": "media.value"
                                  },
                                  "://"
                                ]
                              }
                            },
                            [
                              "http",
                              "https"
                            ]
                          ]
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "百炼 MiniMax 媒体必须使用 HTTP 或 HTTPS 公网 URL"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "image"
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                9
              ]
            },
            "message": "百炼 MiniMax 最多支持 9 张参考图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "video"
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                3
              ]
            },
            "message": "百炼 MiniMax 最多支持 3 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "audio"
                            ]
                          }
                        ]
                      }
                    }
                  }
                },
                3
              ]
            },
            "message": "百炼 MiniMax 最多支持 3 个参考音频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "image"
                            ]
                          },
                          {
                            "$in": [
                              {
                                "$ref": "media.role"
                              },
                              [
                                "first_frame"
                              ]
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
            "message": "百炼 MiniMax 最多只能有一个首帧"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "image"
                            ]
                          },
                          {
                            "$in": [
                              {
                                "$ref": "media.role"
                              },
                              [
                                "last_frame"
                              ]
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
            "message": "百炼 MiniMax 最多只能有一个尾帧"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$coalesce": [
                              {
                                "$concatArrays": [
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.images"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "image"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.videos"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "video"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.audios"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "audio"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                ]
                              },
                              {
                                "$ref": "request.inputs"
                              }
                            ]
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
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$coalesce": [
                              {
                                "$concatArrays": [
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.images"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "image"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.videos"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "video"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.audios"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "audio"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                ]
                              },
                              {
                                "$ref": "request.inputs"
                              }
                            ]
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
                    {
                      "$len": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      }
                    }
                  ]
                }
              ]
            },
            "message": "百炼 MiniMax 首尾帧不能与参考图片、视频或音频混用"
          },
          {
            "assert": {
              "$or": [
                {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$coalesce": [
                              {
                                "$concatArrays": [
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.images"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "image"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.videos"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "video"
                                          }
                                        ]
                                      }
                                    }
                                  },
                                  {
                                    "$map": {
                                      "from": {
                                        "$ref": "request.audios"
                                      },
                                      "as": "media",
                                      "in": {
                                        "$merge": [
                                          {
                                            "$ref": "media"
                                          },
                                          {
                                            "kind": "audio"
                                          }
                                        ]
                                      }
                                    }
                                  }
                                ]
                              },
                              {
                                "$ref": "request.inputs"
                              }
                            ]
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
                  "$in": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.output.aspectRatio"
                        },
                        "adaptive"
                      ]
                    },
                    [
                      "adaptive",
                      "16:9",
                      "9:16",
                      "1:1",
                      "4:3",
                      "3:4",
                      "21:9"
                    ]
                  ]
                }
              ]
            },
            "message": "百炼 MiniMax ratio 不受支持"
          },
          {
            "assert": {
              "$or": [
                {
                  "$gt": [
                    {
                      "$len": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      }
                    },
                    0
                  ]
                },
                {
                  "$in": [
                    {
                      "$ref": "request.output.aspectRatio"
                    },
                    [
                      "16:9",
                      "9:16",
                      "1:1",
                      "4:3",
                      "3:4",
                      "21:9"
                    ]
                  ]
                }
              ]
            },
            "message": "百炼 MiniMax 文生视频必须指定具体画幅比例，不能使用 adaptive"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/services/aigc/video-generation/video-synthesis",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "prompt": {
                "$ref": "request.prompt"
              },
              "media": {
                "$omitEmpty": {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$coalesce": [
                          {
                            "$concatArrays": [
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.images"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "image"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.videos"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "video"
                                      }
                                    ]
                                  }
                                }
                              },
                              {
                                "$map": {
                                  "from": {
                                    "$ref": "request.audios"
                                  },
                                  "as": "media",
                                  "in": {
                                    "$merge": [
                                      {
                                        "$ref": "media"
                                      },
                                      {
                                        "kind": "audio"
                                      }
                                    ]
                                  }
                                }
                              }
                            ]
                          },
                          {
                            "$ref": "request.inputs"
                          }
                        ]
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": {
                        "$if": {
                          "condition": {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "image"
                            ]
                          },
                          "then": {
                            "$if": {
                              "condition": {
                                "$in": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  [
                                    "first_frame",
                                    "last_frame"
                                  ]
                                ]
                              },
                              "then": {
                                "$ref": "media.role"
                              },
                              "else": "image_url"
                            }
                          },
                          "else": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "media.kind"
                                  },
                                  "video"
                                ]
                              },
                              "then": "feature",
                              "else": "driving_audio"
                            }
                          }
                        }
                      },
                      "url": {
                        "$ref": "media.value"
                      }
                    }
                  }
                }
              }
            },
            "parameters": {
              "resolution": {
                "$upper": {
                  "$ref": "request.output.resolution"
                }
              },
              "ratio": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$coalesce": [
                                {
                                  "$concatArrays": [
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.images"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "image"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.videos"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "video"
                                            }
                                          ]
                                        }
                                      }
                                    },
                                    {
                                      "$map": {
                                        "from": {
                                          "$ref": "request.audios"
                                        },
                                        "as": "media",
                                        "in": {
                                          "$merge": [
                                            {
                                              "$ref": "media"
                                            },
                                            {
                                              "kind": "audio"
                                            }
                                          ]
                                        }
                                      }
                                    }
                                  ]
                                },
                                {
                                  "$ref": "request.inputs"
                                }
                              ]
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
                  "then": "adaptive",
                  "else": {
                    "$coalesce": [
                      {
                        "$ref": "request.output.aspectRatio"
                      },
                      "adaptive"
                    ]
                  }
                }
              },
              "duration": {
                "$ref": "request.output.duration"
              },
              "watermark": {
                "$coalesce": [
                  {
                    "$ref": "request.output.watermark"
                  },
                  false
                ]
              }
            }
          },
          "headers": {
            "X-DashScope-Async": "enable"
          },
          "originPath": true
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.output.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "response.output.task_status"
                  },
                  "UNKNOWN"
                ]
              },
              "then": "failed",
              "else": {
                "$ref": "response.output.task_status"
              }
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.output.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "response.output.task_status"
                      },
                      "UNKNOWN"
                    ]
                  },
                  "then": "百炼 MiniMax 任务不存在或已超过 24 小时查询有效期",
                  "else": null
                }
              }
            ]
          },
          "videos": {
            "$ref": "response.output.video_url"
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "code",
            "output.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
