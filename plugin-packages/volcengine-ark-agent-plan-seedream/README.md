# 火山方舟 Seedream Agent Plan 图片接口

火山方舟 Agent Plan 专用声明式图片协议插件，使用 `/api/plan/v3` 图片生成接口。需要 Agent Plan 专用 API Key 和 AFP 额度，不能与普通 `/api/v3` 方舟接口混用。

后端从生成的 `volcengine-ark-agent-plan-seedream.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

完整接口见 [docs/interface.md](docs/interface.md)。
