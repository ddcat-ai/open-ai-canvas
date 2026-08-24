# 火山方舟视频任务

本插件使用 Ark Contents Generations Tasks 异步接口。提示词、参考图、参考视频和参考音频组成 `content[]`；比例、分辨率、时长、生成音频和水印位于顶层任务参数。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/api/v3/contents/generations/tasks
GET  {channel_base_url}/api/v3/contents/generations/tasks/{task_id}
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json
```

## 模型与约束

模型通常对应控制台可用模型或 endpoint ID。允许时长、分辨率、画幅、参考图数量、是否可生成音频及计费由具体模型决定。插件默认 5 秒、`16:9`、`720p`，默认值不是上游能力承诺。

## 参数与字段映射

{{PARAMETERS}}

全模态参考的素材映射如下：

- 图片：`{"type":"image_url","image_url":{"url":"..."},"role":"reference_image"}`
- 视频：`{"type":"video_url","video_url":{"url":"..."},"role":"reference_video"}`
- 音频：`{"type":"audio_url","audio_url":{"url":"..."},"role":"reference_audio"}`

单次最多发送 9 张图片、3 个视频和 3 个音频。参考素材可以组合使用，但上游不支持纯音频或“文本 + 音频”；使用音频时必须同时提供至少一张参考图或一个参考视频。`generate_audio` 和 `watermark` 只在 true 时发送。

## 创建任务示例

```bash
curl "{channel_base_url}/api/v3/contents/generations/tasks" \
  -H "Authorization: Bearer <ARK_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_ARK_VIDEO_MODEL",
    "content":[
      {"type":"text","text":"沿用图片 1 的主体、视频 1 的运镜和音频 1 的音乐风格"},
      {"type":"image_url","image_url":{"url":"https://example.com/subject.png"},"role":"reference_image"},
      {"type":"video_url","video_url":{"url":"https://example.com/motion.mp4"},"role":"reference_video"},
      {"type":"audio_url","audio_url":{"url":"https://example.com/music.mp3"},"role":"reference_audio"}
    ],
    "ratio":"16:9",
    "resolution":"720p",
    "duration":5,
    "generate_audio":true,
    "watermark":false
  }'
```

## 查询、状态与结果

创建响应任务 ID 由统一解析器从顶层、`task` 或 `data` 提取。查询成功后读取视频数组或常见 URL 字段。若 Ark 把结果放在其他嵌套路径，必须用真实 fixture 增加专属解析，不允许只根据 `completed` 返回空成功。

任务失败可能来自 endpoint 不可用、素材下载失败、参数组合不受支持、内容审核、并发或额度限制。上游 request ID 应保留用于排查，API Key 和素材正文不得进入日志。

## 官方资料

- [火山方舟视频生成 API](https://www.volcengine.com/docs/82379)
- [火山方舟内容生成任务文档](https://www.volcengine.com/docs/82379/1520757)
- [Doubao Seedance 2.0 全模态参考教程](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2291680?lang=zh#50e1b4ea)

{{CONTRACT}}
