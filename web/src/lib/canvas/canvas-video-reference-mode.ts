import { inferVideoOperation, type ModelInputSummary } from "@/lib/model-selection";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoReferenceMode } from "@/types/canvas";
import { isCanvasWorkflowProvider } from "./canvas-workflow";

export function usesProjectedVideoReferences(node: CanvasNodeData | undefined) {
    const metadata = node?.metadata;
    return metadata?.dramaRef?.kind === "segment" && !metadata.videoReferenceMode && Boolean(metadata.videoStartFrameNodeId || metadata.videoEndFrameNodeId);
}

export function canvasVideoReferenceMode(node: CanvasNodeData | undefined, hasMedia: boolean): CanvasVideoReferenceMode | undefined {
    if (node?.type !== CanvasNodeType.Video || isCanvasWorkflowProvider(node.metadata)) return undefined;
    const { videoReferenceMode, videoEditOperation, videoStartFrameNodeId, videoEndFrameNodeId } = node.metadata ?? {};
    if (videoEditOperation && !["text_to_video", "reference_to_video", "image_to_video", "audio_to_video"].includes(videoEditOperation)) return undefined;
    if (videoReferenceMode === "frames" || videoReferenceMode === "text") return videoReferenceMode;
    if (usesProjectedVideoReferences(node)) return "all";
    if (!videoReferenceMode && videoEditOperation !== "reference_to_video" && (videoStartFrameNodeId || videoEndFrameNodeId)) return "frames";
    return hasMedia ? "all" : "text";
}

export function canvasVideoOperation(node: CanvasNodeData | undefined, input: ModelInputSummary) {
    const hasVisual = input.imageCount + input.characterCount + input.videoCount > 0;
    const mode = canvasVideoReferenceMode(node, hasVisual || input.audioCount > 0);
    if (!mode) return node?.metadata?.videoEditOperation;
    if (usesProjectedVideoReferences(node)) return inferVideoOperation(input);
    return videoReferenceOperation(mode, hasVisual);
}

export function videoReferenceOperation(mode: CanvasVideoReferenceMode, hasVisual: boolean) {
    if (mode === "text") return "text_to_video";
    if (mode === "frames") return "image_to_video";
    return hasVisual ? "reference_to_video" : "audio_to_video";
}

export function canvasVideoFrameIssue(metadata: CanvasNodeMetadata | undefined, imageIds: readonly string[]) {
    const start = metadata?.videoStartFrameNodeId;
    const end = metadata?.videoEndFrameNodeId;
    if (!start && (!end || metadata?.videoReferenceMode === "frames")) return "请选择首帧图片";
    if (start && !imageIds.includes(start)) return "首帧图片已断开，请重新选择";
    if (end && !imageIds.includes(end)) return "尾帧图片已断开，请重新选择或移除尾帧";
    if (start && start === end) return "首帧和尾帧不能使用同一张图片";
    return "";
}

export function videoMediaMentionIssue(mode: "text" | "frames") {
    return mode === "frames" ? "提示词引用了首尾帧以外的素材，请调整引用或切换到全能参考" : "文生视频不使用媒体引用，请移除提示词中的媒体引用或切换到全能参考";
}
