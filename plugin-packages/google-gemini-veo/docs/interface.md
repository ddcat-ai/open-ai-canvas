# Google Gemini Veo 接口字段

## 协议身份

- 插件 ID：`google-gemini-veo`。
- Provider ID：`gemini-veo`。
- 能力：`video`。
- 默认 Base URL：`https://generativelanguage.googleapis.com`。
- 鉴权驱动：`google-api-key`。
- 创建：`POST /v1beta/models/{{model}}:predictLongRunning`。
- 查询：`GET /v1beta/{{taskId}}`。

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
| `create.path` | `"/v1beta/models/{{model}}:predictLongRunning"` |
| `create.contentType` | `"application/json"` |
| `create.body.instances[0].prompt` | `{"$ref":"request.prompt"}` |
| `create.body.instances[0].image` | `{"$if":{"condition":{"$gt":[{"$len":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}}},0]},"then":{"$if":{"condition":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}},"as":"media","in":{"$ref":"media.dataUrl"}}}},"then":{"inlineData":{"mimeType":{"$dataMime":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}},"as":"media","in":{"$ref":"media.dataUrl"}}}}},"data":{"$dataPayload":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}},"as":"media","in":{"$ref":"media.dataUrl"}}}}}}},"else":{"fileUri":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}},"as":"media","in":{"$ref":"media.url"}}}},"mimeType":{"$omitEmpty":{"$first":{"$map":{"from":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["first_frame",""]]}}},"as":"media","in":{"$ref":"media.mimeType"}}}}}}}},"else":null}}` |
| `create.body.parameters.aspectRatio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.parameters.durationSeconds` | `{"$omitEmpty":{"$ref":"request.duration"}}` |
| `create.body.parameters.resolution` | `{"$omitEmpty":{"$ref":"request.resolution"}}` |
| `create.body.parameters.generateAudio` | `{"$ref":"request.generateAudio"}` |
| `create.body.parameters.sampleCount` | `{"$omitEmpty":{"$ref":"request.imageCount"}}` |
| `create.body.parameters.negativePrompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-veo.negativePrompt"}}` |
| `create.body.parameters.personGeneration` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-veo.personGeneration"}}` |
| `create.body.parameters.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.gemini-veo.seed"}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1beta/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.gemini-veo.negativePrompt`
- `providerOptions.gemini-veo.personGeneration`
- `providerOptions.gemini-veo.seed`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.name"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$if":{"condition":{"$ref":"response.error"},"then":"failed","else":{"$if":{"condition":{"$ref":"response.done"},"then":"succeeded","else":"processing"}}}}` |
| `response.message` | `{"$ref":"response.error.message"}` |
| `response.videos` | `{"$coalesce":[{"$ref":"response.response.generateVideoResponse.generatedSamples"},{"$ref":"response.response.generatedVideos"},{"$ref":"response.response.videos"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |

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
  "id": "google-gemini-veo",
  "name": "Google Gemini Veo",
  "version": "2.0.0",
  "author": "Google / 影策",
  "description": "Google Gemini Veo 独立请求协议插件。",
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
        "id": "gemini-veo",
        "label": "Google Gemini Veo",
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
        "baseUrl": "https://generativelanguage.googleapis.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "google-api-key",
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
              "$eq": [
                {
                  "$len": {
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
                          "reference_image"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Gemini Veo 当前 profile 不支持角色参考图，请使用首帧输入或支持 reference_to_video 的协议"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1beta/models/{{model}}:predictLongRunning",
          "contentType": "application/json",
          "body": {
            "instances": [
              {
                "prompt": {
                  "$ref": "request.prompt"
                },
                "image": {
                  "$if": {
                    "condition": {
                      "$gt": [
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
                                    "first_frame",
                                    ""
                                  ]
                                ]
                              }
                            }
                          }
                        },
                        0
                      ]
                    },
                    "then": {
                      "$if": {
                        "condition": {
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
                                    "$in": [
                                      {
                                        "$ref": "media.role"
                                      },
                                      [
                                        "first_frame",
                                        ""
                                      ]
                                    ]
                                  }
                                }
                              },
                              "as": "media",
                              "in": {
                                "$ref": "media.dataUrl"
                              }
                            }
                          }
                        },
                        "then": {
                          "inlineData": {
                            "mimeType": {
                              "$dataMime": {
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
                                          "$in": [
                                            {
                                              "$ref": "media.role"
                                            },
                                            [
                                              "first_frame",
                                              ""
                                            ]
                                          ]
                                        }
                                      }
                                    },
                                    "as": "media",
                                    "in": {
                                      "$ref": "media.dataUrl"
                                    }
                                  }
                                }
                              }
                            },
                            "data": {
                              "$dataPayload": {
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
                                          "$in": [
                                            {
                                              "$ref": "media.role"
                                            },
                                            [
                                              "first_frame",
                                              ""
                                            ]
                                          ]
                                        }
                                      }
                                    },
                                    "as": "media",
                                    "in": {
                                      "$ref": "media.dataUrl"
                                    }
                                  }
                                }
                              }
                            }
                          }
                        },
                        "else": {
                          "fileUri": {
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
                                      "$in": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        [
                                          "first_frame",
                                          ""
                                        ]
                                      ]
                                    }
                                  }
                                },
                                "as": "media",
                                "in": {
                                  "$ref": "media.url"
                                }
                              }
                            }
                          },
                          "mimeType": {
                            "$omitEmpty": {
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
                                        "$in": [
                                          {
                                            "$ref": "media.role"
                                          },
                                          [
                                            "first_frame",
                                            ""
                                          ]
                                        ]
                                      }
                                    }
                                  },
                                  "as": "media",
                                  "in": {
                                    "$ref": "media.mimeType"
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    },
                    "else": null
                  }
                }
              }
            ],
            "parameters": {
              "aspectRatio": {
                "$omitEmpty": {
                  "$ref": "request.aspectRatio"
                }
              },
              "durationSeconds": {
                "$omitEmpty": {
                  "$ref": "request.duration"
                }
              },
              "resolution": {
                "$omitEmpty": {
                  "$ref": "request.resolution"
                }
              },
              "generateAudio": {
                "$ref": "request.generateAudio"
              },
              "sampleCount": {
                "$omitEmpty": {
                  "$ref": "request.imageCount"
                }
              },
              "negativePrompt": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-veo.negativePrompt"
                }
              },
              "personGeneration": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-veo.personGeneration"
                }
              },
              "seed": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.gemini-veo.seed"
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1beta/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.name"
              },
              {
                "$ref": "taskId"
              }
            ]
          },
          "status": {
            "$if": {
              "condition": {
                "$ref": "response.error"
              },
              "then": "failed",
              "else": {
                "$if": {
                  "condition": {
                    "$ref": "response.done"
                  },
                  "then": "succeeded",
                  "else": "processing"
                }
              }
            }
          },
          "message": {
            "$ref": "response.error.message"
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.response.generateVideoResponse.generatedSamples"
              },
              {
                "$ref": "response.response.generatedVideos"
              },
              {
                "$ref": "response.response.videos"
              }
            ]
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
