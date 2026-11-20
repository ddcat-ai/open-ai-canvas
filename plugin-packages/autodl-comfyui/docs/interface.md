# AutoDL ComfyUI 接口字段

## 协议身份

- 插件 ID：`autodl-comfyui`
- 视频 Provider：`autodl-comfyui`
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
| `model` | string | URL `{workflow_id}` | 原样透传上游工作流 ID；不要求在清单中声明。 |
| `prompt` | string | `prompt` | `minimax_h3_image_audio_to_video` 工作流不发送。 |
| `duration` | integer | `duration` / `audio_duration` | 单图音频同步工作流使用 `audio_duration`。 |
| `resolution` | string | `resolution` | 转小写后发送；管理员可在模型能力中输入预设外的标签。 |
| `images[role=first_frame]` | media | `first_frame` | 首帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| `images[role=last_frame]` | media | `last_frame` | 尾帧工作流优先按 role 选择；旧无 role 请求才按 order 回退。 |
| 普通参考图 | media[] | `ref_image_0` … `ref_image_8` | 过滤 `reference_image/subject_reference/style_reference/edit_source` 后按 order 编号。 |
| `audios` / 参考音频 | media[] | `ref_audio_0` … `ref_audio_2` | 按 order 编号；仅音频相关 H3 工作流发送。 |

## 工作流分支

此插件用于短剧并行出片。编号工作流把 `ref_image_N` 用作普通参考图。专用首尾帧工作流要求同时提供 `first_frame` 和 `last_frame`，适用于手动配置两张关键帧的任务。

| 工作流 | 图片字段 | 音频字段 | 其他差异 |
| --- | --- | --- | --- |
| `minimax_h3_b99_001` | 无 | 无 | 文生视频。 |
| `minimax_h3_lightx2v_no_pic` | 无 | 无 | 文生视频。 |
| `minimax_h3_b99_002` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_lightx2v` | `first_frame/last_frame` | 无 | 显式首尾帧。 |
| `minimax_h3_b99_003_12s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_lightx2v_v5` / `_15s` | `ref_image_0…8` | 无 | 多图参考。 |
| `minimax_h3_zm_u24` / `minimax_h3_zm_u08` | `ref_image_0…8` | 无 | ZM 多参考视频；`@图片1` 对应 `ref_image_0`。 |
| `minimax_h3_zm_u30` | `ref_image_0…8` | `ref_audio_0…2` | ZM 多图多音频。短剧按实际图片槽位将「参考图N」写为 `@图片N`。工作流字段见 [AutoDL 工作流规格](https://autodl.art/api/v1/comfyui/workflows/minimax_h3_zm_u30)。 |
| `minimax_h3_z0901` | 无 | 无 | 文生视频（高质量直出）。 |
| `minimax_h3_z0902` | `ref_image_0…5` | 无 | 六图生视频（多图一致性创作）。 |
| `minimax_h3_z0903` | `ref_image_0…5` | `ref_audio_0…2` | 六图三音频生视频（高质量音画融合）。 |
| `minimax_h3_image_audio_to_video` | `ref_image_0` | `ref_audio_0` | 使用 `audio_duration`，不发送 `prompt/duration`。 |
| `minimax_h3_image_audio_to_video_v2` / `_15s` | `ref_image_0…8` | `ref_audio_0…2` | 多图多音频。 |
| 其他工作流 ID（清单 `*`） | `ref_image_0…8` | `ref_audio_0…2` | 通用透传：全部图片按 order 编号，不区分 role；参考数量由模型能力配置限制。分辨率默认预设 `480p竖/768p竖/960p竖/480p横/768p横/960p横`，默认 `768p竖`。 |

## 响应

- `data.task_id` → 统一任务 ID。
- `data.status` → `pending/processing/succeeded/failed/cancelled`。
- `data.results` → 视频或音频结果列表；音频结果为 `type=audio` 的 wav 地址。
- `data.message` / `msg` → 统一错误消息。
- 结果 URL 按临时地址处理，宿主成功后立即下载并持久化。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "autodl-comfyui",
  "name": "AutoDL ComfyUI 视频与音频",
  "version": "2.5.1",
  "author": "影策社区",
  "description": "通过 AutoDL.Art ComfyUI 工作流 API 接入异步视频生成。",
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
        "videoReferences": {
          "layout": "indexed-images",
          "token": "@图片{n}",
          "dramaTailFrame": "parallel-only",
          "models": {
            "minimax_h3_zm_u30": 9,
            "minimax_h3_zm_u24": 9,
            "minimax_h3_zm_u08": 9,
            "minimax_h3_z0902": 6,
            "minimax_h3_z0903": 6
          }
        },
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
            "description": "输出分辨率标签，原样转小写发送。已声明工作流使用各自枚举；其他工作流默认提供 480p竖、768p竖、960p竖、480p横、768p横、960p横，管理员也可输入上游支持的其他标签。"
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
                        "minimax_h3_zm_u30",
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
                            "$or": [
                              {
                                "$eq": [
                                  {
                                    "$ref": "request.model"
                                  },
                                  "minimax_h3_zm_u30"
                                ]
                              },
                              {
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
                        "minimax_h3_zm_u30",
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
                        "minimax_h3_b99_001",
                        "minimax_h3_b99_003_12s",
                        "minimax_h3_image_audio_to_video_v2_15s",
                        "minimax_h3_lightx2v_v5_15s",
                        "minimax_h3_image_audio_to_video_v2",
                        "minimax_h3_image_audio_to_video",
                        "minimax_h3_lightx2v_v5",
                        "minimax_h3_lightx2v_no_pic",
                        "minimax_h3_lightx2v",
                        "minimax_h3_zm_u24",
                        "minimax_h3_zm_u08",
                        "minimax_h3_zm_u30",
                        "minimax_h3_z0901",
                        "minimax_h3_z0902",
                        "minimax_h3_z0903"
                      ]
                    ]
                  },
                  "then": {},
                  "else": {
                    "$merge": [
                      {
                        "$indexObject": {
                          "from": {
                            "$sortByOrder": {
                              "$ref": "request.images"
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
                      {
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
                      }
                    ]
                  }
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
      },
      {
        "id": "minimax_h3_zm_u30",
        "label": "H3 ZM U30 多图多音频生视频",
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
              "480p横",
              "480p竖",
              "768p横",
              "768p竖",
              "960p横",
              "960p竖"
            ]
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      },
      {
        "id": "*",
        "label": "其他工作流（透传上游模型 ID）",
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
            "description": "视频时长（秒），范围以上游工作流为准。"
          },
          {
            "name": "resolution",
            "type": "string",
            "mapping": "resolution",
            "values": [
              "480p竖",
              "768p竖",
              "960p竖",
              "480p横",
              "768p横",
              "960p横"
            ],
            "description": "默认预设；管理员可输入上游工作流支持的其他分辨率标签。"
          }
        ],
        "defaults": {
          "duration": 5,
          "resolution": "768p竖"
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
