import { t } from "@/i18n";
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
        return t("canvas:the-selected-video-model-does-not-support-reference-videos-trim-and-rege");
    }
    if (!videoProfile.operations.length) return t("canvas:the-current-video-model-has-no-available-generation-modes");
    return "";
}

export function videoReferenceOperationError(config: AiConfig, operation: CanvasVideoEditOperation): string {
    const videoProfile = modelCapabilityConfigFor(config, config.model).video;
    if (!videoProfile?.operations.includes(operation)) return t("canvas:the-current-video-model-does-not-support-the-selected-mode");
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
        return t("canvas:segments-cannot-exceed-the-model-s-reference-video-limit-params", { maxSeconds: maxSeconds });
    }
    if (isSeedanceVideoConfig(config) && durationMs < 2000) {
        return t("canvas:seedance-reference-segments-need-at-least-2-seconds-extend-the-trim-rang");
    }
    return "";
}
