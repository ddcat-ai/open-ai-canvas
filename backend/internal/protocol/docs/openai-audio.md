# OpenAI Audio Speech

该插件调用 OpenAI 风格的同步文字转语音接口，把影策提示词映射为 `input`。当前只发送模型与文本，声音、格式、语速和其他 TTS 选项尚未纳入 adapter。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/audio/speech
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

## 模型、声音与输出格式

模型、voice、格式、单次文本长度、流式能力和价格以 OpenAI 或兼容渠道实际文档为准。当前影策 metadata 没有声明参数表，这意味着只有 `model` 和 `prompt` 的内部映射稳定，不意味着上游没有必填 `voice`。若上游要求 voice，管理员必须先扩展 adapter，不能依赖未白名单的字段自动透传。

## 参数与字段映射

{{PARAMETERS}}

实际请求正文固定为：

```json
{"model":"YOUR_TTS_MODEL","input":"请在午夜前离开这座城市。"}
```

完整上游常见请求参考：

```bash
curl "{channel_base_url}/v1/audio/speech" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"YOUR_TTS_MODEL","voice":"YOUR_VOICE","input":"请在午夜前离开这座城市。","response_format":"mp3"}' \
  --output speech.mp3
```

第二个示例包含当前 adapter 尚未发送的 `voice` 和 `response_format`，用于说明必须补齐的协议字段。

## 响应与当前实现差异

OpenAI 官方 Speech API 通常直接返回音频二进制流；当前 `parseAudioResponse` 却按 JSON 中的 `url/audio_url/data` 解析。因此本插件当前更适合“返回音频 URL JSON”的兼容渠道，不能宣称已经正确处理 OpenAI 官方二进制响应。直连官方服务前必须增加二进制响应合同、MIME/文件名处理和资源保存测试。

## 官方资料

- [OpenAI Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI Audio Speech reference](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)

{{CONTRACT}}
