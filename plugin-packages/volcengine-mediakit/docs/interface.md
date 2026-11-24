# 火山 MediaKit 视频画质增强工具接口字段

这是视频处理协议，不是视频生成模型。它接收已有视频并输出增强后的视频，Provider 类型为 `processing`。

## 视频画质增强

- Provider ID：`volcengine-mediakit-enhance-video`，`kind: processing`，能力 `video`。
- 默认 Base URL：`https://mediakit.cn-beijing.volces.com`。
- 鉴权：`Authorization: Bearer <MediaKit API Key>`（AI MediaKit 控制台 API Key 管理页面创建）。
- 创建：`POST /api/v1/tools/enhance-video-generative`，返回 `task_id`；`success:false` 时 `error.code` 非空，按失败处理。
- 查询：`GET /api/v1/tasks/{{taskId}}`，`status` 为 `running` / `completed` / `failed`。
- 结果：`result.video_url` 为 24 小时临时链接，宿主下载并持久化；`result.duration`、`result.fps`、`result.resolution` 写入 usage，用于按实际输出时长和帧率结算。

### 请求字段

| 上游字段 | 统一来源 | 说明 |
| --- | --- | --- |
| `video_url` | `request.videos[0]` | 公网 URL。输入短边 [360,1080]、长边 [360,1920]，仅 SDR。 |
| `resolution` | `request.resolution` | `720p`（默认）/ `1080p` / `2k` / `4k`。 |
| `fps` | `providerOptions.volcengine-mediakit-enhance-video.fps` | 15-120；不填保持原帧率。 |
| `bitrate_level` | `providerOptions.….bitrate_level` | `low` / `medium` / `high`，默认 `medium`。 |
| `bitrate` | `providerOptions.….bitrate` | 10-150000 kbps，同时给出时优先于 `bitrate_level`。 |
| `client_token` | 宿主幂等键 | 同一次提交重试不会重复创建任务。 |

未接入 `media_output_destination`、`callback_url`、`callback_args`、`queue_id`：结果统一由宿主轮询并落到影策资源存储。

### 耗时与计费

- RTF 约 15-20，任务轮询上限 1 小时，因此源视频时长限制为 180 秒以内。
- 上游计费：输出时长（分钟）× 系数 × 2.5 元/分钟；系数由输出分辨率（按短边判定）与帧率档（≤30 / ≤60 / ≤120）决定，720p≤30fps 为 1，每升一档分辨率或帧率翻倍。
- 平台计费：价格档按 `vquality` × `fpsBand`（`le30` / `le60` / `le120`）配置，支持按次或按秒；按秒时先按源视频时长预扣，成功后按实际输出时长和帧率档结算。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-mediakit",
  "name": "火山 MediaKit 视频画质增强工具",
  "version": "1.0.1",
  "author": "Volcengine / 影策",
  "description": "火山 MediaKit 视频处理工具，用于画质增强，不是视频生成模型；支持 720p、1080p、2K、4K 目标分辨率。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "MediaKit API Key",
        "required": true
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "contributes": {
    "providers": [
      {
        "id": "volcengine-mediakit-enhance-video",
        "label": "火山 MediaKit 视频画质增强工具",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas"
        ],
        "baseUrl": "https://mediakit.cn-beijing.volces.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "video_url",
            "description": "待增强源视频，仅取第一个。短边 360-1080，长边 360-1920，仅 SDR。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "values": [
              "720p",
              "1080p",
              "2k",
              "4k"
            ],
            "mapping": "resolution",
            "description": "目标分辨率，默认 720p。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "fps / bitrate_level / bitrate",
            "description": "fps 15-120（不填保持原帧率）；bitrate_level low/medium/high；bitrate 10-150000 kbps，优先于 bitrate_level。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "画质增强需要一个源视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/tools/enhance-video-generative",
          "contentType": "application/json",
          "body": {
            "video_url": {
              "$first": {
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
            "resolution": {
              "$coalesce": [
                {
                  "$omitEmpty": {
                    "$lower": {
                      "$ref": "request.resolution"
                    }
                  }
                },
                "720p"
              ]
            },
            "fps": {
              "$omitEmpty": {
                "$toFloat": {
                  "$ref": "request.providerOptions.volcengine-mediakit-enhance-video.fps"
                }
              }
            },
            "bitrate_level": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-mediakit-enhance-video.bitrate_level"
              }
            },
            "bitrate": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$toFloat": {
                        "$ref": "request.providerOptions.volcengine-mediakit-enhance-video.bitrate"
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$toInt": {
                    "$ref": "request.providerOptions.volcengine-mediakit-enhance-video.bitrate"
                  }
                }
              }
            },
            "client_token": {
              "$omitEmpty": {
                "$ref": "request.extra.idempotencyKey"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
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
                "$ref": "response.error.code"
              }
            ]
          },
          "videos": {
            "$ref": "response.result.video_url"
          },
          "usage": {
            "$omitEmpty": {
              "outputDurationSeconds": {
                "$ref": "response.result.duration"
              },
              "outputResolution": {
                "$ref": "response.result.resolution"
              },
              "outputFps": {
                "$ref": "response.result.fps"
              }
            }
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
