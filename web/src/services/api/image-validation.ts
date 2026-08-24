import { t } from "@/i18n";
import { imageSizeRequest, type ImageCapabilityConfig } from "@/lib/model-capabilities";
import type { ReferenceImage } from "@/types/image";

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};
const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};
const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;
const VOLCENGINE_ARK_IMAGE_MAX_PIXELS = 4624220;

export function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

/** grok2api / xAI Imagine：画布 quality 映射为 resolution（1k/2k）。 */
export function normalizeGrokImageResolution(quality: string | undefined) {
    const value = (quality || "").trim().toLowerCase();
    if (!value || value === "auto") return undefined;
    if (value === "1k" || value === "low" || value === "standard") return "1k";
    if (value === "2k" || value === "medium" || value === "hd" || value === "high" || value === "4k") return "2k";
    return undefined;
}

/** Map "quality + ratio" to an explicit pixel dimension like "3840x2160". */
export function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

export function parseImageRatio(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error(t("domain:unsupported-image-size-format-use-auto-9-16-or-1024x1024-2"));
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error(t("domain:image-aspect-ratio-must-be-positive-e-g-9-16"));
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error(t("domain:image-aspect-ratio-cannot-exceed-3-1-adjust-the-size-2"));
    return { width: w, height: h };
}

export function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error(t("domain:image-dimensions-must-be-positive-integers-e-g-1024x1024"));
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error(t("domain:image-width-and-height-must-be-multiples-of-16-adjust-the-size"));
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error(t("domain:the-longest-side-of-the-image-cannot-exceed-3840px-adjust-the-size"));
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error(t("domain:image-aspect-ratio-cannot-exceed-3-1-adjust-the-size-2"));
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error(t("domain:total-image-pixels-must-be-between-655-360-and-8-294-400-adjust-the-size"));
}

export function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error(t("domain:unsupported-image-size-format-use-auto-9-16-or-1024x1024-2"));
}

export function resolveAspectRatio(value: string) {
    const normalized = value.trim().toLowerCase().replace("×", "x");
    if (normalized.includes(":")) return normalized;
    const dimensions = parseImageDimensions(normalized);
    if (!dimensions) throw new Error(t("domain:unsupported-aspect-ratio-format-use-3-4-or-1024x1360"));
    const divisor = dimensionGCD(dimensions.width, dimensions.height);
    return `${dimensions.width / divisor}:${dimensions.height / divisor}`;
}

function dimensionGCD(left: number, right: number) {
    while (right) [left, right] = [right, left % right];
    return Math.max(1, left);
}

export function resolveImageRequestSize(profile: ImageCapabilityConfig, quality: string | undefined, size: string) {
    const request = imageSizeRequest(profile, size);
    if (!request) return undefined;
    const value = request.parameter === "size" ? resolveRequestSize(quality, request.value) : resolveAspectRatio(request.value);
    return value ? { parameter: request.parameter, value } : undefined;
}

export function validateImageCapability(profile: ImageCapabilityConfig, references: ReferenceImage[], mask?: ReferenceImage) {
    if (references.length > profile.references.maxImages) throw new Error(t("domain:the-current-image-model-supports-at-most-param-reference-images", { maxImages: profile.references.maxImages }));
    if (mask && !profile.references.maskSupported) throw new Error(t("domain:the-current-image-model-does-not-support-mask-editing"));
    if (profile.references.maxImageBytes > 0 && references.some((image) => (image.bytes || 0) > profile.references.maxImageBytes)) throw new Error(t("domain:the-reference-image-exceeds-the-current-model-s-size-limit-2"));
}

export function normalizeVolcengineArkImageSize(size: string | undefined) {
    if (!size) return undefined;
    const dimensions = parseImageDimensions(size);
    if (!dimensions || dimensions.width * dimensions.height <= VOLCENGINE_ARK_IMAGE_MAX_PIXELS) return size;
    const scale = Math.sqrt(VOLCENGINE_ARK_IMAGE_MAX_PIXELS / (dimensions.width * dimensions.height));
    let width = Math.floor((dimensions.width * scale) / 2) * 2;
    let height = Math.floor((dimensions.height * scale) / 2) * 2;
    while (width > 2 && height > 2 && width * height > VOLCENGINE_ARK_IMAGE_MAX_PIXELS) {
        if (width >= height) width -= 2;
        else height -= 2;
    }
    return `${width}x${height}`;
}
