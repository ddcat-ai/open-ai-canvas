# xAI Grok Images

Grok Images 插件使用 OpenAI 风格的图片生成路径，但请求字段按 xAI 图片协议构造：`aspect_ratio`、`resolution`，并在有参考图时发送单个 `image`。它不是 OpenAI Images 插件的别名。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/images/generations
Authorization: Bearer <XAI_API_KEY>
Content-Type: application/json
```

## 模型与支持边界

模型名由 xAI 账户当前可用模型决定。插件不写死模型、价格、并发或内容限制。当前实现只发送第一张参考图；多参考图、编辑专用路径、mask 和批量生成没有实现，不能因上游可能支持就展示为已支持。

## 参数与字段映射

{{PARAMETERS}}

实际构造为：`aspectRatio -> aspect_ratio`，为空时默认 `1:1`；`quality -> resolution`，为空时默认 `2k`；`images[0] -> image`。`imageCount`、`resolution` 平台字段及其他图片不会发送。

## 文生图请求

```bash
curl "{channel_base_url}/v1/images/generations" \
  -H "Authorization: Bearer <XAI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_GROK_IMAGE_MODEL",
    "prompt":"太空港的清晨，宽银幕概念设计",
    "aspect_ratio":"16:9",
    "resolution":"2k"
  }'
```

## 单图参考请求

```json
{
  "model":"YOUR_GROK_IMAGE_MODEL",
  "prompt":"保持主体轮廓，改成铅笔分镜风格",
  "aspect_ratio":"16:9",
  "resolution":"2k",
  "image":"https://example.com/reference.png"
}
```

## 响应与错误

插件按 OpenAI Images 风格解析 `data[]` 中的 `url`、`b64_json` 或 `data`。如果 xAI 的实际响应结构发生变化或只返回异步任务，当前解析会失败而不是伪造结果。素材不可达、比例/分辨率不受模型支持、模型无权限和审核拒绝应原样暴露。

## 官方资料

- [xAI Image Generation](https://docs.x.ai/docs/guides/image-generation)
- [xAI API Reference](https://docs.x.ai/docs/api-reference)

{{CONTRACT}}
