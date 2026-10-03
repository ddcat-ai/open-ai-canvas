# 极途 Gway API

该目录是极途 Gway 官方 API 的独立协议插件源码。后端从生成的 `gway-api.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

同一包提供四个独立 Provider：

- `gway-chat`：OpenAI 兼容文本对话。
- `gway-image`：Gway 异步图片创建与轮询。
- `gway-image-sync`：Gway 同步 OpenAI 兼容图片生成。
- `gway-video`：Gway 异步视频创建与轮询。

完整字段、请求模板和响应映射见 [docs/interface.md](docs/interface.md)。
