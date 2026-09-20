# METASO MiniMax H3 接口说明

## 鉴权

`Authorization: Bearer mk-xxxxxxxxxxxxxxxxxxxxxxxx`

## 创建视频生成任务

POST `https://metaso.cn/api/minimax/v2/video_generation`

请求体：

```json
{
  "model": "MiniMax-H3",
  "content": [
    { "type": "text", "text": "视频描述" },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "first_frame" },
    { "type": "video_url", "video_url": { "url": "https://..." }, "role": "reference_video" },
    { "type": "audio_url", "audio_url": { "url": "https://..." }, "role": "reference_audio" }
  ],
  "resolution": "768P",
  "duration": 5,
  "ratio": "16:9"
}
```

- content 必须包含一个非空 text 项。
- 首尾帧（first_frame/last_frame）与多模态参考（reference_*）互斥。
- 图片 ≤ 9 张、视频 ≤ 3 段、音频 ≤ 3 段；请求体总大小 ≤ 64 MB。

响应：

```json
{ "task_id": "424010985738629" }
```

## 查询任务

GET `https://metaso.cn/api/minimax/v2/query/video_generation/{task_id}`

响应：

```json
{
  "task": {
    "id": "424010985738629",
    "status": "succeeded",
    "content": { "url": "https://.../output.mp4" },
    "resolution": "2K",
    "duration": 5,
    "usage": { "total_seconds": 5, "output_seconds": 5 }
  }
}
```

status 取值：queued / running / succeeded / failed / cancelled。

## 错误

创建与查询均返回 OpenAI 风格错误体，含 `error.type` / `error.message` / `request_id`；余额不足为 402，速率限制为 429。
