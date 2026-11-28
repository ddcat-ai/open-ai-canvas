import { modelCapabilityConfigFor, referenceMediaLimitError } from "@/lib/model-capabilities";
import { isSeedanceVideoConfig } from "@/lib/seedance-video";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoEditOperation } from "@/types/canvas";
import { logicalModelIDForConfig, resolveModelChannel, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import { isCanvasNodeGenerating } from "./canvas-node-task-state";

export function canRemakeCanvasVideo(node?: CanvasNodeData): node is CanvasNodeData & { metadata: CanvasNodeMetadata } {
    return node?.type === CanvasNodeType.Video && Boolean(node.metadata?.content || node.metadata?.storageKey) && !node.metadata?.fileUpload && !isCanvasNodeGenerating(node);
}

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
    const references = modelCapabilityConfigFor(config, config.model).video?.references;
    const issue = references && !logicalModelIDForConfig(config) && referenceMediaLimitError("video", references, [durationMs]);
    if (issue) return `${issue}，请用「参考片段」选择较短的范围`;
    if (isSeedanceVideoConfig(config) && durationMs < 2000) {
        return "Seedance 参考视频单段至少 2 秒，请扩大截取范围";
    }
    return "";
}

export function videoRemakeInputIssue(metadata: CanvasNodeMetadata | undefined, imageCount: number, videoDurationsMs: readonly number[], config?: AiConfig): string {
    if (!metadata?.videoRemake || metadata.videoReferenceMode !== "all") return "";
    if (!videoDurationsMs.length) return "视频复刻缺少动作参考，请连接原视频";
    if (!imageCount) return "视频复刻缺少参考图片，请上传或连接已有图片";
    if (config && !config.model) return "请选择支持同时引用视频和图片的模型";
    if (config) {
        const references = modelCapabilityConfigFor(config, config.model).video?.references;
        if (references && !logicalModelIDForConfig(config)) {
            const issue = referenceMediaLimitError("video", references, videoDurationsMs);
            if (issue) return videoDurationsMs.length > references.maxVideos ? issue : `${issue}，请用「参考片段」缩短参考视频`;
        }
        if (isSeedanceVideoConfig(config) && videoDurationsMs.some((duration) => duration > 0 && duration < 2000)) return "Seedance 参考视频单段至少 2 秒，请扩大截取范围";
    }
    return "";
}
