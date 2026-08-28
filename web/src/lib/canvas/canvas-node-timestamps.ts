import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

type CanvasNodeTimestampFallback = {
    createdAt?: string;
    updatedAt?: string;
};

const HYDRATED_MEDIA_KEYS = new Set<keyof CanvasNodeMetadata>([
    "content",
    "storageKey",
    "naturalWidth",
    "naturalHeight",
    "bytes",
    "mimeType",
    "durationMs",
    "drawingPreviewUrl",
]);

const MEDIA_NODE_TYPES = new Set<string>([CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Drawing]);

export function canvasNodeCreatedAt(node: CanvasNodeData, fallback?: string) {
    return firstValidDate(node.createdAt, node.metadata?.taskCreatedAt, node.metadata?.folder?.createdAt, fallback);
}

export function canvasNodeUpdatedAt(node: CanvasNodeData, fallback?: string) {
    return firstValidDate(
        node.updatedAt,
        node.metadata?.taskUpdatedAt,
        node.metadata?.drawingUpdatedAt,
        node.metadata?.subtitleUpdatedAt,
        node.metadata?.taskCompletedAt,
        canvasNodeCreatedAt(node),
        fallback,
    );
}

export function normalizeCanvasNodeTimestamps(nodes: CanvasNodeData[], fallback: CanvasNodeTimestampFallback = {}) {
    let changed = false;
    const normalized = nodes.map((node) => {
        const createdAt = canvasNodeCreatedAt(node, fallback.createdAt || fallback.updatedAt);
        const updatedAt = canvasNodeUpdatedAt(node, fallback.updatedAt || createdAt);
        if (createdAt === node.createdAt && updatedAt === node.updatedAt) return node;
        changed = true;
        return { ...node, ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
    });
    return changed ? normalized : nodes;
}

export function stampCanvasNodeChanges(previousNodes: CanvasNodeData[], nextNodes: CanvasNodeData[], now = new Date().toISOString()) {
    if (previousNodes === nextNodes) return previousNodes;
    const previousById = new Map(previousNodes.map((node) => [node.id, node]));
    let changed = false;
    const stamped = nextNodes.map((node) => {
        const previous = previousById.get(node.id);
        const createdAt = canvasNodeCreatedAt(node, canvasNodeCreatedAt(previous || node, now)) || now;
        const meaningfulChange = previous ? canvasNodeMeaningfullyChanged(previous, node) : false;
        const updatedAt = previous
            ? meaningfulChange
                ? now
                : canvasNodeUpdatedAt(node, canvasNodeUpdatedAt(previous, createdAt)) || createdAt
            : canvasNodeUpdatedAt(node, createdAt) || createdAt;
        if (node.createdAt === createdAt && node.updatedAt === updatedAt) return node;
        changed = true;
        return { ...node, createdAt, updatedAt };
    });
    return changed ? stamped : nextNodes;
}

function canvasNodeMeaningfullyChanged(previous: CanvasNodeData, next: CanvasNodeData) {
    if (
        previous.type !== next.type
        || previous.title !== next.title
        || previous.parentId !== next.parentId
        || previous.width !== next.width
        || previous.height !== next.height
        || previous.position.x !== next.position.x
        || previous.position.y !== next.position.y
    ) return true;
    if (previous.metadata === next.metadata) return false;

    const previousMetadata = previous.metadata || {};
    const nextMetadata = next.metadata || {};
    const keys = new Set([...Object.keys(previousMetadata), ...Object.keys(nextMetadata)] as Array<keyof CanvasNodeMetadata>);
    for (const key of keys) {
        if (MEDIA_NODE_TYPES.has(next.type) && HYDRATED_MEDIA_KEYS.has(key)) continue;
        if (!serializableValuesEqual(previousMetadata[key], nextMetadata[key])) return true;
    }
    return false;
}

function serializableValuesEqual(left: unknown, right: unknown) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
}

function firstValidDate(...values: Array<string | undefined>) {
    return values.find((value) => value && Number.isFinite(Date.parse(value)));
}
