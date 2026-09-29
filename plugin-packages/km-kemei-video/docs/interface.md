# KM 可美视频接口字段

## 协议身份

- 插件 ID：`km-kemei-video`。
- Provider ID：`km-kemei-video`。
- 能力：`video`。
- 默认 Base URL：`https://token.xinhankr.com`。
- 鉴权：`Authorization: Bearer <apiKey>`。
- 创建：`POST /v1/video/generations`。
- 查询：`GET /v1/video/generations/{task_id}`，也兼容上游文档中的 `/v1/tasks/{task_id}`。
- 取消：`DELETE /v1/video/generations/{task_id}`。

## 提交任务

请求体使用 JSON。`model` 与 `prompt` 为必填字段；其它统一字段按上游 snake_case 名称发送。`images` 支持 URL、Base64 字符串和带 `role` 的对象，图片按输入顺序保留；单图、双图和三图以上的首帧/尾帧/多图参考推断由 KM 网关执行。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 如 `doubao-seedance-2-5`、`kling-v3-omni`、`wan3.0-video`。 |
| `prompt` | string | 是 | 描述 motion 与画面的提示词。 |
| `negative_prompt` | string | 否 | 负向提示词，通过 `providerOptions.km-kemei-video.negative_prompt` 透传。 |
| `images` / `image_urls` | array | 否 | 图片 URL、Base64 或带 `role` 的图片对象。插件使用 `images` 字段。 |
| `videos` | array | 否 | 参考视频 URL。 |
| `audios` | array | 否 | 参考音频 URL。 |
| `files` | array | 否 | 参考文件 URL，通过 provider options 透传。 |
| `links` | array | 否 | 参考网页 URL，通过 provider options 透传。 |
| `resolution` | string | 否 | `1080p`、`720p`、`480p` 等。 |
| `ratio` | string | 否 | `16:9`、`9:16`、`adaptive`；未设置时回退统一 `aspectRatio`。 |
| `duration` | integer | 否 | 时长秒数。 |
| `generate_audio` | boolean | 否 | 是否生成背景音效或配音。 |
| `watermark` | boolean | 否 | 是否添加水印。 |
| `web_search` | boolean | 否 | 是否启用联网搜索。 |
| `seed` | integer | 否 | 随机数种子。 |

扩展字段命名空间为 `providerOptions.km-kemei-video`，支持 `negative_prompt`、`ratio`、`files`、`links`、`web_search`、`seed` 及其它网关扩展字段。该命名空间可通过自定义渠道元数据传入。

## 图片角色

显式图片角色支持 `first_frame` / `first`、`last_frame` / `end_frame` / `last` / `tail`、`reference_image`。插件会把统一媒体的 `role` 字段编码为对象形式；没有角色时保留为纯 URL 或 Base64 字符串，让网关执行数量推断。

## 异步生命周期

创建响应的 `id`、`task_id` 或对应 `data` 字段映射为统一任务 ID。任务状态从 `pending`、`processing`、`completed`、`succeeded`、`failed`、`cancelled` 等值归一化。成功结果从 `data[].url` 以及常见的 `video_url`、`output_url`、`result_url` 和顶层等价字段提取；临时 URL 标记为 ephemeral，由宿主下载并持久化。

取消只对未完成任务生效。KM 网关返回的 HTTP 错误、`error.code` 和错误消息保持失败语义，不包装成成功。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "km-kemei-video",
  "name": "KM 可美视频",
  "version": "1.0.0",
  "author": "KM 可美 / 影策",
  "description": "KM 可美视频 OpenAI 兼容异步视频生成协议插件。",
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
        "id": "km-kemei-video",
        "label": "KM 可美视频",
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
        "baseUrl": "https://token.xinhankr.com",
        "requiresPublicMediaUrls": false,
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
            "description": "视频生成模型名称。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "描述视频 motion 与画面的提示词。"
          },
          {
            "name": "negative_prompt",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.negative_prompt",
            "description": "负向提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "首帧、尾帧或参考图片，支持 URL 与 Base64。"
          },
          {
            "name": "image_urls",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "images 的别名。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos",
            "description": "参考视频链接数组。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频链接数组。"
          },
          {
            "name": "files",
            "type": "string[]",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.files",
            "description": "参考文件 URL 数组。"
          },
          {
            "name": "links",
            "type": "string[]",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.links",
            "description": "参考网页 URL 数组。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "目标分辨率，如 1080p、720p、480p。"
          },
          {
            "name": "ratio",
            "type": "string",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.ratio/aspectRatio",
            "description": "宽高比，如 16:9、9:16、adaptive。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "视频时长，单位为秒。"
          },
          {
            "name": "generate_audio",
            "type": "boolean",
            "required": false,
            "mapping": "generateAudio",
            "description": "是否同步生成匹配音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "是否添加水印。"
          },
          {
            "name": "web_search",
            "type": "boolean",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.web_search",
            "description": "是否启用联网搜索。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "providerOptions.km-kemei-video.seed",
            "description": "随机数种子。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "KM 可美协议扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/video/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "negative_prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.km-kemei-video.negative_prompt"
              }
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
                    "$if": {
                      "condition": {
                        "$ne": [
                          {
                            "$ref": "media.role"
                          },
                          ""
                        ]
                      },
                      "then": {
                        "url": {
                          "$ref": "media.value"
                        },
                        "role": {
                          "$ref": "media.role"
                        }
                      },
                      "else": {
                        "$ref": "media.value"
                      }
                    }
                  }
                }
              }
            },
            "videos": {
              "$omitEmpty": {
                "$map": {
                  "from": {
                    "$sortByOrder": {
                      "$ref": "request.videos"
                    }
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
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
                    "$ref": "media.value"
                  }
                }
              }
            },
            "files": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.km-kemei-video.files"
              }
            },
            "links": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.km-kemei-video.links"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.km-kemei-video.ratio"
                  },
                  {
                    "$ref": "request.aspectRatio"
                  }
                ]
              }
            },
            "duration": {
              "$omitEmpty": {
                "$ref": "request.duration"
              }
            },
            "generate_audio": {
              "$ref": "request.generateAudio"
            },
            "watermark": {
              "$ref": "request.watermark"
            },
            "web_search": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.km-kemei-video.web_search"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.km-kemei-video.seed"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/video/generations/{{taskId}}",
          "contentType": "application/json"
        },
        "cancel": {
          "method": "DELETE",
          "path": "/v1/video/generations/{{taskId}}",
          "contentType": "application/json"
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
                "$ref": "response.id"
              },
              {
                "$ref": "response.data.task_id"
              },
              {
                "$ref": "response.data.taskId"
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
                "$ref": "response.data.error.message"
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
                "$map": {
                  "from": {
                    "$ref": "response.data"
                  },
                  "as": "item",
                  "in": {
                    "$coalesce": [
                      {
                        "$ref": "item.url"
                      },
                      {
                        "$ref": "item.video_url"
                      },
                      {
                        "$ref": "item.videoUrl"
                      },
                      {
                        "$ref": "item.output_url"
                      },
                      {
                        "$ref": "item.outputUrl"
                      }
                    ]
                  }
                }
              },
              {
                "$ref": "response.data.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.data.videoUrl"
              },
              {
                "$ref": "response.data.output_url"
              },
              {
                "$ref": "response.data.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.output_url"
              },
              {
                "$ref": "response.result_url"
              }
            ]
          },
          "errorPaths": [
            "error.code",
            "data.error.code"
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
