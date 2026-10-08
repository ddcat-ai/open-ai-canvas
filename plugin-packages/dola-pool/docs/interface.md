# Dola-pool Seedance Video 接口

## 协议身份

- 插件 ID / Provider ID：`dola-pool`
- 默认 Base URL：`https://dolasd.xyz`
- 鉴权：`Authorization: Bearer <API key>`
- 创建：`POST /v1/videos/generations`
- 查询：`GET /v1/videos/{task_id}`
- 下载：`GET /v1/videos/{task_id}/content`

## 创建请求

插件以 JSON 发送 `model`、`prompt` 和 `duration`。时长必须显式提供，不要依赖服务端默认值；只提交 `GET /v1/models` 中该模型当前开放的 `durations`。接口当前示例档位为 `seedance-2.5`、30 秒，开放档位由服务端定价配置控制。

`aspectRatio` 同时映射到 `ratio` 和 `size`，因此可填写比例（如 `16:9`、`9:16`）或接口接受的像素尺寸（如 `720x1280`）。参考图映射至 `reference_images`，支持公网 HTTPS URL 或 `data:image/...;base64,...`。建议优先使用公网 URL，单图不超过 15 MB、最多 30 张，格式限 JPEG、PNG、WEBP。

额外请求字段可通过 `providerOptions.dola-pool.body` 或 `providerOptions.dola-pool.extra_body` 传入；扩展对象与标准字段合并，扩展对象中的同名字段优先。

## 轮询与下载

创建响应中的 `id` 是后续查询使用的任务 ID。状态为 `queued`、`processing`、`completed` 或 `failed`；插件将接口状态映射为平台统一状态。建议每 5 至 10 秒查询一次，至少持续 20 分钟再判定超时。`timeout` 或 `download` 类型失败在退款后仍可能于 20 分钟内补回为成功，期间应继续查询，避免重复提交。

完成后优先使用查询响应的 `video_url`。也可调用 `/v1/videos/{task_id}/content` 获取 `video/mp4` 二进制。视频及对应任务记录约保留 6 小时，请及时下载转存。

## 404 排查

Dola-pool 的任务按 API Key 隔离；创建与查询必须使用同一把 Key。任务记录也会在成片保留期结束后清理。Kling Video 插件的轮询路径是 `/v1/videos/generations/{task_id}`，而 Dola-pool 要求 `/v1/videos/{task_id}`，因此两者不能互换。

错误响应使用 `{ "detail": "错误原因" }`。其他状态码与参数限制以 Dola-pool 接口文档及 `/v1/models` 当前返回为准。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "dola-pool",
  "name": "Dola-pool Seedance Video",
  "version": "1.0.0",
  "author": "Dola-pool / 影策",
  "description": "Dola-pool Seedance 视频生成任务协议。",
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
        "id": "dola-pool",
        "label": "Dola-pool Seedance Video",
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
        "baseUrl": "https://dolasd.xyz",
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
            "description": "模型 ID；按 GET /v1/models 返回的模型配置填写。"
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
            "description": "必须显式传当前开放的时长档位；开放档位见 GET /v1/models。"
          },
          {
            "name": "aspectRatio",
            "type": "string",
            "required": false,
            "mapping": "ratio/size",
            "description": "画幅比例别名或受支持的像素尺寸。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "reference_images",
            "description": "参考图片；通过公网 URL 或 data URL 发送。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "Dola-pool 专属扩展字段。"
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
            "message": "Dola-pool 视频任务必须显式指定大于 0 的 duration"
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
                    "$ref": "request.providerOptions.dola-pool.body"
                  },
                  {
                    "$ref": "request.providerOptions.dola-pool.extra_body"
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
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
