---
name: canvas-context
description: 理解影策当前画布的语义结构、选区、连接关系和媒体资源状态；适用于任何需要基于已有画布继续工作的请求。
---

# 画布上下文协议

不要把画布当成一段需要猜测的 JSON。先读取事实，再决定动作：

1. `canvas_get_context`：读取语义化节点、真实 id、连接关系、选区、资源清单和 `stateHash`。
2. 用户说“这个/选中内容”时，补 `canvas_get_selection`。
3. 不知道节点 id 时用 `canvas_find_nodes`，不要猜 id。
4. 已经知道真实节点或连线 id 时，分别用 `canvas_get_node` / `canvas_get_connection` 精确读取，不要为确认一个对象反复传输整张画布。
5. 需要知道画布内生成任务的绑定节点、`taskId`、状态、进度或阶段时，用 `canvas_get_generation_tasks`；它只观察画布快照，不等于主动轮询上游。
6. 涉及图片、视频、音频参考时用 `canvas_get_resources`；只有 `ready=true` 且有持久化引用的资源才可作为可用素材。
7. 看到 `loading`、`error`、缺少 `storageKey/resourceId` 的节点时，向用户说明它是未就绪或占位状态。

上下文只作为事实来源，不要把 `storageKey`、内部 id 或资源状态编造成媒体 URL。工具结果返回后，以结果为准继续下一步。

## 工作流与流水线

用户提出“流水线、工作流、节点图、管线、连线”时，优先使用 `canvas_create_workflow`，不要用 `canvas_create_text_nodes` 伪造流程。将阶段拆成真实语义节点：

- `character_cards`：角色拆分图片卡片，实际类型为 `image`
- `character_three_view`：角色三视图，实际类型为 `image`
- `storyboard_video`：分镜剧情视频，实际类型为 `video`
- `script`：剧本或分镜文字，实际类型为 `script`

媒体节点要有 `prompt` 或 `content`。已知画布素材时，先检索并将真实 node id 放入 `referenceNodeIds`；工作流内部依赖放入 `referenceRefs`。工具会自动布局、默认建立顺序连线并返回连接与重叠复核结果。只有结果中的 `verification` 确认连接实际存在时，才能向用户报告“已连线”。
