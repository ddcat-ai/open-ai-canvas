import { useEffect, useRef } from "react";

/**
 * 插件节点把「我正在干活」写到 **`metadata.pluginRunning`** —— 画布外框的运行中呼吸圈靠它。
 *
 * ⚠️⚠️ **绝对不要用 `metadata.status = "loading"` 来表达"插件在跑"**（2026-09-20 踩过，生产可见）：
 *   `CanvasNodeContent` 的内容分发里，`status === "loading"` 那个分支**排在插件渲染器之前**
 *   （`components/canvas/canvas-node-content.tsx` 第 83 行 vs 第 87 行）——
 *   一写它，插件自己的整个面板就被换成 `LoadingContent`：没有 `taskId` 时显示
 *   **「正在创建任务」**，节点一片空白（移植链 5 个节点一点「转换」就中招）。
 *   同一个道理，`status === "error"` 会换成 `ErrorContent`、`"success"` 也会换分支 ——
 *   **这三个值对插件节点都是"换内容"，不是"加特效"**。
 *   `status` 是**宿主任务驱动节点**（图片/视频生成）专用的字段：它们有 taskId，
 *   加载态显示的才是真进度 ✓。
 *
 * 所以这里另起一个字段：外壳（`canvas-node.tsx`）按
 * `status === "loading" || pluginRunning === true` 加 `.canvas-node-shell.is-running`，
 * 而**内容分发完全不认 `pluginRunning`** ⇒ 面板照常显示、只是外框转起来了 ✓。
 *
 * 用法：把节点自己的「在跑」判据交给钩子即可（收尾一定发生）：
 *
 * ```ts
 * useNodeRunningStatus(updateMetadata, node.id, generating || pendingCount > 0);
 * ```
 */

/** 节点状态的可写子集（只挑我们要写的那个字段，避免误伤 metadata 的其它部分）。 */
export type NodeStatusWriter = (nodeId: string, patch: Record<string, unknown>) => void;

/**
 * ⚠️ 允许 `undefined`：宿主上下文里的 `updateMetadata` 是可选的（插件节点被复用/预览时可能没有），
 *    拿不到就静默跳过 —— 顶多没有特效，绝不能因此抛错把生成带崩。
 */
export type MaybeStatusWriter = NodeStatusWriter | undefined;

/** 置为「运行中」——外框的呼吸圈由它触发（**不碰 `status`**）。 */
export function markNodeRunning(update: MaybeStatusWriter, nodeId: string): void {
    update?.(nodeId, { pluginRunning: true });
}

/** 收尾：把标记清掉即可。**不写 success/error** —— 插件节点自己会展示结果与错误。 */
export function markNodeSettled(update: MaybeStatusWriter, nodeId: string): void {
    update?.(nodeId, { pluginRunning: false });
}

/** 包一圈：开始置运行中、结束清掉（异常照常抛出去，调用方原有的 try/catch 语义不变）。 */
export async function withNodeRunning<T>(update: MaybeStatusWriter, nodeId: string, action: () => Promise<T>): Promise<T> {
    markNodeRunning(update, nodeId);
    try {
        return await action();
    } finally {
        markNodeSettled(update, nodeId);
    }
}

/**
 * 按节点的「在跑」判据持续反映状态（**推荐用这个**，而不是包住单次调用）。
 *
 * 为什么：生成要跑好几秒甚至更久，而提交动作本身往往一瞬间就返回了（剩下靠轮询）——
 * 只在提交那一刻置运行中，呼吸圈会一闪而过 ✗。这里由调用方给出**它自己的"在跑"判据**
 * （例如"还有元素挂着 pending 任务"），钩子在真与假之间切换时写标记 ✓。
 *
 * ⚠️ **从没跑过就不写收尾**：否则组件一挂载 `busy=false` 会立刻写一次 `pluginRunning:false`，
 *    白白触发一轮画布写回（用 ref 记住"我确实置过 running"）。
 */
export function useNodeRunningStatus(update: MaybeStatusWriter, nodeId: string, busy: boolean): void {
    const markedRef = useRef(false);
    useEffect(() => {
        if (busy) {
            if (!markedRef.current) {
                markNodeRunning(update, nodeId);
                markedRef.current = true;
            }
            return;
        }
        if (!markedRef.current) return;
        markNodeSettled(update, nodeId);
        markedRef.current = false;
    }, [busy, nodeId, update]);
}
