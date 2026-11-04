import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position } from "@/types/canvas";
import { batchReferenceHandleAtY } from "./canvas-batch-table";
import type { BatchScroll } from "./canvas-batch-references";
import { getConnectionTargetAnchor, isHiddenBatchChild, storyboardHandleAtY } from "./canvas-project-domain";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "./canvas-frame";

export type CanvasConnectionDropTarget = {
    nodeId: string | null;
    handleId?: string;
    anchorRatio?: number;
    isNearNode: boolean;
    /** 命中了节点但连不上（类型不收、参考数已满、缺少分镜行端口）时是哪个节点，松手时据此提示原因。 */
    rejectedNodeId?: string;
};

export function resolveCanvasConnectionTarget({
    nodes,
    current,
    point,
    radius,
    bodyNodeId,
    scriptScrollTopById,
    batchScrollById,
    canConnect,
}: {
    nodes: CanvasNodeData[];
    current: ConnectionHandle;
    point: Position;
    radius: number;
    bodyNodeId: string | null;
    scriptScrollTopById: Record<string, number>;
    batchScrollById?: Record<string, BatchScroll>;
    canConnect: (node: CanvasNodeData) => boolean;
}): CanvasConnectionDropTarget {
    const candidates = nodes.filter((node) => !isHiddenBatchChild(node, nodes) && !isNodeHiddenByCollapsedFrame(node, nodes) && !isFrameNode(node));
    const handleFor = (node: CanvasNodeData) =>
        node.type === CanvasNodeType.Script ? storyboardHandleAtY(node, point.y, scriptScrollTopById[node.id] || 0) : node.type === CanvasNodeType.BatchTable ? batchReferenceHandleAtY(node, point.y, radius) : undefined;
    const targetFor = (node: CanvasNodeData, handleId = handleFor(node)): CanvasConnectionDropTarget => {
        const missingHandle = (node.type === CanvasNodeType.Script || node.type === CanvasNodeType.BatchTable) && !handleId;
        const accepted = !missingHandle && canConnect(node);
        return accepted ? { nodeId: node.id, handleId, isNearNode: true } : { nodeId: null, handleId, isNearNode: true, rejectedNodeId: node.id };
    };
    // DOM 命中已经包含置顶、选中层级和卡片变换；不可连接的可见主体也阻止穿透。
    const body = candidates.find((node) => node.id === bodyNodeId);
    if (body) return targetFor(body);

    let isNearNode = false;
    let rejectedNodeId: string | undefined;
    for (const node of candidates.reverse()) {
        const scrollTop = scriptScrollTopById[node.id] || 0;
        const handleId = handleFor(node);
        const anchor = getConnectionTargetAnchor(node, current, handleId, scrollTop, batchScrollById?.[node.id]);
        // 没有可见主体时只测试端口圆，不把被遮挡的几何矩形重新当作主体。
        if (Math.hypot(point.x - anchor.x, point.y - anchor.y) > radius) continue;
        isNearNode = true;
        const target = targetFor(node, handleId);
        if (target.nodeId) return target;
        rejectedNodeId ??= target.rejectedNodeId;
    }
    return rejectedNodeId ? { nodeId: null, isNearNode, rejectedNodeId } : { nodeId: null, isNearNode };
}
