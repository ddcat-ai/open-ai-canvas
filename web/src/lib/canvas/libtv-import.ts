const LIBTV_PROJECT_UUID_PATTERN = /^[a-f0-9]{32}$/i;
const LIBTV_RESOURCE_HOST = "libtv-res.liblib.art";
const LIBTV_PREVIEW_WIDTH = 960;
const LIBTV_VIDEO_PREVIEW_WIDTH = 400;

export function parseLibTVProjectUUID(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    let candidate = trimmed;
    try {
        const parsed = new URL(trimmed);
        candidate = parsed.searchParams.get("projectId") || parsed.searchParams.get("uuid") || parsed.pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        candidate = trimmed;
    }
    return LIBTV_PROJECT_UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : "";
}

export function formatLibTVBatchTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function buildLibTVImagePreviewUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return rawUrl;
        if (!url.searchParams.has("x-oss-process")) {
            url.searchParams.set("x-oss-process", `image/resize,w_${LIBTV_PREVIEW_WIDTH}`);
        }
        return url.toString();
    } catch {
        return rawUrl;
    }
}

export function buildLibTVVideoPreviewUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return "";
        if (!url.searchParams.has("x-oss-process")) {
            url.searchParams.set("x-oss-process", `video/snapshot,t_0,f_jpg,w_${LIBTV_VIDEO_PREVIEW_WIDTH},m_fast,ar_auto`);
        }
        return url.toString();
    } catch {
        return "";
    }
}

/**
 * Restores the playable LibTV asset URL when a snapshot transform was
 * persisted as the node's content by an older importer.  The OSS transform
 * belongs only on previewContent; VideoPlayer must receive the original MP4.
 */
export function buildLibTVVideoSourceUrl(rawUrl: string) {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:" || url.hostname !== LIBTV_RESOURCE_HOST) return rawUrl;
        url.searchParams.delete("x-oss-process");
        return url.toString();
    } catch {
        return rawUrl;
    }
}
