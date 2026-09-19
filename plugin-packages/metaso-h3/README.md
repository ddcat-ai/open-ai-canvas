# METASO MiniMax H3

秘塔 METASO MiniMax H3 文生视频 / 图生视频协议插件（异步任务模式）。

## Provider

| Provider | 能力 | 端点 |
|---|---|---|
| metaso-h3 | video | POST /api/minimax/v2/video_generation（创建）<br>GET /api/minimax/v2/query/video_generation/{taskId}（轮询） |

## 配置

在渠道中填写 API Key（METASO 控制台创建，形如 `mk-xxxxxxxx`），baseUrl 使用 `https://metaso.cn`。

## 说明

- 模型：`MiniMax-H3`（支持 768P / 2K，4-15 秒，文生图/图生视频/多模态参考），`MiniMax-H3-Max`（480P / 768P，5-15 秒）。
- 文生视频：仅文本提示词，ratio 必填（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16）。
- 图生视频：图片 role 为 first_frame / last_frame（首尾帧）。
- 多模态参考：图片 reference_image / 视频 reference_video / 音频 reference_audio。
- 异步任务：创建后返回 task_id，轮询查询接口直到 status=succeeded，成片 URL 在 task.content.url。
- 鉴权：`Authorization: Bearer mk-xxx`。
