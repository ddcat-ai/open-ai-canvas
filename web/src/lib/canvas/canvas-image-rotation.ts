import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import { batchOutputResultPending } from "@/lib/canvas/canvas-batch-references";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export type ImageQuarterTurns = 0 | 1 | 2 | 3;
export type ImageRotationDirection = -1 | 0 | 1;
export type CanvasImageRotation = NonNullable<CanvasNodeMetadata["imageRotation"]>;
export type RotationImage = CanvasImageRotation["original"];

function sameResource(left: RotationImage | undefined, right: RotationImage) {
    if (!left) return false;
    return left.storageKey && right.storageKey ? left.storageKey === right.storageKey : left.content === right.content;
}

/** Replacing an image starts a new rotation source even if the upload retained unrelated metadata. */
export function currentImageRotation(node: CanvasNodeData): CanvasImageRotation | undefined {
    const saved = node.metadata?.imageRotation;
    if (!saved) return undefined;
    const active = saved.quarterTurns === 0 ? saved.original : saved.variants?.[saved.quarterTurns];
    return sameResource(active, { content: node.metadata?.content || "", storageKey: node.metadata?.storageKey, width: 0, height: 0 }) ? saved : undefined;
}

export function canRotateCanvasImage(node: CanvasNodeData) {
    return (
        node.type === CanvasNodeType.Image &&
        Boolean(node.metadata?.content || node.metadata?.storageKey) &&
        !node.metadata?.locked &&
        node.metadata?.status !== "loading" &&
        !node.metadata?.fileUpload &&
        !batchOutputResultPending(node.metadata) &&
        !node.metadata?.imageLayerGroup &&
        !node.metadata?.imageLayer &&
        !node.metadata?.layerExtraction
    );
}

export function nextImageQuarterTurns(current: ImageQuarterTurns, direction: ImageRotationDirection): ImageQuarterTurns {
    return direction === 0 ? 0 : (((current + direction + 4) % 4) as ImageQuarterTurns);
}

export function imageRotationSourceKey(node: CanvasNodeData) {
    return `${node.metadata?.storageKey || node.metadata?.content || ""}:${currentImageRotation(node)?.quarterTurns || 0}`;
}

/** The new file replaces this node only. Task records and previously generated output nodes remain immutable. */
export function applyCanvasImageRotation(node: CanvasNodeData, rotation: CanvasImageRotation): CanvasNodeData {
    const image = rotation.quarterTurns === 0 ? rotation.original : rotation.variants?.[rotation.quarterTurns];
    if (!image) throw new Error("旋转后的图片资源缺失");
    const currentTurns = currentImageRotation(node)?.quarterTurns || 0;
    const swapped = (rotation.quarterTurns - currentTurns) % 2 !== 0;
    const width = swapped ? node.height : node.width;
    const height = swapped ? node.width : node.height;
    return {
        ...node,
        width,
        height,
        position: { x: node.position.x + (node.width - width) / 2, y: node.position.y + (node.height - height) / 2 },
        metadata: {
            ...resetGenerationTaskMetadata(node.metadata, "success"),
            content: image.content,
            storageKey: image.storageKey,
            naturalWidth: image.width,
            naturalHeight: image.height,
            bytes: image.bytes,
            mimeType: image.mimeType,
            previewContent: undefined,
            assetId: undefined,
            imageRotation: rotation,
        },
    };
}

/** Include legacy result rows without an input signature in the same undoable edit. */
export function commitCanvasImageRotation(nodes: CanvasNodeData[], nodeId: string, expectedSourceKey: string, rotation: CanvasImageRotation) {
    const source = nodes.find((node) => node.id === nodeId);
    if (!source || !canRotateCanvasImage(source) || imageRotationSourceKey(source) !== expectedSourceKey) return nodes;
    return nodes.map((node) => {
        if (node.id === nodeId) return applyCanvasImageRotation(node, rotation);
        const table = node.metadata?.batchTable;
        if (!table) return node;
        const rows = table.rows.map((row) => (row.outputNodeId && row.inputNodeIds.includes(nodeId) && !row.inputChanged ? { ...row, inputChanged: true } : row));
        return rows.some((row, index) => row !== table.rows[index]) ? { ...node, metadata: { ...node.metadata, batchTable: { ...table, rows } } } : node;
    });
}
