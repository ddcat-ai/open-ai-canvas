# Gemini Veo 长任务

Veo 插件通过 `predictLongRunning` 创建 Google long-running operation，再查询 operation 直到完成。提示词位于 `instances[0]`，当前最多取第一张参考图并以内联 Base64 发送。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v1beta/models/{model}:predictLongRunning
GET  {channel_base_url}/v1beta/{operation_name}
x-goog-api-key: <GEMINI_API_KEY>
Content-Type: application/json
```

API Key 必须通过后端头部中转，不能放入浏览器 URL。Vertex AI Veo 的 OAuth、项目、区域和发布者路径不同，不能直接套用 Gemini Developer API Base URL。

## 模型与能力限制

模型 ID 原样放入创建路径。允许时长、比例、分辨率、音频、参考图类型、并发、结果保留期和计费以 Google 官方模型页及账户区域为准。插件不维护白名单。当前 adapter 只使用第一张图片；视频/音频参考和水印不发送。

## 参数与字段映射

{{PARAMETERS}}

实际映射为 `aspectRatio`、`durationSeconds`、`resolution`、`generateAudio`，均放入 `parameters`。参考图固定为 `instances[0].image.inlineData`；没有 data URL 时 MIME 和数据会退化为空/通用值，因此远程 URL 应先下载并转为 data URL。

## 创建任务示例

```bash
curl "{channel_base_url}/v1beta/models/YOUR_VEO_MODEL:predictLongRunning" \
  -H "x-goog-api-key: <GEMINI_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "instances":[{
      "prompt":"夜间列车驶过雪原，航拍镜头缓慢下降",
      "image":{"inlineData":{"mimeType":"image/png","data":"<BASE64>"}}
    }],
    "parameters":{"aspectRatio":"16:9","durationSeconds":8,"resolution":"720p","generateAudio":true}
  }'
```

## Operation 轮询与结果

创建响应返回 operation `name`。影策会移除开头斜杠，并在缺少 `operations/` 前缀时自动补齐，然后请求 `/v1beta/operations/...`。

```json
{"name":"operations/op_xxx","done":false}
```

该插件使用独立的 Google LRO parser，不经过通用 `status/state` 兼容分支：`done:false` 视为处理中，顶层 `error` 视为失败，`done:true` 后从 `response.generatedVideos[]` 或 `response.generateVideoResponse.generatedSamples[]` 的 `video.uri` 读取视频。成功但缺少视频地址会作为真实错误返回，不把 operation 完成误报为媒体已保存。

```json
{
  "name":"operations/op_xxx",
  "done":true,
  "response":{
    "generateVideoResponse":{
      "generatedSamples":[
        {"video":{"uri":"https://generativelanguage.googleapis.com/v1beta/files/..."}}
      ]
    }
  }
}
```

## 官方资料

- [Gemini API video generation with Veo](https://ai.google.dev/gemini-api/docs/video)
- [Google long-running operations](https://ai.google.dev/api/files#method:-operations.get)

{{CONTRACT}}
