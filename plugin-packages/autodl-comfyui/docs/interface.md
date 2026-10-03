# AutoDL ComfyUI 接口字段

## 协议身份

- 插件 ID：`autodl-comfyui`
- 视频 Provider：`autodl-comfyui`
- 音频 Provider：`autodl-comfyui-audio`
- 创建：`POST /api/v1/comfyui/comfyui_workflow/{workflow_id}`
- 查询：`GET /api/v1/comfyui/comfyui_workflow/result/{task_id}`
- 鉴权：`Authorization: <AutoDL Token>`

## 配置字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | AutoDL Token，由宿主写入 Authorization 请求头。 |

## 视频统一字段

| 统一字段 | 类型 | 上游映射 | 规则 |
| --- | --- | --- | --- |
| `model` | string | URL `{workflow_id}` | 必须是清单中工作流 ID。 |
| `prompt` | string | `prompt` | `minimax_h3_image_audio_to_video` 工作流不发送。 |
| `duration` | integer | `duration` / `audio_duration` | 单图音频同步工作流使用 `audio_duration`。 |
| `resolution` | string | `resolution` | 转小写后发送。 |
| `images[role=first_frame]` | media | `first_frame` | 首帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| `images[role=last_frame]` | media | `last_frame` | 尾帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| 普通参考图 | media[] | `ref_image_0` … `ref_image_8` | 过滤 `reference_image/subject_reference/style_reference/edit_source` 后按 order 编号。 |
| `audios` / 参考音频 | media[] | `ref_audio_0` … `ref_audio_2` | 按 order 编号；仅音频相关 H3 工作流发送。 |

## 工作流分支

| 工作流 | 图片字段 | 音频字段 | 其他差异 |
| --- | --- | --- | --- |
| `minimax_h3_b99_001` | 无 | 无 | 文生视频。 |
| `minimax_h3_lightx2v_no_pic` | 无 | 无 | 文生视频。 |
| `minimax_h3_b99_002` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_lightx2v` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_b99_003_12s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_lightx2v_v5` / `_15s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_zm_u24` / `minimax_h3_zm_u08` | `ref_image_0…8` | 无 | ZM 多参考视频；`@图片1` 对应 `ref_image_0`。 |
| `minimax_h3_z0901` | 无 | 无 | 文生视频（高质量直出）。 |
| `minimax_h3_z0902` | `ref_image_0…5` | 无 | 六图生视频（多图一致性创作）。 |
| `minimax_h3_z0903` | `ref_image_0…5` | `ref_audio_0…2` | 六图三音频生视频（高质量音画融合）。 |
| `minimax_h3_image_audio_to_video` | `ref_image_0` | `ref_audio_0` | 使用 `audio_duration`，不发送 `prompt/duration`。 |
| `minimax_h3_image_audio_to_video_v2` / `_15s` | `ref_image_0…8` | `ref_audio_0…2` | 多图多音频。 |

## 音频字段

| 统一字段 | 上游映射 | 说明 |
| --- | --- | --- |
| `prompt` | `prompt_text` | 待合成文本。 |
| 第一项参考音频 | `prompt_simple` | 按 order 选择第一项。 |
| 固定控制方式 | `emo_control_method` | 发送 `与音色参考音频相同`。 |

## 响应

- `data.task_id` → 统一任务 ID。
- `data.status` → `pending/processing/succeeded/failed/cancelled`。
- `data.results` → 视频或音频结果列表。
- `data.message` / `msg` → 统一错误消息。
- 结果 URL 按临时地址处理，宿主成功后立即下载并持久化。

## 取消语义

- `autodl-comfyui`：不可验证上游取消；当前协议 profile 未提供可验证的上游取消端点；宿主只能停止后续轮询，不能宣称上游任务已取消。
- `autodl-comfyui-audio`：不可验证上游取消；当前协议 profile 未提供可验证的上游取消端点；宿主只能停止后续轮询，不能宣称上游任务已取消。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "autodl-comfyui",
  "name": "AutoDL ComfyUI 视频与音频",
  "version": "2.3.0",
  "author": "影策",
  "description": "通过 AutoDL.Art ComfyUI 工作流 API 接入异步视频与音频生成，新增 H3 Z0901 文生视频、Z0902 六图生视频与 Z0903 六图三音频生视频工作流。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "AutoDL Token",
        "required": true,
        "description": "填写 AutoDL 大模型令牌管理中创建的 ComfyUI 分组 Token。"
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "autodl-comfyui",
        "label": "AutoDL ComfyUI 视频",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "https://autodl.art",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "Authorization"
        },
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频生成提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长（秒）。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "description": "输出分辨率档位，如 480p竖、768p竖、1080p竖、480p横、768p横、1080p横、480p(1:1)、768p(1:1) 等。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "first_frame/last_frame 或 ref_image_N",
            "description": "先按 first_frame、last_frame、reference_image 等 role 分流，再按 order 为工作流生成 ref_image_N；不再用数组 0/1 猜测角色。"
          },
          {
            "name": "audios",
            "type": "media[]",
            "mapping": "ref_audio_N",
            "description": "按 order 生成 ref_audio_N，最多取工作流支持的前三项。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/comfyui/comfyui_workflow/{{model}}",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "prompt": {
                  "$if": {
                    "condition": {
                      "$ne": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax_h3_image_audio_to_video"
                      ]
                    },
                    "then": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                "duration": {
                  "$if": {
                    "condition": {
                      "$ne": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax_h3_image_audio_to_video"
                      ]
                    },
                    "then": {
                      "$ref": "request.duration"
                    }
                  }
                },
                "audio_duration": {
                  "$if": {
                    "condition": {
                      "$eq": [
                        {
                          "$ref": "request.model"
                        },
                        "minimax_h3_image_audio_to_video"
                      ]
                    },
                    "then": {
                      "$ref": "request.duration"
                    }
                  }
                },
                "resolution": {
                  "$omitEmpty": {
                    "$lower": {
                      "$ref": "request.resolution"
                    }
                  }
                }
              },
              {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "minimax_h3_b99_003_12s",
                        "minimax_h3_image_audio_to_video_v2_15s",
                        "minimax_h3_lightx2v_v5_15s",
                        "minimax_h3_image_audio_to_video_v2",
                        "minimax_h3_lightx2v_v5",
                        "minimax_h3_zm_u24",
                        "minimax_h3_zm_u08",
                        "minimax_h3_z0902",
                        "minimax_h3_z0903"
                      ]
                    ]
                  },
                  "then": {
                    "$indexObject": {
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
                                "reference_image",
                                "subject_reference",
                                "style_reference",
                                "edit_source",
                                ""
                              ]
                            ]
                          }
                        }
                      },
                      "as": "media",
                      "prefix": "ref_image_",
                      "max": 9,
                      "value": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": {}
                }
              },
              {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "minimax_h3_b99_002",
                        "minimax_h3_lightx2v"
                      ]
                    ]
                  },
                  "then": {
                    "first_frame": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
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
                                      "$eq": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "first_frame"
                                      ]
                                    }
                                  }
                                },
                                "as": "media",
                                "in": {
                                  "$ref": "media.value"
                                }
                              }
                            }
                          },
                          {
                            "$at": [
                              {
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
                              },
                              0
                            ]
                          }
                        ]
                      }
                    },
                    "last_frame": {
                      "$omitEmpty": {
                        "$coalesce": [
                          {
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
                                      "$eq": [
                                        {
                                          "$ref": "media.role"
                                        },
                                        "last_frame"
                                      ]
                                    }
                                  }
                                },
                                "as": "media",
                                "in": {
                                  "$ref": "media.value"
                                }
                              }
                            }
                          },
                          {
                            "$at": [
                              {
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
                              },
                              1
                            ]
                          }
                        ]
                      }
                    }
                  },
                  "else": {}
                }
              },
              {
                "$if": {
                  "condition": {
                    "$eq": [
                      {
                        "$ref": "request.model"
                      },
                      "minimax_h3_image_audio_to_video"
                    ]
                  },
                  "then": {
                    "ref_image_0": {
                      "$omitEmpty": {
                        "$first": {
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
                  "else": {}
                }
              },
              {
                "$if": {
                  "condition": {
                    "$in": [
                      {
                        "$ref": "request.model"
                      },
                      [
                        "minimax_h3_image_audio_to_video",
                        "minimax_h3_image_audio_to_video_v2",
                        "minimax_h3_image_audio_to_video_v2_15s",
                        "minimax_h3_z0903"
                      ]
                    ]
                  },
                  "then": {
                    "$indexObject": {
                      "from": {
                        "$sortByOrder": {
                          "$ref": "request.audios"
                        }
                      },
                      "as": "media",
                      "prefix": "ref_audio_",
                      "max": 3,
                      "value": {
                        "$ref": "media.value"
                      }
                    }
                  },
                  "else": {}
                }
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/comfyui/comfyui_workflow/result/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id"
          ],
          "statusPaths": [
            "data.status"
          ],
          "errorPaths": [
            "code"
          ],
          "messagePaths": [
            "data.message",
            "msg"
          ],
          "resultPaths": [
            "data.results"
          ],
          "resultKind": "video",
          "resultEphemeral": true
        },
        "nonCancelable": {
          "reason": "当前协议 profile 未提供可验证的上游取消端点；宿主只能停止后续轮询，不能宣称上游任务已取消。"
        }
      },
      {
        "id": "autodl-comfyui-audio",
        "label": "AutoDL ComfyUI 语音",
        "capabilities": [
          "audio"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "https://autodl.art",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "Authorization"
        },
        "parameters": [
          {
            "name": "prompt_text",
            "type": "string",
            "required": true,
            "mapping": "prompt_text",
            "description": "语音合成文本。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/comfyui/comfyui_workflow/{{model}}",
          "contentType": "application/json",
          "body": {
            "prompt_text": {
              "$ref": "request.prompt"
            },
            "prompt_simple": {
              "$omitEmpty": {
                "$first": {
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
              }
            },
            "emo_control_method": "与音色参考音频相同"
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/comfyui/comfyui_workflow/result/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id"
          ],
          "statusPaths": [
            "data.status"
          ],
          "errorPaths": [
            "code"
          ],
          "messagePaths": [
            "data.message",
            "msg"
          ],
          "resultPaths": [
            "data.results"
          ],
          "resultKind": "audio",
          "resultEphemeral": true
        },
        "nonCancelable": {
          "reason": "当前协议 profile 未提供可验证的上游取消端点；宿主只能停止后续轮询，不能宣称上游任务已取消。"
        }
      }
    ],
    "workflows": [
      {
        "id": "minimax_h3_b99_002",
        "label": "H3 首尾帧生成视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "736p竖",
              "736p横",
              "736p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "736p竖"
        }
      },
      {
        "id": "minimax_h3_b99_001",
        "label": "H3 文生视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "736p竖",
              "736p横",
              "736p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "736p竖"
        }
      },
      {
        "id": "minimax_h3_b99_003_12s",
        "label": "H3 多图生视频 12 秒",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~12 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "736p竖",
              "736p横",
              "736p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "736p竖"
        }
      },
      {
        "id": "minimax_h3_image_audio_to_video_v2_15s",
        "label": "H3 多图多音频生视频 15 秒",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_lightx2v_v5_15s",
        "label": "H3 多图生视频 15 秒",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横",
              "480p(1:1)",
              "768p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_image_audio_to_video_v2",
        "label": "H3 多图多音频生视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~10 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "1080p竖",
              "480p横",
              "768p横",
              "1080p横"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_image_audio_to_video",
        "label": "H3 图生视频音频同步",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "audio_duration",
            "type": "integer",
            "mapping": "duration",
            "description": "音频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "1080p竖",
              "480p横",
              "768p横",
              "1080p横"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_lightx2v_v5",
        "label": "H3 多图参考生视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~10 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "1080p竖",
              "480p横",
              "768p横",
              "1080p横",
              "480p(1:1)",
              "768p(1:1)",
              "1080p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_lightx2v_no_pic",
        "label": "H3 文生视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_lightx2v",
        "label": "H3 首尾帧生成视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "indextts2-v1",
        "label": "IndexTTS2 语音",
        "providerId": "autodl-comfyui-audio",
        "capability": "audio",
        "parameters": [
          {
            "name": "prompt_text",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          }
        ],
        "defaults": {}
      },
      {
        "id": "minimax_h3_zm_u24",
        "label": "H3 ZM U24 多参考视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横",
              "480p(1:1)",
              "768p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_zm_u08",
        "label": "H3 ZM U08 多参考视频",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "480p横",
              "768p横",
              "480p(1:1)",
              "768p(1:1)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "minimax_h3_z0901",
        "label": "H3 文生视频（高质量直出）",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖(480*864)",
              "480p横(864*480)",
              "768p竖(768*1344)",
              "768p横(1344*768)",
              "1088p竖(1088*1920)",
              "1088p横(1920*1088)",
              "1440p竖(1440*2560)",
              "1440p横(2560*1440)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖(768*1344)"
        }
      },
      {
        "id": "minimax_h3_z0902",
        "label": "H3 六图生视频（多图一致性创作）",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖(480*864)",
              "480p横(864*480)",
              "768p竖(768*1376)",
              "768p横(1376*768)",
              "1088p竖(1088*1920)",
              "1088p横(1920*1088)",
              "1440p竖(1440*2560)",
              "1440p横(2560*1440)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖(768*1376)"
        }
      },
      {
        "id": "minimax_h3_z0903",
        "label": "H3 六图三音频生视频（高质量音画融合）",
        "providerId": "autodl-comfyui",
        "capability": "video",
        "parameters": [
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt"
          },
          {
            "name": "duration",
            "type": "integer",
            "mapping": "duration",
            "description": "视频时长 1~15 秒"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖(480*864)",
              "480p横(864*480)",
              "768p竖(768*1376)",
              "768p横(1376*768)",
              "1088p竖(1088*1920)",
              "1088p横(1920*1088)",
              "1440p竖(1440*2560)",
              "1440p横(2560*1440)"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖(768*1376)"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
