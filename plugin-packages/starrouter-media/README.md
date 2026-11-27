# StarRouter 专用媒体协议

同一 StarRouter 系统渠道按型号选择媒体协议。Base URL 为 `https://starrouter.io`，凭据填写 StarRouter 模型调用 Key。

通用文本、OpenAI Images、OpenAI Videos 和 OpenAI Speech 使用影策已有协议；火山豆包视频使用 `starrouter-doubao-video`。此包补充其余 StarRouter 专用生成路径，具体范围见 [接口文档](docs/interface.md)。

Comfly 视频处理提供独立的去字幕（`comfly/1194`）、相对深度（`comfly/1776`）和超分（`comfly/1849`）协议，均只接收一个源视频。输入契约与输出边界见 [Comfly 视频处理](docs/comfly-video-processing.md)。
