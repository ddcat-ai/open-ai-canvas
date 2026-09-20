# Ollama Chat 接口字段

## 协议身份

- 插件 ID：`ollama-chat`。
- Provider ID：`ollama-chat`。
- 能力：`text`。
- 默认 Base URL：`http://127.0.0.1:11434`。
- 鉴权驱动：`none`。
- 创建：`POST /api/chat`。
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
| `create.path` | `"/api/chat"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.messages` | `{"$ref":"request.messages"}` |
| `create.body.stream` | `false` |
| `create.body.format` | `{"$omitEmpty":{"$ref":"request.providerOptions.ollama-chat.format"}}` |
| `create.body.options` | `{"$omitEmpty":{"$ref":"request.providerOptions.ollama-chat.options"}}` |
| `create.body.keep_alive` | `{"$omitEmpty":{"$ref":"request.providerOptions.ollama-chat.keep_alive"}}` |
| `create.body.tools` | `{"$omitEmpty":{"$ref":"request.providerOptions.ollama-chat.tools"}}` |
| `create.body.think` | `{"$omitEmpty":{"$ref":"request.providerOptions.ollama-chat.think"}}` |

## Provider 扩展键

- `providerOptions.ollama-chat.format`
- `providerOptions.ollama-chat.keep_alive`
- `providerOptions.ollama-chat.options`
- `providerOptions.ollama-chat.think`
- `providerOptions.ollama-chat.tools`

动态模型或工作流允许使用文档声明的完整 `parameters/input/extra_body` 对象；该对象是协议本身的开放 schema，不会被宿主裁剪。

## 响应映射逐字段清单

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.textPaths[0]` | `"message.content"` |
| `response.textPaths[1]` | `"response"` |
| `response.reasoningPaths[0]` | `"message.thinking"` |
| `response.reasoningPaths[1]` | `"thinking"` |
| `response.errorPaths[0]` | `"error"` |
| `response.messagePaths[0]` | `"error"` |

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
  "id": "ollama-chat",
  "name": "Ollama Chat",
  "version": "2.0.0",
  "author": "Ollama / 影策",
  "description": "Ollama Chat 独立请求协议插件。",
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
        "id": "ollama-chat",
        "label": "Ollama Chat",
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
        "baseUrl": "http://127.0.0.1:11434",
        "requiresPublicMediaUrls": false,
        "auth": {
          "type": "none",
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
          "path": "/api/chat",
          "contentType": "application/json",
          "body": {
            "model": {
              "$ref": "request.model"
            },
            "messages": {
              "$ref": "request.messages"
            },
            "stream": false,
            "format": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ollama-chat.format"
              }
            },
            "options": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ollama-chat.options"
              }
            },
            "keep_alive": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ollama-chat.keep_alive"
              }
            },
            "tools": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ollama-chat.tools"
              }
            },
            "think": {
              "$omitEmpty": {
                "$ref": "request.providerOptions.ollama-chat.think"
              }
            }
          }
        },
        "response": {
          "status": "succeeded",
          "textPaths": [
            "message.content",
            "response"
          ],
          "reasoningPaths": [
            "message.thinking",
            "thinking"
          ],
          "errorPaths": [
            "error"
          ],
          "messagePaths": [
            "error"
          ]
        }
      }
    ]
  }
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
