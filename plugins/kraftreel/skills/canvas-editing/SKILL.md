---
name: canvas-editing
description: 需要实际修改影策画布节点、连线或视口时使用；只读查询不触发。
---

# 可靠画布编辑

- 写操作前必须先读取 `canvas_get_context`；已有节点只使用真实 id。
- 复杂批量修改先用 `canvas_validate_ops`，通过后再用 `canvas_apply_ops`。
- 单个文本优先 `canvas_create_text_node`；生成流程优先 `canvas_generate_text/image/video/audio`；只有批量事务才直接组装 ops。
- 新节点沿现有内容右侧或下方网格布局，保留间距，避免遮挡和重叠。
- 删除、覆盖、批量移动和触发生成属于高影响动作，依赖 MCP 宿主审批，不要绕过审批。
- 执行后检查返回结果。没有变化、部分失败、任务仍在运行时必须如实说明。
- 媒体节点尽量保留原始比例；不要为了“看起来完成”随意改尺寸或创建孤立占位节点。
