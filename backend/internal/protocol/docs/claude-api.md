# Claude Messages API

Claude Messages 使用无状态 `messages` 请求生成内容。影策默认创建一条 `user` 消息、设置 `max_tokens: 4096`，并自动添加 `anthropic-version: 2023-06-01`。系统提示使用顶层 `system`，不能伪装成 `system` 角色消息。

## 接口、鉴权与版本头

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/messages
x-api-key: <API_KEY>
anthropic-version: 2023-06-01
Content-Type: application/json
```

影策的通用渠道中转也可能以 Bearer 方式连接兼容网关；直连 Anthropic 时必须按官方 `x-api-key` 规则配置渠道。版本头由适配器固定添加，Beta 能力需要额外头部时当前插件不会自动猜测。

## 模型与兼容边界

模型 ID 必须使用账户和区域实际可用的 Anthropic 模型名。AWS Bedrock、Google Vertex AI 与 Anthropic 原生 API 的鉴权、路径和模型名不同，不能把原生 Messages 插件直接当作云厂商协议使用，除非中间网关已完成协议转换。

## 参数与字段映射

{{PARAMETERS}}

`extra` 可透传 `max_tokens`、`system`、`messages`、`temperature`、`top_p`、`top_k`、`tools`、`tool_choice` 和 `stream`。`extra.messages` 替换默认消息数组。`max_tokens` 是必需的上游字段，未覆盖时影策发送 4096。

## 请求示例

```bash
curl "{channel_base_url}/v1/messages" \
  -H "x-api-key: <API_KEY>" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "YOUR_CLAUDE_MODEL",
    "max_tokens": 1200,
    "system": "你是影视剧本顾问。",
    "messages": [{"role":"user","content":"指出这一场戏的冲突升级点。"}]
  }'
```

```json
{
  "id":"msg_xxx",
  "type":"message",
  "role":"assistant",
  "content":[{"type":"text","text":"冲突分为三个阶段……"}],
  "stop_reason":"end_turn",
  "usage":{"input_tokens":31,"output_tokens":148}
}
```

## 多内容块、工具与流式

响应解析遍历 `content[]`，只拼接 `type: text` 的块。`tool_use`、thinking、引用等非文本块不会被误当成正文，但当前统一文本结果也不会保存这些块；需要工具循环或完整块语义时应走专用 Agent 执行层。`stream: true` 的事件流由文本任务链路处理，同步解析器只接收完整 JSON。

常见错误包括缺少版本头、模型 ID 无权限、交替角色结构不合法、`max_tokens` 缺失或上下文超限。兼容网关可能接受 Bearer 但不接受 `x-api-key`，需要在渠道层确认，不在插件里双发密钥。

## 官方资料

- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages)
- [Anthropic Messages examples](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)

{{CONTRACT}}
