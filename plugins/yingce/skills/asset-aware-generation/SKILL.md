---
name: asset-aware-generation
description: 基于影策画布已有角色、场景、道具、风格和媒体资源创建生成流程；适用于生图、视频、音频或分镜资产工作。
---

# 资源感知生成

1. 用 `canvas_get_context` 读取已有提示词、工作流和资产引用。
2. 用 `canvas_get_resources` 或 `canvas_find_nodes({resourceOnly:true})` 找到可复用的真实参考节点。
3. 生成前检查资源 `ready`、`status`、`mimeType`、尺寸/时长和资产/版本引用；未就绪资源不能作为参考。
4. 复用真实 `referenceNodeIds`，不要重复上传同一素材，也不要只在 prompt 里写一个无法定位的资源名称。
5. 通过 `canvas_create_generation_flow` 或对应 `canvas_generate_*` 工具创建清晰的提示词节点、参考节点和目标节点关系。
6. 返回结果后确认目标节点、连线和任务状态；生成任务未完成时不要声称成片已完成。

生成任务必须走影策共享 GenerationTask；不要直接调用 provider、模拟点击或把密钥放进 URL。
