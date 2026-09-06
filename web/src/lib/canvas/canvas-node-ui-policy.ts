import { CanvasNodeType, isLocalUploadedAssetNode, type CanvasNodeData } from "@/types/canvas";

export function isMediaNode(node: CanvasNodeData | null | undefined) {
    return node?.type === CanvasNodeType.Image || node?.type === CanvasNodeType.Video || node?.type === CanvasNodeType.Audio;
}

export function hasMediaResource(node: CanvasNodeData | null | undefined) {
    if (!node || !isMediaNode(node)) return false;
    return Boolean(node.metadata?.content || node.metadata?.storageKey);
}

export function isEmptyMediaNode(node: CanvasNodeData | null | undefined) {
    return isMediaNode(node) && !hasMediaResource(node);
}

export function isLocalReadOnlyAssetNode(node: CanvasNodeData | null | undefined) {
    return Boolean(node && isLocalUploadedAssetNode(node));
}

/** Only states that need immediate attention are rendered inside the node. */
export function shouldShowInlineNodeStatus(node: CanvasNodeData | null | undefined) {
    return node?.metadata?.status === "loading" || node?.metadata?.status === "error";
}
