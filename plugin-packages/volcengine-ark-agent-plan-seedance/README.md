# 火山方舟 Seedance Agent Plan 视频接口

火山方舟 Agent Plan 专用声明式协议插件，使用 `/api/plan/v3` 视频生成接口。需要 Agent Plan 专用 API Key 和 AFP 额度，不能与普通 `/api/v3` 方舟接口混用。

后端从生成的 `volcengine-ark-agent-plan-seedance.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

完整接口见 [docs/interface.md](docs/interface.md)。
