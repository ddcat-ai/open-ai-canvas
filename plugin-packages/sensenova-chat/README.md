# SenseNova Chat

SenseNova 平台的独立官方声明式文本协议。插件 ID / Provider ID：`sensenova-chat`，版本 `1.0.0`。

默认 Base URL 为 `https://token.sensenova.cn/v1`，Bearer API Key 鉴权；文本生成与 Agent 请求均使用 `POST /chat/completions`。

支持五个明确型号的文本对话、已文档化视觉输入、正文/推理分离和 Function Calling 映射；不包含图像生成、视频、音频或 Messages/Responses 协议。

本协议声明 `hostTextPolicy="before_mapping"`：宿主先提供实际思考/输出/流式策略，插件映射是最终请求 writer，不在渲染后再注入字段。非 GLM 流式固定 `include_usage=true` 以供本地结算；GLM 不发送 `stream_options`。输出截断或安全过滤映射为失败，不把 HTTP 2xx 当作业务成功。

完整参数、模型差异、响应映射和限制见 [docs/interface.md](docs/interface.md)。源码经统一文档嵌入与打包后由宿主加载，不依赖 `host:` 内置适配器。
