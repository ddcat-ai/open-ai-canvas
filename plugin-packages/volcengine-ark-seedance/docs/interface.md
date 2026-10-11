# Volcengine Ark Seedance 接口字段

## 协议身份

- 插件 ID：`volcengine-ark-seedance`。
- Provider ID：`volcengine-ark-video`。
- 能力：`video`。
- 默认 Base URL：`https://ark.cn-beijing.volces.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v3/contents/generations/tasks`。
- 查询：`GET /api/v3/contents/generations/tasks/{{taskId}}`。
- 取消：`DELETE /api/v3/contents/generations/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | Ark endpoint/model ID。 |
| `prompt` | string | 是 | `content[type=text].text` | 视频提示词。 |
| `images` | media[] | 否 | `content[type=image_url]` | first_frame、last_frame、reference_image 等 role 原样映射。 |
| `videos` | media[] | 否 | `content[type=video_url]` | reference_video。 |
| `audios` | media[] | 否 | `content[type=audio_url]` | reference_audio/reference_voice。 |
| `aspectRatio` | string | 否 | `ratio` | 输出画幅。 |
| `resolution` | string | 否 | `resolution` | 输出分辨率档位。 |
| `duration` | integer | 否 | `duration` | 输出时长秒数。 |
| `generateAudio` | boolean | 否 | `generate_audio` | 是否生成音频。 |
| `watermark` | boolean | 否 | `watermark` | 是否带水印。 |
| `seed` | integer | 否 | `seed` | providerOptions seed。 |
| `camera_fixed` | boolean | 否 | `camera_fixed` | providerOptions camera_fixed。 |
| `draft` | boolean | 否 | `draft` | providerOptions draft。样片模式：true 时仅支持 480p，生成低成本预览视频。 |
| `draftTaskId` | string | 否 | `content[type=draft_task]` | providerOptions draftTaskId。基于样片任务生成 1080p 正式视频，其余参数由模型自动复用。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v3/contents/generations/tasks"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.content` | `{"$if":{"condition":{"$and":[{"$ne":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$ne":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":[{"type":"draft_task","draft_task":{"id":{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"}}}],"else":{"$concatArrays":[[{"type":"text","text":{"$ref":"request.prompt"}}],{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"type":"image_url","image_url":{"url":{"$ref":"media.value"}},"role":{"$coalesce":[{"$ref":"media.role"},"reference_image"]}}}},{"$map":{"from":{"$sortByOrder":{"$ref":"request.videos"}},"as":"media","in":{"type":"video_url","video_url":{"url":{"$ref":"media.value"}},"role":{"$coalesce":[{"$ref":"media.role"},"reference_video"]}}}},{"$map":{"from":{"$sortByOrder":{"$ref":"request.audios"}},"as":"media","in":{"type":"audio_url","audio_url":{"url":{"$ref":"media.value"}},"role":{"$coalesce":[{"$ref":"media.role"},"reference_audio"]}}}}]}}}` |
| `create.body.ratio` | `{"$omitEmpty":{"$if":{"condition":{"$or":[{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":{"$coalesce":[{"$ref":"request.aspectRatio"},"16:9"]},"else":null}}}` |
| `create.body.resolution` | `{"$switch":{"cases":[{"when":{"$and":[{"$ne":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$ne":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":"1080p"}],"default":{"$coalesce":[{"$ref":"request.resolution"},"720p"]}}}` |
| `create.body.duration` | `{"$omitEmpty":{"$if":{"condition":{"$or":[{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":{"$if":{"condition":{"$gt":[{"$ref":"request.duration"},0]},"then":{"$ref":"request.duration"},"else":5}},"else":null}}}` |
| `create.body.generate_audio` | `{"$omitEmpty":{"$if":{"condition":{"$or":[{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":{"$ref":"request.generateAudio"},"else":null}}}` |
| `create.body.watermark` | `{"$ref":"request.watermark"}` |
| `create.body.seed` | `{"$omitEmpty":{"$if":{"condition":{"$or":[{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-video.seed"}},"else":null}}}` |
| `create.body.camera_fixed` | `{"$omitEmpty":{"$if":{"condition":{"$or":[{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},null]},{"$eq":[{"$ref":"request.providerOptions.volcengine-ark-video.draftTaskId"},""]}]},"then":{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-video.camera_fixed"}},"else":null}}}` |
| `create.body.draft` | `{"$omitEmpty":{"$ref":"request.providerOptions.volcengine-ark-video.draft"}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/api/v3/contents/generations/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |
| `cancel.method` | `"DELETE"` |
| `cancel.path` | `"/api/v3/contents/generations/tasks/{{taskId}}"` |
| `cancel.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.volcengine-ark-video.camera_fixed`
- `providerOptions.volcengine-ark-video.seed`
- `providerOptions.volcengine-ark-video.draft`
- `providerOptions.volcengine-ark-video.draftTaskId`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"response.task_id"},{"$ref":"response.data.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},{"$ref":"response.data.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.videos` | `{"$coalesce":[{"$ref":"response.content.video_url"},{"$ref":"response.video_url"},{"$ref":"response.output.video_url"},{"$ref":"response.data.video_url"}]}` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 样片模式（Seedance 2.5）

- Step1：`providerOptions.volcengine-ark-video.draft = true`，仅支持 `resolution = 480p`，生成低成本预览样片；上游返回的任务 ID 即样片任务 ID（7 天内有效）。
- Step2：`providerOptions.volcengine-ark-video.draftTaskId = <样片任务 ID>`，content 仅携带 `draft_task`，`resolution` 强制 `1080p`；`ratio/duration/generate_audio/seed/camera_fixed` 不发送，由模型自动复用 Step1 取值，重复传会触发上游报错。`watermark` 可重新指定。
- 两步独立计费：Step1 按 480p 档、Step2 按 1080p 档，用量以各任务 `usage.completion_tokens` 为准。

## 兼容边界

官方 Ark 推理接入：创建/查询/取消走 /api/v3/contents/generations/tasks；插件不根据图片下标推断首尾帧，role 由业务层确定。API Key 来自方舟推理接入控制台。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-ark-seedance",
  "name": "Volcengine Ark Seedance",
  "version": "2.0.0",
  "author": "Volcengine / 影策",
  "description": "Volcengine Ark Seedance 独立请求协议插件。",
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
        "id": "volcengine-ark-video",
        "label": "Volcengine Ark Seedance",
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
            "description": "Ark endpoint/model ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "content[type=text].text",
            "description": "视频提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=image_url]",
            "description": "first_frame、last_frame、reference_image 等 role 原样映射。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=video_url]",
            "description": "reference_video。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "content[type=audio_url]",
            "description": "reference_audio/reference_voice。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio",
            "description": "输出画幅。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution",
            "description": "输出分辨率档位。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": false,
            "mapping": "duration",
            "description": "输出时长秒数。"
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
            "description": "是否带水印。"
          },
          {
            "name": "seed",
            "type": "integer",
            "required": false,
            "mapping": "seed",
            "description": "providerOptions seed。"
          },
          {
            "name": "camera_fixed",
            "type": "boolean",
            "required": false,
            "mapping": "camera_fixed",
            "description": "providerOptions camera_fixed。"
          },
          {
            "name": "draft",
            "type": "boolean",
            "required": false,
            "mapping": "draft",
            "description": "providerOptions draft。样片模式：true 时仅支持 480p，生成低成本预览视频。"
          },
          {
            "name": "draftTaskId",
            "type": "string",
            "required": false,
            "mapping": "content[type=draft_task]",
            "description": "providerOptions draftTaskId。基于样片任务生成 1080p 正式视频，其余参数由模型自动复用。"
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
                9
              ]
            },
            "message": "Seedance 最多支持 9 张参考图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                3
              ]
            },
            "message": "Seedance 最多支持 3 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                3
              ]
            },
            "message": "Seedance 最多支持 3 个参考音频"
          },
          {
            "assert": {
              "$or": [
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
                  "$gt": [
                    {
                      "$add": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        {
                          "$len": {
                            "$ref": "request.videos"
                          }
                        }
                      ]
                    },
                    0
                  ]
                }
              ]
            },
            "message": "Seedance 不支持纯音频或文本+音频，请同时添加参考图片或参考视频"
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
              "$if": {
                "condition": {
                  "$and": [
                    {
                      "$ne": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                        },
                        null
                      ]
                    },
                    {
                      "$ne": [
                        {
                          "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                        },
                        ""
                      ]
                    }
                  ]
                },
                "then": [
                  {
                    "type": "draft_task",
                    "draft_task": {
                      "id": {
                        "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                      }
                    }
                  }
                ],
                "else": {
                  "$concatArrays": [
                    [
                      {
                        "type": "text",
                        "text": {
                          "$ref": "request.prompt"
                        }
                      }
                    ],
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
                          "role": {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              "reference_video"
                            ]
                          }
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
                          "role": {
                            "$coalesce": [
                              {
                                "$ref": "media.role"
                              },
                              "reference_audio"
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              }
            },
            "ratio": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          null
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$coalesce": [
                      {
                        "$ref": "request.aspectRatio"
                      },
                      "16:9"
                    ]
                  },
                  "else": null
                }
              }
            },
            "resolution": {
              "$switch": {
                "cases": [
                  {
                    "when": {
                      "$and": [
                        {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                            },
                            null
                          ]
                        },
                        {
                          "$ne": [
                            {
                              "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                            },
                            ""
                          ]
                        }
                      ]
                    },
                    "then": "1080p"
                  }
                ],
                "default": {
                  "$coalesce": [
                    {
                      "$ref": "request.resolution"
                    },
                    "720p"
                  ]
                }
              }
            },
            "duration": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          null
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": {
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
                  "else": null
                }
              }
            },
            "generate_audio": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          null
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$ref": "request.generateAudio"
                  },
                  "else": null
                }
              }
            },
            "watermark": {
              "$ref": "request.watermark"
            },
            "seed": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          null
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.volcengine-ark-video.seed"
                    }
                  },
                  "else": null
                }
              }
            },
            "camera_fixed": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          null
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$ref": "request.providerOptions.volcengine-ark-video.draftTaskId"
                          },
                          ""
                        ]
                      }
                    ]
                  },
                  "then": {
                    "$omitEmpty": {
                      "$ref": "request.providerOptions.volcengine-ark-video.camera_fixed"
                    }
                  },
                  "else": null
                }
              }
            },
            "draft": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.volcengine-ark-video.draft"
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
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.output.video_url"
              },
              {
                "$ref": "response.data.video_url"
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
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
