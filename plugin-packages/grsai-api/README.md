# Grsai API Media

该目录是 Grsai 图片与视频异步协议插件源码。后端从生成的 `grsai-api.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

当前包含三个独立 Provider profile：

- `grsai-minimax-h3`：MiniMax H3 视频。
- `grsai-nano-banana-image`：Grsai 私有 Nano Banana 图片协议。
- `grsai-gpt-image`：Grsai 私有 GPT Image 图片协议。

能力限制：

- `grsai-minimax-h3` 支持 `480p`、`768p`、`1080p`，视频时长为 1–15 秒（1080p 最多 10 秒）；画幅支持 `portrait`、`landscape`、`square`。画布仍可使用通用比例，宿主会先归一化后再请求上游。创建默认使用 `replyType=async`，由宿主通过 `/v1/api/result?id=...` 轮询；接口同时接受 `json` 和 `stream`。
- `grsai-gpt-image` 支持 `auto`、`low`、`medium`、`high`、`xhigh`、`max`；具体模型允许的档位由后台模型能力配置决定，插件不会覆盖管理员配置。
- `grsai-nano-banana-image` 的 `imageSize` 只发送 `1K`、`2K` 或 `4K`；统一 `quality` 优先于历史 `resolution`，不会把图片请求的旧 `720` 视频分辨率透传给上游。
- 图片和视频参考媒体支持 URL 或 Data URL。GPT Image 的 `mask` 与 `background` 通过 `providerOptions.grsai-gpt-image` 映射到上游字段。

完整接口见 [docs/interface.md](docs/interface.md)。
