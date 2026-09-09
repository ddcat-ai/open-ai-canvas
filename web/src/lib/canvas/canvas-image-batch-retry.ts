import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function liveImageBatchChildren(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (root.type !== CanvasNodeType.Image) return [];
    const listed = new Set(root.metadata?.batchChildIds || []);
    return nodes.filter((node) => node.id !== root.id && (node.metadata?.batchRootId === root.id || listed.has(node.id)));
}

export function retireImageBatchChildren(root: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const children = liveImageBatchChildren(root, nodes);
    if (!children.length) return { nodes, connections, removedIds: [] as string[] };
    const removedIds = children.filter((node) => !node.metadata?.content).map((node) => node.id);
    const removed = new Set(removedIds);
    const kept = children.filter((node) => Boolean(node.metadata?.content));
    const nextNodes = nodes
        .filter((node) => !removed.has(node.id))
        .map((node) => {
            if (node.id === root.id) {
                const metadata = { ...node.metadata, imageBatchExpanded: true };
                delete metadata.batchChildIds;
                delete metadata.primaryImageId;
                delete metadata.batchFailedCount;
                if (!metadata.content) metadata.status = "idle";
                return { ...node, metadata };
            }
            const index = kept.findIndex((item) => item.id === node.id);
            if (index < 0) return node;
            const metadata = { ...node.metadata };
            delete metadata.batchRootId;
            return {
                ...node,
                position: { x: root.position.x - node.width - 48, y: root.position.y + index * (node.height + 24) },
                metadata,
            };
        });
    return {
        nodes: nextNodes,
        connections: connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)),
        removedIds,
    };
}

export function cancelIncompleteImageBatch(rootId: string, childIds: string[], nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const childIdSet = new Set(childIds);
    const removedIds = nodes.filter((node) => childIdSet.has(node.id) && !node.metadata?.content).map((node) => node.id);
    const removed = new Set(removedIds);
    const nextNodes = nodes
        .filter((node) => !removed.has(node.id))
        .map((node) => {
            if (node.id !== rootId) return node;
            const remaining = (node.metadata?.batchChildIds || []).filter((id) => !removed.has(id) && nodes.some((item) => item.id === id && item.metadata?.content));
            const hasContent = Boolean(node.metadata?.content);
            const metadata = {
                ...node.metadata,
                batchChildIds: remaining.length ? remaining : undefined,
                isBatchRoot: remaining.length > 1 ? true : undefined,
                imageBatchExpanded: remaining.length > 1 ? true : undefined,
                status: hasContent ? node.metadata?.status : "idle",
            };
            if (!hasContent) {
                delete metadata.errorDetails;
                delete metadata.generationErrorCode;
                delete metadata.failedPromptFingerprint;
            }
            if (remaining.length <= 1) {
                delete metadata.batchFailedCount;
                delete metadata.primaryImageId;
                delete metadata.isBatchRoot;
                delete metadata.imageBatchExpanded;
                delete metadata.batchChildIds;
            }
            return { ...node, metadata };
        });
    const remainingIds = new Set(
        nextNodes.find((node) => node.id === rootId)?.metadata?.batchChildIds || [],
    );
    const detached = nextNodes.map((node) => {
        if (!childIdSet.has(node.id) || remainingIds.has(node.id)) return node;
        const metadata = { ...node.metadata };
        delete metadata.batchRootId;
        return { ...node, metadata };
    });
    return {
        nodes: detached,
        connections: connections.filter((connection) => !removed.has(connection.fromNodeId) && !removed.has(connection.toNodeId)),
        removedIds,
    };
}

export function failedImageBatchChildren(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (root.type !== CanvasNodeType.Image || !root.metadata?.isBatchRoot) return [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return (root.metadata.batchChildIds || [])
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node && node.type === CanvasNodeType.Image && node.metadata?.batchRootId === root.id && node.metadata.status === "error"));
}

export function markImageBatchRetrying(rootId: string, childIds: string[], nodes: CanvasNodeData[]): CanvasNodeData[] {
    const retryingIds = new Set(childIds);
    return nodes.map((node) => {
        if (node.id !== rootId && !retryingIds.has(node.id)) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "loading",
                ...(node.id === rootId ? { batchFailedCount: childIds.length } : {}),
                errorDetails: undefined,
                generationErrorCode: undefined,
                resourceReloadAvailable: undefined,
                failedPromptFingerprint: undefined,
            },
        };
    });
}

export function restoreUnsubmittedImageBatchChild(current: CanvasNodeData, original: CanvasNodeData): CanvasNodeData {
    if (current.metadata?.status !== "loading") return current;
    return {
        ...current,
        metadata: {
            ...current.metadata,
            status: "error",
            errorDetails: original.metadata?.errorDetails || "重试请求未提交",
            generationErrorCode: original.metadata?.generationErrorCode,
            resourceReloadAvailable: original.metadata?.resourceReloadAvailable,
            failedPromptFingerprint: original.metadata?.failedPromptFingerprint,
        },
    };
}

export function reconcileImageBatchRoot(root: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (root.type !== CanvasNodeType.Image || !root.metadata?.isBatchRoot) return root;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const children = (root.metadata.batchChildIds || [])
        .map((id) => nodeById.get(id))
        .filter((node): node is CanvasNodeData => Boolean(node && node.type === CanvasNodeType.Image && node.metadata?.batchRootId === root.id));
    if (!children.length) return root;

    const primary = children.find((node) => node.id === root.metadata?.primaryImageId && node.metadata?.content) || children.find((node) => node.metadata?.content);
    const loading = children.some((node) => node.metadata?.status === "loading");
    const failed = children.find((node) => node.metadata?.status === "error");
    const metadata: CanvasNodeMetadata = { ...root.metadata };
    metadata.batchFailedCount = children.filter((node) => node.metadata?.status === "error").length;

    if (primary) {
        metadata.content = primary.metadata?.content;
        metadata.storageKey = primary.metadata?.storageKey;
        metadata.mimeType = primary.metadata?.mimeType;
        metadata.bytes = primary.metadata?.bytes;
        metadata.naturalWidth = primary.metadata?.naturalWidth;
        metadata.naturalHeight = primary.metadata?.naturalHeight;
        metadata.primaryImageId = primary.id;
        metadata.status = "success";
        delete metadata.errorDetails;
        delete metadata.generationErrorCode;
        delete metadata.failedPromptFingerprint;
    } else {
        delete metadata.content;
        delete metadata.storageKey;
        delete metadata.mimeType;
        delete metadata.bytes;
        delete metadata.naturalWidth;
        delete metadata.naturalHeight;
        delete metadata.primaryImageId;
        metadata.status = loading ? "loading" : failed ? "error" : "idle";
        metadata.errorDetails = failed?.metadata?.errorDetails;
        metadata.generationErrorCode = failed?.metadata?.generationErrorCode;
        metadata.resourceReloadAvailable = failed?.metadata?.resourceReloadAvailable;
        metadata.failedPromptFingerprint = failed?.metadata?.failedPromptFingerprint;
    }

    return { ...root, metadata };
}
