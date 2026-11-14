# Volcengine Ark Seedance 2.5 接口字段

## 协议身份

- 插件 ID：`volcengine-ark-seedance-25`。
- Provider ID：`volcengine-ark-seedance-25`。
- 能力：`video`。
- 默认 Base URL：`https://ark.cn-beijing.volces.com`。
- 鉴权：Bearer API Key。
- 创建：`POST /api/v3/contents/generations/tasks`。
- 查询：`GET /api/v3/contents/generations/tasks/{{taskId}}`。
- 取消：`DELETE /api/v3/contents/generations/tasks/{{taskId}}`。
- 轮询：声明为分离式轮询，任务 worker 释放后由调度器继续查询；取消后通过查询接口确认终态。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | 火山方舟 API Key。 |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 官方字段 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | Seedance 2.5 模型 ID 或 Endpoint ID。 |
| `prompt` | string | 否 | `content[type=text].text` | 视频提示词；可与图片、视频或音频单独组合。 |
| `images` | media[] | 否 | `content[type=image_url]` | 保留 `first_frame`、`last_frame`、`reference_image` 等 role。 |
| `videos` | media[] | 否 | `content[type=video_url]` | 统一映射为 `reference_video`。 |
| `audios` | media[] | 否 | `content[type=audio_url]` | 统一映射为 `reference_audio`，Seedance 2.5 支持单独传入。 |
| `aspectRatio` | string | 否 | `ratio` | 默认 `adaptive`。 |
| `resolution` | string | 否 | `resolution` | 默认 `720p`，支持 480p/720p/1080p。 |
| `duration` | integer | 否 | `duration` | 默认 `-1`，由模型选择时长；显式时长为 4–30 秒。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成有声视频。 |
| `watermark` | boolean | 否 | `watermark` | 是否添加 AI 生成水印。 |

## Seedance 2.5 扩展参数

以下字段位于 `providerOptions.volcengine-ark-seedance-25` 命名空间：

| 字段 | 类型 | 官方字段 | 说明 |
| --- | --- | --- | --- |
| `omni_reference_task_type` | string | `omni_reference_task_type` | `auto`、`reference`、`edit` 或 `extend`。 |
| `output_format` | string | `output_format` | `mp4` 或 `mov`。 |
| `return_last_frame` | boolean | `return_last_frame` | 是否返回生成视频尾帧。 |
| `draft` | boolean | `draft` | 是否生成 480p 样片。 |
| `priority` | integer | `priority` | 任务优先级。 |
| `execution_expires_after` | integer | `execution_expires_after` | 任务过期秒数。 |
| `safety_identifier` | string | `safety_identifier` | 终端用户标识哈希。 |

不提供 `body` / `extra_body` 任意覆盖；传入这两个参数或 Seedance 2.5 不支持的 `seed`、`camera_fixed`、`frames`、`service_tier` 时拒绝请求。

## 请求映射

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `POST` |
| `create.path` | `/api/v3/contents/generations/tasks` |
| `create.contentType` | `application/json` |
| `create.body.model` | `request.model` |
| `create.body.content` | 文本（若非空）+ 按顺序排列的图片、视频、音频内容块 |
| `create.body.ratio` | 显式 edit/extend 固定为 `adaptive`；其他任务使用 `request.aspectRatio`，缺省为 `adaptive` |
| `create.body.resolution` | `request.resolution`，缺省为 `720p` |
| `create.body.duration` | 显式 edit 固定为 `-1`；其他任务 `request.duration > 0` 时使用请求值，否则为 `-1` |
| `create.body.generate_audio` | `request.generateAudio` |
| `create.body.watermark` | `request.watermark` |
| `create.body.*` | 由 `providerOptions.volcengine-ark-seedance-25` 透传的扩展字段 |
| `poll.path` | `/api/v3/contents/generations/tasks/{{taskId}}` |
| `cancel.path` | `/api/v3/contents/generations/tasks/{{taskId}}` |

## 输入约束

- 最多 30 张参考图片、10 个参考视频、10 个参考音频。
- 参考视频和音频的公网地址或 `asset://` 素材 ID由宿主提供；插件不上传素材，也不把本地路径放进请求。
- 首帧和尾帧最多各一张，尾帧必须同时提供首帧。首尾帧不得与普通参考图、视频或音频混用；首尾帧请求显式填写非 `adaptive` 比例时拒绝请求。
- 显式 `omni_reference_task_type=edit/extend` 必须有参考视频，插件将比例固定为 `adaptive`；`edit` 同时将输出时长固定为 `-1`，覆盖宿主传入的比例/时长。`auto` 的任务类型由模型判定，上游仍可能因实际任务不符合参数限制而报错。
- `draft=true` 必须同时选择 `resolution=480p`。视频和音频各自总时长均不得超过 30 秒；媒体格式、大小、实际时长及模型判定由上游继续校验。
- 插件允许纯音频请求，因为 Seedance 2.5 官方支持该组合；Seedance 2.0 应继续使用 `volcengine-ark-seedance` 旧版插件。

## 响应映射

创建和查询响应均支持以下字段：

| 统一结果 | 上游路径 |
| --- | --- |
| `taskId` | `id`、`task_id` 或 `data.id` |
| `status` | `status` 或 `data.status` |
| `message` | `error.message`、`error`、`message` 或 `fail_reason` |
| `videos` | `content.video_url`、`content.file_url`、`video_url`、`output.video_url`、`data.video_url` 或 `url` |
| `images` | `content.last_frame_url` 或 `last_frame_url` |
| `usage` | `usage` |

`content.video_url`、`content.last_frame_url` 等地址标记为临时媒体，由宿主下载并持久化。`queued`、`running`、`succeeded`、`failed`、`expired`、`cancelled` 按统一状态规范解析；`error.code` 非零时任务强制判定失败。

## 官方资料

- [创建视频生成任务](https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api)
- [查询视频生成任务](https://ark.volcengine.com/region:cn-beijing/docs/get-video-generation-task-api)
- [取消或删除视频生成任务](https://ark.volcengine.com/region:cn-beijing/docs/cancel-or-delete-video-generation-tasks-api)
- [Seedance 2.5 使用说明](https://ark.volcengine.com/region:cn-beijing/docs/seedance-2-5)

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-ark-seedance-25",
  "name": "Volcengine Ark Seedance 2.5",
  "version": "1.0.0",
  "author": "Volcengine / 影策",
  "description": "火山方舟 Seedance 2.5 官方视频请求协议插件。",
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
        "id": "volcengine-ark-seedance-25",
        "label": "Volcengine Ark Seedance 2.5",
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
        "baseUrl": "https://ark.cn-beijing.volces.com",
        "requiresPublicMediaUrls": true,
        "detachedPolling": true,
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
            "description": "Seedance 2.5 模型 ID 或 Endpoint ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "content[type=text].text",
            "description": "视频提示词，纯音频或纯素材任务可以省略。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=image_url]",
            "description": "最多 30 张，保留 first_frame、last_frame、reference_image role。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=video_url]",
            "description": "最多 10 个，role 固定为 reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=audio_url]",
            "description": "最多 10 个，role 固定为 reference_audio；Seedance 2.5 支持单独传入。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "输出画幅，缺省使用 adaptive。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "输出分辨率，缺省使用 720p。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "输出秒数；缺省发送 -1 由模型选择。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成有声视频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "是否添加 AI 生成水印。"
          },
          {
            "name": "omni_reference_task_type",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.omni_reference_task_type",
            "description": "全模态任务类型：auto、reference、edit 或 extend。"
          },
          {
            "name": "output_format",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.output_format",
            "description": "Seedance 2.5 输出格式：mp4 或 mov。"
          },
          {
            "name": "return_last_frame",
            "type": "boolean",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.return_last_frame",
            "description": "是否返回生成视频尾帧。"
          },
          {
            "name": "draft",
            "type": "boolean",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.draft",
            "description": "是否生成 480p 样片。"
          },
          {
            "name": "priority",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.priority",
            "description": "同一 Endpoint 内的任务优先级。"
          },
          {
            "name": "execution_expires_after",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.execution_expires_after",
            "description": "任务过期阈值，单位秒。"
          },
          {
            "name": "safety_identifier",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.volcengine-ark-seedance-25.safety_identifier",
            "description": "终端用户标识哈希。"
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
                30
              ]
            },
            "message": "Seedance 2.5 最多支持 30 张参考图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "Seedance 2.5 最多支持 10 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "Seedance 2.5 最多支持 10 个参考音频"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                    },
                    "edit"
                  ]
                },
                {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.duration"
                        },
                        0
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.duration"
                        },
                        -1
                      ]
                    },
                    {
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
                            30
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "Seedance 2.5 时长应为 -1 或 4-30 秒"
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
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              "reference_image"
                            ]
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
            "message": "Seedance 2.5 最多一个首帧"
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
                      "as": "media",
                      "where": {
                        "$eq": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              "reference_image"
                            ]
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
            "message": "Seedance 2.5 最多一个尾帧"
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
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$coalesce": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
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
                          "as": "media",
                          "where": {
                            "$eq": [
                              {
                                "$coalesce": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
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
            "message": "Seedance 2.5 尾帧必须同时提供首帧"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$add": [
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
                                "$coalesce": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
                              },
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
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
                                "$coalesce": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
                              },
                              "last_frame"
                            ]
                          }
                        }
                      }
                    },
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
                                "$coalesce": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "reference_image"
                                ]
                              },
                              "reference_image"
                            ]
                          }
                        }
                      }
                    }
                  ]
                },
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                }
              ]
            },
            "message": "Seedance 2.5 图片 role 仅支持 first_frame、last_frame、reference_image"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$gt": [
                      {
                        "$add": [
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
                                      "$coalesce": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "reference_image"
                                      ]
                                    },
                                    "first_frame"
                                  ]
                                }
                              }
                            }
                          },
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
                                      "$coalesce": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "reference_image"
                                      ]
                                    },
                                    "last_frame"
                                  ]
                                }
                              }
                            }
                          }
                        ]
                      },
                      0
                    ]
                  }
                },
                {
                  "$and": [
                    {
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
                                    "$coalesce": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "reference_image"
                                    ]
                                  },
                                  "reference_image"
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
                }
              ]
            },
            "message": "Seedance 2.5 首尾帧不能与全模态参考混用"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$gt": [
                      {
                        "$add": [
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
                                      "$coalesce": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "reference_image"
                                      ]
                                    },
                                    "first_frame"
                                  ]
                                }
                              }
                            }
                          },
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
                                      "$coalesce": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "reference_image"
                                      ]
                                    },
                                    "last_frame"
                                  ]
                                }
                              }
                            }
                          }
                        ]
                      },
                      0
                    ]
                  }
                },
                {
                  "$eq": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.aspectRatio"
                        },
                        "adaptive"
                      ]
                    },
                    "adaptive"
                  ]
                }
              ]
            },
            "message": "Seedance 2.5 首尾帧仅支持 adaptive 比例"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                          },
                          "edit"
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                          },
                          "extend"
                        ]
                      }
                    ]
                  }
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
                }
              ]
            },
            "message": "Seedance 2.5 edit/extend 必须提供参考视频"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                    },
                    "auto"
                  ]
                },
                [
                  "auto",
                  "reference",
                  "edit",
                  "extend"
                ]
              ]
            },
            "message": "Seedance 2.5 任务类型必须为 auto/reference/edit/extend"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.body"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 body"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.seed"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 seed"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.extra_body"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 extra_body"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.service_tier"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 service_tier"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.frames"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 frames"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.providerOptions.volcengine-ark-seedance-25.camera_fixed"
                },
                null
              ]
            },
            "message": "Seedance 2.5 不支持扩展参数 camera_fixed"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v3/contents/generations/tasks",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
              "$concatArrays": [
                {
                  "$if": {
                    "condition": {
                      "$gt": [
                        {
                          "$len": {
                            "$ref": "request.prompt"
                          }
                        },
                        0
                      ]
                    },
                    "then": [
                      {
                        "type": "text",
                        "text": {
                          "$ref": "request.prompt"
                        }
                      }
                    ],
                    "else": []
                  }
                },
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
                      "role": "reference_video"
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
                      "role": "reference_audio"
                    }
                  }
                }
              ]
            },
            "ratio": {
              "$if": {
                "condition": {
                  "$or": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                        },
                        "edit"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                        },
                        "extend"
                      ]
                    }
                  ]
                },
                "then": "adaptive",
                "else": {
                  "$coalesce": [
                    {
                      "$ref": "request.aspectRatio"
                    },
                    "adaptive"
                  ]
                }
              }
            },
            "resolution": {
              "$coalesce": [
                {
                  "$ref": "request.resolution"
                },
                "720p"
              ]
            },
            "duration": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
                    },
                    "edit"
                  ]
                },
                "then": -1,
                "else": {
                  "$if": {
                    "condition": {
                      "$gt": [
                        {
                          "$ref": "request.duration"
                        },
                        0
                      ]
                    },
                    "then": {
                      "$ref": "request.duration"
                    },
                    "else": -1
                  }
                }
              }
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "watermark": {
              "$ref": "request.watermark"
            },
            "omni_reference_task_type": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.omni_reference_task_type"
              }
            },
            "output_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.output_format"
              }
            },
            "return_last_frame": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.return_last_frame"
              }
            },
            "draft": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.draft"
              }
            },
            "priority": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.priority"
              }
            },
            "execution_expires_after": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.execution_expires_after"
              }
            },
            "safety_identifier": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-seedance-25.safety_identifier"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v3/contents/generations/tasks/{{taskId}}"
        },
        "cancel": {
          "method": "DELETE",
          "path": "/api/v3/contents/generations/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.data.status"
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
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.content.video_url"
              },
              {
                "$ref": "response.content.file_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.output.video_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.url"
              }
            ]
          },
          "images": {
            "$coalesce": [
              {
                "$ref": "response.content.last_frame_url"
              },
              {
                "$ref": "response.last_frame_url"
              }
            ]
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
