// 素材卡片和素材档案共用的媒体规格标签：清晰度档位、画幅比例、音频采样率与码率。
// 尺寸未知（0 或旧版本写入的 1×1 占位）时一律返回空字符串，由调用方决定是否展示。

const STANDARD_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21", "4:5", "5:4", "2:1", "1:2"] as const;
// 上游输出常有取整误差（如 1344×768 ≈ 7:4、832×480 ≈ 16:9.2），3% 内归到标准画幅。
const RATIO_TOLERANCE = 0.03;
// 视频清晰度按短边归档，取各家模型参数里出现的标准档位。
const VIDEO_SHORT_EDGE_TIERS = [240, 360, 480, 540, 720, 768, 1080] as const;

function knownSize(width: number | undefined, height: number | undefined): width is number {
    return Boolean(width && height && width > 1 && height > 1 && Number.isFinite(width) && Number.isFinite(height));
}

/** 画幅比例：优先归到标准比例，其次用最简整数比，比例过于零碎时用「x.xx:1」。 */
export function mediaAspectRatioLabel(width?: number, height?: number) {
    if (!knownSize(width, height) || !height) return "";
    const value = width / height;
    let closest = "";
    let bestDifference = Number.POSITIVE_INFINITY;
    for (const label of STANDARD_RATIOS) {
        const [w, h] = label.split(":").map(Number);
        const difference = Math.abs(value - w / h) / (w / h);
        if (difference < bestDifference) {
            closest = label;
            bestDifference = difference;
        }
    }
    if (bestDifference <= RATIO_TOLERANCE) return closest;
    let a = Math.round(width);
    let b = Math.round(height);
    while (b) [a, b] = [b, a % b];
    const reducedWidth = Math.round(width) / a;
    const reducedHeight = Math.round(height) / a;
    if (reducedWidth <= 32 && reducedHeight <= 32) return `${reducedWidth}:${reducedHeight}`;
    return value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`;
}

/**
 * 图片清晰度按总像素归档，与生图模型的 1K / 2K / 4K 档位一致：
 * 1024²、1344×768、1920×1080 都是 1K；2048²、2560×1440 是 2K；3840×2160、4096² 是 4K。
 */
export function imageResolutionTierLabel(width?: number, height?: number) {
    if (!knownSize(width, height) || !height) return "";
    const pixels = width * height;
    if (pixels >= 5_000_000) return "4K";
    if (pixels > 2_200_000) return "2K";
    if (pixels >= 700_000) return "1K";
    return Math.min(width, height) >= 600 ? "720P" : "标清";
}

/** 视频清晰度按短边归档：竖屏 768×1366 与横屏 1366×768 都是 768P；短边 1440 起为 2K，2160 起为 4K。 */
export function videoResolutionTierLabel(width?: number, height?: number) {
    if (!knownSize(width, height) || !height) return "";
    const shortEdge = Math.min(width, height);
    if (shortEdge >= 2000) return "4K";
    if (shortEdge >= 1300) return "2K";
    let closest: number = VIDEO_SHORT_EDGE_TIERS[0];
    for (const tier of VIDEO_SHORT_EDGE_TIERS) {
        if (Math.abs(shortEdge - tier) < Math.abs(shortEdge - closest)) closest = tier;
    }
    return `${closest}P`;
}

/** 44100 → 44.1 kHz；48000 → 48 kHz；22050 → 22.05 kHz。 */
export function formatAudioSampleRate(sampleRate?: number) {
    if (!sampleRate || !Number.isFinite(sampleRate) || sampleRate <= 0) return "";
    const khz = sampleRate / 1000;
    return `${Number.isInteger(khz) ? khz : Number(khz.toFixed(2))} kHz`;
}

/** 按文件大小和时长估算的平均码率（kbps）；无损格式的码率意义不大，由调用方决定是否展示。 */
export function audioAverageBitrateKbps(bytes?: number, durationMs?: number) {
    if (!bytes || !durationMs || bytes <= 0 || durationMs < 1000) return 0;
    // bits / ms 正好等于 kbit / s。
    return Math.round((bytes * 8) / durationMs);
}

// Apple 播客音频规范：WAV / FLAC / MP3 的最低采样率都是 44.1 kHz。
export const RECOMMENDED_MIN_AUDIO_SAMPLE_RATE = 44_100;

const MIME_FORMAT_LABELS: Record<string, string> = {
    "image/jpeg": "JPG",
    "image/svg+xml": "SVG",
    "audio/mpeg": "MP3",
    "audio/mp3": "MP3",
    "audio/x-wav": "WAV",
    "audio/wave": "WAV",
    "audio/vnd.wave": "WAV",
    "audio/x-flac": "FLAC",
    "audio/mp4": "M4A",
    "audio/x-m4a": "M4A",
    "audio/aac": "AAC",
    "video/quicktime": "MOV",
    "video/x-matroska": "MKV",
};

/** image/png → PNG；未知类型保持原样，不猜测。 */
export function mediaFormatLabel(mimeType?: string) {
    const normalized = String(mimeType || "")
        .trim()
        .toLowerCase()
        .split(";")[0];
    if (!normalized) return "";
    if (MIME_FORMAT_LABELS[normalized]) return MIME_FORMAT_LABELS[normalized];
    const subtype = normalized.split("/")[1] || "";
    return /^[a-z0-9]{2,5}$/.test(subtype) ? subtype.toUpperCase() : normalized;
}

export function isLosslessAudioMimeType(mimeType?: string) {
    return ["WAV", "FLAC", "AIFF"].includes(mediaFormatLabel(mimeType));
}
