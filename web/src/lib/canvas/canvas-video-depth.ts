import type { ModelQuoteRequest } from "@/services/api/logical-models";
import type { AiConfig } from "@/stores/use-config-store";
import { videoProcessingTaskInput, videoProcessingQuoteRequest, videoProcessingSourceError } from "./canvas-video-processing";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";

export type VideoDepthParams = { model: string };

export function videoDepthSourceError(node: CanvasNodeData, maxSourceSeconds: number) {
    return videoProcessingSourceError(node, maxSourceSeconds, "depth");
}

/** 只选择深度模型；输出规格由处理协议决定，不能沿用当前生成模型的规格。 */
export function videoDepthTaskInput(options: { config: AiConfig; params: VideoDepthParams; source: ReferenceVideo; sourceNodeId: string; projectId: string; nodeId: string; signal?: AbortSignal }) {
    return videoProcessingTaskInput({ ...options, operation: "depth" });
}

export function videoDepthQuoteRequest(config: AiConfig, params: VideoDepthParams, sourceDurationMs?: number): ModelQuoteRequest | undefined {
    return videoProcessingQuoteRequest(config, params, "depth", sourceDurationMs);
}
