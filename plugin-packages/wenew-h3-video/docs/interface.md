# WeNew API H3 Video 接口字段

## 协议身份与依据

- 插件和 Provider ID：`wenew-h3-video`；能力：`video`。
- Base URL：`https://ai.seekthex.com`。
- 鉴权：`Authorization: Bearer <API Key>`；配置字段 `apiKey` 为必填 secret。
- 创建：`POST /api/v1/tasks`；查询：`GET /api/v1/tasks/{task_id}`，均使用域名根路径。
- 产品固定为 `h3_video`，不能通过扩展参数切换其他计费产品。

合同依据：[官方文档](https://ai.seekthex.com/docs/)、该页面引用的[完整客户端文档数据](https://ai.seekthex.com/_next/static/chunks/2-u4xwfozc01d.js)。以下使用专业任务接口，不混用 OpenAI 或 Sora 格式。

## 统一字段映射

| 统一字段 | 上游字段 | 约束与默认值 |
| --- | --- | --- |
| `model` | 不发给上游 | 影策模型显示名；上游 `product` 固定 `h3_video`。 |
| `prompt` | `params.prompt` | 必填原始提示词。参考素材按顺序使用 `<Picture N>`、`<Audio N>`。 |
| `images` | `inputs.images` 或 `inputs.first_frame` / `inputs.last_frame` | 按 order 排序；普通图片作为参考图。首尾帧角色映射成独立对象，各最多1张。 |
| `audios` | `inputs.audios` | 最多3段，至少搭配1张参考图；每段2–15秒、合计≤15秒。 |
| `duration` | `params.seconds` | 4–15秒整数，未指定时5秒。 |
| `aspectRatio` | `params.ratio` | `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`，默认 `16:9`。 |
| `resolution` | `params.quality` | `768p` / `1080p`，去除外围空格并转小写，默认 `768p`。 |
| `providerOptions.wenew-h3-video.callback_url` | 顶层 `callback_url` | 可选公网 HTTPS 回调地址，≤2048字符；由上游校验地址并投递签名通知。 |
| `providerOptions.wenew-h3-video.params.seed` | `params.seed` | 可选整数0–9007199254740991；省略时平台生成，0保留。 |
| `providerOptions.wenew-h3-video.params.martial_arts` | `params.martial_arts` | 可选布尔值，动态优化，不影响价格。 |
| `providerOptions.wenew-h3-video.params.motion_speed` | `params.motion_speed` | 可选数值-8至8、步长0.5；仅 `martial_arts=true` 时允许，0保留。 |

H3 固定输出带声音的 MP4（H.264 + AAC，24帧/秒），没有 `params.audio` 或生成声音开关。统一请求中的 `generateAudio` 不写入上游请求。

## 素材模式与校验

文生视频不发送 `inputs`。参考生成发送 `inputs.images` / `inputs.audios`，最多9张图、3段音频，音频不能单独生成。首尾帧模式发送独立的 `inputs.first_frame` / `inputs.last_frame`，可只传其中之一；不能与参考图片、参考音频混用。

插件把统一素材的公网地址映射为 `{ "url": "https://…" }`，不会向上游发送 `role` 或 `metadata`。宿主负责统一素材地址解析与公网可访问性检查。已知的 `metadata.durationMs` 会在本地校验单段2–15秒和合计≤15秒；未提供时长的素材仍由上游读取真实媒体并最终校验。图片格式 JPG/PNG/WebP、每张<100 MB；音频格式 MP3/WAV/M4A/AAC/FLAC、每段≤50 MB，由上游校验实际文件。

官方 API 的每个素材对象支持 `url`、`upload_id`、`file_id` 三选一。此插件当前仅提供公网 URL 映射，不提供手工上传流程或 ID 透传。`providerOptions` 只接受 `callback_url` 和白名单 `params`；拒绝 `inputs`、`product`、`body`、`extra_body` 及未知字段，防止覆盖模型或绕过时长、画质校验。`params` 不得覆盖 `prompt`、`quality`、`ratio`、`seconds` 等统一字段。

参考生成请求示例：

```json
{
  "product": "h3_video",
  "params": {"prompt": "<Picture 1>中的人物说话，<Audio 1>作为旁白", "quality": "1080p", "ratio": "16:9", "seconds": 6, "seed": 0},
  "inputs": {
    "images": [{"url": "https://cdn.example/hero.png"}],
    "audios": [{"url": "https://cdn.example/voice.mp3"}]
  },
  "callback_url": "https://callback.example/wenew"
}
```

首尾帧请求示例：

```json
{
  "product": "h3_video",
  "params": {"prompt": "从清晨过渡到日落", "quality": "768p", "ratio": "16:9", "seconds": 5},
  "inputs": {
    "first_frame": {"url": "https://cdn.example/first.png"},
    "last_frame": {"url": "https://cdn.example/last.png"}
  }
}
```

## 响应、轮询与结果保存

| 统一结果 | 官方字段 |
| --- | --- |
| `taskId` | `id`；查询时可沿用已有任务ID。 |
| `status` | `status`：`queued`、`processing`、`succeeded`、`failed`、`canceled`。 |
| `message` | `error.message`。 |
| `videos` | `result.download_url`。 |
| `usage` | `billing`。 |

创建返回202仅表示已受理；每5–10秒查询一次，成功状态为 `succeeded`。下载链接来自 `result.download_url`，每次查询重新签发，`result.expires_at` 为该链接到期时间；结果在任务完成后保留24小时，实际删除时间以 `result.retained_until` 为准。插件标记结果为临时资源，宿主需及时下载并持久化。没有 `video_url` 字段假设。

失败任务读取 `error.code` 和 `error.message`；HTTP非2xx保留错误语义。回调只是通知，最终状态以查询为准。官方不提供用户/API取消接口，也不提供创建幂等保护；已返回任务ID应继续查询，创建超时须先在官方任务列表核实，避免重复计费。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "wenew-h3-video",
  "name": "WeNew API H3 Video",
  "version": "1.0.0",
  "author": "WeNew API / 影策",
  "description": "适配 WeNew API MiniMax H3 视频任务接口的声明式协议插件。",
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
        "id": "wenew-h3-video",
        "videoReferences": {
          "layout": "inputs-images",
          "token": "<Picture {n}>"
        },
        "label": "WeNew API H3 Video",
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
        "baseUrl": "https://ai.seekthex.com",
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
            "description": "影策中的模型显示名；请求产品固定为 h3_video。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "params.prompt",
            "description": "H3 视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "inputs.images / inputs.first_frame / inputs.last_frame",
            "description": "最多9张公网参考图；first_frame/last_frame角色映射独立对象，不能与参考图或音频混用。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "inputs.audios",
            "description": "最多3段公网音频，需至少1张参考图；每段2–15秒、合计不超过15秒。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "params.seconds",
            "description": "4-15 秒，缺省 5 秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "params.ratio",
            "description": "21:9、16:9、4:3、1:1、3:4或9:16；缺省16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "params.quality",
            "description": "768p或1080p，忽略大小写并输出小写，缺省768p。"
          },
          {
            "name": "callback_url",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.wenew-h3-video.callback_url",
            "description": "顶层callback_url：公网HTTPS回调地址，最多2048字符。"
          },
          {
            "name": "params",
            "type": "object",
            "required": false,
            "mapping": "providerOptions.wenew-h3-video.params",
            "description": "仅允许seed（0–9007199254740991整数）、martial_arts（布尔）和motion_speed（-8至8、步长0.5，需martial_arts=true）。"
          }
        ],
        "validations": [
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
                9
              ]
            },
            "message": "H3 最多支持9张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$sortByOrder": {
                      "$ref": "request.audios"
                    }
                  }
                },
                3
              ]
            },
            "message": "H3 最多支持3段参考音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "H3 当前不接受参考视频"
          },
          {
            "assert": {
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
                  "$in": [
                    {
                      "$ref": "request.duration"
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
                }
              ]
            },
            "message": "H3 视频时长应为4-15秒整数"
          },
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$trim": {
                      "$coalesce": [
                        {
                          "$ref": "request.resolution"
                        },
                        "768p"
                      ]
                    }
                  }
                },
                [
                  "768p",
                  "1080p"
                ]
              ]
            },
            "message": "H3 画质只支持768p或1080p"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$trim": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    "16:9"
                  ]
                },
                [
                  "21:9",
                  "16:9",
                  "4:3",
                  "1:1",
                  "3:4",
                  "9:16"
                ]
              ]
            },
            "message": "H3 不支持该画幅比例"
          },
          {
            "assert": {
              "$and": [
                {
                  "$lte": [
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
                              "first_frame"
                            ]
                          }
                        }
                      }
                    },
                    1
                  ]
                },
                {
                  "$lte": [
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
                              "last_frame"
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
            "message": "H3 首帧和尾帧各最多1张"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$add": [
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
                },
                {
                  "$eq": [
                    {
                      "$add": [
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
                                "$and": [
                                  {
                                    "$ne": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "first_frame"
                                    ]
                                  },
                                  {
                                    "$ne": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      "last_frame"
                                    ]
                                  }
                                ]
                              }
                            }
                          }
                        },
                        {
                          "$len": {
                            "$sortByOrder": {
                              "$ref": "request.audios"
                            }
                          }
                        }
                      ]
                    },
                    0
                  ]
                }
              ]
            },
            "message": "H3 首尾帧不能与参考图片或音频混用"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$gte": [
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
                            "$and": [
                              {
                                "$ne": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "first_frame"
                                ]
                              },
                              {
                                "$ne": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "last_frame"
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
            "message": "H3 参考音频至少需要1张参考图片"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
                        }
                      },
                      "as": "media",
                      "where": {
                        "$and": [
                          {
                            "$ne": [
                              {
                                "$ref": "media.metadata.durationMs"
                              },
                              null
                            ]
                          },
                          {
                            "$or": [
                              {
                                "$lt": [
                                  {
                                    "$ref": "media.metadata.durationMs"
                                  },
                                  2000
                                ]
                              },
                              {
                                "$gt": [
                                  {
                                    "$ref": "media.metadata.durationMs"
                                  },
                                  15000
                                ]
                              }
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
            "message": "H3 每段参考音频应为2-15秒"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$add": [
                    {
                      "$at": [
                        {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.audios"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.metadata.durationMs"
                            }
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$at": [
                        {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.audios"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.metadata.durationMs"
                            }
                          }
                        },
                        1
                      ]
                    },
                    {
                      "$at": [
                        {
                          "$map": {
                            "from": {
                              "$sortByOrder": {
                                "$ref": "request.audios"
                              }
                            },
                            "as": "media",
                            "in": {
                              "$ref": "media.metadata.durationMs"
                            }
                          }
                        },
                        2
                      ]
                    }
                  ]
                },
                15000
              ]
            },
            "message": "H3 参考音频合计不能超过15秒"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.providerOptions.wenew-h3-video"
                  }
                },
                {
                  "$add": [
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.params"
                            },
                            null
                          ]
                        },
                        "then": 1,
                        "else": 0
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.callback_url"
                            },
                            null
                          ]
                        },
                        "then": 1,
                        "else": 0
                      }
                    }
                  ]
                }
              ]
            },
            "message": "H3 不支持product、body、extra_body、inputs或未知覆盖字段"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.providerOptions.wenew-h3-video.params"
                  }
                },
                {
                  "$add": [
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                            },
                            null
                          ]
                        },
                        "then": 1,
                        "else": 0
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.params.martial_arts"
                            },
                            null
                          ]
                        },
                        "then": 1,
                        "else": 0
                      }
                    },
                    {
                      "$if": {
                        "condition": {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                            },
                            null
                          ]
                        },
                        "then": 1,
                        "else": 0
                      }
                    }
                  ]
                }
              ]
            },
            "message": "H3 params仅支持seed、martial_arts和motion_speed，不能覆盖计费参数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                        },
                        {
                          "$toInt": {
                            "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                          }
                        }
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.seed"
                        },
                        9007199254740991
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "H3 seed应为0–9007199254740991整数"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.wenew-h3-video.params.martial_arts"
                    },
                    null
                  ]
                },
                {
                  "$in": [
                    {
                      "$ref": "request.providerOptions.wenew-h3-video.params.martial_arts"
                    },
                    [
                      true,
                      false
                    ]
                  ]
                }
              ]
            },
            "message": "H3 martial_arts应为布尔值"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                    },
                    null
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.martial_arts"
                        },
                        true
                      ]
                    },
                    {
                      "$gte": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                        },
                        -8
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                        },
                        8
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                        },
                        {
                          "$ceilStep": [
                            {
                              "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
                            },
                            0.5
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "H3 motion_speed应为-8至8、步长0.5，且martial_arts=true"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/tasks",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "product": "h3_video",
            "params": {
              "prompt": {
                "$ref": "request.prompt"
              },
              "quality": {
                "$lower": {
                  "$trim": {
                    "$coalesce": [
                      {
                        "$ref": "request.resolution"
                      },
                      "768p"
                    ]
                  }
                }
              },
              "ratio": {
                "$coalesce": [
                  {
                    "$trim": {
                      "$ref": "request.aspectRatio"
                    }
                  },
                  "16:9"
                ]
              },
              "seconds": {
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
                  "else": 5
                }
              },
              "seed": {
                "$ref": "request.providerOptions.wenew-h3-video.params.seed"
              },
              "martial_arts": {
                "$ref": "request.providerOptions.wenew-h3-video.params.martial_arts"
              },
              "motion_speed": {
                "$ref": "request.providerOptions.wenew-h3-video.params.motion_speed"
              }
            },
            "callback_url": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.wenew-h3-video.callback_url"
              }
            },
            "inputs": {
              "$omitEmpty": {
                "images": {
                  "$omitEmpty": {
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
                            "$and": [
                              {
                                "$ne": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "first_frame"
                                ]
                              },
                              {
                                "$ne": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "last_frame"
                                ]
                              }
                            ]
                          }
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
                "audios": {
                  "$omitEmpty": {
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
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
                "first_frame": {
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
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "first_frame"
                            ]
                          }
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
                "last_frame": {
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
                            "$eq": [
                              {
                                "$ref": "media.role"
                              },
                              "last_frame"
                            ]
                          }
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
                }
              }
            }
          }
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
                "$ref": "response.id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$ref": "response.status"
          },
          "message": {
            "$ref": "response.error.message"
          },
          "videos": {
            "$ref": "response.result.download_url"
          },
          "usage": {
            "$ref": "response.billing"
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
