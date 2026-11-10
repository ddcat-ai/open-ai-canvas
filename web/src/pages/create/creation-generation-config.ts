import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { preserveVideoSettings as normalizeVideoValue } from "@/lib/media-settings";
import { resolveModelVideoBooleanOptions } from "@/lib/model-selection";
import type { AiConfig } from "@/stores/use-config-store";
import type { CreationSettings } from "./creation-types";

// 报价与提交共用目标模型适配结果，兼容的已有音轨设置继续保留。
export function creationVideoConfig(config: AiConfig, model: string, settings: Pick<CreationSettings, "ratio" | "seconds" | "videoQuality">): AiConfig {
    const profile = modelCapabilityConfigFor(config, model).video!;
    const normalized = normalizeVideoValue(profile, {
        ratio: settings.ratio,
        seconds: settings.seconds,
        resolution: settings.videoQuality,
    });
    return {
        ...config,
        model,
        videoModel: model,
        size: normalized.ratio,
        videoSeconds: normalized.seconds,
        vquality: normalized.resolution.replace(/p$/i, ""),
        ...resolveModelVideoBooleanOptions(config, model, {
            videoGenerateAudio: config.videoGenerateAudio,
            videoWatermark: config.videoWatermark,
        }),
    };
}
