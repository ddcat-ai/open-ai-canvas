# 沧元 Midjourney 接口字段

## 来源与协议身份

- V7：https://ai.cangyuansuanli.cn/docs/models/midjourney-v7
- V8.2 / 1K / 2K：https://ai.cangyuansuanli.cn/docs/models/midjourney-1k
- 模型清单以渠道 `GET /v1/models` 为准：`midjourney-v7`、`midjourney-1k`、`midjourney-2k`。
- 插件 ID `cangyuan-midjourney`；Provider ID `cangyuan-midjourney-v7`、`cangyuan-midjourney-v82`。
- 配置 `apiKey`（secret、必填），由宿主渠道配置提供；鉴权 `Authorization: Bearer <TOKEN>`。
- 创建 `POST /v1/images/generations`；源图编辑 `POST /v1/images/edits`。
- 查询 `GET /v1/images/generations/{task_id}`；编辑查询 `GET /v1/images/edits/{task_id}`。
- 默认同步等待（`async=false`）；保留任务 ID、查询路径以及 pending/completed/failed 的响应解析。
- 不声明取消或单独结果下载端点，供应商未提供相应合同。

## 统一参数与上游请求

| 参数 | 映射与约束 |
| --- | --- |
| `model` | 两条线路分别校验公开模型名，不自动换模型。 |
| `prompt` | 原样传递；V7 最多 4000 字符。1K/2K 可在提示词写 `--v 8.2`，省略版本时由供应商默认 V8.2。 |
| `images` | 依据宿主 role 排序，映射为 HTTPS URL 字符串数组；不能发 data URI 或本地文件。V7 最多 5 张，拒绝蒙版。 |
| `imageCount` | 只能为 1 或未设置，上游固定 `n=1`；返回多张不截断。 |
| `aspectRatio` | 传 `size`；空值或 auto 不发送。V7 支持 1:1 / 16:9 / 9:16 / 4:3 / 3:4 / 3:2 / 2:3 / 5:4 / 4:5 / 21:9 及对应宽x高；默认 16:9。1K/2K 支持 1:2 / 6:11 / 9:16 / 2:3 / 3:4 / 4:5 / 5:6 / 1:1 及其反向比例。 |
| `providerOptions` | 仅 1K/2K 使用 `cangyuan-midjourney-v82.speed`（relax / fast）和 `reference`（image / style / edit / moodboard / editor）。不把速度映射为 quality。 |

`reference=editor` 或宿主显式 `edit_source` 默认走 edits，必须只有一张源图；`reference=edit` 走 generations，最多四张图。mask role 单独映射为 `mask` HTTPS URL，仅 editor 可用。style/moodboard 等含义由调用方显式指定，插件不猜测风格用途。speed 不指定时不发送，沿用供应商默认或 prompt 中的 --fast/--relax；两者同时指定时须一致。

V7 不支持 --v、--niji、--fast、--hd，且不发送 speed、quality、resolution、background、output_format、mask。1K/2K 不发送 quality、resolution、aspect_ratio、background、output_format，不支持 b64_json；不要写 --turbo，1K 不写 --hd。

两条线路均固定 `response_format=url`、`async=false`。请求完整字段、校验表达式与动态端点见下方 Manifest，未列出的字段不透传。

## 响应、保存和错误

- 创建或查询任务 ID：`id` / `task_id`；查询保留当前 task ID。
- 状态读取 `status`，queued/pending 为等待，processing/running 为进行中，completed/succeeded 为完成，failed 为失败。
- 同步 `data[].url` 无 status 时，宿主依据真实图片引用判定完成；遍历全部 data 元素。
- 错误读取 `error.code` 和 `error.message` / `message`；空结果仍失败，不伪造媒体。
- 用量读取 `usage`，不在插件自行计算积分。
- 所有 URL 通过现有宿主 SSRF、跨域凭证隔离、大小/MIME 校验和资源保存。跨源图片不携带供应商 API Key。
- 1K/2K 官方 CDN HTTP 403 与协议字段映射是两件事；新增插件不能保证消除 CDN 拦截。失败保留原任务恢复机制，不提交新的收费生成。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "cangyuan-midjourney",
  "name": "沧元 Midjourney",
  "version": "1.0.0",
  "author": "沧元算力 / 影绘",
  "description": "独立适配 V7 与默认 V8.2 的 1K/2K 线路，按供应商合同创建、查询并提取全部图片。",
  "enabled": true,
  "installable": true,
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
        "id": "cangyuan-midjourney-v7",
        "label": "沧元 Midjourney V7",
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
        "baseUrl": "https://ai.cangyuansuanli.cn/v1",
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
            "description": "供应商公开模型名；两条线路分别校验。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原提示词；1K/2K 默认 V8.2，可写官网 --v / --niji 参数；V7 不支持这些版本参数。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images[] / mask",
            "description": "按宿主显式 role 转换为 HTTPS URL 字符串数组；mask 单独映射。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n=1",
            "description": "一次提交只能为 1，结果 data 可能含多张，全部保存。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "比例或 V7 宽x高；空值和 auto 不发送，沿用供应商默认值。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "cangyuan-midjourney-v82.speed/reference",
            "description": "1K/2K 插件命名空间可指定 speed=relax/fast、reference=image/style/edit/moodboard/editor。V7 没有速度或版本扩展字段。"
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
                  "midjourney-v7"
                ]
              ]
            },
            "message": "模型名与 Midjourney 线路不匹配。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "message": "Midjourney 一次提交 n 只能为 1；返回多张图片会全部保存。"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                0
              ]
            },
            "message": "Midjourney 提示词不能为空。"
          },
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
                        "$ne": [
                          {
                            "$first": {
                              "$split": [
                                {
                                  "$ref": "media.value"
                                },
                                ":"
                              ]
                            }
                          },
                          "https"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Midjourney 参考图和蒙版必须是 HTTPS URL，不能发送本地文件或 data URI。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$filter": {
                      "from": {
                        "$ref": "request.images"
                      },
                      "as": "media",
                      "where": {
                        "$ne": [
                          {
                            "$ref": "media.role"
                          },
                          "mask"
                        ]
                      }
                    }
                  }
                },
                5
              ]
            },
            "message": "Midjourney V7 参考图最多 5 张。"
          },
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
                          "mask"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Midjourney V7 线路不支持蒙版。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.prompt"
                  }
                },
                4000
              ]
            },
            "message": "Midjourney V7 提示词最多 4000 字符。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": 1,
            "size": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      }
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
            },
            "images": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    "as": "media",
                    "in": {
                      "$ref": "media.value"
                    }
                  }
                },
                "else": null
              }
            },
            "response_format": "url",
            "async": false
          },
          "pathTemplate": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$filter": {
                        "from": {
                          "$ref": "request.images"
                        },
                        "as": "media",
                        "where": {
                          "$ne": [
                            {
                              "$ref": "media.role"
                            },
                            "mask"
                          ]
                        }
                      }
                    }
                  },
                  0
                ]
              },
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/images/generations/{{taskId}}",
          "pathTemplate": {
            "$concat": [
              {
                "$if": {
                  "condition": {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "where": {
                              "$ne": [
                                {
                                  "$ref": "media.role"
                                },
                                "mask"
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  "then": "/v1/images/edits",
                  "else": "/v1/images/generations"
                }
              },
              "/",
              {
                "$ref": "taskId"
              }
            ]
          }
        },
        "response": {
          "taskIdPaths": [
            "id",
            "task_id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "url": {
                  "$ref": "item.url"
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          }
        }
      },
      {
        "id": "cangyuan-midjourney-v82",
        "label": "沧元 Midjourney 1K/2K · V8.2",
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
        "baseUrl": "https://ai.cangyuansuanli.cn/v1",
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
            "description": "供应商公开模型名；两条线路分别校验。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原提示词；1K/2K 默认 V8.2，可写官网 --v / --niji 参数；V7 不支持这些版本参数。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images[] / mask",
            "description": "按宿主显式 role 转换为 HTTPS URL 字符串数组；mask 单独映射。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n=1",
            "description": "一次提交只能为 1，结果 data 可能含多张，全部保存。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "mapping": "size",
            "description": "比例或 V7 宽x高；空值和 auto 不发送，沿用供应商默认值。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "cangyuan-midjourney-v82.speed/reference",
            "description": "1K/2K 插件命名空间可指定 speed=relax/fast、reference=image/style/edit/moodboard/editor。V7 没有速度或版本扩展字段。"
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
                  "midjourney-1k",
                  "midjourney-2k"
                ]
              ]
            },
            "message": "模型名与 Midjourney 线路不匹配。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "message": "Midjourney 一次提交 n 只能为 1；返回多张图片会全部保存。"
          },
          {
            "assert": {
              "$gt": [
                {
                  "$len": {
                    "$trim": {
                      "$ref": "request.prompt"
                    }
                  }
                },
                0
              ]
            },
            "message": "Midjourney 提示词不能为空。"
          },
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
                        "$ne": [
                          {
                            "$first": {
                              "$split": [
                                {
                                  "$ref": "media.value"
                                },
                                ":"
                              ]
                            }
                          },
                          "https"
                        ]
                      }
                    }
                  }
                },
                0
              ]
            },
            "message": "Midjourney 参考图和蒙版必须是 HTTPS URL，不能发送本地文件或 data URI。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.cangyuan-midjourney-v82.speed"
                    },
                    "relax"
                  ]
                },
                [
                  "relax",
                  "fast"
                ]
              ]
            },
            "message": "Midjourney speed 只支持 relax 或 fast。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                    },
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
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
                                      "edit_source"
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        "then": "editor",
                        "else": "image"
                      }
                    }
                  ]
                },
                [
                  "image",
                  "style",
                  "edit",
                  "moodboard",
                  "editor"
                ]
              ]
            },
            "message": "Midjourney reference 类型无效。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$not": {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$gt": [
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
                                            "edit_source"
                                          ]
                                        }
                                      }
                                    }
                                  },
                                  0
                                ]
                              },
                              "then": "editor",
                              "else": "image"
                            }
                          }
                        ]
                      },
                      "editor"
                    ]
                  }
                },
                {
                  "$eq": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    1
                  ]
                }
              ]
            },
            "message": "Midjourney editor 只能有一张源图。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$ne": [
                    {
                      "$coalesce": [
                        {
                          "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                        },
                        {
                          "$if": {
                            "condition": {
                              "$gt": [
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
                                          "edit_source"
                                        ]
                                      }
                                    }
                                  }
                                },
                                0
                              ]
                            },
                            "then": "editor",
                            "else": "image"
                          }
                        }
                      ]
                    },
                    "edit"
                  ]
                },
                {
                  "$lte": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    4
                  ]
                }
              ]
            },
            "message": "Midjourney edit 参考图最多 4 张。"
          },
          {
            "assert": {
              "$lte": [
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
                          "mask"
                        ]
                      }
                    }
                  }
                },
                1
              ]
            },
            "message": "Midjourney 蒙版只能有一张。"
          },
          {
            "assert": {
              "$or": [
                {
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
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                {
                  "$and": [
                    {
                      "$eq": [
                        {
                          "$coalesce": [
                            {
                              "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                            },
                            {
                              "$if": {
                                "condition": {
                                  "$gt": [
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
                                              "edit_source"
                                            ]
                                          }
                                        }
                                      }
                                    },
                                    0
                                  ]
                                },
                                "then": "editor",
                                "else": "image"
                              }
                            }
                          ]
                        },
                        "editor"
                      ]
                    },
                    {
                      "$eq": [
                        {
                          "$len": {
                            "$filter": {
                              "from": {
                                "$ref": "request.images"
                              },
                              "as": "media",
                              "where": {
                                "$ne": [
                                  {
                                    "$ref": "media.role"
                                  },
                                  "mask"
                                ]
                              }
                            }
                          }
                        },
                        1
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "蒙版只能用于 editor，且必须有一张源图。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "n": 1,
            "size": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$lower": {
                        "$trim": {
                          "$ref": "request.aspectRatio"
                        }
                      }
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
            },
            "images": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$map": {
                    "from": {
                      "$sortByOrder": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    "as": "media",
                    "in": {
                      "$ref": "media.value"
                    }
                  }
                },
                "else": null
              }
            },
            "response_format": "url",
            "async": false,
            "speed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.cangyuan-midjourney-v82.speed"
              }
            },
            "reference": {
              "$if": {
                "condition": {
                  "$gt": [
                    {
                      "$len": {
                        "$filter": {
                          "from": {
                            "$ref": "request.images"
                          },
                          "as": "media",
                          "where": {
                            "$ne": [
                              {
                                "$ref": "media.role"
                              },
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$coalesce": [
                    {
                      "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                    },
                    {
                      "$if": {
                        "condition": {
                          "$gt": [
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
                                      "edit_source"
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        },
                        "then": "editor",
                        "else": "image"
                      }
                    }
                  ]
                },
                "else": null
              }
            },
            "mask": {
              "$if": {
                "condition": {
                  "$gt": [
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
                              "mask"
                            ]
                          }
                        }
                      }
                    },
                    0
                  ]
                },
                "then": {
                  "$first": {
                    "$map": {
                      "from": {
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
                              "mask"
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
                "else": null
              }
            }
          },
          "pathTemplate": {
            "$if": {
              "condition": {
                "$and": [
                  {
                    "$gt": [
                      {
                        "$len": {
                          "$filter": {
                            "from": {
                              "$ref": "request.images"
                            },
                            "as": "media",
                            "where": {
                              "$ne": [
                                {
                                  "$ref": "media.role"
                                },
                                "mask"
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  },
                  {
                    "$eq": [
                      {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                          },
                          {
                            "$if": {
                              "condition": {
                                "$gt": [
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
                                            "edit_source"
                                          ]
                                        }
                                      }
                                    }
                                  },
                                  0
                                ]
                              },
                              "then": "editor",
                              "else": "image"
                            }
                          }
                        ]
                      },
                      "editor"
                    ]
                  }
                ]
              },
              "then": "/v1/images/edits",
              "else": "/v1/images/generations"
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/images/generations/{{taskId}}",
          "pathTemplate": {
            "$concat": [
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$filter": {
                                "from": {
                                  "$ref": "request.images"
                                },
                                "as": "media",
                                "where": {
                                  "$ne": [
                                    {
                                      "$ref": "media.role"
                                    },
                                    "mask"
                                  ]
                                }
                              }
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$eq": [
                          {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.cangyuan-midjourney-v82.reference"
                              },
                              {
                                "$if": {
                                  "condition": {
                                    "$gt": [
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
                                                "edit_source"
                                              ]
                                            }
                                          }
                                        }
                                      },
                                      0
                                    ]
                                  },
                                  "then": "editor",
                                  "else": "image"
                                }
                              }
                            ]
                          },
                          "editor"
                        ]
                      }
                    ]
                  },
                  "then": "/v1/images/edits",
                  "else": "/v1/images/generations"
                }
              },
              "/",
              {
                "$ref": "taskId"
              }
            ]
          }
        },
        "response": {
          "taskIdPaths": [
            "id",
            "task_id"
          ],
          "statusPaths": [
            "status"
          ],
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ],
          "images": {
            "$map": {
              "from": {
                "$ref": "response.data"
              },
              "as": "item",
              "in": {
                "url": {
                  "$ref": "item.url"
                }
              }
            }
          },
          "usage": {
            "$ref": "response.usage"
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
