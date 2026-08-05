export const VIDEO_DURATION_OPTIONS = [6, 9, 10, 15] as const;
export const VIDEO_RESOLUTION_OPTIONS = [360, 480, 720, 1080, 2160] as const;
export const VIDEO_DURATION_MIN = 1;

export function normalizeVideoDuration(value: string | number | undefined) {
    const seconds = Math.floor(Number(value) || VIDEO_DURATION_OPTIONS[0]);
    return String(Math.max(VIDEO_DURATION_MIN, seconds));
}

export function normalizeVideoResolution(value: string | number | undefined) {
    const token = String(value || "").trim().toLowerCase();
    if (token === "low") return "360";
    if (token === "auto" || token === "medium" || token === "high") return "720";
    if (token === "4k") return "2160";
    const resolution = Number(token.replace(/p$/i, "")) || 720;
    return String(nearestOption(resolution, VIDEO_RESOLUTION_OPTIONS));
}

/** 常见 16:9 / 9:16 档位，避免 even 取整漂出标准像素。 */
const LANDSCAPE_16_9: Record<number, string> = {
    360: "640x360",
    480: "854x480",
    720: "1280x720",
    1080: "1920x1080",
    2160: "3840x2160",
};
const PORTRAIT_9_16: Record<number, string> = {
    360: "360x640",
    480: "480x854",
    720: "720x1280",
    1080: "1080x1920",
    2160: "2160x3840",
};

/** 按当前画幅比例，把分辨率（短边像素）换算成 WxH；横屏用高=res，竖屏用宽=res。 */
export function videoSizeForResolution(resolution: string | number, currentSize: string) {
    const res = Math.max(1, Number(normalizeVideoResolution(resolution)) || 720);
    const normalized = String(currentSize || "").trim().toLowerCase();
    if (normalized === "auto") return "auto";
    const match = normalized.match(/^(\d+)x(\d+)$/);
    const width = Number(match?.[1]) || 0;
    const height = Number(match?.[2]) || 0;
    const landscape = !width || !height ? true : width >= height;
    const ratio = width && height ? width / height : 16 / 9;
    if (landscape && Math.abs(ratio - 16 / 9) < 0.05 && LANDSCAPE_16_9[res]) return LANDSCAPE_16_9[res];
    if (!landscape && Math.abs(ratio - 9 / 16) < 0.05 && PORTRAIT_9_16[res]) return PORTRAIT_9_16[res];
    if (landscape) {
        const h = evenPixel(res);
        const w = evenPixel(Math.round(h * ratio));
        return `${w}x${h}`;
    }
    const w = evenPixel(res);
    const h = evenPixel(Math.round(w / ratio));
    return `${w}x${h}`;
}

/** 从 WxH 反推分辨率（取短边，贴合 360/480/720… 档位）。 */
export function videoResolutionForSize(size: string) {
    const match = String(size || "").trim().toLowerCase().match(/^(\d+)x(\d+)$/);
    if (!match) return normalizeVideoResolution("720");
    const shortSide = Math.min(Number(match[1]) || 720, Number(match[2]) || 720);
    return normalizeVideoResolution(String(shortSide));
}

function evenPixel(value: number) {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded + 1;
}

function nearestOption(value: number, options: readonly number[]) {
    return options.reduce((nearest, option) => Math.abs(option - value) < Math.abs(nearest - value) ? option : nearest, options[0]);
}
