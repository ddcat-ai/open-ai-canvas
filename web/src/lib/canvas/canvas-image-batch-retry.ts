import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

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
