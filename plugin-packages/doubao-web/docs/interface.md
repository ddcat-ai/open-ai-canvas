# Doubao Web 接口（视频 / 生图 / 文本）

## 协议身份

- 插件 ID：`doubao-web`；Provider：`doubao-web`（视频）/ `doubao-web-image`（生图）/ `doubao-web-text`（文本）
- 默认 Base URL：`http://127.0.0.1:8787`（本机 doubao-bridge 桥服务）
- 鉴权：无（`auth: none`；本机桥不校验，配置中的 API Key 可任意填写）

## 前置条件

1. 启动桥服务：`cd doubao-bridge && npm start`（Chrome 按需拉起：扫码/检测阶段无窗口，生成阶段才显示窗口）。
2. 连接豆包：`GET /login/qr.png` 截取登录二维码（后台静默无窗口），用户手机豆包 App 扫码后会话跨重启保留。
3. 登录态查询：`GET /session` 返回 `{ loggedIn, hasSessionCookie, hasLoginButton }`；未登录时创建任务会返回明确失败原因。

## 视频生成（doubao-web，异步任务）

- 创建：`POST /v1/videos/generations`；查询：`GET /v1/videos/{task_id}`；下载：`GET /v1/videos/{task_id}/content`

以 JSON 发送 `model`、`prompt`、`duration`。`model` 当前开放 `seedance_2.0_mini`、`seedance_2.0_fast`（以 `GET /v1/models` 为准）。`duration` 必须显式提供（当前档位 4/10/15 秒，以 `/v1/models` 的 `durations` 为准）。时长以两条通道写入：请求体 `ability_param.duration` 改写 + 提示词追加「，N秒」（豆包 bot 从文本解析时长）；实测 4 秒档出片 4.05s。桥的 `patch30` 请求体补丁默认关闭；开启时会拦截 `/samantha/chat/completion` 请求体改写时长与模型（历史遗留开关，一般无需使用）。

`aspectRatio` 同时映射到 `ratio` 和 `size`，当前支持 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9（以 `/v1/models` 的 `ratios` 为准）。比例**只写请求体** `ability_param.ratio`，不点页面控件：实测页面点选会覆盖请求体，导致 3:4 出方图、4:3 出竖屏的错档；只改请求体时 21:9 → 1470x630、1:1 → 960x960 均正确。参考图映射至 `reference_images`（最多 1 张，视频页只吃首帧），支持公网 HTTPS URL 或 `data:image/...;base64,...`；桥会下载/落地后经网页上传入口（`upload_file_button`）注入。

额外请求字段可通过 `providerOptions.doubao-web.body` / `extra_body` 传入，与标准字段合并（扩展对象同名字段优先）。

创建响应的 `id` 为任务 ID。状态为 `queued`、`processing`、`completed` 或 `failed`。建议每 5–10 秒查询一次；实测 10 秒视频约 2–3 分钟生成完成（桥内部超时 20 分钟，超时前若已捕获直链会兜底交付）。

完成后优先使用查询响应的 `video_url`（豆包 CDN 直链，`lr=unwatermarked` 优先，可能带签名与时效）；也可调用 `/content` 获取 `video/mp4` 二进制（桥代理直链并附 Referer）。`watermark` 字段提示该直链是否带水印标记（`false` = 无水印直链）。

## 生图（doubao-web-image，同步）

- 创建：`POST /v1/images/generations`（同步挂住等豆包页完成，上限 180 秒，超时返回 `504`）

以 JSON 发送 `model`（`doubao_image_1.0` / `doubao_image_5.5` / `doubao_image_4.5` / `doubao_image_4.0`）、`prompt`，可选 `reference_images`（最多 10 张，仅接受 `data:image/...;base64` 内联数据，作图生图；不接受远程地址）。响应为 OpenAI images 形态：`{ "created": ..., "data": [{ "url": "data:image/png;base64,..." }] }`——`url` 即桥侧带 Referer 下载转好的内联 data URL，客户端可直接展示。

豆包页走「图像生成」技能（Seedream 免费四档）。模型与比例都会落到页面：模型走 `[data-input-engine-actionbar-control-key="model"]`，比例走底栏「比例 ‹值›」控件（生图页没有 ratio 的 action key，只能按可见文本定位）。支持比例 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 2:3 / 3:2，与豆包生图页下拉实测一致。生图额度以豆包文本回复判定，命中「额度已用完」会自动换号。

## 文本对话（doubao-web-text，同步）

- 创建：`POST /v1/chat/completions`（同步挂住等豆包回复稳定，上限 180 秒，超时返回 `504`）

以 JSON 发送 `model`（`doubao_text_1.0`）与 OpenAI 形态 `messages`（`system` 角色内容会被桥前置到用户消息之前；仅取末条 `user` 消息）。响应：`{ "choices": [{ "message": { "role": "assistant", "content": "..." } }], "usage": { ... } }`；`usage` 为按字符数粗估（网页驱动拿不到真实 token 数）。

**边界**：网页会话每次新建、历史不回放（多轮需调用方自行拼 messages）；**不支持工具调用，agent 场景不接入本 provider**。

## 错误形态

- `400`：`{ "detail": "model 必填; prompt 必填; duration 必须为大于 0 的整数" }`（视频）/ `model 不支持图像生成: ...`（生图/文本传错能力模型）
- `404`：任务不存在或已淘汰（桥保留最近 200 条任务记录）
- `502`：`{ "detail": "生图失败：页面未返回图片" }` / 对话失败同形态
- `504`：同步端点 180 秒超时（豆包页面任务仍在后台执行，可稍后经 `GET /v1/tasks` 查看）
- 任务失败时查询返回 `status: "failed"` 且 `detail` 给出原因（如「豆包未登录：请在桥服务的 Chrome 窗口中登录豆包账号」）

## 与 dola-pool 插件的关系

两者视频协议形态一致（创建/查询/下载三端点 + 相同响应映射），但驱动层不同：dola-pool 对接远端账号池中转 API（`dolasd.xyz`，按 Key 计费）；本插件对接本机桥（用户自己的豆包网页会话与额度）。轮询路径同为 `/v1/videos/{task_id}`，与 Kling Video 插件（`/v1/videos/generations/{task_id}`）不兼容。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "doubao-web",
  "name": "豆包（网页驱动）",
  "version": "1.0.0",
  "author": "PeekReel",
  "description": "豆包网页驱动任务协议：Seedance 视频生成 + Seedream 生图 + 文本对话（经内置 doubao-bridge 桥驱动已登录的豆包网页会话，使用用户自己的豆包账号额度）。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "baseUrl",
        "type": "url",
        "label": "桥地址（桌面端自动注入动态端口，一般无需修改）",
        "required": false
      },
      {
        "name": "apiKey",
        "type": "secret",
        "label": "API Key（填渠道同步下发的桥令牌）",
        "required": true
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "contributes": {
    "providers": [
      {
        "id": "doubao-web",
        "label": "Doubao Web Seedance Video",
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
        "baseUrl": "",
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
            "description": "模型 ID；当前开放 seedance_2.0_mini / seedance_2.0_fast，按 GET /v1/models 返回填写。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "视频提示词。"
          },
          {
            "name": "duration",
            "type": "integer",
            "required": true,
            "mapping": "duration",
            "description": "显式传时长：4 / 10 / 15 秒（以 GET /v1/models 的 durations 为准）。时长通过请求体 ability_param.duration 与提示词「，N秒」双通道写入，实测 4 秒档出片 4.05s。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/size",
            "description": "画幅比例：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9（以 GET /v1/models 的 ratios 为准）。比例写入请求体 ability_param.ratio，不点页面控件——页面点选会盖掉请求体导致错档（2026-11-11 六档实测）。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图（图生视频，首帧）：通过公网 URL 或 data URL 发送，桥落盘后经网页上传入口注入；视频页只支持 1 张，多余的会被忽略并在任务进度里注明。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "doubao-web 专属扩展字段（providerOptions.doubao-web.body）。"
          }
        ],
        "validations": [
          {
            "assert": {
              "$gt": [
                {
                  "$ref": "request.duration"
                },
                0
              ]
            },
            "message": "Doubao Web 视频任务必须显式指定大于 0 的 duration"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/videos/generations",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "model": {
                  "$ref": "request.model"
                },
                "prompt": {
                  "$ref": "request.prompt"
                },
                "duration": {
                  "$ref": "request.duration"
                },
                "metadata": {
                  "nodeId": {
                    "$ref": "request.metadata.nodeId"
                  }
                },
                "ratio": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "size": {
                  "$omitEmpty": {
                    "$ref": "request.aspectRatio"
                  }
                },
                "reference_images": {
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
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.doubao-web.body"
                  },
                  {
                    "$ref": "request.providerOptions.doubao-web.extra_body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "poll": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}",
          "contentType": "application/json"
        },
        "result": {
          "method": "GET",
          "path": "/v1/videos/{{taskId}}/content",
          "headers": {
            "Accept": "video/mp4"
          }
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
                "$ref": "response.state"
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
                "$ref": "response.error"
              },
              {
                "$ref": "response.detail"
              },
              {
                "$ref": "response.message"
              },
              {
                "$ref": "response.fail_reason"
              }
            ]
          },
          "videos": {
            "$coalesce": [
              {
                "$ref": "response.video_url"
              },
              {
                "$ref": "response.content.video_url"
              },
              {
                "$ref": "response.videoUrl"
              },
              {
                "$ref": "response.result_url"
              },
              {
                "$ref": "response.url"
              },
              {
                "$ref": "response.data.video_url"
              },
              {
                "$ref": "response.output.url"
              }
            ]
          },
          "errorPaths": [
            "detail",
            "error.code"
          ],
          "messagePaths": [
            "error",
            "detail",
            "message"
          ],
          "resultEphemeral": true
        }
      },
      {
        "id": "doubao-web-image",
        "label": "Doubao Web Seedream Image",
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
        "baseUrl": "",
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
            "description": "生图模型 ID：doubao_image_1.0 / doubao_image_5.5 / doubao_image_4.5 / doubao_image_4.0（网页驱动 Seedream 免费四档），以 GET /v1/models 为准。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "生图提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图（图生图）：通过 data URL 发送，桥逐张经网页上传入口注入，最多 10 张（豆包生图页多图入口）。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "doubao-web 专属扩展字段（providerOptions.doubao-web.body）。"
          },
          {
            "name": "imageCount",
            "type": "integer",
            "required": false,
            "mapping": "n",
            "description": "生成张数（默认 1，最大 5）。桥会把它写成提示词末端的强制指令交给豆包网页——豆包「图像生成」没有张数控件，只能靠提示词要求。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/images/generations",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "model": {
                  "$ref": "request.model"
                },
                "prompt": {
                  "$ref": "request.prompt"
                },
                "reference_images": {
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
                "n": {
                  "$omitEmpty": {
                    "$ref": "request.imageCount"
                  }
                },
                "metadata": {
                  "nodeId": {
                    "$ref": "request.metadata.nodeId"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.doubao-web.body"
                  },
                  {
                    "$ref": "request.providerOptions.doubao-web.extra_body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
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
                }
              }
            }
          },
          "errorPaths": [
            "detail",
            "error.code"
          ],
          "messagePaths": [
            "error",
            "detail",
            "message"
          ]
        },
        "imageParameters": [
          {
            "name": "size",
            "label": "画幅 / 尺寸",
            "type": "string",
            "binding": "aspectRatio"
          },
          {
            "name": "count",
            "label": "生成数量",
            "type": "integer",
            "binding": "imageCount",
            "min": 1,
            "max": 5,
            "step": 1,
            "default": 1
          }
        ]
      },
      {
        "id": "doubao-web-text",
        "label": "Doubao Web Chat",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation"
        ],
        "baseUrl": "",
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
            "description": "文本模型 ID；当前开放 doubao_text_1.0（网页驱动对话），以 GET /v1/models 为准。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "doubao-web 专属扩展字段（providerOptions.doubao-web.body）。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "model": {
                  "$ref": "request.model"
                },
                "messages": {
                  "$ref": "request.messages"
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.doubao-web.body"
                  },
                  {
                    "$ref": "request.providerOptions.doubao-web.extra_body"
                  },
                  {}
                ]
              }
            ]
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "choices.0.message.content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "detail",
            "error.code"
          ],
          "messagePaths": [
            "error",
            "detail",
            "message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
