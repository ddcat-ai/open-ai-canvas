# MiniMax 视频生成

MiniMax 视频插件使用 `/v2/video_generation` 创建异步任务。它同时发送顶层 `prompt` 和结构化 `content[]`：文本为 text item，参考图片为带 `reference_image` role 的 image URL item。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v2/video_generation
GET  {channel_base_url}/v2/query/video_generation/{task_id}
Authorization: Bearer <MINIMAX_API_KEY>
Content-Type: application/json
```

## 模型与约束

当前 MiniMax V2 官方文档列出 `MiniMax-H3`，时长为 4–15 秒整数，分辨率为 `768P` 或 `2K`，比例支持 `adaptive`、`21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。当前 adapter 默认 6 秒；模型名和其他限制仍以账户实际开放能力为准。

## 参数与字段映射

{{PARAMETERS}}

每张图片构造为 `content` 中的 `image_url` item。`extra` 可覆盖 `model`、`prompt`、`duration`、`content`、`resolution`、`aspect_ratio`。参考视频、参考音频、音频生成和水印当前不发送。

## 创建任务示例

```bash
curl "{channel_base_url}/v2/video_generation" \
  -H "Authorization: Bearer <MINIMAX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_MINIMAX_VIDEO_MODEL",
    "prompt":"保持角色一致，人物转身看向镜头",
    "duration":6,
    "content":[
      {"type":"text","text":"保持角色一致，人物转身看向镜头"},
      {"type":"image_url","image_url":{"url":"https://example.com/character.png"},"role":"reference_image"}
    ],
    "resolution":"720P",
    "aspect_ratio":"16:9"
  }'
```

## 查询、文件与结果

```bash
curl "{channel_base_url}/v2/query/video_generation/task_xxx" \
  -H "Authorization: Bearer <MINIMAX_API_KEY>"
```

当前 V2 官方成功响应在 `task.content.url` 返回视频地址，通用 parser 会先合并 `task`，再从 `content.url` 提取结果。官方仅允许查询最近 7 天任务，视频 URL 有时效，应立即转存。当前 adapter 尚未发送参考视频、参考音频、`callback_url` 或 `aigc_watermark`；虽然 V2 上游支持这些字段，影策不能宣称已支持。

## 官方资料

- [MiniMax 创建视频生成任务](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create)
- [MiniMax 查询任务](https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query)

{{CONTRACT}}
