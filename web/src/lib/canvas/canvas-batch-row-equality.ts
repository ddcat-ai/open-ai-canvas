import type { CanvasNodeData } from "@/types/canvas";

/** Fields consumed by reference thumbnails, mention labels, readiness and input signatures. */
export function sameBatchReferenceNode(left: CanvasNodeData | undefined, right: CanvasNodeData | undefined) {
    if (left === right) return true;
    if (!left || !right || left.id !== right.id || left.type !== right.type || left.title !== right.title) return false;
    const a = left.metadata,
        b = right.metadata;
    if (a === b) return true;
    return a?.content === b?.content && a?.storageKey === b?.storageKey && a?.previewContent === b?.previewContent && a?.prompt === b?.prompt && a?.status === b?.status && a?.fileUpload === b?.fileUpload && a?.errorDetails === b?.errorDetails;
}
