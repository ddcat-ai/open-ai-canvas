# 卡藏 Midjourney 生图接口

## 来源、模型和边界

供应商文档：[文档首页](https://console.prompt-hubs.com/docs)、[V8.2 特惠](https://console.prompt-hubs.com/docs/model/Midjourney%20v8.2-%E7%89%B9%E6%83%A0)、[V7 特惠](https://console.prompt-hubs.com/docs/model/Midjourney%20v7-%E7%89%B9%E6%83%A0)、[V8.2 稳定](https://console.prompt-hubs.com/docs/model/mj-v8.2)、[V8.2 高速](https://console.prompt-hubs.com/docs/model/Midjourney%20v8.2%20%E9%AB%98%E9%80%9F)。以具体参数表为准；页面通用提示可能与某型号的输出说明不同，插件按实际返回保存全部图片，不按文档样例的图片数量截断。

| Provider | 公开模型 ID | 创建 | 查询 |
| --- | --- | --- | --- |
| `kacang-midjourney-special` | `Midjourney v8.2-特惠`、`Midjourney v8.1-特惠`、`Midjourney v6.1-特惠`、`Midjourney v6-特惠` | `POST /v1/images/generations` | 如果返回任务 ID，使用 `GET /v1/tasks/{task_id}` |
| `kacang-midjourney-v7` | `Midjourney v7-特惠` | 同上 | 同上 |
| `kacang-midjourney` | `mj-v8.2`、`mj-v8.1`、`mj-v6.1`、`mj-v7`、`mj-niji7`、`Midjourney v8.2 高速` | `POST /v1/midjourney/generations` | `GET /v1/tasks/{task_id}` |

默认 Base URL：`https://newapi.prompt-hubs.com/v1`；鉴权：`Authorization: Bearer <API Key>`。API Key 由宿主渠道配置提供，不写入插件包、任务正文或 URL。实际可用模型以该渠道令牌的 `/v1/models` 返回为准，不自动更换模型。

本插件只提供图片生成及参考图生成。供应商后续 `action`、父任务操作和 describe 文本结果需要独立的交互合同，本生图入口不透传这些字段。

## 统一请求与默认能力

| 宿主参数 | 上游映射与约束 |
| --- | --- |
| `model` | `model`，严格校验当前协议公开模型列表。 |
| `prompt` | 原样传递，不能为空；不自动翻译或追加 Midjourney 提示词参数。 |
| `aspectRatio` | `size`；V6/V8 特惠默认 16:9，允许 1:1、3:2、2:3、4:3、3:4、5:4、4:5、16:9、9:16、21:9。V7 特惠增加 auto、9:21；稳定/高速同样增加这两个值，默认 9:16。 |
| `images` | 以显式顺序生成 `images` URL 数组；特惠最多 1 张，稳定/高速最多 5 张。宿主将本地资源转换为短期公网 URL。拒绝 mask。 |
| `imageCount` | 未设置或 1；上游固定 `n=1`，不是返回图片的截断数量。 |
| `providerOptions.kacang-midjourney.raw` | 稳定/高速 `raw`，默认 false。 |
| `providerOptions.kacang-midjourney.quality` | 仅稳定 `mj-*`，数值 0.25、0.5、1、2，默认 1。不使用宿主 `quality` 的 1K/2K/4K 值。 |
| `providerOptions.kacang-midjourney.stylize/chaos/weird` | 仅稳定 `mj-*`，默认 100/0/0，范围分别 0–1000、0–100、0–3000。 |
| `providerOptions.kacang-midjourney.iw/cw/sw/dw` | 仅稳定 `mj-*`；可选，范围 0–3、0–100、0–1000、0–100。 |
| `providerOptions.kacang-midjourney.seed/negative_prompt/tile/cref/sref/dref` | 仅稳定 `mj-*`；调用方明确指定时才发送，不设未声明的默认值。 |
| `providerOptions.kacang-midjourney.hd` | 仅 mj-v8.2 / mj-v8.1，默认 false。 |

特惠不发送 Raw 或稳定版扩展字段；高速只发送 Raw。所有协议均不发送 resolution、透明背景、response_format、output_format、async 或 Prefer 请求头。

“能力与参数”自动配置：参考图上限为 1 或 5，无蒙版，比例选择不可输入自定义像素，单次请求数量 1；不支持的通用输出控件关闭。宿主提示词默认上限 32000 字符、参考图单张 30 MB，属于宿主限制，上游未声明这两个上限。1K 预设只用于宿主比例选择与界面尺寸换算，不承诺实际输出像素。稳定版数值画质与风格参数由插件命名空间映射，不伪装成分辨率选项。

## 响应、失败与保存

- 任务 ID：优先 `data.task_id`，其次 `task_id` / `id`，查询时保留原 task ID。
- 状态：读取 `data.status` / `status`；submitted / queued 为等待，processing 为进行中，completed 为成功，failed 为失败。
- 特惠同步结果：遍历 `data[].url`；没有 status 的真实图片结果仍按宿主合同完成。
- 稳定/高速结果：同时支持 `data.result.data.image_urls` 和 `result.data.image_urls`。可选 `grid_image_url` 一并保存，若它已经在 image_urls 中则不重复。
- 错误：读取 `data.error_code` / `error_code` / `error.code`，以及对应 error_message / error.message。失败和空结果不会生成伪资源。
- 返回 URL 标记 `resultEphemeral=true`，宿主立即下载并存入已配置对象存储。跨源下载不携带供应商 API Key。
- 供应商托管链接有有效期；生成成功不等于转存成功，最终必须以宿主资源 ready 与任务成功为准。已有任务只查询，不重新生成。
- 取消和独立结果下载端点未声明；供应商未提供适用于本生图入口的相应合同。

请求示例：`{"model":"mj-v8.2","prompt":"生成一张氛围感美女照片","size":"9:16","raw":false,"quality":1,"stylize":100,"chaos":0,"weird":0,"hd":false,"n":1}`。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "kacang-midjourney",
  "name": "卡藏 Midjourney",
  "version": "1.0.0",
  "author": "影绘",
  "description": "适配卡藏特惠、V7特惠与稳定/高速生图，按公开模型合同映射请求并查询、保存全部结果。",
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
        "id": "kacang-midjourney-special",
        "label": "卡藏 Midjourney 特惠 V6/V8",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "values": [
              "Midjourney v8.2-特惠",
              "Midjourney v8.1-特惠",
              "Midjourney v6.1-特惠",
              "Midjourney v6-特惠"
            ],
            "mapping": "model",
            "description": "卡藏公开 API 模型 ID，必须与所选协议一致。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原样保留提示词；上游仅声明不能为空。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "values": [
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "16:9",
              "9:16",
              "21:9"
            ],
            "mapping": "size",
            "description": "默认 16:9；仅发送已确认的比例，不发送像素或 resolution。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "按显式顺序发送参考图 URL 数组；最多 1 张，不支持蒙版。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n=1",
            "description": "一次请求固定 n=1，宿主保存所有返回单图及可选四宫格封面。"
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
                  "Midjourney v8.2-特惠",
                  "Midjourney v8.1-特惠",
                  "Midjourney v6.1-特惠",
                  "Midjourney v6-特惠"
                ]
              ]
            },
            "message": "模型名与卡藏 Midjourney 协议不匹配。"
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
              "$in": [
                {
                  "$ref": "request.imageCount"
                },
                [
                  0,
                  1
                ]
              ]
            },
            "message": "Midjourney 一次提交只能 n=1，所有返回图片仍会保存。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                1
              ]
            },
            "message": "当前卡藏 Midjourney 参考图最多 1 张。"
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
            "message": "卡藏 Midjourney 生图协议不支持蒙版。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$trim": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    "16:9"
                  ]
                },
                [
                  "1:1",
                  "3:2",
                  "2:3",
                  "4:3",
                  "3:4",
                  "5:4",
                  "4:5",
                  "16:9",
                  "9:16",
                  "21:9"
                ]
              ]
            },
            "message": "当前卡藏 Midjourney 不支持此比例。"
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
            "size": {
              "$coalesce": [
                {
                  "$trim": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "16:9"
              ]
            },
            "n": 1,
            "images": {
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
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id",
            "task_id",
            "id"
          ],
          "statusPaths": [
            "data.status",
            "status"
          ],
          "errorPaths": [
            "data.error_code",
            "error_code",
            "error.code"
          ],
          "messagePaths": [
            "data.error_message",
            "error_message",
            "error.message",
            "message"
          ],
          "resultEphemeral": true,
          "usage": {
            "$coalesce": [
              {
                "$ref": "response.data.usage"
              },
              {
                "$ref": "response.usage"
              }
            ]
          },
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
          }
        }
      },
      {
        "id": "kacang-midjourney-v7",
        "label": "卡藏 Midjourney V7 特惠",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "values": [
              "Midjourney v7-特惠"
            ],
            "mapping": "model",
            "description": "卡藏公开 API 模型 ID，必须与所选协议一致。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原样保留提示词；上游仅声明不能为空。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "values": [
              "auto",
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "16:9",
              "9:16",
              "21:9",
              "9:21"
            ],
            "mapping": "size",
            "description": "默认 16:9；仅发送已确认的比例，不发送像素或 resolution。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "按显式顺序发送参考图 URL 数组；最多 1 张，不支持蒙版。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n=1",
            "description": "一次请求固定 n=1，宿主保存所有返回单图及可选四宫格封面。"
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
                  "Midjourney v7-特惠"
                ]
              ]
            },
            "message": "模型名与卡藏 Midjourney 协议不匹配。"
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
              "$in": [
                {
                  "$ref": "request.imageCount"
                },
                [
                  0,
                  1
                ]
              ]
            },
            "message": "Midjourney 一次提交只能 n=1，所有返回图片仍会保存。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                1
              ]
            },
            "message": "当前卡藏 Midjourney 参考图最多 1 张。"
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
            "message": "卡藏 Midjourney 生图协议不支持蒙版。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$trim": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    "16:9"
                  ]
                },
                [
                  "auto",
                  "1:1",
                  "3:2",
                  "2:3",
                  "4:3",
                  "3:4",
                  "5:4",
                  "4:5",
                  "16:9",
                  "9:16",
                  "21:9",
                  "9:21"
                ]
              ]
            },
            "message": "当前卡藏 Midjourney 不支持此比例。"
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
            "size": {
              "$coalesce": [
                {
                  "$trim": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "16:9"
              ]
            },
            "n": 1,
            "images": {
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
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id",
            "task_id",
            "id"
          ],
          "statusPaths": [
            "data.status",
            "status"
          ],
          "errorPaths": [
            "data.error_code",
            "error_code",
            "error.code"
          ],
          "messagePaths": [
            "data.error_message",
            "error_message",
            "error.message",
            "message"
          ],
          "resultEphemeral": true,
          "usage": {
            "$coalesce": [
              {
                "$ref": "response.data.usage"
              },
              {
                "$ref": "response.usage"
              }
            ]
          },
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
          }
        }
      },
      {
        "id": "kacang-midjourney",
        "label": "卡藏 Midjourney 稳定/高速",
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
        "baseUrl": "https://newapi.prompt-hubs.com/v1",
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
            "values": [
              "mj-v8.2",
              "mj-v8.1",
              "mj-v6.1",
              "mj-v7",
              "mj-niji7",
              "Midjourney v8.2 高速"
            ],
            "mapping": "model",
            "description": "卡藏公开 API 模型 ID，必须与所选协议一致。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "原样保留提示词；上游仅声明不能为空。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "values": [
              "auto",
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "16:9",
              "9:16",
              "21:9",
              "9:21"
            ],
            "mapping": "size",
            "description": "默认 9:16；仅发送已确认的比例，不发送像素或 resolution。"
          },
          {
            "name": "images",
            "type": "media[]",
            "mapping": "images",
            "description": "按显式顺序发送参考图 URL 数组；最多 5 张，不支持蒙版。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "mapping": "n=1",
            "description": "一次请求固定 n=1，宿主保存所有返回单图及可选四宫格封面。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "mapping": "kacang-midjourney.raw/quality/stylize/chaos/weird/seed/negative_prompt/tile/iw/cref/sref/dref/cw/sw/dw/hd",
            "description": "默认 raw=false；稳定 mj-* 的数值 quality 默认1，不能将1K/2K分辨率作为quality。高速版仅映射raw。后续action任务不属于本生图插件。"
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
                  "mj-v8.2",
                  "mj-v8.1",
                  "mj-v6.1",
                  "mj-v7",
                  "mj-niji7",
                  "Midjourney v8.2 高速"
                ]
              ]
            },
            "message": "模型名与卡藏 Midjourney 协议不匹配。"
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
              "$in": [
                {
                  "$ref": "request.imageCount"
                },
                [
                  0,
                  1
                ]
              ]
            },
            "message": "Midjourney 一次提交只能 n=1，所有返回图片仍会保存。"
          },
          {
            "assert": {
              "$lte": [
                {
                  "$len": {
                    "$ref": "request.images"
                  }
                },
                5
              ]
            },
            "message": "当前卡藏 Midjourney 参考图最多 5 张。"
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
            "message": "卡藏 Midjourney 生图协议不支持蒙版。"
          },
          {
            "assert": {
              "$in": [
                {
                  "$coalesce": [
                    {
                      "$trim": {
                        "$ref": "request.aspectRatio"
                      }
                    },
                    "9:16"
                  ]
                },
                [
                  "auto",
                  "1:1",
                  "3:2",
                  "2:3",
                  "4:3",
                  "3:4",
                  "5:4",
                  "4:5",
                  "16:9",
                  "9:16",
                  "21:9",
                  "9:21"
                ]
              ]
            },
            "message": "当前卡藏 Midjourney 不支持此比例。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$in": [
                    {
                      "$toFloat": {
                        "$coalesce": [
                          {
                            "$ref": "request.providerOptions.kacang-midjourney.quality"
                          },
                          1
                        ]
                      }
                    },
                    [
                      0.25,
                      0.5,
                      1,
                      2
                    ]
                  ]
                }
              ]
            },
            "message": "稳定版 quality 仅支持 0.25、0.5、1、2。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.stylize"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.stylize"
                              },
                              0
                            ]
                          }
                        },
                        1000
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "stylize 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.chaos"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.chaos"
                              },
                              0
                            ]
                          }
                        },
                        100
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "chaos 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.weird"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.weird"
                              },
                              0
                            ]
                          }
                        },
                        3000
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "weird 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.iw"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.iw"
                              },
                              0
                            ]
                          }
                        },
                        3
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "iw 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.cw"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.cw"
                              },
                              0
                            ]
                          }
                        },
                        100
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "cw 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.sw"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.sw"
                              },
                              0
                            ]
                          }
                        },
                        1000
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "sw 超出文档规定范围。"
          },
          {
            "assert": {
              "$or": [
                {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                {
                  "$and": [
                    {
                      "$gte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.dw"
                              },
                              0
                            ]
                          }
                        },
                        0
                      ]
                    },
                    {
                      "$lte": [
                        {
                          "$toFloat": {
                            "$coalesce": [
                              {
                                "$ref": "request.providerOptions.kacang-midjourney.dw"
                              },
                              0
                            ]
                          }
                        },
                        100
                      ]
                    }
                  ]
                }
              ]
            },
            "message": "dw 超出文档规定范围。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/midjourney/generations",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "prompt": {
              "$ref": "request.prompt"
            },
            "size": {
              "$coalesce": [
                {
                  "$trim": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "9:16"
              ]
            },
            "n": 1,
            "images": {
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
                "else": null
              }
            },
            "raw": {
              "$toBool": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.kacang-midjourney.raw"
                  },
                  false
                ]
              }
            },
            "seed": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.seed"
                  }
                }
              }
            },
            "negative_prompt": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.negative_prompt"
                  }
                }
              }
            },
            "tile": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.tile"
                  }
                }
              }
            },
            "iw": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.iw"
                  }
                }
              }
            },
            "cref": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.cref"
                  }
                }
              }
            },
            "sref": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.sref"
                  }
                }
              }
            },
            "dref": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.dref"
                  }
                }
              }
            },
            "cw": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.cw"
                  }
                }
              }
            },
            "sw": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.sw"
                  }
                }
              }
            },
            "dw": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.kacang-midjourney.dw"
                  }
                }
              }
            },
            "quality": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$toFloat": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.kacang-midjourney.quality"
                      },
                      1
                    ]
                  }
                }
              }
            },
            "stylize": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$toFloat": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.kacang-midjourney.stylize"
                      },
                      100
                    ]
                  }
                }
              }
            },
            "chaos": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$toFloat": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.kacang-midjourney.chaos"
                      },
                      0
                    ]
                  }
                }
              }
            },
            "weird": {
              "$if": {
                "condition": {
                  "$eq": [
                    {
                      "$ref": "request.model"
                    },
                    "Midjourney v8.2 高速"
                  ]
                },
                "then": null,
                "else": {
                  "$toFloat": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.kacang-midjourney.weird"
                      },
                      0
                    ]
                  }
                }
              }
            },
            "hd": {
              "$if": {
                "condition": {
                  "$in": [
                    {
                      "$ref": "request.model"
                    },
                    [
                      "mj-v8.2",
                      "mj-v8.1"
                    ]
                  ]
                },
                "then": {
                  "$toBool": {
                    "$coalesce": [
                      {
                        "$ref": "request.providerOptions.kacang-midjourney.hd"
                      },
                      false
                    ]
                  }
                },
                "else": null
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskIdPaths": [
            "data.task_id",
            "task_id",
            "id"
          ],
          "statusPaths": [
            "data.status",
            "status"
          ],
          "errorPaths": [
            "data.error_code",
            "error_code",
            "error.code"
          ],
          "messagePaths": [
            "data.error_message",
            "error_message",
            "error.message",
            "message"
          ],
          "resultEphemeral": true,
          "usage": {
            "$coalesce": [
              {
                "$ref": "response.data.usage"
              },
              {
                "$ref": "response.usage"
              }
            ]
          },
          "images": {
            "$concatArrays": [
              {
                "$map": {
                  "from": {
                    "$coalesce": [
                      {
                        "$ref": "response.data.result.data.image_urls"
                      },
                      {
                        "$ref": "response.result.data.image_urls"
                      }
                    ]
                  },
                  "as": "url",
                  "in": {
                    "url": {
                      "$ref": "url"
                    }
                  }
                }
              },
              {
                "$if": {
                  "condition": {
                    "$and": [
                      {
                        "$gt": [
                          {
                            "$len": {
                              "$toString": {
                                "$coalesce": [
                                  {
                                    "$ref": "response.data.result.data.grid_image_url"
                                  },
                                  {
                                    "$ref": "response.result.data.grid_image_url"
                                  }
                                ]
                              }
                            }
                          },
                          0
                        ]
                      },
                      {
                        "$not": {
                          "$in": [
                            {
                              "$coalesce": [
                                {
                                  "$ref": "response.data.result.data.grid_image_url"
                                },
                                {
                                  "$ref": "response.result.data.grid_image_url"
                                }
                              ]
                            },
                            {
                              "$coalesce": [
                                {
                                  "$ref": "response.data.result.data.image_urls"
                                },
                                {
                                  "$ref": "response.result.data.image_urls"
                                }
                              ]
                            }
                          ]
                        }
                      }
                    ]
                  },
                  "then": [
                    {
                      "url": {
                        "$coalesce": [
                          {
                            "$ref": "response.data.result.data.grid_image_url"
                          },
                          {
                            "$ref": "response.result.data.grid_image_url"
                          }
                        ]
                      }
                    }
                  ],
                  "else": []
                }
              }
            ]
          }
        }
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
