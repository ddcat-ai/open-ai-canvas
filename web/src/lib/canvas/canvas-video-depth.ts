import type { ModelQuoteRequest } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";

export type VideoDepthParams = { model: string };

export function videoDepthSourceError(node: CanvasNodeData, maxSourceSeconds: number) {
    if (!node.metadata?.storageKey && !node.metadata?.content) return "视频节点为空，无法生成相对深度视频";
    if ((node.metadata.durationMs || 0) > maxSourceSeconds * 1000) return `源视频时长超过 ${maxSourceSeconds} 秒上限，请先截取片段`;
    return "";
}

/** 只选择深度模型；输出规格由处理协议决定，不能沿用当前生成模型的规格。 */
export function videoDepthTaskInput(options: { config: AiConfig; params: VideoDepthParams; source: ReferenceVideo; sourceNodeId: string; projectId: string; nodeId: string; signal?: AbortSignal }) {
    const { config, params, source, sourceNodeId, projectId, nodeId, signal } = options;
    return {
        projectId,
        nodeId,
        mode: "video" as const,
        prompt: "相对深度视频",
        config: { ...config, model: params.model, videoModel: params.model, vquality: "", size: "", videoSeconds: String(Math.max(1, Math.ceil((source.durationMs || 1000) / 1000))), taskWorkflowProvider: "model" as const },
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId, videoEditOperation: "depth" as const },
    };
}

export function videoDepthQuoteRequest(config: AiConfig, params: VideoDepthParams, sourceDurationMs?: number): ModelQuoteRequest | undefined {
    const channel = resolveModelChannel(config, params.model);
    if (channel.scope !== "system" || !params.model || !sourceDurationMs || sourceDurationMs <= 0) return undefined;
    return {
        channelId: channel.id,
        modelKey: modelOptionName(params.model),
        intent: { capability: "video", operation: "depth", inputs: { video: 1 }, options: { videoSeconds: Math.ceil(sourceDurationMs / 1000) } },
    };
}
