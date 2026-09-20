# Image Tools

影策图片工具协议插件，提供去背景和图层拆分两个异步能力。

## 能力

- `image-tools-remove-background`：`bria/remove-background`
- `image-tools-layer-decomposition`：`bytedance/seedream-v5.0-pro/layer-decomposition`

两个 provider 都接受统一的 `images[]` 源图输入，结果 URL 会由宿主下载并持久化。
