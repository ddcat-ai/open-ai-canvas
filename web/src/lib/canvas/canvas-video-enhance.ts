import { DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS, modelCapabilityConfigFor, type VideoProcessingConfig } from "@/lib/model-capabilities";
import type { ModelQuoteRequest } from "@/services/api/logical-models";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceVideo } from "@/types/media";

/** 与后端 VideoProcessingOperationEnhance 一致。 */
export const VIDEO_ENHANCE_OPERATION = "enhance";

export type VideoEnhanceBitrateLevel = "low" | "medium" | "high";

export type VideoEnhanceParams = {
    model: string;
    resolution: string;
    /** 仅 fpsPolicy=user_select 时有值；保持原帧率时不发送。 */
    fps?: number;
    bitrateLevel?: VideoEnhanceBitrateLevel;
    bitrate?: number;
};

export function videoEnhanceProfile(config: AiConfig, model: string) {
    const video = modelCapabilityConfigFor(config, model).video;
    const processing: VideoProcessingConfig = video?.processing || { fpsPolicy: "keep_source" };
    return {
        resolutions: video?.resolutions?.length ? video.resolutions : ["720p", "1080p", "2k", "4k"],
        defaultResolution: video?.defaultResolution || "1080p",
        processing,
        maxSourceSeconds: processing.maxSourceSeconds || DEFAULT_VIDEO_PROCESSING_MAX_SOURCE_SECONDS,
    };
}

/** 目标分辨率档对应的短边像素，用于置灰低于源视频的档位。 */
export function videoEnhanceResolutionShortEdge(resolution: string) {
    const value = resolution.trim().toLowerCase();
    if (value === "2k") return 1440;
    if (value === "4k") return 2160;
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : 0;
}

/** MediaKit 视频画质增强工具输入规格：短边 [360,1080]、长边 [360,1920]、时长不超过后台上限。 */
export function videoEnhanceSourceError(node: CanvasNodeData, maxSourceSeconds: number) {
    const metadata = node.metadata;
    if (!metadata?.storageKey && !metadata?.content) return "视频节点为空，无法画质增强";
    const durationMs = metadata.durationMs || 0;
    if (durationMs > maxSourceSeconds * 1000) return `源视频时长超过 ${maxSourceSeconds} 秒上限，请先截取片段后再增强`;
    const width = metadata.naturalWidth || 0;
    const height = metadata.naturalHeight || 0;
    if (width > 0 && height > 0) {
        const short = Math.min(width, height);
        const long = Math.max(width, height);
        if (short < 360 || short > 1080 || long > 1920) return `源视频分辨率 ${width}×${height} 不受支持：短边需在 360–1080、长边不超过 1920`;
    }
    return "";
}

export function videoEnhanceFpsBand(fps?: number) {
    if (!fps || fps <= 30) return "le30";
    return fps <= 60 ? "le60" : "le120";
}

/** 生成任务配置：只覆盖模型与分辨率；时长和帧率档由后端按源资源重算。 */
export function videoEnhanceGenerationConfig(config: AiConfig, params: VideoEnhanceParams, sourceDurationMs?: number): AiConfig {
    const seconds = Math.max(1, Math.ceil((sourceDurationMs || 1000) / 1000));
    return { ...config, model: params.model, videoModel: params.model, vquality: params.resolution, videoSeconds: String(seconds), taskWorkflowProvider: "model" };
}

export function videoEnhanceProviderOptions(config: AiConfig, params: VideoEnhanceParams) {
    const protocol = resolveModelRequestConfig(config, params.model).interfaceType;
    const options: Record<string, unknown> = {};
    if (params.fps) options.fps = params.fps;
    if (params.bitrate) options.bitrate = params.bitrate;
    else if (params.bitrateLevel) options.bitrate_level = params.bitrateLevel;
    return protocol ? { [protocol]: options } : {};
}

/** 新节点与重试共用的任务输入；prompt 由后端按处理模型重建，这里仅作展示。 */
export function videoEnhanceTaskInput(options: { config: AiConfig; params: VideoEnhanceParams; source: ReferenceVideo; sourceNodeId: string; projectId: string; nodeId: string; signal?: AbortSignal }) {
    const { config, params, source, sourceNodeId, projectId, nodeId, signal } = options;
    return {
        projectId,
        nodeId,
        mode: "video" as const,
        prompt: `画质增强（${params.resolution}）`,
        config: videoEnhanceGenerationConfig(config, params, source.durationMs),
        referenceVideos: [source],
        signal,
        metadata: { sourceNodeId, videoEditOperation: VIDEO_ENHANCE_OPERATION, providerOptions: videoEnhanceProviderOptions(config, params) },
    };
}

/** 报价按源时长预扣口径；实际结算以输出时长为准。 */
export function videoEnhanceQuoteRequest(config: AiConfig, params: VideoEnhanceParams, sourceDurationMs?: number): ModelQuoteRequest | undefined {
    const channel = resolveModelChannel(config, params.model);
    if (channel.scope !== "system" || !params.model) return undefined;
    const seconds = Math.max(1, Math.ceil((sourceDurationMs || 1000) / 1000));
    return {
        channelId: channel.id,
        modelKey: modelOptionName(params.model),
        intent: {
            capability: "video",
            operation: VIDEO_ENHANCE_OPERATION,
            inputs: { video: 1 },
            options: { vquality: params.resolution, videoSeconds: seconds, fpsBand: videoEnhanceFpsBand(params.fps) },
        },
    };
}
