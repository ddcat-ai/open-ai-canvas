# WAN 3.0 拼车中转接口字段

## 协议身份

- 插件 ID：`coolhs-wan3-relay`。
- Provider ID：`coolhs-wan3-relay`。
- 能力：`video`。
- 默认 Base URL：`https://wan.coolhs.com`（所有路径按站点根路径拼接）。
- 鉴权驱动：`header`，卡密写入请求头 `X-Wan-Card`，不进入 URL 或查询参数。
- 所有请求固定带浏览器形态的 `User-Agent`，否则站点前置的 Cloudflare 会以 1010 拒绝；渠道自定义请求头可覆盖。
- 素材上传：`POST /api/portal/media`（multipart，字段 `file` + `kind`，不带 token）。
- 创建：`POST /api/portal/jobs`。
- 查询：`GET /api/portal/jobs/{taskId}`。
- 取消：`DELETE /api/portal/jobs/{taskId}`（仅候车阶段有效）。
- 结果下载兜底：`GET /api/portal/jobs/{taskId}/video`（查询结果没有 `videoUrl` 时使用）。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | 中转站卡密（次数卡 / 积分卡 / 专车卡） |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `prompt` | string | 否 | `prompt` | 提示词，最多 20000 字符；用文字“参考图1”“图片1”等指代参考素材。 |
| `images` | media[] | 否 | `media[] kind=image` | 先上传拿素材 ID；普通参考图 `role=ref`，首帧 `first`、尾帧 `last`。最多 10 张，首尾帧不能与参考图混用。 |
| `videos` | media[] | 否 | `media[] kind=video` | 参考视频最多 5 段、合计 ≤15 秒，参考秒数 + 成片秒数 ≤30。 |
| `audios` | media[] | 否 | `media[] kind=audio` | 参考音频最多 5 段、合计 ≤15 秒。 |
| `duration` | integer | 否 | `duration` | 2-30 秒；未指定时传 `-1`（自动）。 |
| `aspectRatio` | string | 否 | `ratio` | `adaptive` `21:9` `16:9` `4:3` `1:1` `3:4` `9:16`；未指定时由上游自适应。 |
| `resolution` | string | 否 | `resolution` | `480P` `720P` `1080P`，统一转大写。 |
| `generateAudio` | boolean | 否 | `audio` | 是否同时生成对白与音效。 |
| `providerOptions` | object | 否 | `promptExtend / audio` | 命名空间 `coolhs-wan3-relay`：`promptExtend`（-1/0/1）覆盖扩写开关，`audio` 覆盖出声开关。 |

## 请求细节

- `id`：宿主幂等键（每次路由尝试稳定的 UUID）。中转站按 `id` 去重，内容一致时幂等返回、不重复扣费，因此插件声明 `idempotentCreate`，create 遇到 429 / 5xx 时最多重试 3 次。
- `copies` 固定为 1：一条任务对应一个平台任务和一个成片，多版本由平台多次提交。
- `promptExtend`：带任何参考素材时为 `0`（官方扩写会稀释“参考图1 的人物”这类约束），纯文生视频为 `-1`。
- 参考素材只走上传：宿主在交单前读取平台存储里的文件字节（不签发临时访问地址），逐个 `POST /api/portal/media` 上传，`media[].id` 只引用上传返回的素材 ID，不传任何 URL。任务可能候车数小时，临时地址届时早已失效；有素材没拿到上传 ID 时直接拒绝交单。恢复回查不会重复上传。
- `media[].token`：
  - 图片名称含“参考图”（短剧流水线的“参考图N”）时原样作为 token，与提示词里的文字一一对应；
  - 其他图片按序号写 `图片N`，对应画布提示词中的 `@图片N`；
  - 视频、音频分别写 `视频N`、`音频N`。
- 上传文件名按 `kind-序号.扩展名` 生成，不带中文，避免终端编码问题。

## 响应映射

| 映射位置 | 上游路径 | 说明 |
| --- | --- | --- |
| `response.taskId` | `id` / `job.id` / `jobs[0].id`，兜底为提交时的幂等键 | 上游任务 ID 即交单时的 `id`。 |
| `response.status` | `wait.phase` | `done` → 成功，`failed` → 失败，`cancelled` → 已取消，`running` → 生成中，`boarding` / `queued` 与其他值 → 排队中。不使用 `status` 字段判断进度。 |
| `response.stage` | `wait.label` + `wait.ahead` | 展示为“候车 · 前面 N 条”，写入任务进度文案。 |
| `response.queueAhead` | `wait.ahead` | 前面的条数，宿主据此决定下次回查间隔。 |
| `response.message` | `wait.detail` / `detail` / `error.message` | 中文可读失败原因，原样展示。 |
| `response.videos` | `videoUrl`（仅 `wait.phase=done`） | 成片链接 24 小时有效，标记为临时地址，宿主立即下载转存。 |
| 上传 `id` | `id` / `media.id` / `data.id` | 写入 `media.uploadId`，create 的 `media[].id` 引用它。 |

## 长排队与回查

- 提交成功后宿主立即保存上游任务 ID，把任务退回调度并释放 worker。
- 调度按排队位置回查原任务，不会重新上传或交单：前面 ≤20 条每 15 秒，21–100 条每 30 秒，101–500 条每 60 秒，超过 500 条每 2 分钟。任务进度显示上游阶段（候车、已发车、出片中），回查期间文案保持不变。
- 从首次领取起超过 48 小时仍未出片时，停止自动查询并把任务标记失败，提示到中转站确认原任务。

## 错误与边界

- 400 / 422 是参数或素材问题（边长 >8000、格式不支持、专车卡超限等），直接失败并展示 `detail`，不重试。
- 401 卡密无效，403 额度不足，409 `id` 冲突（内容不同）。
- 503“这班还没开 / 维护中”与 429 会在 create 阶段有限重试；仍失败时任务失败，可在班次开放后重试。
- 首尾帧与参考图互斥。短剧流水线的“尾帧续接”模式会把上一段尾帧当首帧、同时附角色参考图，这个渠道会拒绝，请改用“并行出片”。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "coolhs-wan3-relay",
  "name": "WAN 3.0 拼车中转（班次发车）",
  "version": "1.1.0",
  "author": "影策",
  "description": "WAN 3.0 拼车中转站 /api/portal 协议：素材先上传、交单进站候车、发车后出片，提交后释放执行位并按 15 秒间隔回查。",
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
        "label": "卡密",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "coolhs-wan3-relay",
        "label": "WAN 3.0 拼车中转",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://wan.coolhs.com",
        "detachedPolling": true,
        "idempotentCreate": true,
        "auth": {
          "type": "header",
          "header": "X-Wan-Card",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "prompt",
            "description": "提示词，最多 20000 字符；用“参考图1”“图片1”等文字指代参考素材。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "media[] kind=image",
            "description": "参考图（role=ref）或首帧/尾帧（role=first/last），最多 10 张；首尾帧不能与参考图混用。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "media[] kind=video",
            "description": "参考视频，最多 5 段，合计不超过 15 秒；参考秒数加成片秒数不超过 30。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "media[] kind=audio",
            "description": "参考音频，最多 5 段，合计不超过 15 秒。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "成片秒数 2-30；未指定时传 -1 由模型自选。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "values": [
              "adaptive",
              "21:9",
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16"
            ],
            "description": "画幅；未指定时由上游按参考图自适应。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "values": [
              "480P",
              "720P",
              "1080P"
            ],
            "description": "清晰度；次数卡与分辨率无关，建议 1080P。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio",
            "description": "是否同时生成对白与音效。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "promptExtend / audio",
            "description": "命名空间 coolhs-wan3-relay：promptExtend（-1/0/1）覆盖扩写开关，audio 覆盖出声开关。"
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
                10
              ]
            },
            "message": "WAN 3.0 中转单条任务最多 10 张图片"
          },
          {
            "assert": {
              "$and": [
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    5
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    },
                    5
                  ]
                }
              ]
            },
            "message": "WAN 3.0 中转单条任务最多 5 段参考视频、5 段参考音频"
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
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "where": {
                              "$not": {
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
                        }
                      },
                      0
                    ]
                  }
                ]
              }
            },
            "message": "WAN 3.0 中转的首尾帧不能与参考图混用；短剧请在制作设置里选择“并行出片”"
          },
          {
            "assert": {
              "$or": [
                {
                  "$lte": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.duration"
                        },
                        2
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
            },
            "message": "WAN 3.0 中转成片时长必须是 2-30 秒"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.inputs"
                      },
                      "as": "media",
                      "where": {
                        "$not": {
                          "$ref": "media.uploadId"
                        }
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "WAN 3.0 中转的参考素材必须先上传到中转站再交单，不能直接传临时地址（排队期间会失效）"
          }
        ],
        "upload": {
          "kinds": [
            "image",
            "video",
            "audio"
          ],
          "method": "POST",
          "path": "/api/portal/media",
          "originPath": true,
          "contentType": "multipart/form-data",
          "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; YingCe/1.0)"
          },
          "body": {
            "kind": {
              "$ref": "media.kind"
            }
          },
          "files": [
            {
              "name": "file",
              "source": {
                "$ref": "media"
              },
              "filename": {
                "$concat": [
                  {
                    "$ref": "media.kind"
                  },
                  "-",
                  {
                    "$add": [
                      {
                        "$ref": "media.order"
                      },
                      1
                    ]
                  },
                  ".",
                  {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.mimeType"
                              },
                              "image/jpeg"
                            ]
                          },
                          "then": "jpg"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.mimeType"
                              },
                              "video/quicktime"
                            ]
                          },
                          "then": "mov"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.mimeType"
                              },
                              "audio/mpeg"
                            ]
                          },
                          "then": "mp3"
                        },
                        {
                          "when": {
                            "$in": [
                              {
                                "$ref": "media.mimeType"
                              },
                              [
                                "audio/wav",
                                "audio/x-wav",
                                "audio/wave"
                              ]
                            ]
                          },
                          "then": "wav"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "video"
                            ]
                          },
                          "then": "mp4"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "audio"
                            ]
                          },
                          "then": "mp3"
                        }
                      ],
                      "default": {
                        "$coalesce": [
                          {
                            "$at": [
                              {
                                "$split": [
                                  {
                                    "$ref": "media.mimeType"
                                  },
                                  "/"
                                ]
                              },
                              1
                            ]
                          },
                          "png"
                        ]
                      }
                    }
                  }
                ]
              }
            }
          ],
          "id": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.media.id"
              },
              {
                "$ref": "response.data.id"
              }
            ]
          }
        },
        "create": {
          "method": "POST",
          "path": "/api/portal/jobs",
          "originPath": true,
          "contentType": "application/json",
          "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; YingCe/1.0)"
          },
          "body": {
            "id": {
              "$ref": "request.extra.idempotencyKey"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "copies": 1,
            "ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$upper": {
                  "$ref": "request.resolution"
                }
              }
            },
            "duration": {
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
            },
            "audio": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.coolhs-wan3-relay.audio"
                },
                {
                  "$ref": "request.generateAudio"
                }
              ]
            },
            "promptExtend": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.coolhs-wan3-relay.promptExtend"
                },
                {
                  "$if": {
                    "condition": {
                      "$gt": [
                        {
                          "$len": {
                            "$ref": "request.inputs"
                          }
                        },
                        0
                      ]
                    },
                    "then": 0,
                    "else": -1
                  }
                }
              ]
            },
            "media": {
              "$map": {
                "from": {
                  "$ref": "request.inputs"
                },
                "as": "media",
                "in": {
                  "id": {
                    "$ref": "media.uploadId"
                  },
                  "kind": {
                    "$ref": "media.kind"
                  },
                  "token": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "video"
                            ]
                          },
                          "then": {
                            "$concat": [
                              "视频",
                              {
                                "$add": [
                                  {
                                    "$ref": "media.order"
                                  },
                                  1
                                ]
                              }
                            ]
                          }
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.kind"
                              },
                              "audio"
                            ]
                          },
                          "then": {
                            "$concat": [
                              "音频",
                              {
                                "$add": [
                                  {
                                    "$ref": "media.order"
                                  },
                                  1
                                ]
                              }
                            ]
                          }
                        },
                        {
                          "when": {
                            "$gt": [
                              {
                                "$len": {
                                  "$split": [
                                    {
                                      "$ref": "media.name"
                                    },
                                    "参考图"
                                  ]
                                }
                              },
                              1
                            ]
                          },
                          "then": {
                            "$ref": "media.name"
                          }
                        }
                      ],
                      "default": {
                        "$concat": [
                          "图片",
                          {
                            "$add": [
                              {
                                "$ref": "media.order"
                              },
                              1
                            ]
                          }
                        ]
                      }
                    }
                  },
                  "role": {
                    "$switch": {
                      "cases": [
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          },
                          "then": "first"
                        },
                        {
                          "when": {
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          },
                          "then": "last"
                        }
                      ],
                      "default": "ref"
                    }
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/portal/jobs/{{taskId}}",
          "originPath": true,
          "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; YingCe/1.0)"
          }
        },
        "cancel": {
          "method": "DELETE",
          "path": "/api/portal/jobs/{{taskId}}",
          "originPath": true,
          "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; YingCe/1.0)"
          }
        },
        "result": {
          "method": "GET",
          "path": "/api/portal/jobs/{{taskId}}/video",
          "originPath": true,
          "headers": {
            "User-Agent": "Mozilla/5.0 (compatible; YingCe/1.0)"
          }
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.id"
              },
              {
                "$ref": "response.job.id"
              },
              {
                "$ref": "response.jobs.0.id"
              },
              {
                "$ref": "taskId"
              },
              {
                "$ref": "request.extra.idempotencyKey"
              }
            ]
          },
          "status": {
            "$switch": {
              "cases": [
                {
                  "when": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.wait.phase"
                          },
                          {
                            "$ref": "response.job.wait.phase"
                          }
                        ]
                      },
                      "done"
                    ]
                  },
                  "then": "succeeded"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.wait.phase"
                          },
                          {
                            "$ref": "response.job.wait.phase"
                          }
                        ]
                      },
                      "failed"
                    ]
                  },
                  "then": "failed"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.wait.phase"
                          },
                          {
                            "$ref": "response.job.wait.phase"
                          }
                        ]
                      },
                      "cancelled"
                    ]
                  },
                  "then": "cancelled"
                },
                {
                  "when": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "response.wait.phase"
                          },
                          {
                            "$ref": "response.job.wait.phase"
                          }
                        ]
                      },
                      "running"
                    ]
                  },
                  "then": "processing"
                }
              ],
              "default": "pending"
            }
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.wait.detail"
              },
              {
                "$ref": "response.job.wait.detail"
              },
              {
                "$ref": "response.detail"
              },
              {
                "$ref": "response.error.message"
              }
            ]
          },
          "stage": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.wait.ahead"
                      },
                      {
                        "$ref": "response.job.wait.ahead"
                      },
                      0
                    ]
                  },
                  0
                ]
              },
              "then": {
                "$concat": [
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.wait.label"
                      },
                      {
                        "$ref": "response.job.wait.label"
                      },
                      "排队中"
                    ]
                  },
                  " · 前面 ",
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.wait.ahead"
                      },
                      {
                        "$ref": "response.job.wait.ahead"
                      }
                    ]
                  },
                  " 条"
                ]
              },
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.wait.label"
                  },
                  {
                    "$ref": "response.job.wait.label"
                  }
                ]
              }
            }
          },
          "videos": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$coalesce": [
                      {
                        "$ref": "response.wait.phase"
                      },
                      {
                        "$ref": "response.job.wait.phase"
                      }
                    ]
                  },
                  "done"
                ]
              },
              "then": {
                "$omitEmpty": {
                  "$coalesce": [
                    {
                      "$ref": "response.videoUrl"
                    },
                    {
                      "$ref": "response.job.videoUrl"
                    }
                  ]
                }
              },
              "else": null
            }
          },
          "resultEphemeral": true,
          "queueAhead": {
            "$coalesce": [
              {
                "$ref": "response.wait.ahead"
              },
              {
                "$ref": "response.job.wait.ahead"
              }
            ]
          }
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
