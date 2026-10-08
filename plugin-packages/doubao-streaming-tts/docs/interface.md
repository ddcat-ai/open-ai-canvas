# 豆包音频生成 接口字段

## 协议身份

- 插件 ID：`doubao-streaming-tts`。
- Provider ID：`doubao-streaming-tts`。
- 能力：`audio`。
- 默认 Base URL：`https://openspeech.bytedance.com`。
- 鉴权驱动：`header`。
- 创建：`POST /api/v3/tts/create`。
- 生命周期：同步响应。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 音频模型 ID。 |
| `prompt` | string | 是 | `input` | 待合成文本。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v3/tts/create"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.text_prompt` | `{"$ref":"request.prompt"}` |
| `create.body.references` | `{"$omitEmpty":{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.images"}},0]},"then":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"image_url":{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$ref":"media.source.type"},"url"]},"then":{"$ref":"media.url"},"else":null}}},"image_data":{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$ref":"media.source.type"},"data"]},"then":{"$dataPayload":{"$ref":"media.value"}},"else":null}}}}}},"else":{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.audios"}},0]},"then":{"$concatArrays":[{"$map":{"from":{"$ref":"request.audios"},"as":"media","in":{"audio_url":{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$ref":"media.source.type"},"url"]},"then":{"$ref":"media.url"},"else":null}}},"audio_data":{"$omitEmpty":{"$if":{"condition":{"$eq":[{"$ref":"media.source.type"},"data"]},"then":{"$dataPayload":{"$ref":"media.value"}},"else":null}}}}}},{"$if":{"condition":{"$and":[{"$ref":"request.extra.audioVoice"},{"$lt":[{"$len":{"$ref":"request.audios"}},3]}]},"then":[{"speaker":{"$ref":"request.extra.audioVoice"}}],"else":[]}}]},"else":{"$if":{"condition":{"$ref":"request.extra.audioVoice"},"then":[{"speaker":{"$ref":"request.extra.audioVoice"}}],"else":null}}}}}}}` |
| `create.body.audio_config.format` | `{"$coalesce":[{"$ref":"request.extra.audioFormat"},"mp3"]}` |
| `create.body.audio_config.speech_rate` | `{"$omitEmpty":{"$if":{"condition":{"$ne":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},0]},"then":{"$add":[{"$multiply":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},100]},-100]},"else":null}}}` |
| `create.headers.X-Api-Request-Id` | `{"$ref":"request.extra.idempotencyKey"}` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.errorPaths[0]` | `"code"` |
| `response.messagePaths[0]` | `"message"` |
| `response.status` | `"succeeded"` |
| `response.resultKind` | `"audio"` |
| `response.audios` | `{"$if":{"condition":{"$ref":"response.url"},"then":{"url":{"$ref":"response.url"},"ephemeral":true},"else":{"$if":{"condition":{"$ref":"response.audio"},"then":{"dataUrl":{"$ref":"response.audio"},"mimeType":{"$if":{"condition":{"$eq":[{"$ref":"request.extra.audioFormat"},"wav"]},"then":"audio/wav","else":{"$if":{"condition":{"$eq":[{"$ref":"request.extra.audioFormat"},"pcm"]},"then":"audio/pcm","else":{"$if":{"condition":{"$eq":[{"$ref":"request.extra.audioFormat"},"ogg_opus"]},"then":"audio/ogg","else":"audio/mpeg"}}}}}}},"else":null}}}}` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

火山引擎 seed-audio-1.0 非流式音频生成。POST /api/v3/tts/create。不传 references 为纯文本生成；连接音频时写入 references 的 audio_url 或 audio_data，最多 3 段，参考音频少于 3 段且指定了音色时再追加一个 speaker；连接图片时写入 image_url 或 image_data，最多 1 张。图片和音频不能同时使用。没有参考素材时，speaker 只在用户明确指定音色时发送，且官方仅接受语音合成 2.0 音色或复刻音色。text_prompt 引用参考音频时使用 @Audio1、@Audio2。响应是单个 JSON，audio 为 Base64，url 两小时过期。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "doubao-streaming-tts",
  "name": "豆包音频生成",
  "version": "2.0.0",
  "author": "Volcengine / 影策",
  "description": "豆包音频生成 独立请求协议插件。",
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
        "id": "doubao-streaming-tts",
        "label": "豆包音频生成",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://openspeech.bytedance.com",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "X-Api-Key"
        },
        "parameters": [
          {
            "name": "model",
            "type": "string",
            "required": true,
            "mapping": "model",
            "description": "音频模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "input",
            "description": "待合成文本。"
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
          "path": "/api/v3/tts/create",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "text_prompt": {
              "$ref": "request.prompt"
            },
            "references": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$map": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "in": {
                        "image_url": {
                          "$omitEmpty": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "media.source.type"
                                  },
                                  "url"
                                ]
                              },
                              "then": {
                                "$ref": "media.url"
                              },
                              "else": null
                            }
                          }
                        },
                        "image_data": {
                          "$omitEmpty": {
                            "$if": {
                              "condition": {
                                "$eq": [
                                  {
                                    "$ref": "media.source.type"
                                  },
                                  "data"
                                ]
                              },
                              "then": {
                                "$dataPayload": {
                                  "$ref": "media.value"
                                }
                              },
                              "else": null
                            }
                          }
                        }
                      }
                    }
                  },
                  "else": {
                    "$if": {
                      "condition": {
                        "$gt": [
                          {
                            "$len": {
                              "$ref": "request.audios"
                            }
                          },
                          0
                        ]
                      },
                      "then": {
                        "$concatArrays": [
                          {
                            "$map": {
                              "from": {
                                "$ref": "request.audios"
                              },
                              "as": "media",
                              "in": {
                                "audio_url": {
                                  "$omitEmpty": {
                                    "$if": {
                                      "condition": {
                                        "$eq": [
                                          {
                                            "$ref": "media.source.type"
                                          },
                                          "url"
                                        ]
                                      },
                                      "then": {
                                        "$ref": "media.url"
                                      },
                                      "else": null
                                    }
                                  }
                                },
                                "audio_data": {
                                  "$omitEmpty": {
                                    "$if": {
                                      "condition": {
                                        "$eq": [
                                          {
                                            "$ref": "media.source.type"
                                          },
                                          "data"
                                        ]
                                      },
                                      "then": {
                                        "$dataPayload": {
                                          "$ref": "media.value"
                                        }
                                      },
                                      "else": null
                                    }
                                  }
                                }
                              }
                            }
                          },
                          {
                            "$if": {
                              "condition": {
                                "$and": [
                                  {
                                    "$ref": "request.extra.audioVoice"
                                  },
                                  {
                                    "$lt": [
                                      {
                                        "$len": {
                                          "$ref": "request.audios"
                                        }
                                      },
                                      3
                                    ]
                                  }
                                ]
                              },
                              "then": [
                                {
                                  "speaker": {
                                    "$ref": "request.extra.audioVoice"
                                  }
                                }
                              ],
                              "else": []
                            }
                          }
                        ]
                      },
                      "else": {
                        "$if": {
                          "condition": {
                            "$ref": "request.extra.audioVoice"
                          },
                          "then": [
                            {
                              "speaker": {
                                "$ref": "request.extra.audioVoice"
                              }
                            }
                          ],
                          "else": null
                        }
                      }
                    }
                  }
                }
              }
            },
            "audio_config": {
              "format": {
                "$coalesce": [
                  {
                    "$ref": "request.extra.audioFormat"
                  },
                  "mp3"
                ]
              },
              "speech_rate": {
                "$omitEmpty": {
                  "$if": {
                    "condition": {
                      "$ne": [
                        {
                          "$toFloat": {
                            "$ref": "request.extra.audioSpeed"
                          }
                        },
                        0
                      ]
                    },
                    "then": {
                      "$add": [
                        {
                          "$multiply": [
                            {
                              "$toFloat": {
                                "$ref": "request.extra.audioSpeed"
                              }
                            },
                            100
                          ]
                        },
                        -100
                      ]
                    },
                    "else": null
                  }
                }
              }
            }
          },
          "headers": {
            "X-Api-Request-Id": {
              "$ref": "request.extra.idempotencyKey"
            }
          }
        },
        "response": {
          "errorPaths": [
            "code"
          ],
          "messagePaths": [
            "message"
          ],
          "status": "succeeded",
          "resultKind": "audio",
          "audios": {
            "$if": {
              "condition": {
                "$ref": "response.url"
              },
              "then": {
                "url": {
                  "$ref": "response.url"
                },
                "ephemeral": true
              },
              "else": {
                "$if": {
                  "condition": {
                    "$ref": "response.audio"
                  },
                  "then": {
                    "dataUrl": {
                      "$ref": "response.audio"
                    },
                    "mimeType": {
                      "$if": {
                        "condition": {
                          "$eq": [
                            {
                              "$ref": "request.extra.audioFormat"
                            },
                            "wav"
                          ]
                        },
                        "then": "audio/wav",
                        "else": {
                          "$if": {
                            "condition": {
                              "$eq": [
                                {
                                  "$ref": "request.extra.audioFormat"
                                },
                                "pcm"
                              ]
                            },
                            "then": "audio/pcm",
                            "else": {
                              "$if": {
                                "condition": {
                                  "$eq": [
                                    {
                                      "$ref": "request.extra.audioFormat"
                                    },
                                    "ogg_opus"
                                  ]
                                },
                                "then": "audio/ogg",
                                "else": "audio/mpeg"
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
          }
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
