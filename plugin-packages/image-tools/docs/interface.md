# Image Tools Interface

## Remove Background

- Provider: `image-tools-remove-background`
- Upstream: `POST /bria/remove-background`
- Input: first image in `images[]`
- Output: asynchronous image result

## Layer Decomposition

- Provider: `image-tools-layer-decomposition`
- Upstream: `POST /bytedance/seedream-v5.0-pro/layer-decomposition`
- Input: first image in `images[]`
- Output: asynchronous image result list

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "image-tools",
  "name": "Image Tools",
  "version": "1.0.0",
  "author": "影策",
  "description": "图片去背景与图层拆分工具协议插件。",
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
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>",
  "contributes": {
    "providers": [
      {
        "id": "image-tools-remove-background",
        "label": "Image Tools Remove Background",
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
            "required": false,
            "mapping": "model",
            "description": "默认 bria/remove-background。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "prompt",
            "description": "可选工具提示词。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": true,
            "mapping": "source image",
            "description": "源图片。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "工具扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/bria/remove-background",
          "contentType": "application/json",
          "body": {
            "image": {
              "$first": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
              }
            },
            "output_format": {
              "$coalesce": [
                {
                  "$ref": "request.providerOptions.image-tools-remove-background.output_format"
                },
                "png"
              ]
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
      },
      {
        "id": "image-tools-layer-decomposition",
        "label": "Image Tools Layer Decomposition",
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
            "required": false,
            "mapping": "model",
            "description": "默认 bytedance/seedream-v5.0-pro/layer-decomposition。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": false,
            "mapping": "prompt",
            "description": "描述需要拆分的图层。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": true,
            "mapping": "source image",
            "description": "源图片。"
          },
          {
            "name": "providerOptions",
            "type": "object",
            "required": false,
            "mapping": "provider-specific fields",
            "description": "工具扩展字段。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/bytedance/seedream-v5.0-pro/layer-decomposition",
          "contentType": "application/json",
          "body": {
            "image": {
              "$first": {
                "$map": {
                  "from": {
                    "$ref": "request.images"
                  },
                  "as": "media",
                  "in": {
                    "$ref": "media.value"
                  }
                }
              }
            },
            "prompt": {
              "$omitEmpty": {
                "$ref": "request.prompt"
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
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
