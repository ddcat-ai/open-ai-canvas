# DashScope Wan 3.0 Video 接口字段

## 协议身份

- 插件 ID：`dashscope-wan3-video`。
- Provider ID：`dashscope-wan3-video`。
- 能力：`video`。
- 默认 Base URL：`https://dashscope.aliyuncs.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v1/services/aigc/video-generation/video-synthesis`。
- 查询：`GET /api/v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 视频模型 ID。 |
| `prompt` | string | 是 | `prompt/content/input` | 视频提示词。 |
| `images` | media[] | 否 | `first/last/reference image` | 显式 role 图片输入。 |
| `videos` | media[] | 否 | `reference video` | 参考视频。 |
| `audios` | media[] | 否 | `reference audio/voice` | 参考音频或音色。 |
| `duration` | integer | 否 | `duration/seconds` | 时长秒数。 |
| `aspectRatio` | string | 否 | `ratio/aspect_ratio/size` | 画幅比例或尺寸。 |
| `resolution` | string | 否 | `resolution` | 分辨率档位。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成音频。 |
| `watermark` | boolean | 否 | `watermark` | 水印开关。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v1/services/aigc/video-generation/video-synthesis"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.input.prompt` | `{"$omitEmpty":{"$ref":"request.prompt"}}` |
| `create.body.input.media` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.dashscope-wan3-video.media"},{"$map":{"from":{"$sortByOrder":{"$ref":"request.inputs"}},"as":"media","in":{"type":{"$coalesce":[{"$ref":"media.role"},{"$if":{"condition":{"$eq":[{"$ref":"media.kind"},"image"]},"then":"reference_image","else":{"$if":{"condition":{"$eq":[{"$ref":"media.kind"},"video"]},"then":"reference_video","else":{"$if":{"condition":{"$eq":[{"$ref":"media.kind"},"audio"]},"then":"reference_audio","else":{"$ref":"media.kind"}}}}}}}]},"url":{"$ref":"media.value"}}}}]}}` |
| `create.body.parameters.resolution` | `{"$omitEmpty":{"$ref":"request.resolution"}}` |
| `create.body.parameters.ratio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.parameters.duration` | `{"$omitEmpty":{"$ref":"request.duration"}}` |
| `create.body.parameters.audio` | `{"$coalesce":[{"$ref":"request.providerOptions.dashscope-wan3-video.audio"},{"$ref":"request.generateAudio"}]}` |
| `create.body.parameters.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.dashscope-wan3-video.seed"}}` |
| `create.body.parameters.prompt_extend` | `{"$coalesce":[{"$ref":"request.providerOptions.dashscope-wan3-video.prompt_extend"},true]}` |
| `create.body.parameters.watermark` | `{"$ref":"request.watermark"}` |
| `create.headers.X-DashScope-Async` | `"enable"` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/api/v1/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.dashscope-wan3-video.audio`
- `providerOptions.dashscope-wan3-video.media`
- `providerOptions.dashscope-wan3-video.prompt_extend`
- `providerOptions.dashscope-wan3-video.seed`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.output.task_id"},{"$ref":"response.task_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$if":{"condition":{"$eq":[{"$lower":{"$ref":"response.output.task_status"}},"unknown"]},"then":"failed","else":{"$coalesce":[{"$ref":"response.output.task_status"},{"$ref":"response.status"},"pending"]}}}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.videos` | `{"$ref":"response.output.video_url"}` |
| `response.errorPaths[0]` | `"code"` |
| `response.errorPaths[1]` | `"output.code"` |
| `response.resultEphemeral` | `true` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.messagePaths[0]` | `"message"` |
| `response.messagePaths[1]` | `"output.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该包只代表上述线协议 profile；同一品牌的其他 endpoint、云区域或网关包装必须使用独立插件，不能根据模型名猜测。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "dashscope-wan3-video",
  "name": "DashScope Wan 3.0 Video",
  "version": "2.0.0",
  "author": "Alibaba Cloud / 影策",
  "description": "DashScope Wan 3.0 Video 独立请求协议插件。",
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
        "id": "dashscope-wan3-video",
        "label": "DashScope Wan 3.0 Video",
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
        "baseUrl": "https://dashscope.aliyuncs.com",
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
            "description": "视频模型 ID。"
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
            "description": "显式 role 图片输入。"
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
            "description": "时长秒数。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/aspect_ratio/size",
            "description": "画幅比例或尺寸。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "分辨率档位。"
          },
          {
            "name": "generateAudio",
            "type": "boolean",
            "required": false,
            "mapping": "generate_audio",
            "description": "是否生成音频。"
          },
          {
            "name": "watermark",
            "type": "boolean",
            "required": false,
            "mapping": "watermark",
            "description": "水印开关。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "插件命名空间内的厂商扩展字段。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$lower": {
                    "$ref": "request.model"
                  }
                },
                [
                  "wan3.0-video-prime",
                  "wan3.0-video"
                ]
              ]
            },
            "message": "Wan 3.0 Video 仅支持 wan3.0-video-prime 或 wan3.0-video"
          },
          {
            "assert": {
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
                        "$in": [
                          {
                            "$ref": "media.role"
                          },
                          [
                            "first_frame"
                          ]
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "Wan 3.0 Video 最多只能有一个 first_frame"
          },
          {
            "assert": {
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
                        "$in": [
                          {
                            "$ref": "media.role"
                          },
                          [
                            "last_frame"
                          ]
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "Wan 3.0 Video 最多只能有一个 last_frame"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/services/aigc/video-generation/video-synthesis",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "prompt": {
                "$omitEmpty": {
                  "$ref": "request.prompt"
                }
              },
              "media": {
                "$omitEmpty": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.dashscope-wan3-video.media"
                    },
                    {
                      "$map": {
                        "from": {
                          "$sortByOrder": {
                            "$ref": "request.inputs"
                          }
                        },
                        "as": "media",
                        "in": {
                          "type": {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              {
                                "$if": {
                                  "condition": {
                                    "$eq": [
                                      {
                                        "$ref": "media.kind"
                                      },
                                      "image"
                                    ]
                                  },
                                  "then": "reference_image",
                                  "else": {
                                    "$if": {
                                      "condition": {
                                        "$eq": [
                                          {
                                            "$ref": "media.kind"
                                          },
                                          "video"
                                        ]
                                      },
                                      "then": "reference_video",
                                      "else": {
                                        "$if": {
                                          "condition": {
                                            "$eq": [
                                              {
                                                "$ref": "media.kind"
                                              },
                                              "audio"
                                            ]
                                          },
                                          "then": "reference_audio",
                                          "else": {
                                            "$ref": "media.kind"
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            ]
                          },
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
                "$omitEmpty": {
                  "$ref": "request.resolution"
                }
              },
              "ratio": {
                "$omitEmpty": {
                  "$ref": "request.aspectRatio"
                }
              },
              "duration": {
                "$omitEmpty": {
                  "$ref": "request.duration"
                }
              },
              "audio": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.dashscope-wan3-video.audio"
                  },
                  {
                    "$ref": "request.generateAudio"
                  }
                ]
              },
              "seed": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.dashscope-wan3-video.seed"
                }
              },
              "prompt_extend": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.dashscope-wan3-video.prompt_extend"
                  },
                  true
                ]
              },
              "watermark": {
                "$ref": "request.watermark"
              }
            }
          },
          "headers": {
            "X-DashScope-Async": "enable"
          },
          "originPath": true
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
                "$ref": "response.output.task_id"
              },
              {
                "$ref": "response.task_id"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$lower": {
                      "$ref": "response.output.task_status"
                    }
                  },
                  "unknown"
                ]
              },
              "then": "failed",
              "else": {
                "$coalesce": [
                  {
                    "$ref": "response.output.task_status"
                  },
                  {
                    "$ref": "response.status"
                  },
                  "pending"
                ]
              }
            }
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
            "$ref": "response.output.video_url"
          },
          "errorPaths": [
            "code",
            "output.code"
          ],
          "resultEphemeral": true,
          "usage": {
            "$ref": "response.usage"
          },
          "messagePaths": [
            "message",
            "output.message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
