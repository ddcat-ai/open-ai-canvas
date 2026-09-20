# Antigravity Proxy

Antigravity 中转渠道插件：OpenAI Chat Completions 兼容对话协议。

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

## 模型

- `gemini-3.8-flash-high`
- `gemini-pro-agent`

## 统一字段映射

| 统一字段 | 类型 | 必填 | 上游映射 |
| --- | --- | --- | --- |
| `model` | string | 是 | `model` |
| `messages` | message[] | 是 | `messages` |
| `instructions` | string | 否 | `system/instructions` |
| `temperature` | number | 否 | `temperature` |
| `top_p` | number | 否 | `top_p` |
| `max_tokens` | integer | 否 | `max_tokens` |
| `tools` | array | 否 | `tools` |
| `tool_choice` | object\|string | 否 | `tool_choice` |
| `response_format` | object | 否 | `response_format` |
| `stream` | boolean | 否 | `stream` |

完整接口见 [docs/interface.md](docs/interface.md)。
