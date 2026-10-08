import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { normalizeVideoDuration, VIDEO_DURATION_OPTIONS } from "@/lib/video-generation-options";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

// Existing channel contract values; these are not a claim about every provider's current limits.
export const SEEDANCE_REFERENCE_LIMITS = { images: 9, videos: 3, audios: 3, imageMaxBytes: 30 * 1048576, videoMaxBytes: 50 * 1048576, audioMaxBytes: 15 * 1048576 };
export const seedanceResolutionOptions = [
    { label: "480P", value: "480p" },
    { label: "720P", value: "720p" },
    { label: "1080P", value: "1080p" },
] as const;
export const seedanceRatioOptions = [
    { label: "横屏", value: "16:9" },
    { label: "竖屏", value: "9:16" },
    { label: "方形", value: "1:1" },
    { label: "标准横屏", value: "4:3" },
    { label: "标准竖屏", value: "3:4" },
    { label: "宽银幕", value: "21:9" },
    { label: "自适应", value: "adaptive" },
] as const;
export const seedanceDurationOptions = VIDEO_DURATION_OPTIONS;

const rasterRows: Record<string, readonly string[]> = {
    "16:9": ["864x496", "1280x720", "1920x1080"],
    "4:3": ["752x560", "1112x834", "1664x1248"],
    "1:1": ["640x640", "960x960", "1440x1440"],
    "3:4": ["560x752", "834x1112", "1248x1664"],
    "9:16": ["496x864", "720x1280", "1080x1920"],
    "21:9": ["992x432", "1470x630", "2206x946"],
};
const ratios = Object.keys(rasterRows).map((label) => {
    const [w, h] = label.split(":").map(Number);
    return { label, ratio: w / h };
});

export function isSeedanceVideoModel(model: string): boolean {
    return /seedance/i.test(model);
}
export function isSeedanceFastModel(model: string): boolean {
    return isSeedanceVideoModel(model) && /fast/i.test(model);
}
export function isArkPlanBaseUrl(baseUrl: string): boolean {
    return /\/api\/plan\/v3/i.test(baseUrl);
}

export function isSeedanceVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "baseUrl">): boolean {
    const request = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    if ("interfaceType" in request && ["volcengine-ark-image", "volcengine-ark-agent-plan-image"].includes(String(request.interfaceType))) return false;
    return isArkPlanBaseUrl(request.baseUrl || "") || isSeedanceVideoModel(modelOptionName(request.model || request.videoModel));
}

export function normalizeResolutionToken(value: string): string {
    const token = String(value || "").toLowerCase();
    const aliases: Record<string, string> = { low: "480p", auto: "720p", high: "720p", medium: "720p", "4k": "2160p", "": "720p" };
    return aliases[token] || `${token.replace(/p$/, "")}p`;
}
export function normalizeSeedanceResolution(value: string, model = ""): string {
    const requested = normalizeResolutionToken(value);
    const supported = isSeedanceFastModel(model) ? ["480p", "720p"] : ["480p", "720p", "1080p", "2160p"];
    return supported.includes(requested) ? requested : "720p";
}
export function normalizeSeedanceDuration(value: string): number {
    return +normalizeVideoDuration(value);
}

export function normalizeSeedanceRatio(value: string): string {
    if (Object.hasOwn(rasterRows, value)) return value;
    const size = /^(\d+)x(\d+)$/.exec(value);
    if (!size || +size[1] === 0 || +size[2] === 0) return "adaptive";
    const requested = +size[1] / +size[2];
    let nearest = ratios[0];
    let distance = Infinity;
    for (const entry of ratios) {
        const next = Math.abs(entry.ratio - requested);
        if (next < distance) {
            distance = next;
            nearest = entry;
        }
    }
    return nearest.label;
}

export function seedancePixelLabel(resolution: string, ratio: string): string {
    const aspect = normalizeSeedanceRatio(ratio);
    if (aspect === "adaptive") return "自动匹配";
    const column = ["480p", "720p", "1080p"].indexOf(normalizeSeedanceResolution(resolution));
    return column < 0 ? "" : rasterRows[aspect]?.[column] || "";
}
export function boolConfig(value: string | undefined, fallback: boolean): boolean {
    return value === "true" || (value !== "false" && fallback);
}
export function seedanceReferenceLabel(kind: "image" | "video" | "audio", index: number): string {
    return `${{ image: "图片", video: "视频", audio: "音频" }[kind]}${index + 1}`;
}
export function buildSeedancePromptText(prompt: string, _images: ReferenceImage[], _videos: ReferenceVideo[], _audios: ReferenceAudio[]): string {
    return prompt.trim();
}

type VideoRule = { valid: (video: ReferenceVideo) => boolean; message: string };
const videoRules: VideoRule[] = [
    { valid: (v) => !v.bytes || v.bytes <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes, message: "超过 50MB，请压缩后再上传" },
    { valid: (v) => !v.durationMs || (v.durationMs >= 2000 && v.durationMs <= 15000), message: "时长需要在 2-15 秒之间" },
    { valid: (v) => !v.width || !v.height || [v.width, v.height].every((edge) => edge >= 300 && edge <= 6000), message: "宽高需要在 300-6000px 之间" },
    { valid: (v) => !v.width || !v.height || (v.width / v.height >= 0.4 && v.width / v.height <= 2.5), message: "宽高比需要在 0.4-2.5 之间" },
    { valid: (v) => !v.width || !v.height || (v.width * v.height >= 409600 && v.width * v.height <= 2086876), message: "像素总量不符合 Seedance 要求，请转成 480p/720p/1080p 后再上传" },
];
export function seedanceVideoReferenceError(videos: ReferenceVideo[]): string {
    for (const [index, video] of videos.entries()) {
        const failed = videoRules.find((rule) => !rule.valid(video));
        if (failed) return `${seedanceReferenceLabel("video", index)} ${failed.message}`;
    }
    const duration = videos.reduce((total, video) => total + (video.durationMs || 0), 0);
    return duration > 15000 ? "Seedance 参考视频总时长不能超过 15 秒" : "";
}
export const seedanceVideoReferenceHint = "参考视频需为 mp4/mov，H.264/H.265，FPS 24-60；含真人人脸素材请使用火山授权 asset:// 素材。";
