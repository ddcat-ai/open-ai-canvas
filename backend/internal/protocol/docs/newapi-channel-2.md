# NewAPI Video Generations

该插件使用 `/v1/video/generations` JSON 异步接口，直接发送图片、视频和音频 URL 数组。它适用于实现这一特定路径和字段集合的 NewAPI 渠道，不等同于 `/v1/videos` 媒体任务协议。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/video/generations
GET  {channel_base_url}/v1/video/generations/{task_id}
Authorization: Bearer <CHANNEL_API_KEY>
Content-Type: application/json
```

## 模型与约束来源

可用模型、每种素材上限、时长范围、音频能力、分辨率和计费由该 NewAPI 部署映射的上游决定。插件没有通用白名单。用户示例中的 Seedance 限制只可用于实际连接该服务且管理员验证一致的渠道。

## 参数与字段映射

{{PARAMETERS}}

实际字段为 `model`、`prompt`、`seconds`、`aspect_ratio`、可选 `resolution`、`generate_audio`、`image_urls`、`video_urls`、`audio_urls`。时长默认 6 秒并发送为字符串，比例默认 `16:9`。水印当前不发送。

## 完整多模态请求

```bash
curl "{channel_base_url}/v1/video/generations" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_VIDEO_MODEL",
    "prompt":"人物参考第一张图，镜头运动参考视频，节奏跟随音频",
    "seconds":"10",
    "aspect_ratio":"9:16",
    "resolution":"720p",
    "generate_audio":true,
    "image_urls":["https://example.com/subject.png"],
    "video_urls":["https://example.com/motion.mp4"],
    "audio_urls":["https://example.com/beat.mp3"]
  }'
```

## 任务状态与结果

```json
{"task_id":"task_xxx","status":"queued"}
```

```bash
curl "{channel_base_url}/v1/video/generations/task_xxx" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>"
```

状态会归一为等待、处理中、成功或失败。成功结果可来自视频数组或常见顶层 URL；当前没有取消路径。任务失败后的退款、额度释放和结果保留期属于部署方账务合同，影策不会在没有接口证据时承诺。

## 官方资料与边界

- 以连接的 NewAPI 部署接口文档、版本和渠道配置为准。
- 素材必须能被网关和最终上游访问；网关可访问不代表最终供应商可访问。

{{CONTRACT}}
