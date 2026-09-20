# MiniMax Hailuo Video V2 / H3 接口字段

## 入口和生命周期

- 创建：`POST /v2/video_generation`。
- 查询：`GET /v2/query/video_generation/{taskId}`。
- 鉴权：`Authorization: Bearer <apiKey>`。
- 请求：JSON；结果：异步任务，完成后下载并持久化临时 URL。

## 请求字段

| 上游字段 | 类型 | 必填 | 统一来源 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `request.model` | Hailuo/MiniMax 视频模型 ID。 |
| `content` | block[] | 是 | prompt + inputs | 第一个 block 为 text；媒体 block 依次按 order 输出。 |
| `content[].type` | enum | 是 | media.kind | `text/image_url/video_url/audio_url`。 |
| `content[].text` | string | 文本必填 | `request.prompt` | 不重复发送顶层 prompt。 |
| `content[].image_url.url` | string | 图片 block 必填 | `media.value` | 由宿主保证公网 URL。 |
| `content[].video_url.url` | string | 视频 block 必填 | `media.value` | 参考视频。 |
| `content[].audio_url.url` | string | 音频 block 必填 | `media.value` | 参考音频/声音。 |
| `content[].role` | string | 媒体必填 | `media.role` | `first_frame/last_frame/reference_image/reference_video/reference_audio/reference_voice`。 |
| `images` | media[] | 否 | image content blocks | 图片按显式 role 与 order 映射，不使用数组下标猜测。 |
| `videos` | media[] | 否 | video content blocks | 参考视频按 role 与 order 映射。 |
| `audios` | media[] | 否 | audio content blocks | 参考音频或声音按 role 与 order 映射。 |
| `duration` | integer | 是 | `request.duration` | 4-15 秒。 |
| `resolution` | string | 否 | `request.resolution` | 默认 `768P`；实际枚举按模型 profile。 |
| `ratio` | string | 否 | `request.aspectRatio` | 首尾帧模式为 `adaptive`，其余默认 `16:9`。 |
| `aigc_watermark` | boolean | 否 | `request.watermark` | 是否带 AIGC 水印。 |
| `generate_audio` | boolean | 否 | `request.generateAudio` | 模型支持时生成音频。 |
| `seed` | integer | 否 | `providerOptions.minimax-video.seed` | 随机种子。 |
| `prompt_optimizer` | boolean | 否 | `providerOptions.minimax-video.prompt_optimizer` | 提示词优化开关。 |

## 强校验

- 图片最多 9 张、视频最多 3 个、音频最多 3 个。
- 首帧和尾帧各最多 1 张；尾帧不能脱离首帧。
- 首尾帧模式不能混入 `reference_image/subject_reference/style_reference`。
- duration 超出 4-15 秒直接失败，不静默裁剪。

## 中转兼容边界

本插件对应 MiniMax `/v2/video_generation` 原生线协议。NewAPI Channel 1、Channel 2 和自定义 OpenAI Videos 中转必须选择各自独立插件；不能只根据模型名包含 `H3` 自动切协议。

## 响应映射

- `task.id` / `task_id` / `id` 映射为统一任务 ID；查询响应缺省时保留已有任务 ID。
- `task.status` / `status` 映射为 `pending/processing/succeeded/failed/cancelled`。
- `task.content.url` / `content.url` / `video_url` / `file.url` 映射为统一视频结果。
- 创建和查询响应优先读取 `task.error.message`，再读取 `task.message` / `base_resp.status_msg` / `message` / `error.message`；具体失败原因通过任务错误返回给用户。
- `task.error.code` / `base_resp.status_code` / `error.code` 非成功值均判定为失败，即使响应 HTTP 状态为 200 或未提供任务状态。
- 完成后的临时媒体地址由宿主立即下载并持久化。

例如，参考图片尺寸不符合要求时，上游返回 `task.error.code: "2013"` 和 `task.error.message: "content[1].image_url: media dimensions must be between 256 and 5760 pixels"`。任务应展示这条具体消息；只有上游未提供可读取的错误原因时，才使用通用失败提示。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "minimax-hailuo-video-v2",
  "name": "MiniMax Hailuo Video V2 / H3",
  "version": "2.0.1",
  "author": "MiniMax / 影策",
  "description": "MiniMax / Hailuo V2 视频生成协议，保留首帧、尾帧、参考图、视频和音频角色语义。",
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
        "id": "minimax-video",
        "label": "MiniMax Hailuo Video V2 / H3",
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
        "baseUrl": "https://api.minimax.io",
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
            "description": "MiniMax/Hailuo 视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "仅写入 text content block，避免与顶层 prompt 重复。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "content[type=image_url]",
            "description": "保留 first_frame、last_frame、reference_image 等 role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "content[type=video_url]",
            "description": "映射为 reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "content[type=audio_url]",
            "description": "映射为 reference_audio/reference_voice。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "values": [
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
              "11",
              "12",
              "13",
              "14",
              "15"
            ],
            "mapping": "duration",
            "description": "4-15 秒。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "如 768P、1080P、2K；按模型能力限制。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "ratio",
            "description": "首尾帧模式自动使用 adaptive；其他模式使用用户比例。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "mapping": "aigc_watermark",
            "description": "AIGC 水印。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "模型支持时生成音频。"
          },
          {
            "name": "seed",
            "type": "integer",
            "mapping": "seed",
            "description": "providerOptions.minimax-video.seed。"
          },
          {
            "name": "prompt_optimizer",
            "type": "boolean",
            "mapping": "prompt_optimizer",
            "description": "providerOptions.minimax-video.prompt_optimizer。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                9
              ]
            },
            "message": "MiniMax H3 最多支持 9 张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "MiniMax H3 最多支持 3 个参考音频"
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
                    15
                  ]
                }
              ]
            },
            "message": "MiniMax H3 duration 必须在 4-15 秒之间"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "first_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个首帧"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "image",
                      "where": {
                        "$eq": [
                          {
                            "$ref": "image.role"
                          },
                          "last_frame"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "MiniMax H3 最多只能有一个尾帧"
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
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "last_frame"
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
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$eq": [
                              {
                                "$ref": "image.role"
                              },
                              "first_frame"
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
            "message": "MiniMax H3 使用尾帧时必须同时提供首帧"
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
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
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
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "image",
                            "where": {
                              "$in": [
                                {
                                  "$ref": "image.role"
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
                  }
                ]
              }
            },
            "message": "MiniMax H3 首尾帧模式不能混入普通角色或风格参考图"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v2/video_generation",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                [
                  {
                    "type": "text",
                    "text": {
                      "$ref": "request.prompt"
                    }
                  }
                ],
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.images"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_image"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.videos"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_video"
                        ]
                      }
                    }
                  }
                },
                {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$ref": "request.audios"
                      }
                    },
                    "as": "media",
                    "in": {
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": {
                        "$coalesce": [
                          {
                            "$ref": "media.role"
                          },
                          "reference_audio"
                        ]
                      }
                    }
                  }
                }
              ]
            },
            "duration": {
              "$ref": "request.duration"
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "768P"
              ]
            },
            "ratio": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "image",
                          "where": {
                            "$in": [
                              {
                                "$ref": "image.role"
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
                      "$ref": "request.aspectRatio"
                    },
                    "16:9"
                  ]
                }
              }
            },
            "aigc_watermark": {
              "$ref": "request.watermark"
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.minimax-video.seed"
              }
            },
            "prompt_optimizer": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.minimax-video.prompt_optimizer"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v2/query/video_generation/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task.id"
              },
              {
                "$ref": "response.task_id"
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
                "$ref": "response.task.status"
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
                "$ref": "response.task.error.message"
              },
              {
                "$ref": "response.task.message"
              },
              {
                "$ref": "response.base_resp.status_msg"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.error.message"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.task.content.url"
              },
              {
                "$ref": "response.content.url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.file.url"
              }
            ]
          },
          "errorPaths": [
            "task.error.code",
            "base_resp.status_code",
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
