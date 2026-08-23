# 即梦官方视频异步 API

即梦视频插件使用 `CVSync2AsyncSubmitTask` 创建、`CVSync2AsyncGetResult` 查询，并由渠道的火山 AK/SK 实现完成签名。创建与查询均为 POST，模型能力键通过 `req_key` 传递。

## 接口与签名

{{OPERATIONS}}

这两个名称是视觉服务 Action，实际 URL、Query、Region、Service、时间戳和签名头必须按火山官方签名规范生成。把 AK/SK 放入 JSON 或浏览器会造成密钥泄漏。

## 模型、版本与素材限制

`req_key` 必须是账户已开通的即梦视频能力键。每个版本对首帧/尾帧、参考图数量、时长、比例和分辨率的约束不同；插件不维护一张可能过期的模型表。当前只映射参考图片，不发送参考视频、音频、生成音频或水印。

## 参数与字段映射

{{PARAMETERS}}

基础请求包含 `req_key`、`prompt`、可选 `image_urls`。`extra` 可透传并覆盖 `req_key`、`prompt`、`image_urls`、`duration`、`ratio`、`resolution`，适合管理员按已确认的官方版本补参数。

## 创建任务正文

```json
{
  "req_key":"YOUR_JIMENG_VIDEO_REQ_KEY",
  "prompt":"保持参考人物，镜头从全景移动到近景",
  "image_urls":["https://example.com/subject.png"],
  "duration":5,
  "ratio":"16:9",
  "resolution":"720p"
}
```

创建响应：

```json
{"data":{"task_id":"task_xxx"}}
```

查询正文：

```json
{"req_key":"YOUR_JIMENG_VIDEO_REQ_KEY","task_id":"task_xxx"}
```

## 轮询、结果与失败

轮询响应由统一异步 parser 读取状态和视频 URL。查询必须继续携带创建时的模型 `req_key`，不能只传任务 ID。签名时间偏差、Region 错误、能力未开通、素材 URL 失效、参数不匹配和审核均会失败。当前没有取消接口，失败后的额度处理以官方账务为准。

## 官方资料

- [火山引擎视觉智能开放平台](https://www.volcengine.com/docs/85621)
- [火山引擎 API 签名方法](https://www.volcengine.com/docs/6369/67269)

{{CONTRACT}}
