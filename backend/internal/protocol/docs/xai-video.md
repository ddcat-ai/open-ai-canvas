# xAI 视频生成

xAI 视频插件创建异步 generation request，再按 request ID 查询。单张参考图发送为 `image`，多张参考图发送为 `reference_images`；时长、画幅和分辨率使用 xAI 风格字段。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/videos/generations
GET  {channel_base_url}/v1/videos/{request_id}
Authorization: Bearer <XAI_API_KEY>
Content-Type: application/json
```

## 模型与当前支持

模型 ID、允许时长、比例、分辨率、参考图数量、审核规则和计费以 xAI 控制台及官方文档为准。当前 adapter 默认 6 秒、`16:9`、`720p`。视频参考、音频参考、音频生成开关和水印均不会发送。

## 参数与字段映射

{{PARAMETERS}}

单图结构：`"image":{"url":"..."}`；多图结构：`"reference_images":[{"url":"..."}]`。URL 或 data URL 是否被具体模型接受，应在调用前验证。

## 请求示例

```bash
curl "{channel_base_url}/v1/videos/generations" \
  -H "Authorization: Bearer <XAI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_XAI_VIDEO_MODEL",
    "prompt":"雨夜都市追逐，手持摄影，真实运动模糊",
    "duration":8,
    "aspect_ratio":"16:9",
    "resolution":"720p",
    "image":{"url":"https://example.com/character.png"}
  }'
```

## 创建、查询与下载

创建响应需包含 `request_id` 或其他统一解析器支持的任务字段。查询完成后从视频数组或 `video_url/result_url/url` 读取媒体。当前没有 cancel adapter；关闭影策弹窗不会取消上游生成。结果 URL 应及时转存，不能假定永久有效。

## 错误处理

模型权限、无效尺寸、参考素材不可访问、内容审核、速率或余额限制必须作为真实失败展示。若官方响应结构与通用解析器不一致，应补 xAI 专属 parser 和 fixture 测试，而不是继续堆叠模糊字段猜测。

## 官方资料

- [xAI Video Generation guide](https://docs.x.ai/docs/guides/video-generation)
- [xAI API Reference](https://docs.x.ai/docs/api-reference)

{{CONTRACT}}
