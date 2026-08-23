# 火山方舟图片生成

本插件面向火山方舟 Ark 图片生成 JSON 接口。提示词直接发送，参考图数组映射到 `image`，连续生成和水印参数可从模型扩展字段透传。

## 接口、鉴权与区域

{{OPERATIONS}}

```http
POST {channel_base_url}/api/v3/images/generations
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

Base URL、鉴权方式和可用模型受火山方舟控制台、区域与接入方式影响。若使用 AK/SK 签名网关，应由渠道层完成签名，不能把 Secret Key 写入插件文档或浏览器。

## 模型与支持边界

模型 ID、尺寸范围与能力以火山方舟控制台为准。

## 参数与字段映射

{{PARAMETERS}}

当前实现：`aspectRatio -> size`，所有 `images -> image[]`；`extra` 可透传 `size`、`sequential_image_generation`、`sequential_image_generation_options`、`watermark`。`imageCount`、`quality` 与 `resolution` 没有通用映射，必须按模型接口另行适配。

## 文生图示例

```bash
curl "{channel_base_url}/api/v3/images/generations" \
  -H "Authorization: Bearer <ARK_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_ARK_ENDPOINT_OR_MODEL",
    "prompt":"古城屋顶追逐，低机位，动态构图",
    "size":"2048x1152",
    "watermark":false
  }'
```

## 参考图示例

```json
{
  "model":"YOUR_ARK_ENDPOINT_OR_MODEL",
  "prompt":"保持人物服装和发型，生成侧面中景",
  "image":["https://example.com/character.png"],
  "size":"2048x1152"
}
```

## 响应解析与限制

响应按 `data[]` 图片数组解析，元素需包含 `url`、`b64_json` 或 `data`。当前插件没有为 Ark 特有错误码、任务模式或内容过滤结果做专属解包；渠道返回非兼容结构时会明确失败。模型尺寸、参考图数量、序列图上限、水印和计费以控制台当前模型说明为准，不能从插件默认值推断。

## 官方资料

- [火山方舟视觉模型 API 文档](https://www.volcengine.com/docs/82379)
- [火山方舟 API 接入与鉴权文档](https://www.volcengine.com/docs/82379/1263279)

{{CONTRACT}}
