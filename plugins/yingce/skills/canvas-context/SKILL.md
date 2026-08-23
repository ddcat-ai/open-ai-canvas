---
name: canvas-context
description: 理解影策当前画布的语义结构、选区、连接关系和媒体资源状态；适用于任何需要基于已有画布继续工作的请求。
---

# 画布上下文协议

不要把画布当成一段需要猜测的 JSON。先读取事实，再决定动作：

1. `canvas_get_context`：读取语义化节点、真实 id、连接关系、选区、资源清单和 `stateHash`。
2. 用户说“这个/选中内容”时，补 `canvas_get_selection`。
3. 不知道节点 id 时用 `canvas_find_nodes`，不要猜 id。
4. 涉及图片、视频、音频参考时用 `canvas_get_resources`；只有 `ready=true` 且有持久化引用的资源才可作为可用素材。
5. 看到 `loading`、`error`、缺少 `storageKey/resourceId` 的节点时，向用户说明它是未就绪或占位状态。

上下文只作为事实来源，不要把 `storageKey`、内部 id 或资源状态编造成媒体 URL。工具结果返回后，以结果为准继续下一步。
