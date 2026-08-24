import { t } from "@/i18n";
export type GeminiImageGenerationConfig = {
    responseModalities: ["TEXT", "IMAGE"];
    imageConfig?: { aspectRatio?: string; imageSize?: "1K" | "2K" | "4K" };
};

export type GeminiInlineImage = {
    mimeType: string;
    data: string;
};

const GEMINI_IMAGE_SIZES: Record<string, GeminiInlineImageGenerationSize> = {
    low: "1K",
    medium: "2K",
    high: "4K",
    "1k": "1K",
    "2k": "2K",
    "4k": "4K",
};

type GeminiInlineImageGenerationSize = "1K" | "2K" | "4K";

export function parseGeminiImageDataUrl(dataUrl: string): GeminiInlineImage {
    const match = dataUrl.trim().match(/^data:([^;,\s]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=_-]+)$/i);
    if (!match) throw new Error(t("lib:failed-to-read-the-reference-image-no-valid-image-data-url-was-produced"));
    const mimeType = match[1].toLowerCase();
    const data = match[2].replace(/-/g, "+").replace(/_/g, "/");
    if (!mimeType.startsWith("image/")) throw new Error(t("lib:invalid-reference-image-mime-type-param", { mimeType: mimeType }));
    if (!data) throw new Error(t("lib:failed-to-read-the-reference-image-image-data-is-empty"));
    return { mimeType, data };
}

export function buildGeminiImageGenerationConfig(size?: string, quality?: string): GeminiImageGenerationConfig {
    const imageConfig: NonNullable<GeminiImageGenerationConfig["imageConfig"]> = {};
    const normalizedSize = size?.trim();
    const normalizedQuality = quality?.trim().toLowerCase();
    if (normalizedSize && normalizedSize !== "auto" && /^\d+:\d+$/.test(normalizedSize)) imageConfig.aspectRatio = normalizedSize;
    const imageSize = GEMINI_IMAGE_SIZES[normalizedQuality || ""];
    if (imageSize) imageConfig.imageSize = imageSize;
    return { responseModalities: ["TEXT", "IMAGE"], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) };
}
