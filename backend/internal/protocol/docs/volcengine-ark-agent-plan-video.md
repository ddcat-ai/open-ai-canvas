# 火山方舟 Agent Plan 视频任务

本插件使用 Agent Plan 专属 Contents Generations Tasks 异步接口。提示词、参考图、参考视频和参考音频组成 `content[]`；比例、分辨率、时长、生成音频和水印位于顶层任务参数。请求体与官方 Ark Seedance 一致，入口改为 `/api/plan/v3`。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/api/plan/v3/contents/generations/tasks
GET  {channel_base_url}/api/plan/v3/contents/generations/tasks/{task_id}
DELETE {channel_base_url}/api/plan/v3/contents/generations/tasks/{task_id}
Authorization: Bearer <AGENT_PLAN_API_KEY>
Content-Type: application/json
```

与官方 `/api/v3` 的差异：

| 项 | 官方 Ark | Agent Plan |
| --- | --- | --- |
| Base URL | `https://ark.cn-beijing.volces.com/api/v3` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| API Key | 推理接入控制台 Key | Agent Plan 专属 Key |
| 计费 | 推理后付费/项目额度 | AFP 套餐抵扣 |
| 请求体 | contents/generations/tasks | 同左 |

## 参数与字段映射

{{PARAMETERS}}

全模态参考的素材映射如下：

- 图片：`{"type":"image_url","image_url":{"url":"..."},"role":"reference_image"}`
- 视频：`{"type":"video_url","video_url":{"url":"..."},"role":"reference_video"}`
- 音频：`{"type":"audio_url","audio_url":{"url":"..."},"role":"reference_audio"}`

单次最多发送 9 张图片、3 个视频和 3 个音频。参考素材可以组合使用，但上游不支持纯音频或“文本 + 音频”。

## 官方资料

- [火山方舟 Agent Plan 文档](https://www.volcengine.com/docs/82379/2375486)
- [火山方舟内容生成任务文档](https://www.volcengine.com/docs/82379/1520757)

{{CONTRACT}}
