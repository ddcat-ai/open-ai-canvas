# OpenAI Chat Completions

Chat Completions 是基于 `messages` 的同步或流式文本协议。影策默认把提示词包装成一条 `user` 消息；需要多轮上下文、工具调用或结构化输出时，通过模型扩展参数传入完整 OpenAI 字段。

## 接口、鉴权与请求模式

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/chat/completions
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

官方服务的 Base URL 通常以 `/v1` 结尾；在影策中应以渠道实际配置为准。同步请求返回单个 JSON；`stream: true` 时上游返回 SSE，影策文本任务流负责转发和组装事件。

## 模型与兼容边界

模型名不会由插件维护白名单，必须填写渠道实际暴露的模型 ID。OpenAI 新项目更推荐 Responses API；现有 Chat Completions 模型和兼容渠道仍可使用本插件。兼容渠道可能只实现字段子集，不能因为路径相同就假定支持工具、视觉输入或 JSON Schema。

## 参数与字段映射

{{PARAMETERS}}

可通过 `extra` 透传 `messages`、`temperature`、`top_p`、`max_tokens`、`stream`、`tools` 和 `response_format`。传入 `extra.messages` 时会替换默认单条消息，而不是追加。

## 完整请求示例

```bash
curl "{channel_base_url}/v1/chat/completions" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_MODEL",
    "messages": [
      {"role":"system","content":"你是影视分镜助理。"},
      {"role":"user","content":"把这场雨夜追逐拆成 6 个镜头。"}
    ],
    "temperature": 0.7
  }'
```

```json
{
  "id": "chatcmpl_xxx",
  "choices": [{"message":{"role":"assistant","content":"1. 全景……"},"finish_reason":"stop"}],
  "usage": {"prompt_tokens":32,"completion_tokens":95,"total_tokens":127}
}
```

## 响应解析、流式与错误

同步解析只读取 `choices[0].message.content`，并保留顶层 `usage`。当前解析器不把 `tool_calls` 当文本结果；只有工具调用而没有正文时，应由调用方进入工具回合，不能当作普通文本成功。流式分片、结束标记和断线续传由文本任务 SSE 链路处理，不使用此同步 JSON 解析器硬拼。

常见失败包括模型不存在、上下文超限、字段不受兼容服务支持、额度或速率限制。应保留上游 HTTP 状态和错误正文，不改写为成功。

## 官方资料

- [OpenAI Chat Completions API Reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [OpenAI Text generation guide](https://developers.openai.com/api/docs/guides/text)

{{CONTRACT}}
