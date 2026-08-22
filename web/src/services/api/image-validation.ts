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
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    if (Math.max(w, h) / Math.min(w, h) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return { width: w, height: h };
}

export function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

export function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
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
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

export function resolveAspectRatio(value: string) {
    const normalized = value.trim().toLowerCase().replace("×", "x");
    if (normalized.includes(":")) return normalized;
    const dimensions = parseImageDimensions(normalized);
    if (!dimensions) throw new Error("图像比例格式不支持，请使用 3:4 或 1024x1360");
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
    if (references.length > profile.references.maxImages) throw new Error(`当前图片模型最多支持 ${profile.references.maxImages} 张参考图`);
    if (mask && !profile.references.maskSupported) throw new Error("当前图片模型不支持蒙版编辑");
    if (profile.references.maxImageBytes > 0 && references.some((image) => (image.bytes || 0) > profile.references.maxImageBytes)) throw new Error("参考图片文件超过当前模型大小限制");
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
