# EvoLink 豆包 Seed Audio 1.0 接口字段

## 协议身份

- 插件 ID：`evolink-seed-audio`。
- Provider ID：`evolink-seed-audio`。
- 能力：`audio`。
- 默认 Base URL：`https://api.evolink.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/audios/generations`。
- 查询：`GET /v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 模型 ID，使用 doubao-seed-audio-1-0。 |
| `prompt` | string | 是 | `prompt` | 待生成的台词与声音指令。 |
| `audios` | media[] | 否 | `audio_references` | 最多三段参考音频，按顺序对应 @audio1 至 @audio3。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/audios/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.audio_references` | `{"$omitEmpty":{"$if":{"condition":{"$gt":[{"$len":{"$ref":"request.audios"}},0]},"then":{"$map":{"from":{"$sortByOrder":{"$ref":"request.audios"}},"as":"media","in":{"$ref":"media.uploadId"}}},"else":null}}}` |
| `create.body.format` | `{"$coalesce":[{"$ref":"request.extra.audioFormat"},"mp3"]}` |
| `create.body.speech_rate` | `{"$coalesce":[{"$if":{"condition":{"$ne":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},0]},"then":{"$toFloat":{"$ref":"request.extra.audioSpeed"}},"else":null}},1]}` |
| `create.body.sample_rate` | `24000` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/tasks/{{taskId}}"` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.audios` | `{"$coalesce":[{"$ref":"response.result_data.0.audio_url"},{"$ref":"response.results.0"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

EvoLink Seed Audio 1.0：参考音频先经 EvoLink 文件服务上传，再以 file_url 提交异步任务；输出 URL 由宿主下载保存。图片参考暂不接入该插件。

---

# EvoLink Qwen Audio 3.1 TTS Flash 接口字段

## 协议身份

- 插件 ID：`evolink-seed-audio`。
- Provider ID：`evolink-qwen-audio-tts`。
- 能力：`audio`。
- 默认 Base URL：`https://api.evolink.ai`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/audios/generations`。
- 查询：`GET /v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 固定为 qwen-audio-3.1-tts-flash。 |
| `prompt` | string | 是 | `prompt` | 待合成文本，最多 5000 字符。 |
| `providerOptions` | object | 否 | `voice/instruction/response_format/speech_rate` | 音色、声音指令、格式与语速由画布音频设置提供。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/audios/generations"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.voice` | `{"$coalesce":[{"$ref":"request.extra.audioVoice"},"longanhuan_v3.1"]}` |
| `create.body.instruction` | `{"$omitEmpty":{"$ref":"request.extra.audioInstructions"}}` |
| `create.body.response_format` | `{"$coalesce":[{"$ref":"request.extra.audioFormat"},"mp3"]}` |
| `create.body.speech_rate` | `{"$coalesce":[{"$if":{"condition":{"$ne":[{"$toFloat":{"$ref":"request.extra.audioSpeed"}},0]},"then":{"$toFloat":{"$ref":"request.extra.audioSpeed"}},"else":null}},1]}` |
| `create.body.sample_rate` | `24000` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/v1/tasks/{{taskId}}"` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.error.message"},{"$ref":"response.message"},{"$ref":"response.fail_reason"}]}` |
| `response.audios` | `{"$coalesce":[{"$ref":"response.result_data.0.audio_url"},{"$ref":"response.results.0"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.messagePaths[0]` | `"error.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

EvoLink Qwen Audio 3.1 TTS Flash 只接受文本合成；参考音频需要先通过独立的 voice-enrollment 模型创建临时音色，本插件不隐式上传或复刻。输出 URL 由宿主及时下载保存。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "evolink-seed-audio",
  "name": "EvoLink 音频模型",
  "version": "2.0.0",
  "author": "EvoLink / 影策",
  "description": "EvoLink 音频模型 独立请求协议插件。",
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
        "id": "evolink-seed-audio",
        "label": "EvoLink 豆包 Seed Audio 1.0",
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
        "baseUrl": "https://api.evolink.ai",
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
            "description": "模型 ID，使用 doubao-seed-audio-1-0。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "待生成的台词与声音指令。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "required": false,
            "mapping": "audio_references",
            "description": "最多三段参考音频，按顺序对应 @audio1 至 @audio3。"
          }
        ],
        "validations": [
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
            "message": "EvoLink Seed Audio 最多支持三段参考音频"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                0
              ]
            },
            "message": "当前 EvoLink Seed Audio 插件暂不支持参考图片"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "EvoLink Seed Audio 不支持参考视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/audios/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "audio_references": {
              "$omitEmpty": {
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
                    "$map": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
                        }
                      },
                      "as": "media",
                      "in": {
                        "$ref": "media.uploadId"
                      }
                    }
                  },
                  "else": null
                }
              }
            },
            "format": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioFormat"
                },
                "mp3"
              ]
            },
            "speech_rate": {
              "$coalesce": [
                {
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
                      "$toFloat": {
                        "$ref": "request.extra.audioSpeed"
                      }
                    },
                    "else": null
                  }
                },
                1
              ]
            },
            "sample_rate": 24000
          }
        },
        "upload": {
          "kinds": [
            "audio"
          ],
          "method": "POST",
          "path": "/api/v1/files/upload/stream",
          "contentType": "multipart/form-data",
          "files": [
            {
              "name": "file",
              "source": {
                "$ref": "media.value"
              },
              "filename": {
                "$coalesce": [
                  {
                    "$ref": "media.name"
                  },
                  "reference.wav"
                ]
              },
              "mimeType": {
                "$ref": "media.mimeType"
              }
            }
          ],
          "id": {
            "$ref": "response.data.file_url"
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
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
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.result_data.0.audio_url"
              },
              {
                "$ref": "response.results.0"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "messagePaths": [
            "error.message"
          ]
        }
      },
      {
        "id": "evolink-qwen-audio-tts",
        "label": "EvoLink Qwen Audio 3.1 TTS Flash",
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
        "baseUrl": "https://api.evolink.ai",
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
            "description": "固定为 qwen-audio-3.1-tts-flash。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "待合成文本，最多 5000 字符。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "voice/instruction/response_format/speech_rate",
            "description": "音色、声音指令、格式与语速由画布音频设置提供。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                5000
              ]
            },
            "message": "Qwen Audio TTS 文本最多 5000 字符"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.audios"
                  }
                },
                0
              ]
            },
            "message": "Qwen Audio TTS 不直接接受参考音频，请使用已有音色 ID"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                0
              ]
            },
            "message": "Qwen Audio TTS 不接受参考图片"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                0
              ]
            },
            "message": "Qwen Audio TTS 不接受参考视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/audios/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "voice": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioVoice"
                },
                "longanhuan_v3.1"
              ]
            },
            "instruction": {
              "$omitEmpty": {
                "$ref": "request.extra.audioInstructions"
              }
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioFormat"
                },
                "mp3"
              ]
            },
            "speech_rate": {
              "$coalesce": [
                {
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
                      "$toFloat": {
                        "$ref": "request.extra.audioSpeed"
                      }
                    },
                    "else": null
                  }
                },
                1
              ]
            },
            "sample_rate": 24000
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
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
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "audios": {
            "$coalesce": [
              {
                "$ref": "response.result_data.0.audio_url"
              },
              {
                "$ref": "response.results.0"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "resultEphemeral": true,
          "usage": {
            "$ref": "response.usage"
          },
          "messagePaths": [
            "error.message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
