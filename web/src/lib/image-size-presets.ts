import { buildImageResolutionOptions, type ImageResolutionOption, type ImageResolutionTier } from "./image-resolution-tiers";
import type { ImageCapabilityConfig } from "./model-capabilities";

export const IMAGE_RESOLUTIONS: ImageResolutionTier[] = ["1k", "2k", "4k"];
// 1.5K 只在模型明确配置此档位时出现，既有模型的档位保持原有顺序。
export function imageResolutionTiers(profile: ImageCapabilityConfig): ImageResolutionTier[] {
    if (profile.parameters) return profile.resolution.supported ? profile.resolution.values : [];
    const declares15k = Boolean(profile.size.presets?.some((preset) => preset.tier === "1.5k") || profile.quality.values.includes("1.5k"));
    if (!declares15k) return IMAGE_RESOLUTIONS;
    // Seedream 5.0 最高 2K：声明了 1.5K 且没有 4K 档位时只提供 1K / 1.5K / 2K。
    const declares4k = Boolean(profile.size.presets?.some((preset) => preset.tier === "4k") || profile.quality.values.includes("4k") || profile.resolution.values.includes("4k"));
    return declares4k ? ["1k", "1.5k", "2k", "4k"] : ["1k", "1.5k", "2k"];
}
export const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"];
// Administrator's initial selection; plugin constraints still bound these choices.
export const DEFAULT_IMAGE_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"];

export function imageSingleSizeTier(profile: ImageCapabilityConfig): string | undefined {
    if (profile.size.defaultTier) return profile.size.defaultTier;
    const resolution = profile.parameters?.find((p) => p.name === "imageResolution");
    if (resolution?.default !== undefined && resolution.default !== "auto") return String(resolution.default);
    const preset = profile.size.presets?.find((p) => p.size === profile.size.default);
    if (preset) return preset.tier;
    const tiers = [...new Set(profile.size.presets?.map((p) => p.tier))];
    return tiers.length === 1 ? tiers[0] : undefined;
}
const standardSizes: Record<string, string[]> = {
    "1:1": ["1024x1024", "2048x2048", "2880x2880"],
    "16:9": ["1824x1024", "2752x1536", "3840x2160"],
    "9:16": ["1024x1824", "1536x2752", "2160x3840"],
    "4:3": ["1360x1024", "2304x1728", "3264x2448"],
    "3:4": ["1024x1360", "1728x2304", "2448x3264"],
    "3:2": ["1536x1024", "2496x1664", "3504x2336"],
    "2:3": ["1024x1536", "1664x2496", "2336x3504"],
    "4:5": ["1024x1280", "1792x2240", "2560x3200"],
    "5:4": ["1280x1024", "2240x1792", "3200x2560"],
    "21:9": ["2048x878", "3136x1344", "3808x1632"],
};

export function imagePresetForRatio(tier: ImageResolutionTier, input: string): ImageResolutionOption {
    const match = input.trim().match(/^(\d{1,5})\s*[:：]\s*(\d{1,5})$/);
    if (!match) throw new Error("请输入宽高比，例如 16:9");
    let w = Number(match[1]),
        h = Number(match[2]);
    if (!w || !h || Math.max(w, h) / Math.min(w, h) > 3) throw new Error("宽高比必须为正数，且不超过 3:1");
    let a = w,
        b = h;
    while (b) [a, b] = [b, a % b];
    w /= a;
    h /= a;
    const ratio =
        Object.keys(standardSizes).find((value) => {
            const [width, height] = value.split(":").map(Number);
            return width * h === height * w;
        }) || `${w}:${h}`;
    const index = IMAGE_RESOLUTIONS.indexOf(tier);
    if (index < 0 && tier !== "1.5k") throw new Error("分辨率仅支持 1K、1.5K、2K、4K");
    const standard = tier === "1.5k" ? undefined : standardSizes[ratio]?.[index];
    const pixels = tier === "1.5k" ? 2_359_296 : [1_048_576, 4_194_304, 8_294_400][index];
    let width = Math.round(Math.sqrt((pixels * w) / h) / 16) * 16;
    let height = Math.round((width * h) / w / 16) * 16;
    while (width * height > pixels || Math.max(width, height) > 3840) {
        if (width >= height) {
            width -= 16;
            height = Math.round((width * h) / w / 16) * 16;
        } else {
            height -= 16;
            width = Math.round((height * w) / h / 16) * 16;
        }
    }
    if (standard) [width, height] = standard.split("x").map(Number);
    return { tier, ratio, width, height, size: `${width}x${height}` };
}

export function imageQualityForTier(profile: ImageCapabilityConfig, tier: ImageResolutionTier) {
    if (profile.parameters) return undefined;
    const aliases: Record<string, string[]> = { "1k": ["1k", "low"], "1.5k": ["1.5k"], "2k": ["2k", "medium"], "4k": ["4k", "high"] };
    return profile.quality.supported ? profile.quality.values.find((value) => aliases[tier]?.includes(value.toLowerCase())) : undefined;
}

export function imageResolutionUsesQuality(profile: ImageCapabilityConfig) {
    if (profile.parameters) return false;
    return (
        !profile.resolution.supported &&
        profile.size.parameter === "aspect_ratio" &&
        profile.quality.supported &&
        Boolean(profile.resolutionUsesQuality || profile.quality.values.some((value) => IMAGE_RESOLUTIONS.includes(value.toLowerCase() as ImageResolutionTier) || value.toLowerCase() === "1.5k"))
    );
}

export function imageTierAvailable(profile: ImageCapabilityConfig, tier: ImageResolutionTier) {
    if (profile.parameters) return profile.resolution.supported ? profile.resolution.values.includes(tier) : (profile.size.parameter === "size" && profile.size.allowCustom) || Boolean(profile.size.presets?.some((preset) => preset.tier === tier));
    // 质量参数能映射档位时按上游质量裁剪；管理员尺寸预设存在时再取交集，避免默认 low/medium/high 把未启用的 1K 显示出来。
    if (profile.size.parameter !== "aspect_ratio") return profile.size.parameter !== "none";
    const configuredTiers = new Set(profile.size.presets?.map((preset) => preset.tier));
    if (imageResolutionUsesQuality(profile)) {
        if (!imageQualityForTier(profile, tier)) return false;
        return configuredTiers.size ? configuredTiers.has(tier) : true;
    }
    if (configuredTiers.size) return configuredTiers.has(tier);
    // 无质量映射且无预设时,后端 filterImageSizePresets 会返回全部预设或空;
    // 前端不应硬编码 1k 兜底,避免产生后端不认可的幻影选项。
    return false;
}

export function imageQualityForSelection(profile: ImageCapabilityConfig, tier: ImageResolutionTier) {
    if (profile.parameters) return undefined;
    if (imageResolutionUsesQuality(profile)) return imageQualityForTier(profile, tier);
    return !profile.resolution.supported && !profile.quality.supported && imageTierAvailable(profile, tier) ? tier : undefined;
}

export function imageSizePresets(profile: ImageCapabilityConfig): ImageResolutionOption[] {
    if (profile.size.parameter === "none") return [];
    if (profile.parameters && !profile.resolution.supported) {
        const tier = imageSingleSizeTier(profile);
        return (profile.size.presets || []).filter((preset) => preset.tier === (tier ?? ""));
    }
    if (profile.size.presets) return profile.size.presets;
    if (profile.parameters) return [];
    const pixels = buildImageResolutionOptions(profile.size.values);
    const tiers = profile.size.parameter === "aspect_ratio" ? imageResolutionTiers(profile).filter((tier) => imageQualityForTier(profile, tier)) : [];
    const ratios = tiers.flatMap((tier) =>
        profile.size.values.flatMap((ratio) => {
            try {
                const preset = imagePresetForRatio(tier, ratio);
                return pixels.some((pixel) => pixel.ratio === preset.ratio) ? [] : [preset];
            } catch {
                return [];
            }
        }),
    );
    return [...pixels, ...ratios];
}

export function imagePresetValue(profile: ImageCapabilityConfig, preset: ImageResolutionOption) {
    if (!profile.size.presets && !profile.size.allowCustom && preset.tier === "1k" && profile.size.values.includes(preset.ratio) && !profile.size.values.includes(preset.size)) return preset.ratio;
    return profile.size.parameter === "aspect_ratio" ? preset.ratio : preset.size;
}

export function imageSizeConfigWithPresets(profile: ImageCapabilityConfig, presets: ImageResolutionOption[]): ImageCapabilityConfig["size"] {
    const values = [...new Set(presets.map((preset) => (profile.size.parameter === "aspect_ratio" ? preset.ratio : preset.size || preset.ratio)))];
    if (profile.size.values.includes("auto")) values.unshift("auto");
    if (!values.length) values.push("auto");
    return { ...profile.size, presets, values, default: values.includes(profile.size.default) ? profile.size.default : values[0] || "auto" };
}
