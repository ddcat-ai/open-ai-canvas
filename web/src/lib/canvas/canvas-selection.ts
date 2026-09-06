import { buildCanvasSpatialIndex, canvasNodeBounds, type CanvasSpatialBounds, type CanvasSpatialIndex } from "@/lib/canvas/canvas-spatial-index";
import type { CanvasNodeData, CanvasSelectionHitMode, CanvasSelectionStrategy } from "@/types/canvas";

type SelectionModifiers = {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
};

type CanvasPointerIntentInput = SelectionModifiers & {
    background: boolean;
    boxSelectEnabled: boolean;
    button: number;
    pointerType: string;
    spacePressed: boolean;
};

export type CanvasPointerIntent = "ignore" | "pan" | "select";

/**
 * Keeps desktop selection and navigation on separate event paths: mouse drag
 * selects by default, while touch, Space + drag and middle-button drag pan.
 * Trackpad gestures arrive as wheel events and never pass through this router.
 */
export function resolveCanvasPointerIntent(input: CanvasPointerIntentInput): CanvasPointerIntent {
    if (input.pointerType === "touch") return input.background ? "pan" : "ignore";
    if (input.button === 1) return "pan";
    if (input.button !== 0) return "ignore";
    if (input.spacePressed) return "pan";
    if (!input.background) return "ignore";
    if (input.boxSelectEnabled || input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return "select";
    return "pan";
}

export type CanvasSelectionSpatialIndexCache = {
    get: (nodes: CanvasNodeData[]) => CanvasSpatialIndex<CanvasNodeData>;
};

/** Reuses the selectable-node index until the immutable node array changes. */
export function createCanvasSelectionSpatialIndexCache(): CanvasSelectionSpatialIndexCache {
    let source: CanvasNodeData[] | null = null;
    let index = buildCanvasSpatialIndex<CanvasNodeData>([]);

    return {
        get(nodes) {
            if (source === nodes) return index;
            const nodeById = new Map(nodes.map((node) => [node.id, node]));
            const hiddenBatchChildIds = new Set(nodes.flatMap((node) => {
                const rootId = node.metadata?.batchRootId;
                const root = rootId ? nodeById.get(rootId) : undefined;
                return root && !root.metadata?.imageBatchExpanded ? [node.id] : [];
            }));
            index = buildCanvasSpatialIndex(nodes
                .filter((node) => !hiddenBatchChildIds.has(node.id) && !(node.parentId && nodeById.get(node.parentId)?.metadata?.frame?.collapsed))
                .map((node) => ({ id: node.id, bounds: canvasNodeBounds(node), value: node })));
            source = nodes;
            return index;
        },
    };
}

export function resolveCanvasSelectionStrategy(modifiers: SelectionModifiers): CanvasSelectionStrategy {
    if (modifiers.altKey) return "subtract";
    if (modifiers.ctrlKey || modifiers.metaKey) return "toggle";
    if (modifiers.shiftKey) return "add";
    return "replace";
}

export function resolveCanvasSelectionHitMode(startWorldX: number, currentWorldX: number): CanvasSelectionHitMode {
    return currentWorldX >= startWorldX ? "contain" : "intersect";
}

export function createCanvasSelectionBounds(startWorldX: number, startWorldY: number, currentWorldX: number, currentWorldY: number): CanvasSpatialBounds {
    return {
        left: Math.min(startWorldX, currentWorldX),
        top: Math.min(startWorldY, currentWorldY),
        right: Math.max(startWorldX, currentWorldX),
        bottom: Math.max(startWorldY, currentWorldY),
    };
}

export function canvasSelectionHitsBounds(selectionBounds: CanvasSpatialBounds, nodeBounds: CanvasSpatialBounds, hitMode: CanvasSelectionHitMode): boolean {
    if (hitMode === "contain") {
        return nodeBounds.left >= selectionBounds.left
            && nodeBounds.top >= selectionBounds.top
            && nodeBounds.right <= selectionBounds.right
            && nodeBounds.bottom <= selectionBounds.bottom;
    }
    return nodeBounds.right > selectionBounds.left
        && nodeBounds.left < selectionBounds.right
        && nodeBounds.bottom > selectionBounds.top
        && nodeBounds.top < selectionBounds.bottom;
}

export function applyCanvasSelectionStrategy(initialSelection: Iterable<string>, hitNodeIds: Iterable<string>, strategy: CanvasSelectionStrategy): Set<string> {
    const hits = Array.from(hitNodeIds);
    if (strategy === "replace") return new Set(hits);

    const nextSelection = new Set(initialSelection);
    for (const nodeId of hits) {
        if (strategy === "add") nextSelection.add(nodeId);
        else if (strategy === "subtract") nextSelection.delete(nodeId);
        else if (nextSelection.has(nodeId)) nextSelection.delete(nodeId);
        else nextSelection.add(nodeId);
    }
    return nextSelection;
}

export function resolveCanvasSelectionPreviewDelta(initialSelection: ReadonlySet<string>, hitNodeIds: ReadonlySet<string>, strategy: CanvasSelectionStrategy) {
    const includeNodeIds = new Set<string>();
    const removeNodeIds = new Set<string>();

    if (strategy === "replace") {
        for (const nodeId of hitNodeIds) {
            if (!initialSelection.has(nodeId)) includeNodeIds.add(nodeId);
        }
        for (const nodeId of initialSelection) {
            if (!hitNodeIds.has(nodeId)) removeNodeIds.add(nodeId);
        }
        return { includeNodeIds, removeNodeIds };
    }

    for (const nodeId of hitNodeIds) {
        if (strategy === "add") {
            if (!initialSelection.has(nodeId)) includeNodeIds.add(nodeId);
        } else if (strategy === "subtract") {
            if (initialSelection.has(nodeId)) removeNodeIds.add(nodeId);
        } else if (initialSelection.has(nodeId)) removeNodeIds.add(nodeId);
        else includeNodeIds.add(nodeId);
    }
    return { includeNodeIds, removeNodeIds };
}
