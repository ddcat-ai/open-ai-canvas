# WaveSpeed Image Edit 接口字段

## 协议身份

- 插件 ID：`wavespeed-image-edit`。
- Provider ID：`wavespeed-image-edit`。
- 能力：`image`。
- 默认 Base URL：`https://api.wavespeed.ai/api/v3`。
- 鉴权驱动：`bearer`。
- 创建：`POST /{{model}}`（model 为 WaveSpeed 图片编辑端点，如 `openai/gpt-image-2.5-sunburst/edit`）。
- 生命周期：异步任务（create 返回 task id，poll 轮询结果）。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | WaveSpeed API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | WaveSpeed 图片编辑模型端点 ID。 |
| `prompt` | string | 是 | `prompt` | 编辑提示词。 |
| `images` | media[] | 否 | `images` | 编辑源图或参考图，按数组顺序透传 URL。 |
| `imageCount` | integer | 否 | `n/sample_count` | 输出数量（WaveSpeed 多数编辑模型不支持，留空）。 |
| `aspectRatio` | string | 否 | `aspect_ratio` | 比例或尺寸，如 `1:1`、`16:9`。 |
| `resolution` | string | 否 | `resolution/imageSize` | 分辨率档位（编辑模型一般不支持，留空）。 |
| `quality` | string | 否 | `quality` | 质量档位：`low` / `medium` / `high`。 |
| `providerOptions` | object | 否 | `provider-specific fields` | 插件命名空间内的厂商扩展字段。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/{{model}}"` |
| `create.contentType` | `"application/json"` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.images` | `{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}}` |
| `create.body.aspect_ratio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.quality` | `{"$omitEmpty":{"$ref":"request.quality"}}` |
| `create.body.output_format` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.wavespeed-image-edit.output_format"},"png"]}}` |
| `create.body.enable_base64_output` | `{"$omitEmpty":{"$ref":"request.providerOptions.wavespeed-image-edit.enable_base64_output"}}` |
| `create.body.enable_sync_mode` | `{"$omitEmpty":{"$ref":"request.providerOptions.wavespeed-image-edit.enable_sync_mode"}}` |
| `poll.method` | `"GET"` |
| `poll.path` | `"/predictions/{{taskId}}/result"`（taskId 来自 create 响应 `data.id`） |
| `poll.contentType` | `"application/json"` |

## Provider 扩展键

- `providerOptions.wavespeed-image-edit.output_format`
- `providerOptions.wavespeed-image-edit.enable_base64_output`
- `providerOptions.wavespeed-image-edit.enable_sync_mode`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.taskId` | `{"$coalesce":[{"$ref":"response.data.id"},{"$ref":"response.id"}]}` |
| `response.status` | `{"$coalesce":[{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]}` |
| `response.message` | `{"$coalesce":[{"$ref":"response.data.error"},{"$ref":"response.data.message"},{"$ref":"response.error.message"},{"$ref":"response.message"}]}` |
| `response.images` | `{"$ref":"response.data.outputs"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.resultEphemeral` | `true` |

WaveSpeed 异步任务响应结构：

- create 成功：`{"code":200,"data":{"id":"<taskId>"}}`
- poll 进行中：`{"code":200,"data":{"id":"<taskId>","status":"processing","outputs":null}}`
- poll 完成：`{"code":200,"data":{"id":"<taskId>","status":"completed","outputs":["https://cdn.wavespeed.ai/..."]}}`
- poll 失败：`{"code":200,"data":{"id":"<taskId>","status":"failed","error":"..."}}`

`images` 直接透传 `data.outputs` 字符串数组；宿主把每个字符串识别为结果媒体 URL（同时兼容对象数组取 `url` 字段的写法）。`resultEphemeral` 标记临时媒体 URL，由宿主立即下载持久化。

## 兼容边界

模型字段由所选端点决定：编辑类端点接受 `prompt + images[]`；图层分解端点（`bytedance/seedream-v5.0-pro/layer-decomposition`）接受 `image + prompt`（用 `providerOptions` 传额外字段）；去背景端点（`bria/remove-background`）接受 `image`。宿主通过 `request.images` 统一提供源图，模型字段差异由调用方通过 providerOptions 补充。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "wavespeed-image-edit",
  "name": "WaveSpeed Image Edit",
  "version": "1.0.0",
  "author": "WaveSpeed / 影策",
  "description": "WaveSpeed 图片编辑协议插件：GPT Image 2.5 / Seedream 5.0 Pro / Nano Banana 的 Image to Image 编辑与图层分解、去背景。",
  "permissions": [
    "generation.run",
    "media.read"
  ],
  "configuration": {
    "fields": [
      {
        "name": "apiKey",
        "type": "secret",
        "label": "WaveSpeed API Key",
        "required": true
      }
    ]
  },
  "contributes": {
    "providers": [
      {
        "id": "wavespeed-image-edit",
        "label": "WaveSpeed Image Edit",
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
        "baseUrl": "https://api.wavespeed.ai/api/v3",
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
            "description": "WaveSpeed 图片编辑模型端点 ID，如 openai/gpt-image-2.5-sunburst/edit、bytedance/seedream-v5.0-pro/edit、google/nano-banana-2/edit。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "prompt",
            "description": "编辑提示词，描述对源图的修改。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "provider image/reference fields",
            "description": "编辑源图或参考图，role 由业务层确定；按数组顺序作为 images 入参。"
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
            "description": "比例或尺寸，如 1:1、16:9、9:16、4:3、3:4。"
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
            "description": "质量档位：low/medium/high。"
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
          "path": "/{{model}}",
          "contentType": "application/json",
          "body": {
            "prompt": {
              "$ref": "request.prompt"
            },
            "images": {
              "$map": {
                "from": {
                  "$ref": "request.images"
                },
                "as": "media",
                "in": {
                  "$ref": "media.value"
                }
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "quality": {
              "$omitEmpty": {
                "$ref": "request.quality"
              }
            },
            "output_format": {
              "$omitEmpty": {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.wavespeed-image-edit.output_format"
                  },
                  "png"
                ]
              }
            },
            "enable_base64_output": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.wavespeed-image-edit.enable_base64_output"
              }
            },
            "enable_sync_mode": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.wavespeed-image-edit.enable_sync_mode"
              }
            }
          }
        },
        "poll": {
          "method": "GET",
          "path": "/predictions/{{taskId}}/result"
        },
        "response": {
          "taskId": {
            "$coalesce": [
              {
                "$ref": "response.data.id"
              },
              {
                "$ref": "response.id"
              }
            ]
          },
          "status": {
            "$coalesce": [
              {
                "$ref": "response.data.status"
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
                "$ref": "response.data.error"
              },
              {
                "$ref": "response.data.message"
              },
              {
                "$ref": "response.error.message"
              },
              {
                "$ref": "response.message"
              }
            ]
          },
          "images": {
            "$ref": "response.data.outputs"
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
