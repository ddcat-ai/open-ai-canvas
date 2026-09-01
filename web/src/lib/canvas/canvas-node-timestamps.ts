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
    "hasAudio",
    "videoPreview",
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
    // Most canvas edits preserve order and replace one node. Avoid allocating a
    // 50k-entry id map and comparing metadata for every untouched node in that
    // hot path. The map fallback still handles inserts, deletes and reorders.
    const sameOrder = previousNodes.length === nextNodes.length && previousNodes.every((node, index) => node.id === nextNodes[index]?.id);
    const previousById = sameOrder ? null : new Map(previousNodes.map((node) => [node.id, node]));
    let changed = false;
    const stamped = nextNodes.map((node, index) => {
        const previous = sameOrder ? previousNodes[index] : previousById?.get(node.id);
        if (previous === node) return node;
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

/**
 * Update one node without routing through the generic full-array timestamp
 * reconciliation. This is used by media metadata callbacks, which can fire
 * in bursts while a large canvas is first becoming visible.
 */
export function updateCanvasNode(nodes: CanvasNodeData[], nodeId: string, update: (node: CanvasNodeData) => CanvasNodeData, now = new Date().toISOString()) {
    return updateCanvasNodes(nodes, new Map([[nodeId, update]]), now);
}

export function updateCanvasNodes(nodes: CanvasNodeData[], updates: ReadonlyMap<string, (node: CanvasNodeData) => CanvasNodeData>, now = new Date().toISOString()) {
    if (!updates.size) return nodes;
    let changed = false;
    const next = nodes.map((current) => {
        const update = updates.get(current.id);
        if (!update) return current;
        const updated = update(current);
        if (updated === current) return current;
        changed = true;
        const createdAt = canvasNodeCreatedAt(updated, canvasNodeCreatedAt(current, now)) || now;
        const updatedAt = canvasNodeMeaningfullyChanged(current, updated)
            ? now
            : canvasNodeUpdatedAt(updated, canvasNodeUpdatedAt(current, createdAt)) || createdAt;
        return updated.createdAt === createdAt && updated.updatedAt === updatedAt ? updated : { ...updated, createdAt, updatedAt };
    });
    return changed ? next : nodes;
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
