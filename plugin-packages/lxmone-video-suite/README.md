# 万有引力视频套件（lxmone.xyz）

该目录是万有引力中转站（`https://lxmone.xyz/v1`）视频协议的官方声明式插件源码。
后端从生成的 `lxmone-video-suite.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

协议按中转站公开接口文档 `https://lxmone.xyz/docs/` 的 `/v1/videos` 与 `/v1/videos/generations`
两套请求体形状编写，拆成 8 个 provider，覆盖该站点当前开放的全部视频模型：

| Provider ID | 覆盖模型 | 创建接口 |
| --- | --- | --- |
| `lxmone-wan-videos` | `wan3.0-video`、`wan3.0-video-prime` | `POST /v1/videos` |
| `lxmone-wan-channel-s` | `wan3.0-video-s`、`wan3.0-video-prime-s` | `POST /v1/videos` |
| `lxmone-seedance-videos` | `seedance-2-pro/fast/mini`、`seedance-2.5-pro`、`seedance2.0-a`~`seedance2.0-f`、`seedance2.5-a` | `POST /v1/videos` |
| `lxmone-h3-max-videos` | `minimax-h3-max` | `POST /v1/videos` |
| `lxmone-sd-videos` | `sd-2.0-a`、`sd-2.0-b`、`sd-2.0-c`、`sd-2.5-a`、`sd-2.5` | `POST /v1/videos` |
| `lxmone-sd-mini-videos` | `sd-mini` | `POST /v1/videos` |
| `lxmone-grok-videos` | `grok-imagine-video`、`grok-imagine-video-1.5`、`grok-imagine-video-1.5S` | `POST /v1/videos/generations` |
| `lxmone-h3-workflow` | `minimax-h3-a`~`minimax-h3-e` | `POST /v1/videos/generations` |

完整字段、请求模板与响应映射见 [docs/interface.md](docs/interface.md)。

## 构建

```sh
node plugin-packages/embed-documentation.mjs lxmone-video-suite
sh plugin-packages/build-packages.sh
```
