# Gemini 图片生成

Gemini 图片插件调用 `generateContent`，把提示词和参考图组织为一个 `user` content。Data URL 被拆为 `inline_data`，外部 URL 被发送为 `file_data.file_uri`；响应从候选内容中的内联图片解析。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1beta/models/{model}:generateContent
x-goog-api-key: <GEMINI_API_KEY>
Content-Type: application/json
```

通过后端渠道中转时，API Key 必须留在服务端头部，不能放进浏览器 URL。Vertex AI 使用不同 Base URL、OAuth 与资源路径，除非网关转换协议，否则不能直接复用此插件。

## 模型与输出模式

只有支持原生图片输出的 Gemini 模型才能返回内联图片。模型 ID 原样放进 URL 并进行路径转义。插件不维护模型白名单、图片尺寸表或计费，因为这些应由官方模型页和渠道模型配置共同确定。

## 参数与字段映射

{{PARAMETERS}}

`aspectRatio -> generationConfig.imageConfig.aspectRatio`，`quality -> generationConfig.imageConfig.imageSize`。`extra` 可替换 `generationConfig`、`safetySettings` 和 `systemInstruction`；替换完整配置时调用方必须保留所需图片输出配置。

## 文生图请求

```bash
curl "{channel_base_url}/v1beta/models/YOUR_MODEL:generateContent" \
  -H "x-goog-api-key: <GEMINI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "contents":[{"role":"user","parts":[{"text":"复古科幻电影海报，中文标题清晰"}]}],
    "generationConfig":{"imageConfig":{"aspectRatio":"3:4","imageSize":"2K"}}
  }'
```

## 参考图请求

```json
{
  "contents":[{"role":"user","parts":[
    {"text":"保持人物一致，改为冬季服装"},
    {"inline_data":{"mime_type":"image/png","data":"<BASE64>"}}
  ]}]
}
```

外部 URL 会被构造成 `file_data.file_uri`。该 URI 是否允许任意 HTTP URL 取决于上游；如果官方只接受 Files API URI，必须先上传文件，当前插件不会自动代传。

## 响应解析与安全

解析器遍历 `candidates[].content.parts[]`，识别 `inlineData` 或 `inline_data`，再生成 `data:<mime>;base64,...`。只有文本、finishReason 或安全反馈而没有内联图片时请求会失败。大图片不能进入 localStorage，应立即转存到影策资源存储。

## 官方资料

- [Gemini native image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)

{{CONTRACT}}
