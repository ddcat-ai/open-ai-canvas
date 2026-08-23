# OpenAI Images

OpenAI Images 插件实现 JSON 文生图请求，并解析 OpenAI Images 风格的 `data[]` 响应。上游官方还提供 multipart 图像编辑接口，但当前影策适配器的创建路径只构造 `/v1/images/generations`；详情中列出编辑接口是为了说明协议能力，不代表当前画布已发送编辑请求。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/images/generations
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

官方编辑接口为 `POST /v1/images/edits`、`multipart/form-data`。当前适配器未在有参考图时切换到该路径，这是明确的实现缺口。

## 模型、尺寸与质量

模型、允许尺寸、质量枚举、单次张数和计费会随上游服务变化，插件不维护可能过期的白名单。渠道若是 OpenAI 兼容实现，必须分别验证它是否支持 `n`、`quality`、`background`、`output_format` 和 Base64 响应。

## 参数与字段映射

{{PARAMETERS}}

当前实现：`imageCount -> n`、`aspectRatio -> size`、`quality -> quality`；`extra` 可透传 `size`、`quality`、`background`、`response_format`、`output_format`、`style`、`n`。`images` 和 `resolution` 当前不会进入文生图请求。

## 文生图请求

```bash
curl "{channel_base_url}/v1/images/generations" \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_IMAGE_MODEL",
    "prompt":"雨夜便利店门口，青绿色霓虹，电影剧照",
    "size":"1536x1024",
    "quality":"high",
    "n":1
  }'
```

URL 响应：

```json
{"created":1780000000,"data":[{"url":"https://cdn.example/generated.png"}]}
```

Base64 响应：

```json
{"created":1780000000,"data":[{"b64_json":"iVBORw0KGgo..."}]}
```

解析器遍历 `data[]`，优先识别 `url`，也接受 `b64_json` 或 `data`。URL 应立即下载；裸 Base64 会转为 `data:image/png;base64,...`，已带 data URL 前缀的值保持不变。若渠道使用 WebP/JPEG Base64 且响应不返回 MIME，当前协议无法可靠推断格式，应优先请求 URL 或补充带 MIME 的响应合同。

## 图像编辑参考请求

```bash
curl "{channel_base_url}/v1/images/edits" \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=YOUR_IMAGE_MODEL" \
  -F "image=@reference.png" \
  -F "prompt=保持人物一致，改成雨夜街道"
```

该示例是上游协议参考；在影策中使用前必须补 multipart 构造、参考图数量与 MIME 校验、编辑响应测试。

## 官方资料

- [OpenAI Image generation guide](https://developers.openai.com/api/docs/guides/image-generation)
- [OpenAI Images API reference](https://developers.openai.com/api/reference/resources/images)

{{CONTRACT}}
