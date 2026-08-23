# 即梦官方图片异步 API

本插件使用即梦视觉异步任务模式：提交任务取得 `task_id`，再以相同 `req_key` 查询结果。接口由火山引擎视觉服务的 AK/SK 签名体系保护，不是 Bearer 兼容接口。

## 接口与签名

{{OPERATIONS}}

逻辑操作名为 `CVSync2AsyncSubmitTask` 和 `CVSync2AsyncGetResult`。实际主机、Query 参数、Service/Region 与签名头由渠道的火山签名实现负责；不能只对这两个字符串执行普通 HTTP POST。

## 模型与 req_key

影策模型 ID 映射为 `req_key`，必须与已开通的即梦能力完全一致。插件不提供可能过期的 `req_key` 白名单，也不根据名字推断文生图、图生图或版本能力。

## 参数与字段映射

{{PARAMETERS}}

当前实现发送 `req_key`、`prompt`，有参考图时发送 `image_urls`。`extra` 可覆盖 `req_key`、`prompt`、`image_urls`、`seed`、`width`、`height`。平台的 `aspectRatio`、`quality`、`resolution` 和 `imageCount` 没有自动转换。

## 创建请求正文

```json
{
  "req_key":"YOUR_JIMENG_REQ_KEY",
  "prompt":"悬疑短剧分镜，楼道尽头的逆光人影",
  "image_urls":["https://example.com/reference.png"],
  "width":1536,
  "height":1024,
  "seed":42
}
```

创建响应至少需要可识别任务 ID：

```json
{"data":{"task_id":"task_xxx"}}
```

## 轮询请求与结果

```json
{"req_key":"YOUR_JIMENG_REQ_KEY","task_id":"task_xxx"}
```

轮询响应从顶层、`task` 或 `data` 读取状态，并按图片类型提取 `images`、`image_url`、`imageUrl`、`result_url` 或 `url`；图片数组可包含 URL 字符串或对象。若结果只出现在即梦其他专属嵌套字段中，需要补 fixture 和专属解析，不能把“拿到 completed”当作已经保存图片。

## 错误与排查

签名时间偏差、Region/Service 错误、`req_key` 未开通、素材不可下载、宽高不支持和内容审核都会导致失败。日志可以记录请求 ID 和错误码，不得记录 Secret Key、完整签名或私有素材 data URL。

## 官方资料

- [火山引擎视觉智能开放平台](https://www.volcengine.com/docs/85621)
- [火山引擎签名方法](https://www.volcengine.com/docs/6369/67269)

{{CONTRACT}}
