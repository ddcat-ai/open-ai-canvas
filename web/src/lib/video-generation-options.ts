export const VIDEO_DURATION_OPTIONS = [6, 9, 10, 15] as const;
export const VIDEO_RESOLUTION_OPTIONS = [480, 720, 1080, 1440, 2160] as const;
export const VIDEO_RESOLUTION_CAPABILITY_OPTIONS = VIDEO_RESOLUTION_OPTIONS.map((value) => `${value}p`);
export const VIDEO_DURATION_MIN = 1;

export function normalizeVideoDuration(value: string | number | undefined) {
    const seconds = Math.floor(Number(value) || VIDEO_DURATION_OPTIONS[0]);
    return String(Math.max(VIDEO_DURATION_MIN, seconds));
}

export function normalizeVideoResolution(value: string | number | undefined) {
    const raw = String(value || "").trim();
    const token = raw.toLowerCase();
    if (token === "low") return "480";
    if (token === "auto" || token === "medium" || token === "high") return "720";
    if (token === "2k") return "1440";
    if (token === "4k") return "2160";
    const resolution = Number(token.replace(/p$/i, ""));
    if (Number.isFinite(resolution)) return resolution > 0 ? String(Math.floor(resolution)) : "720";
    // Channel-declared values are opaque enums, not necessarily numeric tiers.
    // Preserve them verbatim so values such as `768p竖` remain selectable and
    // can be sent back to the provider without being collapsed to 720p.
    return raw || "720";
}

export function videoResolutionComparisonKey(value: string | number | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const normalized = normalizeVideoResolution(raw);
    return /^\d+$/.test(normalized) ? `${normalized}p` : normalized.toLowerCase();
}

export function formatVideoResolutionLabel(value: string | number | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const normalized = normalizeVideoResolution(raw);
    if (normalized === "2160") return "4K";
    if (/^\d+$/.test(normalized)) return `${normalized}P`;
    return normalized.replace(/^(\d+)p/i, "$1P");
}

export function videoDimensionsForRatioAndResolution(ratio: string | undefined, resolution: string | number | undefined) {
    const ratioMatch = String(ratio || "")
        .trim()
        .toLowerCase()
        .replace("×", "x")
        .match(/^(\d+(?:\.\d+)?)(?::|x)(\d+(?:\.\d+)?)$/);
    if (!ratioMatch) return undefined;

    const ratioWidth = Number(ratioMatch[1]);
    const ratioHeight = Number(ratioMatch[2]);
    if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) return undefined;

    const normalizedResolution = normalizeVideoResolution(resolution);
    const resolutionMatch = normalizedResolution.match(/^(\d+)(?:p)?/i);
    const shortEdge = Number(resolutionMatch?.[1]);
    if (!Number.isFinite(shortEdge) || shortEdge <= 0) return undefined;

    const aspect = ratioWidth / ratioHeight;
    if (aspect >= 1) return { width: evenDimension(shortEdge * aspect), height: shortEdge };
    return { width: shortEdge, height: evenDimension(shortEdge / aspect) };
}

function evenDimension(value: number) {
    return Math.max(2, Math.round(value / 2) * 2);
}
