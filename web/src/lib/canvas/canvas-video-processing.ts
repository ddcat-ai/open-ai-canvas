import { decodeChannelModel, modelOptionName, modelOptionsFromChannels, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";
import type { ModelQuoteRequest } from "@/services/api/logical-models";
import { resolveModelChannel } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { mediaToolForOperation, videoProcessingTools, validateProcessingParameters, type MediaToolOperation, type ProcessingParameters, type MediaToolParameter } from "./media-tool-contract";
import { selectionForConfig, validateGenerationSpec } from "./generation-contract";
import { GENERATION_CONTRACT_VERSION } from "./generation-contract.generated";

export type VideoProcessingOperation = MediaToolOperation;
export type InputOnlyVideoProcessingOperation = Exclude<VideoProcessingOperation, "enhance">;
export type VideoProcessingParams = ProcessingParameters & { model: string; resolution?: string };

export const VIDEO_PROCESSING_LABELS = Object.fromEntries(videoProcessingTools.map((tool) => [tool.operation, tool.label])) as Record<VideoProcessingOperation, string>;

/** 通用表单读取注册参数，再按模型合同收窄分辨率和可选帧率。 */
export function videoProcessingFields(config: AiConfig, model: string, operation: VideoProcessingOperation): Record<string, MediaToolParameter> {
    const tool = mediaToolForOperation(operation);
    if (!tool) return {};
    const video = modelCapabilityConfigFor(config, model).video;
    const fields = Object.fromEntries(Object.entries(tool.parameters).map(([key, value]) => [key, { ...value }]));
    if (fields.resolution) {
        if (video?.resolutions?.length) fields.resolution = { ...fields.resolution, enum: video.resolutions, default: video.defaultResolution || video.resolutions[0] };
        else delete fields.resolution;
    }
    if (fields.fps) {
        if (video?.processing?.fpsPolicy === "user_select") fields.fps = { ...fields.fps, enum: video.processing.fpsOptions || [], default: video.processing.fpsOptions?.[0] };
        else delete fields.fps;
    }
    return fields;
}

/** 处理工具各自只选择对应 operation 的系统模型，避免与普通生成或其他处理工具混用。 */
export function listVideoProcessingModels(config: AiConfig, operation: VideoProcessingOperation): string[] {
    if (!mediaToolForOperation(operation)) return [];
    return modelOptionsFromChannels(config.channels).filter((model) => {
        const decoded = decodeChannelModel(model);
        const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : undefined;
        if (!channel || channel.scope !== "system" || channel.enabled === false) return false;
        const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(model));
        const video = cost?.capabilityConfig?.video;
        return cost?.available !== false && cost?.capability === "video" && Boolean(video?.processing) && video?.defaultOperation === operation;
    });
}

export function videoProcessingSourceError(node: CanvasNodeData, maxSourceSeconds: number, operation: VideoProcessingOperation, maxSourceBytes?: number) {
    if (!node.metadata?.storageKey && !node.metadata?.content) return `视频节点为空，无法${VIDEO_PROCESSING_LABELS[operation]}`;
    if ((node.metadata?.durationMs || 0) > maxSourceSeconds * 1000) return `源视频时长超过 ${maxSourceSeconds} 秒上限，请先截取片段`;
    if (maxSourceBytes && (node.metadata?.bytes || 0) > maxSourceBytes) return `源视频大小超过 ${(maxSourceBytes / 1024 / 1024).toFixed(0)} MiB 上限`;
    return "";
}

/** 单视频工具共享业务任务输入；供应商和工作流 ID 由后台模型配置决定。 */
export function videoProcessingTaskInput(options: { config: AiConfig; params: VideoProcessingParams; operation: VideoProcessingOperation; source: ReferenceVideo; sourceNodeId: string; projectId: string; nodeId: string; signal?: AbortSignal }) {
    const { config, params, operation, source, sourceNodeId, projectId, nodeId, signal } = options;
    const { model, resolution, ...rawParameters } = params;
    const processingParameters = validateProcessingParameters(operation, rawParameters);
    const generationSpec = validateGenerationSpec({
        version: GENERATION_CONTRACT_VERSION,
        mode: "video",
        operation,
        processingParameters,
        prompt: VIDEO_PROCESSING_LABELS[operation],
        modelSelection: selectionForConfig({ ...config, model }),
        options: { ...(resolution ? { resolution } : {}), ...(source.durationMs ? { durationSeconds: Math.ceil(source.durationMs / 1000) } : {}) },
        referenceBindings: [{ id: `node:${sourceNodeId}`, nodeId: sourceNodeId, mediaType: "video", role: "reference", order: 0, resolution: "latest" }],
        textInputMode: "prompt-only",
    });
    return {
        projectId,
        nodeId,
        mode: "video" as const,
        prompt: VIDEO_PROCESSING_LABELS[operation],
        config: { ...config, model, videoModel: model, vquality: resolution || "", size: "", videoSeconds: String(Math.max(1, Math.ceil((source.durationMs || 1000) / 1000))), taskWorkflowProvider: "model" as const },
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId, videoEditOperation: operation, processingParameters, generationSpec },
    };
}

export function videoProcessingQuoteRequest(config: AiConfig, params: VideoProcessingParams, operation: VideoProcessingOperation, sourceDurationMs?: number): ModelQuoteRequest | undefined {
    const { model, resolution, ...processingParameters } = params;
    const channel = resolveModelChannel(config, model);
    if (channel.scope !== "system" || !model || !sourceDurationMs || sourceDurationMs <= 0) return undefined;
    return {
        channelId: channel.id,
        modelKey: modelOptionName(model),
        intent: {
            capability: "video",
            operation,
            inputs: { video: 1 },
            processingParameters: validateProcessingParameters(operation, processingParameters),
            options: { videoSeconds: Math.ceil(sourceDurationMs / 1000), ...(resolution ? { vquality: resolution } : {}), ...(params.fps ? { fpsBand: params.fps <= 30 ? "le30" : params.fps <= 60 ? "le60" : "le120" } : {}) },
        },
    };
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
