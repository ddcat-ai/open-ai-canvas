# StarRouter 专用媒体接口

配置字段 `apiKey` 使用 StarRouter 模型调用 Key，以 Bearer 方式认证。相同渠道可配置多个协议，不从返回的排队 URL 取请求地址。

| 协议 | 提交和结果 |
| --- | --- |
| `starrouter-gpt-image-26` | 用于 `gpt-image-2.6-flare` 和 `gpt-image-2.6-sunburst`。无参考图用 JSON `POST /v1/images/generations`；有参考图用 multipart `POST /v1/images/edits`（单图 `image`、多图 `image[]`）。 |
| `starrouter-ctyun-video` | `/ctyun/seedance/contents/generations/tasks` 创建，用响应 `id` 查询原路径下的任务，结果是 `content.video_url`。按型号配置首帧、首尾帧或全模态参考之一。 |
| `starrouter-ctyun-image` | `/ctyun/seedance/images/generations` 文生图，响应是 `data[].url`。 |
| `starrouter-happyhorse` | `/aliyun/happyhorse/video-synthesis/raw` 创建，`/aliyun/happyhorse/tasks/{taskId}` 查询；解析 `output.task_id`、`output.task_status` 和 `output.video_url`。 |
| `starrouter-tokenhub-kling` | `/v1/wand/kling` 下按文生、图生或 Omni 提交，`tasks/{taskId}` 查询，结果在 `data[].outputs`。 |
| `starrouter-tokenhub-vidu` | `/v1/wand/vidu` 下按文生、图生、参考图或首尾帧提交，`tasks/{taskId}` 查询，结果在 `creations[].url`。 |
| `starrouter-vclm-kling` / `starrouter-vclm-vidu` | `/tencent/vclm/kling` 或 `/tencent/vclm/vidu` 提交文生视频，`/v1/videos/{taskId}` 查询兼容响应，读取 `metadata.url`。不声称支持未映射的 VCLM 原生 Action。 |
| `starrouter-fal-h3` | `/v1/fal/minimax/h3-max-turbo` 下文生或图生，可用两个上游型号分别配置；轮询 `requests/{taskId}/status` 后读取同一路线的 `requests/{taskId}`，解析 `video.url`。 |
| `starrouter-doubao-image` | `/volcengine/doubao/images/generations` 透传文生图及图片参考，响应是 `data[].url`。 |
| `starrouter-comfly-video` | `/comfly/v1/videos` 提交 `model` 和 `metadata.prompt`，按响应 `id` 查询、下载或取消；仅适用于声明该输入字段的工作流。 |
| `starrouter-comfly-video-subtitle-removal` | `comfly/1194` 去字幕，只映射一个源视频到 `metadata.input_video`。 |
| `starrouter-comfly-video-depth` | `comfly/1776` 相对深度，只映射一个源视频到 `metadata.input_video`。 |
| `starrouter-comfly-video-upscale` | `comfly/1849` 超分，只映射一个源视频到 `metadata.input_video`。 |
| `starrouter-doubao-speech` | `/volcengine/doubao/audio/speech` 提交语音合成，响应为二进制音频。 |

GPT Image 2.6 的 `size` 按 OpenAI 图片生成指南配置：自动尺寸省略字段；推荐尺寸为 `1024x1024`、`1536x1024`、`1024x1536`。自定义宽高均须为 16 的倍数，最长边不超过 3840 像素，宽高比在 1:3 至 3:1 之间，总像素在 655360 至 8294400 之间。默认输出 PNG；选择 GIF 后传送 `frame_count`（2–16，默认 9）与 `frame_duration_ms`（至少 20，默认 200），静态格式不发送这两个字段。该协议不开放蒙版或 SVG。

规格、模型分组、语音音色和可用操作按上游型号配置。CosyVoice WebSocket、实时对话、语音识别和天翼素材库管理不属于本包的生成任务协议。

三个 Comfly 处理协议为 `kind=processing`，不接受图片或音频参考，不透传提示词、分辨率、帧率和任意 providerOptions。每个协议校验对应上游型号，完整请求与返回合同见 [Comfly 视频处理](comfly-video-processing.md)。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "starrouter-media",
  "name": "StarRouter 专用媒体协议",
  "version": "1.2.1",
  "author": "Yingce",
  "description": "StarRouter 的天翼、腾讯、HappyHorse、fal、豆包和 Comfly 媒体生成与视频处理线路。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "StarRouter API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "starrouter-gpt-image-26",
        "label": "StarRouter GPT Image 2.6",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "尺寸",
            "type": "string",
            "binding": "aspectRatio",
            "encoding": "pixels",
            "description": "输入宽x高；宽高须为 16 的倍数，最长边不超过 3840px，宽高比在 1:3 至 3:1 之间，总像素为 655360 至 8294400。",
            "default": "auto",
            "pricing": true
          },
          {
            "name": "outputFormat",
            "label": "输出格式",
            "type": "string",
            "binding": "providerOptions.starrouter-gpt-image-26.output_format",
            "values": [
              "png",
              "jpeg",
              "webp",
              "gif"
            ],
            "default": "png"
          },
          {
            "name": "gifFrameCount",
            "label": "GIF 帧数",
            "type": "integer",
            "binding": "providerOptions.starrouter-gpt-image-26.frame_count",
            "min": 2,
            "max": 16,
            "default": 9
          },
          {
            "name": "gifFrameDurationMs",
            "label": "GIF 每帧延迟（毫秒）",
            "type": "integer",
            "binding": "providerOptions.starrouter-gpt-image-26.frame_duration_ms",
            "min": 20,
            "default": 200
          }
        ],
        "validations": [
          {
            "assert": {
              "$in": [
                {
                  "$ref": "request.model"
                },
                [
                  "gpt-image-2.6-flare",
                  "gpt-image-2.6-sunburst"
                ]
              ]
            },
            "message": "此协议仅支持 StarRouter 的 GPT Image 2.6 Flare 和 Sunburst"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "pathTemplate": {
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
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          },
          "contentType": "application/json",
          "contentTypeTemplate": {
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
              "then": "multipart/form-data",
              "else": "application/json"
            }
          },
          "files": [
            {
              "name": "image",
              "source": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$ref": "request.images"
                  },
                  "else": null
                }
              }
            },
            {
              "name": "image[]",
              "source": {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$sortByOrder": {
                      "$ref": "request.images"
                    }
                  },
                  "else": null
                }
              }
            }
          ],
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "request.aspectRatio"
                      },
                      [
                        "",
                        "auto"
                      ]
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            },
            "output_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.starrouter-gpt-image-26.output_format"
                },
                "png"
              ]
            },
            "frame_count": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.providerOptions.starrouter-gpt-image-26.output_format"
                      },
                      "gif"
                    ]
                  },
                  "then": {
                    "$ref": "request.providerOptions.starrouter-gpt-image-26.frame_count"
                  },
                  "else": null
                }
              }
            },
            "frame_duration_ms": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.providerOptions.starrouter-gpt-image-26.output_format"
                      },
                      "gif"
                    ]
                  },
                  "then": {
                    "$ref": "request.providerOptions.starrouter-gpt-image-26.frame_duration_ms"
                  },
                  "else": null
                }
              }
            }
          }
        },
        "response": {
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "url": {
                  "$omitEmpty": {
                    "$ref": "item.url"
                  }
                },
                "b64_json": {
                  "$omitEmpty": {
                    "$ref": "item.b64_json"
                  }
                },
                "output_format": {
                  "$omitEmpty": {
                    "$coalesce": [
                      {
                        "$ref": "item.output_format"
                      },
                      {
                        "$ref": "response.output_format"
                      }
                    ]
                  }
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code",
            "error.message"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-ctyun-video",
        "label": "StarRouter 天翼 Seedance",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "videoReferences": {
          "layout": "content",
          "token": "参考图{n}"
        },
        "create": {
          "method": "POST",
          "path": "/ctyun/seedance/contents/generations/tasks",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "content": {
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
                      "$ref": "request.videos"
                    },
                    "as": "media",
                    "in": {
                      "type": "video_url",
                      "video_url": {
                        "url": {
                          "$ref": "media.value"
                        }
                      },
                      "role": "reference_video"
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
                          "$ref": "media.value"
                        }
                      },
                      "role": "reference_audio"
                    }
                  }
                }
              ]
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
            "generate_audio": {
              "$ref": "request.generateAudio"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/ctyun/seedance/contents/generations/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "resultURLPaths": [
            "content.video_url"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-ctyun-image",
        "label": "StarRouter 天翼 Seedream",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
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
            "message": "此线路只开放天翼文生图"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/ctyun/seedance/images/generations",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$omitEmpty": {
                "$upper": {
                  "$ref": "request.resolution"
                }
              }
            },
            "response_format": "url",
            "stream": false,
            "sequential_image_generation": "disabled",
            "watermark": {
              "$ref": "request.watermark"
            }
          }
        },
        "response": {
          "resultKind": "image",
          "status": "succeeded",
          "images": {
            "$ref": "response.data"
          },
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-happyhorse",
        "label": "StarRouter 阿里云 HappyHorse",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "create": {
          "method": "POST",
          "path": "/aliyun/happyhorse/video-synthesis/raw",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "prompt": {
                "$ref": "request.prompt"
              },
              "media": {
                "$omitEmpty": {
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
                            "$concat": [
                              "reference_",
                              {
                                "$ref": "media.kind"
                              }
                            ]
                          }
                        ]
                      },
                      "url": {
                        "$ref": "media.value"
                      }
                    }
                  }
                }
              }
            },
            "parameters": {
              "duration": {
                "$omitEmpty": {
                  "$ref": "request.duration"
                }
              },
              "resolution": {
                "$omitEmpty": {
                  "$upper": {
                    "$ref": "request.resolution"
                  }
                }
              },
              "ratio": {
                "$omitEmpty": {
                  "$ref": "request.aspectRatio"
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/aliyun/happyhorse/tasks/{{taskId}}",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "output.task_id"
          ],
          "statusPaths": [
            "output.task_status"
          ],
          "resultURLPaths": [
            "output.video_url"
          ],
          "messagePaths": [
            "output.message",
            "message"
          ],
          "errorPaths": [
            "code",
            "output.code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-tokenhub-kling",
        "label": "StarRouter 腾讯 TokenHub Kling",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
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
            "message": "TokenHub Kling 此协议未开放音频输入"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/wand/kling/text-to-video",
          "contentType": "application/json",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$or": [
                  {
                    "$in": [
                      {
                        "$ref": "request.operation"
                      },
                      [
                        "reference_to_video",
                        "video_to_video"
                      ]
                    ]
                  },
                  {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "kling-video-v3-omni",
                        "kling-video-o1-token"
                      ]
                    ]
                  }
                ]
              },
              "then": "/v1/wand/kling/omni-video",
              "else": {
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
                  "then": "/v1/wand/kling/image-to-video",
                  "else": "/v1/wand/kling/text-to-video"
                }
              }
            }
          },
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$or": [
                      {
                        "$in": [
                          {
                            "$ref": "request.operation"
                          },
                          [
                            "reference_to_video",
                            "video_to_video"
                          ]
                        ]
                      },
                      {
                        "$in": [
                          {
                            "$ref": "request.model"
                          },
                          [
                            "kling-video-v3-omni",
                            "kling-video-o1-token"
                          ]
                        ]
                      }
                    ]
                  },
                  "then": null,
                  "else": {
                    "$ref": "request.prompt"
                  }
                }
              }
            },
            "contents": {
              "$omitEmpty": {
                "$concatArrays": [
                  {
                    "$if": {
                      "condition": {
                        "$or": [
                          {
                            "$in": [
                              {
                                "$ref": "request.operation"
                              },
                              [
                                "reference_to_video",
                                "video_to_video"
                              ]
                            ]
                          },
                          {
                            "$in": [
                              {
                                "$ref": "request.model"
                              },
                              [
                                "kling-video-v3-omni",
                                "kling-video-o1-token"
                              ]
                            ]
                          }
                        ]
                      },
                      "then": [
                        {
                          "type": "prompt",
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
                        "$sortByOrder": {
                          "$ref": "request.images"
                        }
                      },
                      "as": "media",
                      "in": {
                        "type": {
                          "$coalesce": [
                            {
                              "$ref": "media.role"
                            },
                            "first_frame"
                          ]
                        },
                        "url": {
                          "$ref": "media.value"
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
                        "type": "reference_video",
                        "url": {
                          "$ref": "media.value"
                        }
                      }
                    }
                  }
                ]
              }
            },
            "settings": {
              "$omitEmpty": {
                "duration": {
                  "$omitEmpty": {
                    "$ref": "request.duration"
                  }
                },
                "resolution": {
                  "$omitEmpty": {
                    "$ref": "request.resolution"
                  }
                },
                "aspect_ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                }
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/wand/kling/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.id"
          ],
          "statusPaths": [
            "data.status"
          ],
          "status": {
            "$ref": "response.data.0.status"
          },
          "videos": {
            "$ref": "response.data.0.outputs"
          },
          "messagePaths": [
            "data.0.message",
            "message"
          ],
          "errorPaths": [
            "code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-tokenhub-vidu",
        "label": "StarRouter 腾讯 TokenHub Vidu",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$add": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    }
                  ]
                },
                0
              ]
            },
            "message": "TokenHub Vidu 此协议只接收图片引用"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/wand/vidu/text-to-video",
          "contentType": "application/json",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "request.operation"
                  },
                  "reference_to_video"
                ]
              },
              "then": "/v1/wand/vidu/reference-to-video",
              "else": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      2
                    ]
                  },
                  "then": "/v1/wand/vidu/start-end-to-video",
                  "else": {
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
                      "then": "/v1/wand/vidu/image-to-video",
                      "else": "/v1/wand/vidu/text-to-video"
                    }
                  }
                }
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
            "duration": {
              "$omitEmpty": {
                "$ref": "request.duration"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/wand/vidu/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "task_id"
          ],
          "statusPaths": [
            "state"
          ],
          "videos": {
            "$ref": "response.creations"
          },
          "messagePaths": [
            "message",
            "err_code"
          ],
          "errorPaths": [
            "err_code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-vclm-kling",
        "label": "StarRouter 腾讯 VCLM Kling",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.inputs"
                  }
                },
                0
              ]
            },
            "message": "此协议仅开放 VCLM Kling 文生视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/tencent/vclm/kling",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "Action": "SubmitTextToVideoJob",
            "Prompt": {
              "$ref": "request.prompt"
            },
            "Duration": {
              "$omitEmpty": {
                "$toString": {
                  "$ref": "request.duration"
                }
              }
            },
            "AspectRatio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "Mode": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.starrouter-vclm-kling.mode"
              }
            },
            "Sound": {
              "$if": {
                "condition": {
                  "$ref": "request.generateAudio"
                },
                "then": "on",
                "else": "off"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "resultURLPaths": [
            "metadata.url"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-vclm-vidu",
        "label": "StarRouter 腾讯 VCLM Vidu",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.inputs"
                  }
                },
                0
              ]
            },
            "message": "此协议仅开放 VCLM Vidu 文生视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/tencent/vclm/vidu",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "Action": "SubmitTextToVideoViduJob",
            "Prompt": {
              "$ref": "request.prompt"
            },
            "Duration": {
              "$omitEmpty": {
                "$ref": "request.duration"
              }
            },
            "AspectRatio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "Resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "resultURLPaths": [
            "metadata.url"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-fal-h3",
        "label": "StarRouter fal H3 Max Turbo",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$or": [
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax/h3-max-turbo/text-to-video"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        0
                      ]
                    }
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax/h3-max-turbo/image-to-video"
                      ]
                    },
                    {
                      "$in": [
                        {
                          "$len": {
                            "$ref": "request.images"
                          }
                        },
                        [
                          1,
                          2
                        ]
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "fal H3 上游型号必须匹配文生视频或首帧/首尾帧图生视频模式"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$add": [
                    {
                      "$len": {
                        "$ref": "request.videos"
                      }
                    },
                    {
                      "$len": {
                        "$ref": "request.audios"
                      }
                    }
                  ]
                },
                0
              ]
            },
            "message": "fal H3 此协议只接收图片引用"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/fal/minimax/h3-max-turbo/text-to-video",
          "contentType": "application/json",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "request.model"
                  },
                  "minimax/h3-max-turbo/image-to-video"
                ]
              },
              "then": "/v1/fal/minimax/h3-max-turbo/image-to-video",
              "else": "/v1/fal/minimax/h3-max-turbo/text-to-video"
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
              "$omitEmpty": {
                "$ref": "request.duration"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$upper": {
                  "$ref": "request.resolution"
                }
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "image_url": {
              "$omitEmpty": {
                "$ref": "request.images.0.value"
              }
            },
            "end_image_url": {
              "$omitEmpty": {
                "$ref": "request.images.1.value"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/fal/minimax/h3-max-turbo/text-to-video/requests/{{taskId}}/status",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "request.model"
                  },
                  "minimax/h3-max-turbo/image-to-video"
                ]
              },
              "then": "/v1/fal/minimax/h3-max-turbo/image-to-video/requests/{{taskId}}/status",
              "else": "/v1/fal/minimax/h3-max-turbo/text-to-video/requests/{{taskId}}/status"
            }
          }
        },
        "result": {
          "method": "GET",
          "path": "/v1/fal/minimax/h3-max-turbo/text-to-video/requests/{{taskId}}",
          "pathTemplate": {
            "$if": {
              "condition": {
                "$eq": [
                  {
                    "$ref": "request.model"
                  },
                  "minimax/h3-max-turbo/image-to-video"
                ]
              },
              "then": "/v1/fal/minimax/h3-max-turbo/image-to-video/requests/{{taskId}}",
              "else": "/v1/fal/minimax/h3-max-turbo/text-to-video/requests/{{taskId}}"
            }
          }
        },
        "response": {
          "taskIdPaths": [
            "request_id"
          ],
          "statusPaths": [
            "status"
          ],
          "resultURLPaths": [
            "video.url"
          ],
          "messagePaths": [
            "error",
            "detail",
            "message"
          ],
          "errorPaths": [
            "error",
            "error_type"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-doubao-image",
        "label": "StarRouter 火山豆包生图",
        "capabilities": [
          "image"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "create": {
          "method": "POST",
          "path": "/volcengine/doubao/images/generations",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "image": {
              "$omitEmpty": {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$len": {
                          "$ref": "request.images"
                        }
                      },
                      1
                    ]
                  },
                  "then": {
                    "$ref": "request.images.0.value"
                  },
                  "else": {
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
            "size": {
              "$omitEmpty": {
                "$upper": {
                  "$ref": "request.resolution"
                }
              }
            },
            "response_format": "url",
            "watermark": {
              "$ref": "request.watermark"
            }
          }
        },
        "response": {
          "resultKind": "image",
          "status": "succeeded",
          "images": {
            "$ref": "response.data"
          },
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "resultEphemeral": true
        }
      },
      {
        "id": "starrouter-comfly-video",
        "label": "StarRouter Comfly 视频",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.inputs"
                  }
                },
                0
              ]
            },
            "message": "Comfly 视频的参考素材字段随工作流变化，此协议只开放提示词输入"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/comfly/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "metadata": {
              "prompt": {
                "$ref": "request.prompt"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}/content",
          "originPath": true
        },
        "cancel": {
          "method": "POST",
          "path": "/comfly/v1/videos/{{taskId}}/cancel",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "usage": {
            "$ref": "response.usage"
          }
        }
      },
      {
        "id": "starrouter-comfly-video-subtitle-removal",
        "label": "StarRouter Comfly 视频去字幕",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "metadata.input_video",
            "description": "单个源视频；工作流只公开 input_video，不接受提示词或输出规格。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "comfly/1194"
              ]
            },
            "message": "此协议仅支持 comfly/1194"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                1
              ]
            },
            "message": "视频处理需要且只能提交一个源视频"
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
            "message": "视频处理不接受参考图片"
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
            "message": "视频处理不接受参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/comfly/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": "comfly/1194",
            "metadata": {
              "input_video": {
                "$ref": "request.videos.0.value"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}/content",
          "originPath": true
        },
        "cancel": {
          "method": "POST",
          "path": "/comfly/v1/videos/{{taskId}}/cancel",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "usage": {
            "$ref": "response.usage"
          }
        }
      },
      {
        "id": "starrouter-comfly-video-depth",
        "label": "StarRouter Comfly 相对深度视频",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "metadata.input_video",
            "description": "单个源视频；工作流只公开 input_video，不接受提示词或输出规格。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "comfly/1776"
              ]
            },
            "message": "此协议仅支持 comfly/1776"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                1
              ]
            },
            "message": "视频处理需要且只能提交一个源视频"
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
            "message": "视频处理不接受参考图片"
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
            "message": "视频处理不接受参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/comfly/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": "comfly/1776",
            "metadata": {
              "input_video": {
                "$ref": "request.videos.0.value"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}/content",
          "originPath": true
        },
        "cancel": {
          "method": "POST",
          "path": "/comfly/v1/videos/{{taskId}}/cancel",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "usage": {
            "$ref": "response.usage"
          }
        }
      },
      {
        "id": "starrouter-comfly-video-upscale",
        "label": "StarRouter Comfly 视频超分",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas"
        ],
        "baseUrl": "https://starrouter.io",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "metadata.input_video",
            "description": "单个源视频；工作流只公开 input_video，不接受提示词或输出规格。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$eq": [
                {
                  "$ref": "request.model"
                },
                "comfly/1849"
              ]
            },
            "message": "此协议仅支持 comfly/1849"
          },
          {
            "assert": {
              "$eq": [
                {
                  "$len": {
                    "$ref": "request.videos"
                  }
                },
                1
              ]
            },
            "message": "视频处理需要且只能提交一个源视频"
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
            "message": "视频处理不接受参考图片"
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
            "message": "视频处理不接受参考音频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/comfly/v1/videos",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": "comfly/1849",
            "metadata": {
              "input_video": {
                "$ref": "request.videos.0.value"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}",
          "originPath": true
        },
        "result": {
          "method": "GET",
          "path": "/comfly/v1/videos/{{taskId}}/content",
          "originPath": true
        },
        "cancel": {
          "method": "POST",
          "path": "/comfly/v1/videos/{{taskId}}/cancel",
          "originPath": true
        },
        "response": {
          "taskIdPaths": [
            "id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code",
            "code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "usage": {
            "$ref": "response.usage"
          }
        }
      },
      {
        "id": "starrouter-doubao-speech",
        "label": "StarRouter 火山豆包语音合成",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://starrouter.io",
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "create": {
          "method": "POST",
          "path": "/volcengine/doubao/audio/speech",
          "originPath": true,
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "input": {
              "$ref": "request.prompt"
            },
            "voice": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioVoice"
                },
                "zh_male_M392_conversation_wvae_bigtts"
              ]
            },
            "response_format": {
              "$coalesce": [
                {
                  "$ref": "request.extra.audioFormat"
                },
                "mp3"
              ]
            }
          }
        },
        "response": {
          "binaryPayload": true,
          "resultKind": "audio",
          "status": "succeeded",
          "messagePaths": [
            "error.message",
            "message"
          ],
          "errorPaths": [
            "error.code"
          ]
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
