# Dola-pool Seedance Video

该独立视频协议插件对接 `https://dolasd.xyz` 的 Dola-pool 视频任务 API。

在渠道配置中选择 `Dola-pool Seedance Video`，填写 Dola-pool API Key。任务使用 `/v1/videos/generations` 创建、`/v1/videos/{task_id}` 查询；不要使用 Kling Video 插件，Kling 的轮询 URL 与 Dola-pool 不同。

接口细节见 [docs/interface.md](docs/interface.md)。
