import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

/** 异步阶段只准备结果；提交时按节点身份合并，绝不能用旧文档覆盖当前文档。 */
export function commitCanvasGenerationResult(current: CanvasNodeData[], before: CanvasNodeData, result: CanvasNodeData, taskId: string, additionalNodes: CanvasNodeData[] = []): CanvasNodeData[] {
    const live = current.find((node) => node.id === before.id);
    if (!live) throw new Error("生成结果对应节点已删除，结果仍保留在任务中心");
    if (result.id !== before.id || (live.metadata?.taskId && live.metadata.taskId !== taskId) || (before.metadata?.taskId && !live.metadata?.taskId)) {
        throw new Error("节点已绑定其他生成任务，旧任务结果不能覆盖当前节点");
    }
    const metadata: CanvasNodeMetadata = { ...live.metadata };
    for (const key of new Set([...Object.keys(before.metadata || {}), ...Object.keys(result.metadata || {})]) as Set<keyof CanvasNodeMetadata>) {
        if (JSON.stringify(before.metadata?.[key]) === JSON.stringify(result.metadata?.[key])) continue;
        Object.assign(metadata, { [key]: result.metadata?.[key] });
    }
    const geometryChanged = live.width !== before.width || live.height !== before.height || live.metadata?.manualSize;
    const moved = live.position.x !== before.position.x || live.position.y !== before.position.y;
    const merged: CanvasNodeData = {
        ...live,
        type: result.type === before.type ? live.type : result.type,
        title: result.title === before.title || live.title !== before.title ? live.title : result.title,
        width: geometryChanged ? live.width : result.width,
        height: geometryChanged ? live.height : result.height,
        position: moved || geometryChanged ? live.position : result.position,
        metadata,
    };
    const versionRootId = merged.metadata?.versionOfNodeId;
    const committed = current.map((node) => {
        if (node.id === merged.id) return versionRootId ? { ...merged, metadata: { ...merged.metadata, versionPrimary: true } } : merged;
        if (!versionRootId || (node.metadata?.versionOfNodeId || node.id) !== versionRootId) return node;
        return { ...node, metadata: { ...node.metadata, versionPrimary: false } };
    });
    // 同一任务的图片子节点使用稳定 ID；重放只补缺失项，不覆盖用户已移动、改名的图片。
    const existingIds = new Set(current.map((node) => node.id));
    return [...committed, ...additionalNodes.filter((node) => !existingIds.has(node.id)).map((node) => ({ ...node, position: { x: node.position.x + merged.position.x - result.position.x, y: node.position.y + merged.position.y - result.position.y } }))];
}
