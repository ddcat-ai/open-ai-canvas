# SeedanceMINI1 接口

## 配置

- 插件 ID / Provider ID：`seedance-mini1`；显示名称：`SeedanceMINI1`。
- 能力：`video`；认证配置字段：`apiKey`。
- 服务地址在渠道连接配置中填写，插件不携带固定主机或平台名称。
- 请求统一使用 `Authorization: Bearer <API_KEY>`，密钥不进入插件包、URL 或 JSON 正文。
- 当前实现是独立的 `yingce.plugin/v2` 声明式插件，沿用宿主的计费、出站、轮询和媒体存储合同。

## 创建与参数

`POST /v1/videos`，`Content-Type: application/json`。发送 `Idempotency-Key`，使用宿主稳定的请求编号；相同编号的网络重试复用同一任务。拿到任务 ID 后只查询原任务，不重新创建。

| 统一参数 | 上游字段 | 规则 |
| --- | --- | --- |
| `model` | `model` | 原样发送渠道模型 ID；空值省略，由服务端选择默认渠道。 |
| `prompt` | `prompt` | 1-5000 字符，原样发送；`@Image1` / `@图1` 对应排序后的第一张参考图。 |
| `duration` | `seconds` | JSON 整数，3-15 秒；未指定时为 5 秒。 |
| `aspectRatio` | `size` | 16:9、9:16、1:1、4:3、3:4、21:9；默认 16:9。 |
| `resolution` | `enhance` | 720p、1080p、2k、4k；转小写，默认 720p。 |
| `images` | `reference_images` | 最多 9 张图片，按 `order` 排列，上传后发送 URL 数组。 |
| `providerOptions` | `face_mode` | `providerOptions.seedance-mini1.face_mode`，可选 off、split、sheet、sketch、virtual，默认 off。 |

参考音频、参考视频和提示词音频引用标记会在提交前报参数错误。插件不发送 `duration`、`aspect_ratio`、`audio`、`audio_urls`、`generate_audio` 或 `face_split` 等其他协议字段。

```json
{
  "prompt": "海边日落，镜头缓慢推进",
  "seconds": 5,
  "size": "16:9",
  "enhance": "720p",
  "face_mode": "off"
}
```

## 参考图上传

对输入图片逐张调用 `POST /v1/uploads/images`（multipart，字段 `image`），取 `data[0].url` 写入创建请求的 `reference_images`。宿主负责从 URL 或 data URL 读取图片，使用同一 API Key 上传；重复引用同一素材时复用本次上传结果。恢复已有视频任务时跳过上传和创建。

上传接口按服务合同处理图片，长边上限 1280 像素、体积上限 700 KB；该处理发生在上游，插件不在本地重新压缩。接受的素材格式为 JPG、PNG、WebP。

## 轮询、响应与结果

- 查询：`GET /v1/videos/{id}`；任务 ID 来自创建响应 `id`。
- 状态：`queued` 等待、`in_progress` 生成中、`completed` 成功、`failed` 失败。
- 阶段：读取 `stage`；排队位置读取 `queue_position`。
- 失败：保留 `error.message`，不自动重提已失败的视频任务；`error_code`、`retriable`、`suggestion` 等原始诊断信息仍保留在上游响应中。
- 成功：优先下载响应顶层 `url`；没有 URL 时调用 `GET /v1/videos/{id}/content`，返回视频二进制。
- 查询和下载使用与创建相同的 API Key。同源 URL 下载携带鉴权，跨源媒体链接沿用宿主规则，不转发渠道密钥。
- 宿主自动轮询、恢复已有任务并将成片持久化；轮询频率由宿主统一管理，插件不额外启动定时器。

请求的 `enhance` 只是目标档位；最终结果可能降级或保留原片。实际 `enhanced`、`width`、`height`、`enhance_note` 写入结果 usage；如上游返回实际 `duration`，记录为 `outputDurationSeconds`，不把请求 `seconds` 当成实际时长。

插件只实现视频生成链路，未声明取消、逐图诊断或图片生成操作。

## 打包

在仓库根目录嵌入完整文档：

```sh
node plugin-packages/embed-documentation.mjs seedance-mini1
```

在本插件目录生成发行包：

```sh
zip -X -q ../seedance-mini1.yingce-plugin manifest.json README.md docs/interface.md
```

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "seedance-mini1",
  "name": "SeedanceMINI1",
  "version": "1.0.0",
  "author": "影策",
  "description": "SeedanceMINI1 视频生成插件，支持参考图、清晰度增强与异步任务。",
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
        "id": "seedance-mini1",
        "label": "SeedanceMINI1",
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
        "idempotentCreate": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": false,
            "mapping": "model",
            "description": "渠道配置的模型 ID；省略时使用服务端默认模型。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "1-5000 字符的视频描述，支持 @Image1 或 @图1 引用按顺序排列的参考图。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "seconds",
            "description": "3-15 秒整数，未指定时为 5 秒。",
            "values": [
              "3",
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
            ]
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "画幅比例，默认 16:9。",
            "values": [
              "16:9",
              "9:16",
              "1:1",
              "4:3",
              "3:4",
              "21:9"
            ]
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "enhance",
            "description": "请求清晰度，默认 720p；最终档位以响应 enhanced 和真实宽高为准。",
            "values": [
              "720p",
              "1080p",
              "2k",
              "4k"
            ]
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "reference_images",
            "description": "最多 9 张参考图，上传后按输入 order 发送 URL 数组。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "face_mode",
            "description": "seedance-mini1 命名空间支持 face_mode：off、split、sheet、sketch、virtual，默认 off。"
          }
        ],
        "validations": [
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
                    5000
                  ]
                }
              ]
            },
            "message": "SeedanceMINI1 提示词应为 1-5000 字符"
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
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$ref": "request.duration"
                        },
                        3
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
                }
              ]
            },
            "message": "SeedanceMINI1 时长应为 3-15 秒整数"
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
                  "16:9",
                  "9:16",
                  "1:1",
                  "4:3",
                  "3:4",
                  "21:9"
                ]
              ]
            },
            "message": "SeedanceMINI1 仅支持 16:9、9:16、1:1、4:3、3:4、21:9 比例"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.resolution"
                        }
                      }
                    },
                    "720p"
                  ]
                },
                [
                  "720p",
                  "1080p",
                  "2k",
                  "4k"
                ]
              ]
            },
            "message": "SeedanceMINI1 清晰度应为 720p、1080p、2k 或 4k"
          },
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
            "message": "SeedanceMINI1 最多接收 9 张参考图"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$ref": "request.audios"
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
                }
              ]
            },
            "message": "SeedanceMINI1 仅接收图片参考，请移除参考音频和参考视频"
          },
          {
            "assert": {
              "$and": [
                {
                  "$eq": [
                    {
                      "$len": {
                        "$split": [
                          {
                            "$lower": {
                              "$ref": "request.prompt"
                            }
                          },
                          "@audio"
                        ]
                      }
                    },
                    1
                  ]
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$split": [
                          {
                            "$ref": "request.prompt"
                          },
                          "@音频"
                        ]
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "SeedanceMINI1 提示词请移除音频引用标记"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.providerOptions.seedance-mini1.face_mode"
                        }
                      }
                    },
                    "off"
                  ]
                },
                [
                  "off",
                  "split",
                  "sheet",
                  "sketch",
                  "virtual"
                ]
              ]
            },
            "message": "SeedanceMINI1 face_mode 应为 off、split、sheet、sketch 或 virtual"
          }
        ],
        "upload": {
          "kinds": [
            "image"
          ],
          "method": "POST",
          "path": "/v1/uploads/images",
          "contentType": "multipart/form-data",
          "files": [
            {
              "name": "image",
              "source": {
                "$ref": "media"
              },
              "filename": {
                "$coalesce": [
                  {
                    "$ref": "media.name"
                  },
                  "reference.png"
                ]
              }
            }
          ],
          "id": {
            "$ref": "response.data.0.url"
          }
        },
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$ref": "request.extra.idempotencyKey"
            }
          },
          "body": {
            "model": {
              "$omitEmpty": {
                "$ref": "request.model"
              }
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "seconds": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.duration"
                    },
                    0
                  ]
                },
                "then": 5,
                "else": {
                  "$ref": "request.duration"
                }
              }
            },
            "size": {
              "$coalesce": [
                {
                  "$trim": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "16:9"
              ]
            },
            "enhance": {
              "$coalesce": [
                {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.resolution"
                    }
                  }
                },
                "720p"
              ]
            },
            "reference_images": {
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
                        "$ref": "media.uploadId"
                      },
                      {
                        "$ref": "media.value"
                      }
                    ]
                  }
                }
              }
            },
            "face_mode": {
              "$coalesce": [
                {
                  "$lower": {
                    "$trim": {
                      "$ref": "request.providerOptions.seedance-mini1.face_mode"
                    }
                  }
                },
                "off"
              ]
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
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
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              "queued"
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
                "$ref": "response.suggestion"
              }
            ]
          },
          "stage": {
            "$ref": "response.stage"
          },
          "queueAhead": {
            "$ref": "response.queue_position"
          },
          "videos": {
            "$ref": "response.url"
          },
          "usage": {
            "$omitEmpty": {
              "outputDurationSeconds": {
                "$omitEmpty": {
                  "$ref": "response.duration"
                }
              },
              "width": {
                "$omitEmpty": {
                  "$ref": "response.width"
                }
              },
              "height": {
                "$omitEmpty": {
                  "$ref": "response.height"
                }
              },
              "enhanced": {
                "$ref": "response.enhanced"
              },
              "enhance_note": {
                "$ref": "response.enhance_note"
              }
            }
          },
          "errorPaths": [
            "error.message"
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
