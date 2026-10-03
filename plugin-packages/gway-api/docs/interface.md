# 极途 Gway API 接口字段

## 协议身份

- 插件 ID：`gway-api`。
- Provider ID：`gway-chat`、`gway-image`、`gway-image-sync`、`gway-video`。
- 默认 Base URL：`https://api.gway.dev`。
- 鉴权：`Authorization: Bearer <apiKey>`。
- 模型目录：`GET /v1/models`；请求中的 `model` 必须使用 `data[].id`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | Gway Tokens 页面创建的 API Key。 |

## gway-chat：文本对话

### 请求

`POST /v1/chat/completions`，`Content-Type: application/json`。

| 字段 | 类型 | 必填 | 上游字段 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 从 `GET /v1/models` 获取。 |
| `messages` | message[] | 是 | `messages` | OpenAI Chat Completions 消息数组。 |
| `instructions` | string | 否 | system message | 宿主在没有 system 消息时加入。 |
| `temperature` | number | 否 | `temperature` | 采样温度。 |
| `top_p` | number | 否 | `top_p` | 核采样概率。 |
| `max_tokens` | integer | 否 | `max_tokens` | 最大输出 token。 |
| `n` | integer | 否 | `n` | 候选数量。 |
| `tools` | array | 否 | `tools` | 工具定义。 |
| `tool_choice` | object/string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 是否 SSE 流式返回。 |

### 响应

成功文本从 `choices[0].message.content` 或 `choices[0].text` 读取；推理内容从 `choices[0].message.reasoning_content` 读取；用量从 `usage` 读取。错误消息读取 `error.message`，错误码读取 `error.code`。

## gway-image：异步图片

### 创建

`POST /v1/images/create`，`Content-Type: application/json`。

| 字段 | 类型 | 必填 | 上游字段 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片描述。 |
| `imageCount` | integer | 否 | `n` | 默认 1，最多 128。 |
| `quality` | string | 否 | `quality` | `auto`、`low`、`medium` 或 `high`。 |
| `aspectRatio` | string | 否 | `ratio` | `1:1`、`16:9`、`9:16`、`3:4`、`4:3` 等。 |
| `resolution` | string | 否 | `resolution` | `1K`、`2K` 或 `4K`；模型可能有更细限制。 |
| `images` | media[] | 否 | `images` | 公网参考图片 URL 或 `{url,name?}`。 |
| `providerOptions` | object | 否 | 扩展字段 | 插件命名空间内的厂商字段。 |

创建响应包含 `id`、`task_id` 和 `status`。创建成功后使用 `GET /v1/images/tasks/{task_id}` 轮询。

### 查询与响应

查询响应是扁平对象，不带 `code/data` 包装：

```json
{
  "id": "task_xxx",
  "object": "image",
  "status": "completed",
  "progress": 100,
  "result_urls": ["https://example.com/image.png"]
}
```

`result_urls` 映射为图片结果并标记为临时 URL；失败时读取 `error.message`。文档没有提供图片取消端点。

## gway-image-sync：同步图片

`POST /v1/images/generations` 使用标准 OpenAI 图片请求体：

| 字段 | 类型 | 必填 | 上游字段 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片描述。 |
| `imageCount` | integer | 否 | `n` | 默认 1，最多 128。 |
| `aspectRatio` | string | 否 | `size` | 像素尺寸，例如 `1024x1024`。 |
| `quality` | string | 否 | `quality` | 上游图片质量字段。 |
| `providerOptions` | object | 否 | `response_format` | `providerOptions.gway-image-sync.response_format` 可设为 `url` 或 `b64_json`。 |

响应使用标准 `data` 数组：

```json
{"created":1710000000,"data":[{"url":"https://example.com/generated.png"}]}
```

`data[*].url` 或 `data[*].b64_json` 映射为图片结果并标记为临时结果。

## gway-video：异步视频

### 创建

`POST /v1/video/generations`，`Content-Type: application/json`。

| 字段 | 类型 | 必填 | 上游字段 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 视频模型 ID。 |
| `prompt` | string | 是 | `prompt` | 视频描述，可引用 `@图片N`、`@视频N`、`@音频N`。 |
| `duration` | integer | 否 | `duration` | 视频时长，单位秒。 |
| `aspectRatio` | string | 否 | `ratio` | `16:9`、`9:16` 或 `1:1`；别名为 `aspect_ratio`。 |
| `resolution` | string | 否 | `resolution` | `480p`、`720p` 或 `1080p` 等。 |
| `images` | media[] | 否 | `images` | URL 或 `{url,name?,type?}`；`type` 可为 `first_frame`、`end_frame`。 |
| `videos` | media[] | 否 | `videos` | 参考视频 URL 或对象。 |
| `audios` | media[] | 否 | `audios` | 参考音频 URL 或对象；不能与首尾帧类型混用。 |
| `materials` | array | 否 | `materials` | 混合素材 `{type,url,name?}`，通过 `providerOptions.gway-video.materials` 传入。 |
| `face` | object | 否 | `face` | `{enabled:true,mode:"light"}` 或 `{enabled:false}`，通过 `providerOptions.gway-video.face` 传入。 |
| `providerOptions` | object | 否 | 扩展字段 | 插件命名空间内的厂商字段。 |

创建响应包含 `id`、`task_id` 和 `status`。创建成功后优先使用 `GET /v1/videos/tasks/{task_id}` 轮询；兼容路径是 `/v1/videos/{task_id}`，旧回退路径是 `/v1/video/generations/{task_id}`，本插件按文档首选路径执行。

### 查询与响应

查询响应是扁平对象，不带 `code/data` 包装：

```json
{
  "id": "task_xxx",
  "object": "video",
  "status": "completed",
  "progress": 100,
  "result_urls": ["https://example.com/video.mp4"]
}
```

`result_urls` 映射为视频结果并标记为临时 URL；失败时读取 `error.message`。文档没有提供视频取消端点，宿主取消只能停止后续轮询。

## 公网媒体与兼容边界

图片、视频和音频参考素材按 URL 发送，因此两个媒体 Provider 要求公网可访问媒体 URL。Gway 也提供 `/v1/media/uploads` 上传会话和 `/v1/media/upload` multipart 回退接口，但本插件只实现生成与轮询协议，上传由宿主媒体流程负责。

本包只代表文档中列出的 `/v1` 接口；其它路径、模型专用参数或模型返回结构必须通过独立 Provider 扩展，不能根据模型名猜测。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "gway-api",
  "name": "极途 Gway API",
  "version": "1.0.0",
  "author": "极途 Gway / iGO Studio",
  "description": "极途 Gway OpenAI 兼容文本、异步图片与异步视频协议插件。",
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
        "id": "gway-chat",
        "label": "极途 Gway Chat",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.gway.dev",
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
            "description": "从 GET /v1/models 返回的文本模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "messages",
            "description": "OpenAI Chat Completions 消息数组。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system message",
            "description": "系统指令；宿主会在没有 system 消息时加入消息数组。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样概率。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens",
            "description": "最大输出 token 数。"
          },
          {
            "name": "n",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "生成的候选数量。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "是否以 SSE 流式返回。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "temperature": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.temperature"
              }
            },
            "top_p": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.top_p"
              }
            },
            "max_tokens": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.max_tokens"
                  },
                  {
                    "$ref": "request.providerOptions.gway-chat.max_tokens"
                  }
                ]
              }
            },
            "n": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.n"
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.tools"
              }
            },
            "tool_choice": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.tool_choice"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.response_format"
              }
            },
            "stream": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-chat.stream"
              }
            }
          }
        },
        "agent": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "$ref": "request.extra.agent.chatCompletion"
              },
              {
                "model": {
                  "$ref": "request.model"
                }
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message"
          ]
        },
        "agentResponse": {
          "textPaths": [
            "choices.0.message.content",
            "choices.0.text"
          ],
          "reasoningPaths": [
            "choices.0.message.reasoning_content"
          ],
          "toolCallsPath": "choices.0.message.tool_calls",
          "toolCallIdPaths": [
            "id"
          ],
          "toolCallNamePaths": [
            "function.name"
          ],
          "toolCallArgumentsPaths": [
            "function.arguments"
          ]
        }
      },
      {
        "id": "gway-image",
        "label": "极途 Gway Image",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.gway.dev",
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
            "description": "从 GET /v1/models 返回的图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片描述。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "生成数量，默认 1，最多 128。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量，可用 auto、low、medium、high。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio",
            "description": "画幅比例，例如 1:1、16:9、9:16、3:4、4:3。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位，例如 1K、2K、4K。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "公网参考图片 URL 或带 url 的对象。"
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
          "path": "/v1/images/create",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": {
              "$coalesce": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "quality": {
              "$omitEmpty": {
                "$ref": "request.quality"
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
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
                    "$ref": "media.value"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/images/tasks/{{taskId}}"
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
                "$ref": "response.state"
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
              }
            ]
          },
          "images": {
            "$ref": "response.result_urls"
          },
          "errorPaths": [
            "error.code",
            "error.message"
          ],
          "resultEphemeral": true
        },
        "nonCancelable": {
          "reason": "Gway 文档未提供图片任务取消端点；宿主只能停止后续轮询。"
        }
      },
      {
        "id": "gway-image-sync",
        "label": "极途 Gway Image Sync",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://api.gway.dev",
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
            "description": "从 GET /v1/models 返回的图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片描述。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "生成数量，默认 1，最多 128。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size",
            "description": "像素尺寸，例如 1024x1024；同步接口不使用 1K/2K 档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "上游图片质量字段。"
          },
          {
            "name": "responseFormat",
            "type": "string",
            "required": false,
            "mapping": "response_format",
            "description": "可选 url 或 b64_json。通过 providerOptions.gway-image-sync.response_format 传入。"
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
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": {
              "$coalesce": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "size": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "quality": {
              "$omitEmpty": {
                "$ref": "request.quality"
              }
            },
            "response_format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-image-sync.response_format"
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$ref": "response.data"
          },
          "errorPaths": [
            "error.code",
            "error.message"
          ],
          "messagePaths": [
            "error.message"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "gway-video",
        "label": "极途 Gway Video",
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
        "baseUrl": "https://api.gway.dev",
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
            "description": "从 GET /v1/models 返回的视频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频描述；可用 @图片N、@视频N、@音频N 或材料名称引用素材。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "视频时长，单位秒，具体范围由模型决定。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio",
            "description": "画幅比例：16:9、9:16 或 1:1。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "输出分辨率，例如 480p、720p、1080p。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "images",
            "description": "参考图片；first_frame/end_frame 通过对象 type 指定首尾帧。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "videos",
            "description": "参考视频 URL 或带 url 的对象。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audios",
            "description": "参考音频 URL 或带 url 的对象。"
          },
          {
            "name": "materials",
            "type": "array",
            "required": false,
            "mapping": "materials",
            "description": "混合素材数组，元素包含 type、url、name。通过 providerOptions.gway-video 传入。"
          },
          {
            "name": "face",
            "type": "object",
            "required": false,
            "mapping": "face",
            "description": "人脸处理配置，例如 enabled 与 mode。通过 providerOptions.gway-video 传入。"
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
          "path": "/v1/video/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "duration": {
              "$omitEmpty": {
                "$ref": "request.duration"
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
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
                    "$merge": [
                      {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      {
                        "name": {
                          "$omitEmpty": {
                            "$ref": "media.name"
                          }
                        }
                      },
                      {
                        "type": {
                          "$omitEmpty": {
                            "$ref": "media.role"
                          }
                        }
                      }
                    ]
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
            "materials": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-video.materials"
              }
            },
            "face": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.gway-video.face"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/tasks/{{taskId}}"
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
                "$ref": "response.state"
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
              }
            ]
          },
          "videos": {
            "$ref": "response.result_urls"
          },
          "errorPaths": [
            "error.code",
            "error.message"
          ],
          "resultEphemeral": true
        },
        "nonCancelable": {
          "reason": "Gway 文档未提供视频任务取消端点；宿主只能停止后续轮询。"
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
