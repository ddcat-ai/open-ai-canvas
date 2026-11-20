# 火山 MediaKit 视频画质增强工具

火山 MediaKit 官方声明式视频处理插件，用于画质增强，不是视频生成模型。它接收已有视频并输出增强后的视频，支持 720p、1080p、2K、4K 目标分辨率。

后端从生成的 `volcengine-mediakit.yingce-plugin` 包加载，不依赖系统内置 `host:` 适配器。

所有 provider 声明 `kind: "processing"`：以输入媒体为主体，不要求提示词，不出现在生成模型列表，只出现在画布节点的处理工具里。

| Provider | 能力 | 画布入口 |
| --- | --- | --- |
| `volcengine-mediakit-enhance-video` | video | 视频节点「画质增强」 |

完整接口见 [docs/interface.md](docs/interface.md)。
