# WAN 3.0 拼车中转（班次发车）

该目录是独立协议插件源码，对接 WAN 3.0 拼车中转站的 `/api/portal/*` 接口。后端从生成的 `coolhs-wan3-relay.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

中转站按“班次”出片：交单后先候车，班次发车后才排队生成。插件声明了分离式回查（`detachedPolling`），提交成功后立即释放 worker，任务调度每 15 秒回查一次原任务，候车数小时也不会占用执行位或超时重提。

完整接口见 [docs/interface.md](docs/interface.md)。
