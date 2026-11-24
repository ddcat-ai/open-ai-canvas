import { IMAGE_RATIOS, IMAGE_RESOLUTIONS, imagePresetForRatio } from "./image-size-presets";
import type { ImageResolutionOption } from "./image-resolution-tiers";

export function protocolImageSizePresets(protocol?: string): ImageResolutionOption[] {
    if (protocol === "openai-image") {
        return IMAGE_RESOLUTIONS.flatMap((tier) => IMAGE_RATIOS.map((ratio) => imagePresetForRatio(tier, ratio)));
    }
    return [];
}
