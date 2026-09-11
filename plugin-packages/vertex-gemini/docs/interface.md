# Vertex AI Gemini 接口字段

## 协议身份

- 插件 ID：`vertex-gemini`。
- Provider ID：`vertex-gemini`。
- 能力：`text`。
- 默认 Base URL：`https://{location}-aiplatform.googleapis.com`。
- 鉴权驱动：`bearer`。
- 创建：`POST /v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent`。
- 生命周期：同步响应。

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `provider message container` | 包含历史消息和当前用户输入。 |
| `instructions` | string | 否 | `system/instructions` | 系统指令。 |
| `temperature` | number | 否 | `temperature` | 采样温度。 |
| `top_p` | number | 否 | `top_p` | 核采样参数。 |
| `max_tokens` | integer | 否 | `max_tokens/max_output_tokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关；后台任务当前以最终响应归一。 |

## 上游请求模板逐字段清单

下表由插件请求模板生成，覆盖 body、query、headers 和 multipart 文件声明中的每个字段。

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent"` |
| `create.contentType` | `"application/json"` |
| `create.body` | `{"$merge":[{"model":{"$ref":"request.model"},"messages":{"$ref":"request.messages"},"input":{"$omitEmpty":{"$ref":"request.prompt"}},"parameters":{"$omitEmpty":{"$ref":"request.providerOptions.vertex-gemini.parameters"}}},{"$coalesce":[{"$ref":"request.providerOptions.vertex-gemini.body"},{"$ref":"request.providerOptions.vertex-gemini.extra_body"},{}]}]}` |

## Provider 扩展键

- `providerOptions.vertex-gemini.body`
- `providerOptions.vertex-gemini.extra_body`
- `providerOptions.vertex-gemini.location`
- `providerOptions.vertex-gemini.parameters`
- `providerOptions.vertex-gemini.project`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.textPaths[0]` | `"output.text"` |
| `response.textPaths[1]` | `"output_text"` |
| `response.textPaths[2]` | `"choices.0.message.content"` |
| `response.textPaths[3]` | `"result"` |
| `response.reasoningPaths[0]` | `"reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.errorPaths[1]` | `"code"` |
| `response.messagePaths[0]` | `"error.message"` |
| `response.messagePaths[1]` | `"message"` |

## 响应与错误

插件把上游 task/status/text/media/usage 映射为统一结果。临时媒体 URL 标记为 ephemeral，由宿主立即下载持久化。HTTP 错误、业务 code 和 error object 保持失败语义，不包装成成功。

## 兼容边界

该协议的模型级字段变化快或依赖云资源配置。插件固定线协议入口和统一字段，完整厂商对象通过 providerOptions.vertex-gemini 的 parameters/input/extra_body 传入；Gemini contents/parts。云签名型入口在未配置对应鉴权驱动时会明确失败，不会伪装成 Bearer 成功。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v2",
  "id": "vertex-gemini",
  "name": "Vertex AI Gemini",
  "version": "2.0.0",
  "author": "Google Cloud / 影策",
  "description": "Vertex AI Gemini 独立请求协议插件。",
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
        "id": "vertex-gemini",
        "label": "Vertex AI Gemini",
        "capabilities": [
          "text"
        ],
        "scopes": [
          "admin.system-channel",
          "user.custom-channel",
          "canvas",
          "creation",
          "agent"
        ],
        "baseUrl": "https://{location}-aiplatform.googleapis.com",
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
            "description": "上游模型 ID。"
          },
          {
            "name": "messages",
            "type": "message[]",
            "required": true,
            "mapping": "provider message container",
            "description": "包含历史消息和当前用户输入。"
          },
          {
            "name": "instructions",
            "type": "string",
            "required": false,
            "mapping": "system/instructions",
            "description": "系统指令。"
          },
          {
            "name": "temperature",
            "type": "number",
            "required": false,
            "mapping": "temperature",
            "description": "采样温度。"
          },
          {
            "name": "top_p",
            "type": "number",
            "required": false,
            "mapping": "top_p",
            "description": "核采样参数。"
          },
          {
            "name": "max_tokens",
            "type": "integer",
            "required": false,
            "mapping": "max_tokens/max_output_tokens",
            "description": "最大输出 token。"
          },
          {
            "name": "tools",
            "type": "array",
            "required": false,
            "mapping": "tools/toolConfig",
            "description": "工具定义。"
          },
          {
            "name": "tool_choice",
            "type": "object|string",
            "required": false,
            "mapping": "tool_choice",
            "description": "工具选择策略。"
          },
          {
            "name": "response_format",
            "type": "object",
            "required": false,
            "mapping": "response_format/text",
            "description": "结构化输出配置。"
          },
          {
            "name": "stream",
            "type": "boolean",
            "required": false,
            "mapping": "stream",
            "description": "流式开关；后台任务当前以最终响应归一。"
          }
        ],
        "create": {
          "method": "POST",
          "path": "/v1/projects/{{request.providerOptions.vertex-gemini.project}}/locations/{{request.providerOptions.vertex-gemini.location}}/publishers/google/models/{{model}}:generateContent",
          "contentType": "application/json",
          "body": {
            "$merge": [
              {
                "model": {
                  "$ref": "request.model"
                },
                "messages": {
                  "$ref": "request.messages"
                },
                "input": {
                  "$omitEmpty": {
                    "$ref": "request.prompt"
                  }
                },
                "parameters": {
                  "$omitEmpty": {
                    "$ref": "request.providerOptions.vertex-gemini.parameters"
                  }
                }
              },
              {
                "$coalesce": [
                  {
                    "$ref": "request.providerOptions.vertex-gemini.body"
                  },
                  {
                    "$ref": "request.providerOptions.vertex-gemini.extra_body"
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
            "output.text",
            "output_text",
            "choices.0.message.content",
            "result"
          ],
          "reasoningPaths": [
            "reasoning_content"
          ],
          "usage": {
            "$ref": "response.usage"
          },
          "errorPaths": [
            "error.code",
            "code"
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
