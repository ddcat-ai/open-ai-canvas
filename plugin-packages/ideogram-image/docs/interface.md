# Ideogram Image 接口字段

## 协议身份

- 插件 ID：`ideogram-image`。
- Provider ID：`ideogram-image`。
- 能力：`image`。
- 默认 Base URL：`https://api.ideogram.ai`。
- 鉴权驱动：`header`。
- 创建：`POST 动态路径`。
- 生命周期：同步响应。

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
| `create.path` | `"dynamic"` |
| `create.contentType` | `"multipart/form-data"` |
| `create.body.prompt` | `{"$ref":"request.prompt"}` |
| `create.body.negative_prompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.negative_prompt"}}` |
| `create.body.aspect_ratio` | `{"$omitEmpty":{"$ref":"request.aspectRatio"}}` |
| `create.body.resolution` | `{"$omitEmpty":{"$ref":"request.resolution"}}` |
| `create.body.num_images` | `{"$coalesce":[{"$ref":"request.imageCount"},1]}` |
| `create.body.rendering_speed` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.rendering_speed"}}` |
| `create.body.style_type` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.style_type"}}` |
| `create.body.magic_prompt` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.magic_prompt"}}` |
| `create.body.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.seed"}}` |
| `create.body.color_palette` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.color_palette"}}` |
| `create.body.character_reference_images_mask` | `{"$omitEmpty":{"$ref":"request.providerOptions.ideogram-image.character_reference_images_mask"}}` |
| `create.files[0].name` | `"image"` |
| `create.files[0].source` | `{"$first":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["edit_source","reference_image","subject_reference","style_reference",""]]}}}}` |
| `create.files[0].filename` | `"reference.png"` |
| `create.files[1].name` | `"mask"` |
| `create.files[1].source` | `{"$first":{"$filter":{"from":{"$sortByOrder":{"$ref":"request.images"}},"as":"media","where":{"$in":[{"$ref":"media.role"},["mask"]]}}}}` |
| `create.files[1].filename` | `"mask.png"` |

## Provider 扩展键

- `providerOptions.ideogram-image.character_reference_images_mask`
- `providerOptions.ideogram-image.color_palette`
- `providerOptions.ideogram-image.endpoint`
- `providerOptions.ideogram-image.magic_prompt`
- `providerOptions.ideogram-image.negative_prompt`
- `providerOptions.ideogram-image.rendering_speed`
- `providerOptions.ideogram-image.seed`
- `providerOptions.ideogram-image.style_type`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.images` | `{"$coalesce":[{"$ref":"response.data"},{"$ref":"response.images"}]}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |
| `response.messagePaths[1]` | `"message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该包只代表上述线协议 profile；同一品牌的其他 endpoint、云区域或网关包装必须使用独立插件，不能根据模型名猜测。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "ideogram-image",
  "name": "Ideogram Image",
  "version": "2.0.0",
  "author": "Ideogram / 影策",
  "description": "Ideogram Image 独立请求协议插件。",
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
        "id": "ideogram-image",
        "label": "Ideogram Image",
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
        "baseUrl": "https://api.ideogram.ai",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "header",
          "field": "apiKey",
          "header": "Api-Key"
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
          "pathTemplate": {
            "$coalesce": [
              {
                "$ref": "request.providerOptions.ideogram-image.endpoint"
              },
              "/v1/ideogram-v3/generate"
            ]
          },
          "contentType": "multipart/form-data",
          "body": {
            "prompt": {
              "$ref": "request.prompt"
            },
            "negative_prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.negative_prompt"
              }
            },
            "aspect_ratio": {
              "$omitEmpty": {
                "$ref": "request.aspectRatio"
              }
            },
            "resolution": {
              "$omitEmpty": {
                "$ref": "request.resolution"
              }
            },
            "num_images": {
              "$coalesce": [
                {
                  "$ref": "request.imageCount"
                },
                1
              ]
            },
            "rendering_speed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.rendering_speed"
              }
            },
            "style_type": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.style_type"
              }
            },
            "magic_prompt": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.magic_prompt"
              }
            },
            "seed": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.seed"
              }
            },
            "color_palette": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.color_palette"
              }
            },
            "character_reference_images_mask": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ideogram-image.character_reference_images_mask"
              }
            }
          },
          "files": [
            {
              "name": "image",
              "source": {
                "$first": {
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
                          "edit_source",
                          "reference_image",
                          "subject_reference",
                          "style_reference",
                          ""
                        ]
                      ]
                    }
                  }
                }
              },
              "filename": "reference.png"
            },
            {
              "name": "mask",
              "source": {
                "$first": {
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
                          "mask"
                        ]
                      ]
                    }
                  }
                }
              },
              "filename": "mask.png"
            }
          ]
        },
        "response": {
          "status": "succeeded",
          "images": {
            "$coalesce": [
              {
                "$ref": "response.data"
              },
              {
                "$ref": "response.images"
              }
            ]
          },
          "errorPaths": [
            "error.code"
          ],
          "messagePaths": [
            "error.message",
            "message"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
