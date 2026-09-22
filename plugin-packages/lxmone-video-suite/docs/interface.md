# 万有引力视频套件接口字段

## 协议身份

- 插件 ID：`lxmone-video-suite`。
- 能力：`video`。
- 默认 Base URL：`https://lxmone.xyz/v1`。
- 鉴权驱动：`bearer`。
- 创建接口：`POST /v1/videos` 或 `POST /v1/videos/generations`（按模型所属 provider 决定）。
- 查询接口：`GET /v1/videos/{{taskId}}` 或 `GET /v1/videos/generations/{{taskId}}`。
- 参考媒体要求公开可访问的 HTTPS URL（`requiresPublicMediaUrls`）。

以上形状来自中转站公开文档 `https://lxmone.xyz/docs/`：同一批模型的 `model`、`prompt`、时长、
分辨率与画幅字段名在不同渠道并不一致，因此按上游请求体拆成 8 个 provider，而不是一个通用协议。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | 万有引力中转站的 API Key，随请求发送 `Authorization: Bearer <apiKey>`。 |

## 统一字段映射

宿主向插件提交统一的视频生成请求，插件按 provider 映射到上游字段：

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID，透传，不做改名或别名。 |
| `prompt` | string | 是 | `prompt` / `input.prompt` | 视频提示词。 |
| `images` | media[] | 否 | `reference_images` / `images` / `image_url` / `input.media[]` / `input_reference` | 参考图；带 role 的 `first_frame`、`last_frame` 会落到支持首尾帧的 provider 专属字段。 |
| `videos` | media[] | 否 | `reference_videos` / `videos` / `input.media[]` | 参考视频。 |
| `audios` | media[] | 否 | `reference_audios` / `audio` / `audio_urls` / `input.media[]` | 参考音频。 |
| `duration` | integer | 否 | `seconds` / `duration` / `duration_seconds` | 时长秒数；缺省由各 provider 填默认值。 |
| `aspectRatio` | string | 否 | `aspect_ratio` / `parameters.ratio` | 画幅比例，默认 `16:9`。 |
| `resolution` | string | 否 | `resolution` / `size` / `parameters.resolution` | 分辨率档位；上游要求大写 `720P` 形式的 provider 会自动转换。 |
| `generateAudio` | boolean | 否 | `audio` / `generate_audio` | 是否生成或保留音频。 |

## 各 provider 的创建体

### `lxmone-wan-videos`（`wan3.0-video`、`wan3.0-video-prime`）

`POST /v1/videos`，顶层字段：`model`、`prompt`、`seconds`、`size`、`aspect_ratio`、
`reference_images[{url, role}]`、`reference_videos[]`、`reference_audios[]`、`prompt_extend`。

### `lxmone-wan-channel-s`（`wan3.0-video-s`、`wan3.0-video-prime-s`）

`POST /v1/videos`，`input.media[{type, url}]` 与 `input.prompt`，参数放在
`parameters{resolution, ratio, duration, audio, prompt_extend}`。

### `lxmone-seedance-videos`（`seedance-2-pro/fast/mini`、`seedance-2.5-pro`、`seedance2.0-a`~`f`、`seedance2.5-a`）

`POST /v1/videos`，字段：`model`、`prompt`、`duration_seconds`、`resolution`、`aspect_ratio`、
`reference_images[]`、`reference_videos[]`、`reference_audios[]`。

### `lxmone-h3-max-videos`（`minimax-h3-max`）

官方文档要求 H3 Max 走 `POST /v1/videos`（不要提交到 `/v1/videos/generations`，也要避开
`input_reference` 与 `audio` 这组独立工作流字段），字段为：`model`、`prompt`、`seconds`、
`resolution`、`aspect_ratio`、`reference_images[]`、`reference_videos[]`、`reference_audios[]`。
上游把客户端传入的 720p 映射为 768p，参考素材上限为图 / 视频 / 音频各 12 段。

### `lxmone-sd-videos`（`sd-2.0-a`、`sd-2.0-b`、`sd-2.0-c`、`sd-2.5-a`、`sd-2.5`）

`POST /v1/videos`，字段：`model`、`prompt`、`duration`、`resolution`、`aspect_ratio`、
`images[]`、`videos[]`、`audio[]`。

### `lxmone-sd-mini-videos`（`sd-mini`）

`POST /v1/videos`，字段：`model`、`prompt`、`seconds`、`resolution`、`aspect_ratio`、
`image_url`、`reference_image_urls[]`、`audio_urls[]`。

### `lxmone-grok-videos`（`grok-imagine-video`、`grok-imagine-video-1.5`、`grok-imagine-video-1.5S`）

`POST /v1/videos/generations`，字段：`model`、`prompt`、`duration`、`aspect_ratio`、`resolution`、
`generate_audio`，以及互斥的 `image{url}`（首帧）或 `reference_images[{url}]`（参考图）。

### `lxmone-h3-workflow`（`minimax-h3-a`~`minimax-h3-e`）

`POST /v1/videos/generations`，字段：`model`、`prompt`、`seconds`、`resolution`、`aspect_ratio`、
`input_reference[]`、`first_frame`、`last_frame`、`audio`。

## 响应与错误

创建成功后，插件从上游响应里按顺序取 `id`、`task_id`、`taskId`、`data.id` 得到统一 `taskId`，
轮询时按 `status`、`state`、`data.status` 取状态，`completed`/`succeeded` 归一为 `succeeded`，
`failed`/`expired`/`error` 归一为 `failed`，其余按进行中处理。

视频地址优先取 `metadata.direct_url`、`data.metadata.direct_url`，再按
`metadata.url`、`metadata.video_url`、`video_url`、`videoUrl`、`result_url`、`url`、
`data.metadata.url`、`data.video_url`、`output.url` 依次取值；上游返回的是临时地址
（`resultEphemeral`），由宿主立即下载并转存为项目资源。

H3 工作流完成响应可能同时包含相对路径 `metadata.url` 和完整 HTTPS 地址
`metadata.direct_url`，必须优先选择后者，避免把缺少主机的路径交给外部资源下载器。
下载仍执行宿主的地址与 SSRF 校验。

错误信息取 `error.message`、`message`、`fail_reason`，错误码路径为 `error.message` 与 `error.code`。
HTTP 失败、业务错误码或状态进入 `failed` 时，任务以失败结束并把上游原文回传给用户。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "lxmone-video-suite",
  "name": "万有引力视频套件",
  "version": "1.0.1",
  "author": "Yingce / 万有引力",
  "description": "万有引力（lxmone.xyz）视频协议套件：Wan 3.0（现有渠道与 S 渠道）、Seedance 2 / 2.5、SD 2.0 / 2.5 / Mini、Grok Imagine、MiniMax H3（Max 与 A-E 独立工作流）。",
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
        "id": "lxmone-wan-videos",
        "label": "万有引力 Wan 3.0 视频（现有渠道）",
        "description": "wan3.0-video / wan3.0-video-prime：POST /v1/videos，顶层 reference_images、reference_videos、reference_audios。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
                "else": 10
              }
            },
            "size": {
              "$coalesce": [
                {
                  "$upper": {
                    "$ref": "request.resolution"
                  }
                },
                "720P"
              ]
            },
            "aspect_ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
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
                    "url": {
                      "$ref": "media.value"
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
              }
            },
            "reference_videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "prompt_extend": false
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-wan-channel-s",
        "label": "万有引力 Wan 3.0 视频（S 渠道）",
        "description": "wan3.0-video-s / wan3.0-video-prime-s：POST /v1/videos，原生 input.media 与 parameters。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
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
                  "$concatArrays": [
                    {
                      "$map": {
                        "from": {
                          "$sortByOrder": {
                            "$ref": "request.images"
                          }
                        },
                        "as": "media",
                        "in": {
                          "type": {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              "reference_image"
                            ]
                          },
                          "url": {
                            "$ref": "media.value"
                          }
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
                          "type": "reference_video",
                          "url": {
                            "$ref": "media.value"
                          }
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
                          "type": "reference_audio",
                          "url": {
                            "$ref": "media.value"
                          }
                        }
                      }
                    }
                  ]
                }
              }
            },
            "parameters": {
              "resolution": {
                "$coalesce": [
                  {
                    "$upper": {
                      "$ref": "request.resolution"
                    }
                  },
                  "720P"
                ]
              },
              "ratio": {
                "$coalesce": [
                  {
                    "$ref": "request.aspectRatio"
                  },
                  "16:9"
                ]
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
                  "else": 5
                }
              },
              "audio": {
                "$ref": "request.generateAudio"
              },
              "prompt_extend": false
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-seedance-videos",
        "label": "万有引力 Seedance 视频",
        "description": "seedance-2-pro/fast/mini、seedance-2.5-pro、seedance2.0-a~f、seedance2.5-a。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration_seconds": {
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
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
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-h3-max-videos",
        "label": "万有引力 MiniMax H3 Max 视频",
        "description": "minimax-h3-max：POST /v1/videos，seconds、resolution 与 reference_images、reference_videos、reference_audios 扁平 URL 数组。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "768p"
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
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "reference_audios": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-sd-videos",
        "label": "万有引力 SD 视频",
        "description": "sd-2.0-a/b/c、sd-2.5-a、sd-2.5：POST /v1/videos，duration 与 images、videos、audio 数组。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
                "else": 5
              }
            },
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
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
            "images": {
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
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "audio": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-sd-mini-videos",
        "label": "万有引力 SD Mini 视频",
        "description": "sd-mini：POST /v1/videos，主图 image_url、额外参考图 reference_image_urls、音频 audio_urls。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
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
            "image_url": {
              "$omitEmpty": {
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
            },
            "reference_image_urls": {
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
                        "$gt": [
                          {
                            "$ref": "media.order"
                          },
                          0
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
            "audio_urls": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$ref": "request.audios"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-grok-videos",
        "label": "万有引力 Grok Imagine 视频",
        "description": "grok-imagine-video / 1.5 / 1.5S：POST /v1/videos/generations，duration、image、reference_images。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
                "else": 6
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
                ]
              }
            },
            "image": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "url": {
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
                  },
                  "else": null
                }
              }
            },
            "reference_images": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
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
                        "url": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/generations/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
            "error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "lxmone-h3-workflow",
        "label": "万有引力 MiniMax H3 工作流",
        "description": "minimax-h3-a~e：POST /v1/videos/generations，input_reference、first_frame、last_frame、audio。",
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
        "baseUrl": "https://lxmone.xyz/v1",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片，宿主发布为公开 URL 后提交。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "reference_videos",
            "description": "参考视频。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "reference_audios",
            "description": "参考音频。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "seconds/duration/duration_seconds",
            "description": "输出时长，单位秒。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "aspect_ratio",
            "description": "画幅比例。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/size",
            "description": "输出分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "audio/generate_audio",
            "description": "是否生成或保留音频。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
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
            "resolution": {
              "$lower": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  "720p"
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
            "input_reference": {
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
                    "$ref": "media.value"
                  }
                }
              }
            },
            "first_frame": {
              "$omitEmpty": {
                "$first": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.images"
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
                      "$ref": "media.value"
                    }
                  }
                }
              }
            },
            "last_frame": {
              "$omitEmpty": {
                "$first": {
                  "$map": {
                    "from": {
                      "$filter": {
                        "from": {
                          "$ref": "request.images"
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
                      "$ref": "media.value"
                    }
                  }
                }
              }
            },
            "audio": {
              "$omitEmpty": {
                "$first": {
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
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/generations/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.request_id"
              },
              {
                "$ref": "response.data.id"
              },
              "taskId"
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.status"
              },
              {
                "$ref": "response.state"
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
                "$ref": "response.metadata.direct_url"
              },
              {
                "$ref": "response.data.metadata.direct_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.metadata.video_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "error.message",
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
