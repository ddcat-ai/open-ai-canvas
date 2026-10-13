import { buildImageResolutionOptions } from "./image-resolution-tiers";
import { isImageResolutionTier } from "./image-quality";
import type { ImageCapabilityConfig } from "./model-capabilities";

/** 旧图片价格档把 1K/2K/4K 存在 quality；只在读取价格条件时转换。 */
export function normalizeImagePriceSelector(input: Record<string, string>, declaredParameters = false) {
    if (declaredParameters) return { ...input };
    const selector = { ...input };
    for (const key of ["quality", "resolution", "size"] as const) {
        if (selector[key]) selector[key] = selector[key].trim().toLowerCase();
    }
    if (isImageResolutionTier(selector.quality) && (!selector.resolution || selector.resolution === "*")) {
        selector.resolution = selector.quality;
        delete selector.quality;
    }
    return selector;
}

export function imagePriceSelector(quality: string, size: string, profile?: ImageCapabilityConfig, imageResolution?: string): Record<string, string> {
    if (profile?.parameters) {
        const values: Record<string, string | undefined> = { quality, size, imageResolution };
        return Object.fromEntries(profile.parameters.filter((p) => p.enabled !== false && p.pricing && values[p.name]).map((p) => [p.name, values[p.name]!])) as Record<string, string>;
    }
    quality = quality.trim().toLowerCase();
    size = size.trim().toLowerCase();
    const selector: Record<string, string> = {};
    if (quality && quality !== "auto" && quality !== "any") selector.quality = quality;
    if (size && size !== "auto" && size !== "any") selector.size = size;
    const pixel = buildImageResolutionOptions([size])[0];
    if (pixel) {
        selector.resolution = profile?.size.presets?.find((preset) => preset.size.toLowerCase() === size)?.tier || pixel.tier;
    } else if (isImageResolutionTier(quality)) {
        selector.resolution = quality;
    } else if (profile?.size.parameter === "aspect_ratio") {
        const tier = ({ low: "1k", medium: "2k", high: "4k" } as Record<string, string>)[quality];
        if (tier && profile.quality.supported) selector.resolution = tier;
        else if (!profile.quality.supported) {
            const tiers = new Set(profile.size.presets?.filter((preset) => preset.ratio === size).map((preset) => preset.tier));
            if (tiers.size === 1) selector.resolution = [...tiers][0];
        }
    }
    return selector;
}
