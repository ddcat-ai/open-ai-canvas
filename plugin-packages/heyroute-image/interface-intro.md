# 图片请求与响应合同

apiKey 从渠道密钥字段读取，使用 Bearer 头。model、prompt 为必填；imageCount 映射 n，aspectRatio 映射支持模型的 size，quality 仅 GPT 生效。images 中普通图片发送为 repeated image，role=mask 发送为 mask；无参考图用 JSON generations，有参考图用 multipart edits。

responseMode=sse-json 要求宿主先消费流式终态，再交给声明式响应映射。completed 的 data 数组里 b64_json 转为图片，url 标记临时资源。error.code/error.message 表示失败。未完成就 EOF/done、非法 JSON、响应超过资源限制均报错。此接口不提供异步 poll 或 cancel。

## Manifest 完整接口定义
