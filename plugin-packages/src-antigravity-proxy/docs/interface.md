# Antigravity Proxy 接口字段

## 协议身份

- 插件 ID：`antigravity-proxy`
- Provider ID：`antigravity-chat`
- 能力：`text`
- 默认 Base URL：`http://103.242.14.110:8317`
- 鉴权驱动：`bearer`
- 创建：`POST /chat/completions`
- 生命周期：同步响应

## 配置字段

| 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- |
| `apiKey` | secret | 是 | 中转渠道 API Key |

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 | 说明 |
| --- | --- | --- | --- | --- |
| `model` | string | 是 | `model` | 上游模型 ID。 |
| `messages` | message[] | 是 | `messages` | 包含历史消息和当前用户输入。 |
| `instructions` | string | 否 | `system/instructions` | 系统指令。 |
| `temperature` | number | 否 | `temperature` | 采样温度。 |
| `top_p` | number | 否 | `top_p` | 核采样参数。 |
| `max_tokens` | integer | 否 | `max_tokens/max_output_tokens` | 最大输出 token。 |
| `tools` | array | 否 | `tools/toolConfig` | 工具定义。 |
| `tool_choice` | object\|string | 否 | `tool_choice` | 工具选择策略。 |
| `response_format` | object | 否 | `response_format/text` | 结构化输出配置。 |
| `stream` | boolean | 否 | `stream` | 流式开关。 |

## 上游请求模板

| 上游位置 | 值或转换表达式 |
| --- | --- |
| `create.method` | `"POST"` |
| `create.path` | `"/chat/completions"` |
| `create.contentType` | `"application/json"` |
| `create.body.model` | `{"$ref":"request.model"}` |
| `create.body.messages` | `{"$ref":"request.messages"}` |
| `create.body.temperature` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.temperature"}}` |
| `create.body.top_p` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.top_p"}}` |
| `create.body.max_tokens` | `{"$omitEmpty":{"$coalesce":[{"$ref":"request.extra.max_tokens"},{"$ref":"request.providerOptions.antigravity-chat.max_tokens"}]}}` |
| `create.body.tools` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.tools"}}` |
| `create.body.tool_choice` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.tool_choice"}}` |
| `create.body.response_format` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.response_format"}}` |
| `create.body.stream` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.stream"}}` |
| `create.body.stop` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.stop"}}` |
| `create.body.seed` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.seed"}}` |
| `create.body.frequency_penalty` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.frequency_penalty"}}` |
| `create.body.presence_penalty` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.presence_penalty"}}` |
| `create.body.user` | `{"$omitEmpty":{"$ref":"request.providerOptions.antigravity-chat.user"}}` |

## 响应映射

| 映射位置 | 上游路径或转换表达式 |
| --- | --- |
| `response.status` | `"succeeded"` |
| `response.textPaths[0]` | `"choices.0.message.content"` |
| `response.textPaths[1]` | `"choices.0.text"` |
| `response.reasoningPaths[0]` | `"choices.0.message.reasoning_content"` |
| `response.usage` | `{"$ref":"response.usage"}` |
| `response.errorPaths[0]` | `"error.code"` |
| `response.messagePaths[0]` | `"error.message"` |

## 兼容边界

该包只代表 Antigravity 中转渠道的 OpenAI Chat Completions 线协议；其他端点或网关包装必须使用独立插件。
