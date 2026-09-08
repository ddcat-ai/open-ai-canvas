# Heyroute 图片协议

协议 ID `heyroute-image`，随支持 SSE 图片的新版宿主内置。Base URL 填 **https://heyroute.ai**；协议负责拼接 `/v1/images/generations` 或 `/v1/images/edits`。鉴权使用图片分组 API Key，视频分组 Key 不能代替它。

支持 gpt-image-2、grok-imagine-image、flux-klein-2、gemini-3-pro-image、gemini-3.1-flash-image，以及 nano-banana-pro/nano-banana-2 两个别名。Grok 一次 1～10 张，其余一次 1 张。参考图通过重复 image 文件字段提交，蒙版通过 mask PNG 文件提交。

GPT size 主要控制画幅，不能承诺实际 4K；Flux 可选尺寸限已经核对的常用档。Gemini/Grok 的 size、quality 不生效，协议不发送这些无效字段，比例写在提示词里。只有 GPT 显示 quality 选项。不声明透明背景或可选输出编码能力。

服务端消费 started/heartbeat/completed/error/done SSE，在 completed 后立即保存图片，在错误、截断或取消时失败，不自动重复创建收费请求。优先请求 Base64；URL 回落经现有资源保存流程入库。HTTP 200 的 error 事件仍按失败处理。图片任务超时应至少 10 分钟，生产建议 15 分钟。

模型与渠道价格分别由管理员配置，本协议不改动已有密钥或定价。上线前使用模拟 HTTP 验证文生图、multipart 编辑、错误/超时、资源解析；真实额度测试须结合已配置的渠道验收。文档来源：[Heyroute 图片帮助](https://heyroute.ai/help?collection=models-capabilities&page=image-model)。

重建命令：`python3 plugin-packages/heyroute-video/build.py`，再执行 `python3 plugin-packages/heyroute-image/build.py`。图片构建脚本同时生成前后端共用的模型能力表，两份生成结果在测试中核对一致性。
