# Gemini Web2API Image 接口字段

## 协议身份

- 插件 ID：`gemini-web2api-image`。
- Provider ID：`gemini-web2api-image`。
- 能力：`image`。
- 默认 Base URL：``。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/chat/completions`。
- 生命周期：同步响应。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 使用代理的 gemini-image 模型，不是 gemini-3.1-pro。 |
| `prompt` | string | 是 | `messages[].content` | 生图提示词。比例和风格以提示词描述。 |
| `images` | media[] | 否 | `messages[].content[].image_url` | 可选参考图；需要代理支持图片输入。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/chat/completions"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.messages` | `{"$ref":"request.messages"}` |
| `create.body.stream` | `false` |

## Provider 扩展键

- 无额外扩展键。

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `{"$if":{"condition":{"$gt":[{"$len":{"$markdownDataImages":{"$ref":"response.choices.0.message.content"}}},0]},"then":"succeeded","else":"failed"}}` |
| `response.images` | `{"$markdownDataImages":{"$ref":"response.choices.0.message.content"}}` |
| `response.message` | `{"$if":{"condition":{"$gt":[{"$len":{"$markdownDataImages":{"$ref":"response.choices.0.message.content"}}},0]},"then":null,"else":"图片代理未返回有效图片，请检查代理登录状态及上游生图权限。"}}` |
| `response.errorPaths[0]` | `"error"` |
| `response.usage` | `{"$ref":"response.usage"}` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

专用于 https://github.com/zexadev/gemini-web2api-go 的 gemini-image：POST /v1/chat/completions，以 Markdown 内的 Base64 图片返回。不是 OpenAI Images 或 Google 原生 Gemini 协议。Base URL 由管理员配置，Docker 访问宿主机需使用 host.docker.internal 并精确放行该主机。代理必须具备有效 Cookie 登录态；本插件不读取 Cookie。size/n 不生效，不发送尺寸、质量、数量、透明背景和输出格式参数；默认一次请求，不保证上游返回张数。仅接受内嵌 PNG/JPEG/WebP/GIF，纯文本、外链和损坏 Base64 不作为成功图片。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "gemini-web2api-image",
  "name": "Gemini Web2API Image",
  "version": "2.0.0",
  "author": "Gemini Web2API / 影策",
  "description": "Gemini Web2API Image 独立请求协议插件。",
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
        "id": "gemini-web2api-image",
        "label": "Gemini Web2API Image",
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
            "description": "使用代理的 gemini-image 模型，不是 gemini-3.1-pro。"
          },
          {
            "name": "prompt",
            "type": "string",
            "required": true,
            "mapping": "messages[].content",
            "description": "生图提示词。比例和风格以提示词描述。"
          },
          {
            "name": "images",
            "type": "media[]",
            "required": false,
            "mapping": "messages[].content[].image_url",
            "description": "可选参考图；需要代理支持图片输入。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/chat/completions",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "stream": false
          }
        },
        "response": {
          "status": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$markdownDataImages": {
                        "$ref": "response.choices.0.message.content"
                      }
                    }
                  },
                  0
                ]
              },
              "then": "succeeded",
              "else": "failed"
            }
          },
          "images": {
            "$markdownDataImages": {
              "$ref": "response.choices.0.message.content"
            }
          },
          "message": {
            "$if": {
              "condition": {
                "$gt": [
                  {
                    "$len": {
                      "$markdownDataImages": {
                        "$ref": "response.choices.0.message.content"
                      }
                    }
                  },
                  0
                ]
              },
              "then": null,
              "else": "图片代理未返回有效图片，请检查代理登录状态及上游生图权限。"
            }
          },
          "errorPaths": [
            "error"
          ],
          "usage": {
            "$ref": "response.usage"
          }
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
