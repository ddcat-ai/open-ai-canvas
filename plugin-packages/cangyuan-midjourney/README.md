# 沧元 Midjourney

独立声明式协议插件（`yingce.plugin/v2`），同时提供 `cangyuan-midjourney-v7` 和 `cangyuan-midjourney-v82`。使用宿主的渠道鉴权、出站安全检查、下载和资源持久化，不执行额外服务代码。

V7 使用 `midjourney-v7`，无分辨率和速度档。1K/2K 使用 `midjourney-1k` / `midjourney-2k`，供应商默认版本为 V8.2，提示词可显式写 `--v 8.2`；不存在独立的 `midjourney-v8.2` 模型名。

两条线路不能互换。1K/2K 返回官网 CDN 原链，服务器下载可能遇到 HTTP 403；本插件不会伪报保存成功或自动换模型。V7 返回供应商可直接下载的结果地址。`n=1` 表示一次请求，返回的所有图片均交给宿主保存。

完整接口见 [docs/interface.md](docs/interface.md)。
