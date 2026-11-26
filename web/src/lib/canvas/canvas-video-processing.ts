import { decodeChannelModel, modelOptionName, modelOptionsFromChannels, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";
import type { ModelQuoteRequest } from "@/services/api/logical-models";
import { resolveModelChannel } from "@/stores/use-config-store";

export type VideoProcessingOperation = "enhance" | "depth" | "upscale" | "remove_subtitles";
export type InputOnlyVideoProcessingOperation = Exclude<VideoProcessingOperation, "enhance">;
export type VideoProcessingParams = { model: string };

export const VIDEO_PROCESSING_LABELS: Record<VideoProcessingOperation, string> = { enhance: "画质增强", depth: "相对深度", upscale: "视频超分", remove_subtitles: "去字幕" };

/** 处理工具各自只选择对应 operation 的系统模型，避免与普通生成或其他处理工具混用。 */
export function listVideoProcessingModels(config: AiConfig, operation: VideoProcessingOperation): string[] {
    return modelOptionsFromChannels(config.channels).filter((model) => {
        const decoded = decodeChannelModel(model);
        const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : undefined;
        if (!channel || channel.scope !== "system" || channel.enabled === false) return false;
        const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
        const video = cost?.capabilityConfig?.video;
        return cost?.available !== false && cost?.capability === "video" && Boolean(video?.processing) && video?.defaultOperation === operation;
    });
}

export function videoProcessingSourceError(node: CanvasNodeData, maxSourceSeconds: number, operation: InputOnlyVideoProcessingOperation, maxSourceBytes?: number) {
    if (!node.metadata?.storageKey && !node.metadata?.content) return `视频节点为空，无法${VIDEO_PROCESSING_LABELS[operation]}`;
    if ((node.metadata?.durationMs || 0) > maxSourceSeconds * 1000) return `源视频时长超过 ${maxSourceSeconds} 秒上限，请先截取片段`;
    if (maxSourceBytes && (node.metadata?.bytes || 0) > maxSourceBytes) return `源视频大小超过 ${(maxSourceBytes / 1024 / 1024).toFixed(0)} MiB 上限`;
    return "";
}

/** 单视频工具共享业务任务输入；供应商和工作流 ID 由后台模型配置决定。 */
export function videoProcessingTaskInput(options: { config: AiConfig; params: VideoProcessingParams; operation: InputOnlyVideoProcessingOperation; source: ReferenceVideo; sourceNodeId: string; projectId: string; nodeId: string; signal?: AbortSignal }) {
    const { config, params, operation, source, sourceNodeId, projectId, nodeId, signal } = options;
    return {
        projectId,
        nodeId,
        mode: "video" as const,
        prompt: VIDEO_PROCESSING_LABELS[operation],
        config: { ...config, model: params.model, videoModel: params.model, vquality: "", size: "", videoSeconds: String(Math.max(1, Math.ceil((source.durationMs || 1000) / 1000))), taskWorkflowProvider: "model" as const },
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId, videoEditOperation: operation },
    };
}

export function videoProcessingQuoteRequest(config: AiConfig, params: VideoProcessingParams, operation: InputOnlyVideoProcessingOperation, sourceDurationMs?: number): ModelQuoteRequest | undefined {
    const channel = resolveModelChannel(config, params.model);
    if (channel.scope !== "system" || !params.model || !sourceDurationMs || sourceDurationMs <= 0) return undefined;
    return { channelId: channel.id, modelKey: modelOptionName(params.model), intent: { capability: "video", operation, inputs: { video: 1 }, options: { videoSeconds: Math.ceil(sourceDurationMs / 1000) } } };
}

export function videoProcessingSourceReference(node: CanvasNodeData): ReferenceVideo {
    const metadata = node.metadata || {};
    return {
        id: node.id,
        name: `${node.title || "video"}.mp4`,
        type: metadata.mimeType || "video/mp4",
        url: metadata.content || "",
        storageKey: metadata.storageKey,
        role: "reference",
        ...(metadata.bytes ? { bytes: metadata.bytes } : {}),
        ...(metadata.naturalWidth ? { width: metadata.naturalWidth } : {}),
        ...(metadata.naturalHeight ? { height: metadata.naturalHeight } : {}),
        ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
    };
}
