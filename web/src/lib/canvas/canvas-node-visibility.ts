import { canvasNodeBounds, type CanvasSpatialBounds, type CanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import type { CanvasNodeData } from "@/types/canvas";

const intersects = (a: CanvasSpatialBounds, b: CanvasSpatialBounds) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

/** 预算只能裁减屏外预加载，不能裁掉屏内节点或正在交互的节点。 */
export function selectCanvasVisibleNodes({
    index, nodeById, view, enter, retain, hiddenIds, retainedIds, forcedIds, budget,
}: {
    index: CanvasSpatialIndex<string>;
    nodeById: ReadonlyMap<string, CanvasNodeData>;
    view: CanvasSpatialBounds;
    enter: CanvasSpatialBounds;
    retain: CanvasSpatialBounds;
    hiddenIds: ReadonlySet<string>;
    retainedIds: ReadonlySet<string>;
    forcedIds: ReadonlySet<string>;
    budget: number;
}) {
    // 先做语义过滤再预算；折叠子图和屏外缓冲区不能抢占真正可见节点的名额。
    const ids = new Set([...index.query(retain), ...forcedIds]);
    const visible: CanvasNodeData[] = [];
    const overscan: CanvasNodeData[] = [];
    for (const id of ids) {
        const node = nodeById.get(id);
        if (!node || hiddenIds.has(id)) continue;
        const bounds = canvasNodeBounds(node);
        if (forcedIds.has(id) || intersects(bounds, view)) visible.push(node);
        else if (retainedIds.has(id) || intersects(bounds, enter)) overscan.push(node);
    }
    return [...visible, ...overscan.slice(0, Math.max(0, budget - visible.length))];
}
