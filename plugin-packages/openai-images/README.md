# OpenAI Images

该目录是独立官方协议插件源码。后端从生成的 `openai-images.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

完整接口见 [docs/interface.md](docs/interface.md)。

图片编辑的 JSON 请求支持公开图片 URL 和 Base64 data URL。本地角色卡参考图由后端在归属校验后读取为内嵌数据，不要求配置公开存储地址；不会因此将本地服务暴露到公网。
