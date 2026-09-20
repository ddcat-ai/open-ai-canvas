# DashScope Qwen / Wan Image 接口字段

## 协议身份

- 插件 ID：`dashscope-qwen-image`。
- Provider ID：`dashscope-qwen-image`。
- 能力：`image`。
- 默认 Base URL：`https://dashscope.aliyuncs.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /api/v1/services/aigc/image-generation/generation`。
- 查询：`GET /api/v1/tasks/{{taskId}}`。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 图片模型 ID。 |
| `prompt` | string | 是 | `prompt` | 图片提示词。 |
| `images` | media[] | 否 | `provider image/reference fields` | 参考图或编辑源图，role 由业务层确定。 |
| `imageCount` | integer | 否 | `n/sample_count` | 输出数量。 |
| `aspectRatio` | string | 否 | `size/aspect_ratio` | 比例或尺寸，语义按协议说明。 |
| `resolution` | string | 否 | `resolution/imageSize` | 分辨率档位。 |
| `quality` | string | 否 | `quality` | 质量档位。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/api/v1/services/aigc/image-generation/generation"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.input.messages[0].role` | `"user"` |
| `create.body.input.messages[0].content` | `{"$concatArrays":[{"$map":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","in":{"image":{"$coalesce":[{"$ref":"media.dataUrl"},{"$ref":"media.url"}]}}}},[{"text":{"$ref":"request.prompt"}}]]}` |
| `create.body.parameters.size` | `{"$omitEmpty":{"$switch":{"cases":[{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1:1"]},"then":"1024*1024"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"3:4"]},"then":"960*1280"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"4:3"]},"then":"1280*960"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"2:3"]},"then":"1024*1536"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"3:2"]},"then":"1536*1024"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"9:16"]},"then":"864*1536"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"16:9"]},"then":"1536*864"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1024x1024"]},"then":"1024*1024"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1024x1536"]},"then":"1024*1536"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1536x1024"]},"then":"1536*1024"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1024x1280"]},"then":"1024*1280"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1280x1024"]},"then":"1280*1024"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"960x1280"]},"then":"960*1280"},{"when":{"$eq":[{"$ref":"request.aspectRatio"},"1280x960"]},"then":"1280*960"}],"default":null}}}` |
| `create.body.parameters.n` | `{"$if":{"condition":{"$gt":[{"$toInt":{"$ref":"request.imageCount"}},0]},"then":{"$toInt":{"$ref":"request.imageCount"}},"else":1}}` |
| `create.body.parameters.prompt_extend` | `true` |
| `create.body.parameters.enable_thinking` | `false` |
| `create.body.parameters.negative_prompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.dashscope-qwen-image.negative_prompt"}}` |
| `create.body.parameters.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.dashscope-qwen-image.seed"}}` |
| `create.body.parameters.watermark` | `{"$omitEmpty":{"$ref":"request.watermark"}}` |
| `create.headers.X-DashScope-Async` | `"enable"` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/api/v1/tasks/{{taskId}}"` |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.dashscope-qwen-image.negative_prompt`
- `providerOptions.dashscope-qwen-image.seed`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.output.task_id"},{"$ref":"response.task_id"},{"$ref":"taskId"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.output.task_status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.output.message"},{"$ref":"response.message"}]}` |
| `response.images` | `{"$map":{"from":{"$ref":"response.output.choices.0.message.content"},"as":"item","in":{"url":{"$omitEmpty":{"$ref":"item.image"}}}}}` |
| `response.errorPaths[0]` | `"code"` |
| `response.errorPaths[1]` | `"output.code"` |
| `response.resultEphemeral` | `true` |
| `response.messagePaths[0]` | `"message"` |
| `response.messagePaths[1]` | `"output.message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

百炼多模态图像端点（image-generation 异步任务）。文生图与图生图共用同一入口：不传 image 为文生图，传 1-3 张 image 为图生图。参考图通过 input.messages[].content[].image 传输（优先 Base64 data URL），不使用 OpenAI 的 /v1/images/edits multipart。size 采用“宽*高”，未登记的档位省略并由模型自动推荐；enable_thinking 固定为 false，因为官方要求非流式调用关闭思考模式。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "dashscope-qwen-image",
  "name": "DashScope Qwen / Wan Image",
  "version": "2.0.0",
  "author": "Alibaba Cloud / 影策",
  "description": "DashScope Qwen / Wan Image 独立请求协议插件。",
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
        "id": "dashscope-qwen-image",
        "label": "DashScope Qwen / Wan Image",
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
        "baseUrl": "https://dashscope.aliyuncs.com",
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
            "description": "图片模型 ID。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "图片提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "参考图或编辑源图，role 由业务层确定。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n/sample_count",
            "description": "输出数量。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "size/aspect_ratio",
            "description": "比例或尺寸，语义按协议说明。"
          },
          {
            "name": "resolution",
            "type": "string",
            "required": false,
            "mapping": "resolution/imageSize",
            "description": "分辨率档位。"
          },
          {
            "name": "quality",
            "type": "string",
            "required": false,
            "mapping": "quality",
            "description": "质量档位。"
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
          "path": "/api/v1/services/aigc/image-generation/generation",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "messages": [
                {
                  "role": "user",
                  "content": {
                    "$concatArrays": [
                      {
                        "$map": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
                            }
                          },
                          "as": "media",
                          "in": {
                            "image": {
                              "$coalesce": [
                                {
                                  "$ref": "media.dataUrl"
                                },
                                {
                                  "$ref": "media.url"
                                }
                              ]
                            }
                          }
                        }
                      },
                      [
                        {
                          "text": {
                            "$ref": "request.prompt"
                          }
                        }
                      ]
                    ]
                  }
                }
              ]
            },
            "parameters": {
              "size": {
                "$omitEmpty": {
                  "$switch": {
                    "cases": [
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1:1"
                          ]
                        },
                        "then": "1024*1024"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "3:4"
                          ]
                        },
                        "then": "960*1280"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "4:3"
                          ]
                        },
                        "then": "1280*960"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "2:3"
                          ]
                        },
                        "then": "1024*1536"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "3:2"
                          ]
                        },
                        "then": "1536*1024"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "9:16"
                          ]
                        },
                        "then": "864*1536"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "16:9"
                          ]
                        },
                        "then": "1536*864"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1024x1024"
                          ]
                        },
                        "then": "1024*1024"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1024x1536"
                          ]
                        },
                        "then": "1024*1536"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1536x1024"
                          ]
                        },
                        "then": "1536*1024"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1024x1280"
                          ]
                        },
                        "then": "1024*1280"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1280x1024"
                          ]
                        },
                        "then": "1280*1024"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "960x1280"
                          ]
                        },
                        "then": "960*1280"
                      },
                      {
                        "when": {
                          "$eq": [
                            {
                              "$ref": "request.aspectRatio"
                            },
                            "1280x960"
                          ]
                        },
                        "then": "1280*960"
                      }
                    ],
                    "default": null
                  }
                }
              },
              "n": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$toInt": {
                          "$ref": "request.imageCount"
                        }
                      },
                      0
                    ]
                  },
                  "then": {
                    "$toInt": {
                      "$ref": "request.imageCount"
                    }
                  },
                  "else": 1
                }
              },
              "prompt_extend": true,
              "enable_thinking": false,
              "negative_prompt": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.dashscope-qwen-image.negative_prompt"
                }
              },
              "seed": {
                "$omitEmpty": {
                  "$ref": "request.providerOptions.dashscope-qwen-image.seed"
                }
              },
              "watermark": {
                "$omitEmpty": {
                  "$ref": "request.watermark"
                }
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
            "$coalesce": [
              {
                "$ref": "response.output.task_status"
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
                "$ref": "response.output.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "images": {
            "$map": {
              "from": {
                "$ref": "response.output.choices.0.message.content"
              },
              "as": "item",
              "in": {
                "url": {
                  "$omitEmpty": {
                    "$ref": "item.image"
                  }
                }
              }
            }
          },
          "errorPaths": [
            "code",
            "output.code"
          ],
          "resultEphemeral": true,
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
