# WeNew API H3 Video

影策官方声明式协议插件，适配 [WeNew API](https://ai.seekthex.com/) 的 MiniMax H3 视频生成产品。

- Provider：`wenew-h3-video`
- 产品代码：`h3_video`
- 创建：`POST /api/v1/tasks`
- 查询：`GET /api/v1/tasks/{task_id}`
- 鉴权：`Authorization: Bearer <API Key>`

该协议使用 WeNew API 的统一异步任务入口，支持文生视频、图片参考生成（可搭配音频）和独立首尾帧模式。首尾帧不能与参考图、参考音频混用；输出固定带声音。插件使用公网素材地址，不提供任意请求体或计费产品覆盖。自定义渠道的 Base URL 填 `https://ai.seekthex.com`，API Key 填 WeNew 控制台创建的密钥。

完整字段映射见 [`docs/interface.md`](docs/interface.md)。
