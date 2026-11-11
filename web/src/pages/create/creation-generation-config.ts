import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { preserveVideoSettings as normalizeVideoValue } from "@/lib/media-settings";
import { resolveModelVideoBooleanOptions } from "@/lib/model-selection";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { CreationSettings } from "./creation-types";

type VideoSettings = Pick<CreationSettings, "ratio" | "seconds" | "videoQuality">;

// 偏好/旧消息恢复与最终提交共用目标协议，auto 的省略语义不能在恢复时丢失。
export function creationVideoSettings(config: AiConfig, model: string, settings: Partial<VideoSettings> = {}): VideoSettings {
    const profile = modelCapabilityConfigFor(config, model).video!;
    const normalized = normalizeVideoValue(profile, { ratio: settings.ratio, seconds: settings.seconds, resolution: settings.videoQuality }, resolveModelRequestConfig(config, model).interfaceType);
    return { ratio: normalized.ratio, seconds: normalized.seconds, videoQuality: normalized.resolution.replace(/p$/i, "") };
}

// 报价与提交共用目标模型适配结果，兼容的已有音轨设置继续保留。
export function creationVideoConfig(config: AiConfig, model: string, settings: VideoSettings): AiConfig {
    const normalized = creationVideoSettings(config, model, settings);
    return {
        ...config,
        model,
        videoModel: model,
        size: normalized.ratio,
        videoSeconds: normalized.seconds,
        vquality: normalized.videoQuality,
        ...resolveModelVideoBooleanOptions(config, model, {
            videoGenerateAudio: config.videoGenerateAudio,
            videoWatermark: config.videoWatermark,
        }),
    };
}
