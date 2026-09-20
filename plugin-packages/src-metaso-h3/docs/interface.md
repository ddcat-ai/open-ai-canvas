# METASO MiniMax H3 接口说明

## 鉴权

`Authorization: Bearer mk-xxxxxxxxxxxxxxxxxxxxxxxx`

## 创建视频生成任务

POST `https://metaso.cn/api/minimax/v2/video_generation`

请求体：

```json
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "视频描述" },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "first_frame" },
    { "type": "video_url", "video_url": { "url": "https://..." }, "role": "reference_video" },
    { "type": "audio_url", "audio_url": { "url": "https://..." }, "role": "reference_audio" }
  ],
  "resolution": "768P",
  "duration": 5,
  "ratio": "16:9"
}
```

- content 必须包含一个非空 text 项。
- 首尾帧（first_frame/last_frame）与多模态参考（reference_*）互斥。
- 图片 ≤ 9 张、视频 ≤ 3 段、音频 ≤ 3 段；请求体总大小 ≤ 64 MB。

响应：

```json
{ "task_id": "424010985738629" }
```

## 查询任务

GET `https://metaso.cn/api/minimax/v2/query/video_generation/{task_id}`

响应：

```json
{
  "task": {
    "id": "424010985738629",
    "status": "succeeded",
    "content": { "url": "https://.../output.mp4" },
    "resolution": "2K",
    "duration": 5,
    "usage": { "total_seconds": 5, "output_seconds": 5 }
  }
}
```

status 取值：queued / running / succeeded / failed / cancelled。

## 错误

创建与查询均返回 OpenAI 风格错误体，含 `error.type` / `error.message` / `request_id`；余额不足为 402，速率限制为 429。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "metaso-h3",
  "name": "METASO MiniMax H3",
  "version": "1.0.0",
  "author": "METASO",
  "description": "秘塔 METASO MiniMax H3 文生视频/图生视频协议插件（异步任务）。",
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
        "id": "metaso-h3",
        "label": "METASO MiniMax H3",
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
        "baseUrl": "https://metaso.cn",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "requiresPublicMediaUrls": true,
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "视频模型 ID（MiniMax-H3 / MiniMax-H3-Max）。"
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
            "description": "显式 role 图片输入（首帧/尾帧/参考图）。"
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
            "description": "时长秒数（4-15）。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio/size",
            "description": "画幅比例（16:9 等）。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位（768P / 2K）。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "AIGC 水印开关。"
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
          "path": "/api/minimax/v2/video_generation",
          "contentType": "application/json",
          "body": {
            "model": {
              "$coalesce": [
                {
                  "$ref": "request.model"
                },
                "MiniMax-H3"
              ]
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
                      "$ref": "request.images"
                    },
                    "as": "media",
                    "in": {
                      "type": "image_url",
                      "image_url": {
                        "url": {
                          "$coalesce": [
                            {
                              "$ref": "media.url"
                            },
                            {
                              "$ref": "media.dataUrl"
                            }
                          ]
                        }
                      },
                      "role": {
                        "$omitEmpty": {
                          "$ref": "media.role"
                        }
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
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$coalesce": [
                            {
                              "$ref": "media.url"
                            },
                            {
                              "$ref": "media.dataUrl"
                            }
                          ]
                        }
                      },
                      "role": {
                        "$omitEmpty": {
                          "$ref": "media.role"
                        }
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
                      "type": "audio_url",
                      "audio_url": {
                        "url": {
                          "$coalesce": [
                            {
                              "$ref": "media.url"
                            },
                            {
                              "$ref": "media.dataUrl"
                            }
                          ]
                        }
                      },
                      "role": {
                        "$omitEmpty": {
                          "$ref": "media.role"
                        }
                      }
                    }
                  }
                }
              ]
            },
            "resolution": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.resolution"
                  },
                  {
                    "$ref": "request.providerOptions.metaso-h3.resolution"
                  },
                  "768P"
                ]
              }
            },
            "duration": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.duration"
                  },
                  {
                    "$ref": "request.providerOptions.metaso-h3.duration"
                  },
                  5
                ]
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.aspectRatio"
                  },
                  {
                    "$ref": "request.providerOptions.metaso-h3.ratio"
                  },
                  "16:9"
                ]
              }
            },
            "aigc_watermark": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.metaso-h3.aigc_watermark"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/minimax/v2/query/video_generation/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.taskId"
              },
              {
                "$ref": "response.data.task_id"
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
              {
                "$ref": "response.data.status"
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
                "$ref": "response.task.fail_reason"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.task.content.url"
              },
              {
                "$ref": "response.task.content.video_url"
              },
              {
                "$ref": "response.content.url"
              },
              {
                "$ref": "response.data.url"
              }
            ]
          },
          "usage": {
            "$ref": "response.task.usage"
          },
          "errorPaths": [
            "task.error.type",
            "error.type",
            "error.code"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "task.error.message",
            "error.message"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
