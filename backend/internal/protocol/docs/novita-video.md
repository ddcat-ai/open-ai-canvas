# Novita 视频异步 API

Novita 视频插件使用 `/v3/video/create` 创建任务，以 query 参数携带任务 ID 查询统一异步结果。模型字段名为 `model_name`，不是通用 `model`。

## 接口与鉴权

{{OPERATIONS}}

```http
POST {channel_base_url}/v3/video/create
GET  {channel_base_url}/v3/async/task-result?task_id={id}
Authorization: Bearer <NOVITA_API_KEY>
Content-Type: application/json
```

## 模型与约束

Novita 聚合多个视频模型，不同 `model_name` 的字段、图片要求、时长、比例和价格可能不同。当前插件只提供共同子集：提示词、单张参考图、时长和比例；不能据此认定所有 Novita 视频模型都接受相同参数。

## 参数与字段映射

{{PARAMETERS}}

`model -> model_name`，`images[0] -> image_url`，时长默认 5 秒，比例默认 `16:9`。`resolution`、参考视频、参考音频、音频生成和水印当前不发送。

## 创建请求示例

```bash
curl "{channel_base_url}/v3/video/create" \
  -H "Authorization: Bearer <NOVITA_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model_name":"YOUR_NOVITA_VIDEO_MODEL",
    "prompt":"产品在黑色展台上缓慢旋转，轮廓光",
    "duration":5,
    "aspect_ratio":"16:9",
    "image_url":"https://example.com/product.png"
  }'
```

## 查询与下载

创建响应应返回 `task_id/id`。查询时任务 ID会进行 URL query 编码：

```bash
curl "{channel_base_url}/v3/async/task-result?task_id=task_xxx" \
  -H "Authorization: Bearer <NOVITA_API_KEY>"
```

成功结果由统一 parser 从视频数组或 URL 字段读取。Novita 若针对某模型返回独特嵌套结构，应建立该模型 fixture，而不是继续扩展全局模糊字段。当前没有取消接口；任务退款和结果保留期以 Novita 当前规则为准。

## 官方资料

- [Novita Unified Video Generation](https://novita.ai/docs/api-reference/reference-unified-video-generation)
- [Novita Task Result Query](https://novita.ai/docs/api-reference/model-apis-task-result)

{{CONTRACT}}
