import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { isSeedanceVideoConfig } from "@/lib/seedance-video";
import type { CanvasVideoEditOperation } from "@/types/canvas";
import { resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export function listVideoReferenceModels(config: AiConfig): string[] {
    return selectableModelsByCapability(config, "video").filter((model) => {
        const profile = modelCapabilityConfigFor(config, model).video;
        if (!profile || profile.references.maxVideos < 1 || !profile.operations.length) return false;
        const channel = resolveModelChannel(config, model);
        return Boolean(channel.baseUrl.trim() && channel.apiKey.trim());
    });
}

export function videoReferenceRegenerationError(config: AiConfig): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    if (!videoProfile || videoProfile.references.maxVideos < 1) {
        return "当前所选视频模型不支持参考视频，无法为片段创建待生成节点。请选择支持参考视频的模型，或在设置中配置 Seedance / Agent Plan / NewAPI 渠道。";
    }
    if (!videoProfile.operations.length) return "当前视频模型没有可用的视频生成模式";
    return "";
}

export function videoReferenceOperationError(config: AiConfig, operation: CanvasVideoEditOperation): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    if (!videoProfile?.operations.includes(operation)) return "当前视频模型不支持所选生成模式";
    return "";
}

export function validateVideoSegmentBatch(config: AiConfig, segments: Array<{ startMs: number; endMs: number }>, operation?: CanvasVideoEditOperation): string {
    const referenceError = videoReferenceRegenerationError(config);
    if (referenceError) return referenceError;
    if (operation) {
        const operationError = videoReferenceOperationError(config, operation);
        if (operationError) return operationError;
    }
    for (const segment of segments) {
        const segmentError = videoReferenceSegmentError(config, segment.endMs - segment.startMs);
        if (segmentError) return segmentError;
    }
    return "";
}

export function videoReferenceSegmentError(config: AiConfig, durationMs: number): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    const maxSeconds = videoProfile?.references.maxVideoDurationSeconds || 0;
    if (maxSeconds > 0 && durationMs > maxSeconds * 1000) {
        return `截取片段不能超过当前模型参考视频上限（${maxSeconds} 秒）`;
    }
    if (isSeedanceVideoConfig(config) && durationMs < 2000) {
        return "Seedance 参考视频单段至少 2 秒，请扩大截取范围";
    }
    return "";
}
