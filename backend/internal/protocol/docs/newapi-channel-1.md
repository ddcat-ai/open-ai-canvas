# NewAPI 媒体任务协议

该插件把多模态参考素材统一包装为 `input.media[]`，把分辨率、比例、时长和水印放入 `parameters`，使用 `/v1/videos` 创建与查询异步任务。它是影策适配的渠道合同，不是某一家模型厂商的官方协议。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1/videos
GET  {channel_base_url}/v1/videos/{task_id}
Authorization: Bearer <CHANNEL_API_KEY>
Content-Type: application/json
```

## 模型、计费与素材上限

模型清单、计费、时长范围、素材数量和单文件大小均由当前 NewAPI 部署及其上游渠道决定。此插件不能把某个渠道的 Seedance、Veo 或 Kling 限制推广给所有部署。管理员应在模型配置中记录经过实际调用验证的模型 ID。

## 参数与字段映射

{{PARAMETERS}}

实际映射：图片 -> `{type:"reference_image"}`，视频 -> `{type:"reference_video"}`，音频 -> `{type:"reference_voice"}`；均放入 `input.media`。默认 `resolution=720P`、`ratio=16:9`、`duration=5`。只有 `watermark=true` 时才发送水印字段；`generateAudio` 当前不发送。

## 多模态创建示例

```bash
curl "{channel_base_url}/v1/videos" \
  -H "Authorization: Bearer <CHANNEL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"YOUR_CHANNEL_MODEL",
    "input":{
      "prompt":"保持人物外观，动作参考视频，节奏参考声音",
      "media":[
        {"type":"reference_image","url":"https://example.com/character.png"},
        {"type":"reference_video","url":"https://example.com/action.mp4"},
        {"type":"reference_voice","url":"https://example.com/beat.mp3"}
      ]
    },
    "parameters":{"resolution":"720P","ratio":"16:9","duration":8,"watermark":false}
  }'
```

## 响应、轮询与排错

创建响应必须在顶层、`task` 或 `data` 中包含 `id/task_id/taskId/request_id`。查询使用 URL 编码后的任务 ID。完成时解析视频数组或 `video_url/videoUrl/result_url/url`。如果渠道返回自己的深层字段，必须新增专属解析，不能把空结果标记成功。

常见问题包括渠道未映射模型、素材 URL 无法由上游下载、媒体类型命名不被该部署接受、默认参数超出模型范围。先检查部署版本和渠道日志，再修改适配器；不要反复添加兼容别名掩盖协议差异。

## 官方资料与边界

- NewAPI 项目与部署文档由具体运维方提供；本页以影策当前 adapter 的请求事实为准。
- 上游模型官方文档只用于确认模型自身能力，不能替代 NewAPI 网关字段合同。

{{CONTRACT}}
