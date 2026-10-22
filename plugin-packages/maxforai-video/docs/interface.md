# MaxForAI 视频接口字段

## 协议身份

- 插件 ID：`maxforai-video`。
- Provider ID：`maxforai-videos`、`maxforai-video-generations`。
- 能力：`video`。
- 默认 Base URL：`https://maxforai.top/v1`。
- 鉴权：`Authorization: Bearer <apiKey>`。
- 创建入口：`POST /videos` 或 `POST /video/generations`。
- 查询入口：分别为 `GET /videos/{task_id}`、`GET /video/generations/{task_id}`。

两个 provider 使用相同的顶层 JSON 字段，只区分创建和查询路径。

## 请求字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 原样传入所选上游模型 ID。 |
| `prompt` | string | 是 | 视频提示词。参考素材按输入顺序使用 `@image1`、`@video1`、`@audio1` 等格式引用。 |
| `duration` | integer | 否 | 默认 6 秒；范围 4–30 秒，有视频参考时最多 20 秒。 |
| `ratio` | string | 否 | 默认 `16:9`；支持 `16:9`、`9:16`、`1:1`、`21:9`、`3:4`、`4:3`。 |
| `resolution` | string | 否 | 可选值：`480p`、`720p`、`1080p`；未传时省略该字段。 |
| `images` | string[] | 否 | 最多 30 个公网 HTTPS URL，按顺序使用 `@image1`…引用。 |
| `videos` | string[] | 否 | 最多 10 个公网 HTTPS URL，按顺序使用 `@video1`…引用。 |
| `audios` | string[] | 否 | 最多 10 个公网 HTTPS URL，按顺序使用 `@audio1`…引用。 |
| `generate_audio` | boolean | 否 | 显式发送 true/false；false 不省略。 |

图片、视频、音频分别从 1 编号。提示词引用必须使用 API 要求的英文类型标记，并与同类型素材数组中的有效编号对应；声明式协议只透传 prompt，不会把 `@图片N` 改写成 `@imageN`。调用方必须提供公网 HTTPS URL；插件将 URL 原样传入，不负责校验链接是否可公开访问，也不执行图床上传。

## 创建请求

请求体只发送上述统一字段，不发送 `input`、`parameters`、`image_urls`、`seconds` 或 `aspect_ratio` 等其他协议字段。媒体数组保持输入顺序。

两个创建入口的响应任务 ID 从 `id`、`task_id` 或对应的 `data` 字段读取。创建请求使用 `Idempotency-Key`。

## 查询与结果

响应状态从顶层或 `data.status` 读取；视频地址从 `result_url`、`video_url` 或 `/v1/videos` 风格的 `metadata.url` 读取。结果链接是临时地址，宿主会下载并持久化。

## 兼容边界

该插件仅实现 MaxForAI 文档中的统一请求合同。通用 NewAPI 插件保持原有字段映射，不会被本插件修改。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "maxforai-video",
  "name": "MaxForAI Video",
  "version": "1.0.0",
  "author": "MaxForAI / 影策",
  "description": "MaxForAI unified video API using public HTTPS media URLs.",
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
        "id": "maxforai-videos",
        "label": "MaxForAI Videos",
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
        "baseUrl": "https://maxforai.top/v1",
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
            "description": "上游模型标识，例如官转sd2.5。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "生成提示词，素材按顺序使用 @imageN、@videoN、@audioN 引用。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images[]",
            "description": "最多 30 个公网 HTTPS 图片 URL，顺序对应 @image1 至 @image30。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "videos[]",
            "description": "最多 10 个公网 HTTPS 视频 URL，顺序对应 @video1 至 @video10。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "audios[]",
            "description": "最多 10 个公网 HTTPS 音频 URL，顺序对应 @audio1 至 @audio10。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "生成时长 4–30 秒；含视频参考时最长 20 秒，默认 6 秒。"
          },
          {
            "name": "ratio",
            "type": "string",
            "values": [
              "16:9",
              "9:16",
              "1:1",
              "21:9",
              "3:4",
              "4:3"
            ],
            "mapping": "ratio",
            "description": "画面比例，支持 16:9、9:16、1:1、21:9、3:4、4:3；默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "values": [
              "480p",
              "720p",
              "1080p"
            ],
            "mapping": "resolution",
            "description": "输出分辨率，支持 480p、720p、1080p。"
          },
          {
            "name": "generate_audio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "是否生成音轨；false 也会显式发送。"
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
                30
              ]
            },
            "message": "MaxForAI 视频最多支持 30 张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "MaxForAI 视频最多支持 10 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "MaxForAI 视频最多支持 10 个参考音频"
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
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                }
              ]
            },
            "message": "MaxForAI 视频时长不得少于 4 秒"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                "then": {
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
                      "$lte": [
                        {
                          "$ref": "request.duration"
                        },
                        20
                      ]
                    }
                  ]
                },
                "else": {
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
                      "$lte": [
                        {
                          "$ref": "request.duration"
                        },
                        30
                      ]
                    }
                  ]
                }
              }
            },
            "message": "MaxForAI 视频时长不能超过当前素材模式的上限"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/videos",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$omitEmpty": {
                "$ref": "request.extra.idempotencyKey"
              }
            }
          },
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
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
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
            "generate_audio": {
              "$ref": "request.generateAudio"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/videos/{{taskId}}",
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
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.data.task_id"
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
                "$ref": "response.data.error.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.msg"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.data.result_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.data.url"
              }
            ]
          },
          "errorPaths": [
            "error.code",
            "data.error.code"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "maxforai-video-generations",
        "label": "MaxForAI Video Generations",
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
        "baseUrl": "https://maxforai.top/v1",
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
            "description": "上游模型标识，例如官转sd2.5。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "生成提示词，素材按顺序使用 @imageN、@videoN、@audioN 引用。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images[]",
            "description": "最多 30 个公网 HTTPS 图片 URL，顺序对应 @image1 至 @image30。"
          },
          {
            "name": "videos",
            "type": "media[]",
            "mapping": "videos[]",
            "description": "最多 10 个公网 HTTPS 视频 URL，顺序对应 @video1 至 @video10。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "audios[]",
            "description": "最多 10 个公网 HTTPS 音频 URL，顺序对应 @audio1 至 @audio10。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "生成时长 4–30 秒；含视频参考时最长 20 秒，默认 6 秒。"
          },
          {
            "name": "ratio",
            "type": "string",
            "values": [
              "16:9",
              "9:16",
              "1:1",
              "21:9",
              "3:4",
              "4:3"
            ],
            "mapping": "ratio",
            "description": "画面比例，支持 16:9、9:16、1:1、21:9、3:4、4:3；默认 16:9。"
          },
          {
            "name": "resolution",
            "type": "string",
            "values": [
              "480p",
              "720p",
              "1080p"
            ],
            "mapping": "resolution",
            "description": "输出分辨率，支持 480p、720p、1080p。"
          },
          {
            "name": "generate_audio",
            "type": "boolean",
            "mapping": "generate_audio",
            "description": "是否生成音轨；false 也会显式发送。"
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
                30
              ]
            },
            "message": "MaxForAI 视频最多支持 30 张图片"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                10
              ]
            },
            "message": "MaxForAI 视频最多支持 10 个参考视频"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                10
              ]
            },
            "message": "MaxForAI 视频最多支持 10 个参考音频"
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
                  "$gte": [
                    {
                      "$ref": "request.duration"
                    },
                    4
                  ]
                }
              ]
            },
            "message": "MaxForAI 视频时长不得少于 4 秒"
          },
          {
            "assert": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    0
                  ]
                },
                "then": {
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
                      "$lte": [
                        {
                          "$ref": "request.duration"
                        },
                        20
                      ]
                    }
                  ]
                },
                "else": {
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
                      "$lte": [
                        {
                          "$ref": "request.duration"
                        },
                        30
                      ]
                    }
                  ]
                }
              }
            },
            "message": "MaxForAI 视频时长不能超过当前素材模式的上限"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/video/generations",
          "contentType": "application/json",
          "headers": {
            "Idempotency-Key": {
              "$omitEmpty": {
                "$ref": "request.extra.idempotencyKey"
              }
            }
          },
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
            "ratio": {
              "$coalesce": [
                {
                  "$ref": "request.aspectRatio"
                },
                "16:9"
              ]
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
            "generate_audio": {
              "$ref": "request.generateAudio"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/video/generations/{{taskId}}",
          "contentType": "application/json"
        },
        "response": {
          "taskId": {
            "$coalesce": [
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
                "$ref": "response.task_id"
              },
              {
                "$ref": "response.taskId"
              },
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
                "$ref": "response.data.status"
              },
              {
                "$ref": "response.status"
              },
              "pending"
            ]
          },
          "message": {
            "$coalesce": [
              {
                "$ref": "response.data.error.message"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.data.message"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.msg"
              },
              {
                "$ref": "response.data.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.data.result_url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.data.metadata.url"
              },
              {
                "$ref": "response.data.url"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.metadata.url"
              },
              {
                "$ref": "response.url"
              }
            ]
          },
          "errorPaths": [
            "data.error.code",
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
