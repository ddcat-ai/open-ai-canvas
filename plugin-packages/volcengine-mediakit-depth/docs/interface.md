# 火山 MediaKit 视频相对深度估计工具接口

## 协议身份与配置

- 插件 ID：`volcengine-mediakit-depth`，默认 `enabled: false`；不随画质增强插件启用。
- Provider ID：`volcengine-mediakit-video-depth`，`kind: processing`，能力 `video`，仅系统渠道与画布使用。
- 默认 Base URL：`https://mediakit.cn-beijing.volces.com`。
- 必填配置 `apiKey`：MediaKit API Key，使用 `Authorization: Bearer <apiKey>`。
- 创建：`POST /api/v1/tools/video-depth`。
- 查询：`GET /api/v1/tasks/{{taskId}}`。
- [官方接口说明](https://docs.volcengine.com/docs/intelligent-processing/submit-deep-motion-capture-task-api?lang=zh)。

## 请求字段

| 上游字段 | 统一来源 | 说明 |
| --- | --- | --- |
| `video_url` | `request.videos[0]`（参数 `videos`） | 单个公网视频 URL。最长 600 秒，分辨率不超过 2K，必须包含有效视频流。宿主验证源资源归属、就绪状态和时长；官方未明确 2K 的像素边界，分辨率交上游校验，不套用增强工具的 1080p 限制。 |
| `model` | 固定 `standard` | 唯一支持的深度估计档位；不使用系统渠道的模型别名作为上游档位。 |
| `client_token` | `request.extra.idempotencyKey` | 宿主幂等键，空时省略。 |

不开放 `providerOptions`、回调、队列或 `media_output_destination`，结果沿用宿主轮询和资源入库。源视频必须是当前用户可访问的影策资源，沿用公网素材转换、出站 SSRF、配额与任务权限校验。

## 响应与错误

| 映射 | 来源 | 说明 |
| --- | --- | --- |
| `taskId` | `task_id` | 异步任务 ID；轮询时沿用原 ID。 |
| `status` | `status` | 未返回时为 pending；running / completed / failed 映射为宿主任务状态。 |
| `message` | `error.message` / `error.code` | `error.code` 非空时按失败处理，HTTP 失败保留失败语义。 |
| `videos` | `result.video_url` | HEVC 相对深度视频；`resultEphemeral: true`，宿主及时下载并持久化，临时链接默认 24 小时有效。 |
| `usage.outputDurationSeconds` | `result.duration` | 输出时长（秒），用于按秒结算；不是输入时长或估算值。 |

## 计量与验收边界

价格按独立 `depth` 操作配置，不使用画质增强的分辨率或帧率计价档，不预设供应商单价。按秒时先按服务端源时长预扣，成功后优先按持久化资源探测时长、其次按 `result.duration` 结算；缺少有效输出时长则待核对，不伪装为结算成功。

Stub 回归不代表真实服务验收。真实效果、处理耗时、HEVC 跨浏览器播放、输出时长与供应商账单对应关系均需独立验收；不为自动回归发起付费调用。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "volcengine-mediakit-depth",
  "name": "火山 MediaKit 视频相对深度估计工具",
  "version": "1.0.0",
  "author": "Volcengine / 影策",
  "description": "火山 MediaKit 视频处理工具，用于逐帧估计相对深度；默认关闭，不是视频生成模型。",
  "enabled": false,
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "MediaKit API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "volcengine-mediakit-video-depth",
        "label": "火山 MediaKit 视频相对深度估计工具",
        "kind": "processing",
        "capabilities": [
          "video"
        ],
        "scopes": [
          "admin.system-channel",
          "canvas"
        ],
        "baseUrl": "https://mediakit.cn-beijing.volces.com",
        "requiresPublicMediaUrls": true,
        "auth": {
          "type": "bearer",
          "field": "apiKey"
        },
        "parameters": [
          {
            "name": "videos",
            "type": "media[]",
            "required": true,
            "mapping": "video_url",
            "description": "单个源视频，最长 600 秒、分辨率不超过 2K，必须包含有效视频流。"
          }
        ],
        "validations": [
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
            "message": "相对深度处理需要且只能提交一个源视频"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/api/v1/tools/video-depth",
          "contentType": "application/json",
          "body": {
            "video_url": {
              "$first": {
                "$map": {
                  "from": {
                    "$ref": "request.videos"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "model": "standard",
            "client_token": {
              "$omitEmpty": {
                "$ref": "request.extra.idempotencyKey"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/api/v1/tasks/{{taskId}}"
        },
        "response": {
          "taskId": {
            "$coalesce": [
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
                "$ref": "response.error.code"
              }
            ]
          },
          "videos": {
            "$ref": "response.result.video_url"
          },
          "usage": {
            "$omitEmpty": {
              "outputDurationSeconds": {
                "$ref": "response.result.duration"
              }
            }
          },
          "errorPaths": [
            "error.code"
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
