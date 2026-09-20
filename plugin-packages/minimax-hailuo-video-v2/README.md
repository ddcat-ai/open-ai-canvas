# MiniMax Hailuo Video V2 / H3 协议插件

该包贡献兼容旧渠道 ID `minimax-video` 的声明式 provider。画布、创作页和短剧生产只提交统一 `GenerationRequest`；插件将图片、视频和音频按显式 role 转成 MiniMax `content[]`。

重点修复：

- `resolution` 直接来自统一分辨率，不再遗漏。
- 比例写入上游实际使用的 `ratio`；首尾帧模式强制 `adaptive`。
- `watermark` 映射为 `aigc_watermark`。
- `generateAudio` 映射为 `generate_audio`。
- prompt 只放入 text block，不再同时发送顶层 prompt。
- 首帧、尾帧和 reference image 依据 role 转换，不按 `0/1` 猜测。

完整字段见 [docs/interface.md](docs/interface.md)。
