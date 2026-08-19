const TAPNOW_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TAPNOW_SHARE_HOST = "app.tapnow.media";

export function parseTapNowShareID(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return "";
    let candidate = trimmed;
    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
        if (hostname !== TAPNOW_SHARE_HOST || !/^\/tapflow\/view\/?[^/]*\/?$/.test(parsed.pathname)) return "";
        const parts = parsed.pathname.split("/").filter(Boolean);
        candidate = parts.at(-1) || "";
    } catch {
        candidate = trimmed;
    }
    return TAPNOW_SHARE_ID_PATTERN.test(candidate) ? candidate : "";
}

export function formatTapNowBatchTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未知";
    const pad = (part: number) => String(part).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}
