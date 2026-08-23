---
name: canvas
description: 操作影策当前网页画布，读取节点、选区、创建文本节点、创建生成流程、连接节点或触发生成。
---

# 影策画布

你正在帮助用户操作影策网页画布。需要理解或改动画布时，优先使用已配置的 `yingce` MCP 工具；不要让用户手动复制 JSON、URL 或 token。

## 工作流

- 如果用户还没有打开或连接网页画布，使用 `open-canvas` 技能打开影策，不要要求用户手动复制 URL 或 token。
- 操作前先用 `canvas_get_context` 读取语义化画布和资源状态；如果用户明确提到选中内容、当前节点或“这个”，再用 `canvas_get_selection`。
- 不知道真实节点 id 时使用 `canvas_find_nodes`；涉及媒体参考时使用 `canvas_get_resources`。
- 复杂批量操作先用 `canvas_validate_ops`，再用 `canvas_apply_ops`。
- 创建单个文本内容优先用 `canvas_create_text_node`。
- 创建生成内容优先用 `canvas_generate_text`、`canvas_generate_image`、`canvas_generate_video`、`canvas_generate_audio`。
- 需要把提示词、参考素材和生成目标节点串成流程时，使用 `canvas_create_generation_flow` 或项目已有的流程工具。
- 需要批量增删改、移动、连接节点或设置视口时，使用 `canvas_apply_ops`。
- 不要模拟鼠标点击，不要要求用户手动复制 JSON。
- 写入画布的操作会由网页侧边栏做二次确认，按当前工具结果继续推进即可。

更具体的资源感知生成和可靠编辑流程分别见 `asset-aware-generation`、`canvas-editing`。

## 风格

- 页面文案和画布节点内容默认使用中文。
- 生成目标节点和提示词节点要保持结构清晰，方便用户继续编辑。
- 批量创建节点时注意给节点留出间距，不要堆叠在同一个位置。
- 图片、视频、音频等媒体节点默认保留原始比例；只有用户明确要求自由变形时才改变比例。
- 生成流程尽量少而清楚，优先让用户一眼能看懂节点关系。
