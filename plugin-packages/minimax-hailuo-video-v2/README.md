# MiniMax Hailuo Video V2 / H3 协议插件

该包贡献兼容旧渠道 ID `minimax-video` 的声明式 provider。画布、创作页和短剧生产只提交统一 `GenerationRequest`；插件将图片、视频和音频按显式 role 转成 MiniMax `content[]`。

重点修复：

- `duration` 支持 4-30 秒整数，默认 5 秒。
- `resolution` 直接来自统一分辨率，不再遗漏。
- 比例写入上游实际使用的 `ratio`；只有首尾帧、没有其他参考图时使用 `adaptive`，首尾帧混用参考图时按请求比例出片（`adaptive` 会被参考图带偏成横屏）。
- `watermark` 映射为 `aigc_watermark`。
- `generateAudio` 映射为 `generate_audio`。
- prompt 只放入 text block，不再同时发送顶层 prompt。
- 首帧、尾帧和 reference image 依据 role 转换，不按 `0/1` 猜测。
- 首尾帧可与角色、风格参考图同时提交，不再在本地拒绝。

完整字段见 [docs/interface.md](docs/interface.md)。
# 秘塔 Seedance 2.0

Base URL 设置为 `https://metaso.cn/api/minimax` 时，同一秘塔 API Key 可调用 `seedance-2.0-mini`（480p、720p）和 `seedance-2.0`（另支持 1080p、4k）。均为 4–15 整数秒，默认 4 秒、480p，无水印。支持文生、图生、多模态参考视频；不支持 Context IR、提示词优化或视频再生成。4K 结果可能需要支持 HEVC 的播放器。
