# WaveSpeed Image Edit

WaveSpeed 图片编辑协议插件（异步任务式）：把 WaveSpeed 平台的图片编辑模型以 provider 形式接入影策画布，现有画布与已接入渠道可直接调用。

## 接入的模型端点（编辑类）

| 端点 ID | 模型 | 说明 |
| --- | --- | --- |
| `openai/gpt-image-2.5-sunburst/edit` | GPT Image 2.5 Sunburst | 高质量编辑，支持多图参考（≤16） |
| `openai/gpt-image-2.5-flare/edit` | GPT Image 2.5 Flare | 快速编辑，支持多图参考（≤16） |
| `bytedance/seedream-v5.0-pro/edit` | Seedream 5.0 Pro | 编辑与图层分解（≤10 图） |
| `google/nano-banana-2/edit` | Nano Banana 2 | 编辑（≤10 图） |
| `google/nano-banana-2-lite/edit` | Nano Banana 2 Lite | 轻量编辑 |
| `google/nano-banana-pro/edit` | Nano Banana Pro | 编辑 |

## 接入的模型端点（工具类）

| 端点 ID | 模型 | 说明 |
| --- | --- | --- |
| `bria/remove-background` | BRIA | 去背景 |
| `bytedance/seedream-v5.0-pro/layer-decomposition` | Seedream 5.0 Pro | 图层拆分 |

## 使用方式

1. 在画布设置中安装本插件，填入 WaveSpeed API Key。
2. 创建图片节点时选择「WaveSpeed Image Edit」渠道，模型选上述端点 ID。
3. 提供编辑提示词与源图，等待异步任务完成即可。

完整接口见 [docs/interface.md](docs/interface.md)。
