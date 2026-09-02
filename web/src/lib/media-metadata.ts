// 媒体时长探测（纯前端工具，M3.4）。
// 上传视频/音频前用 <video>/<audio> 元数据读取真实时长（毫秒），
// 随上传 meta 传给后端存 Resource.DurationMs → 资产 summary 透出 → 时间线片段真实时长。
// 解码能力仅用于读取 duration，不需要能播放编码。

const PROBE_TIMEOUT_MS = 8000;

function isProbeable(file: File): boolean {
    return /^video\//.test(file.type) || /^audio\//.test(file.type);
}

export async function probeMediaDurationMs(file: File): Promise<number | undefined> {
    if (!isProbeable(file)) return undefined;
    const url = URL.createObjectURL(file);
    const el: HTMLVideoElement | HTMLAudioElement = /^video\//.test(file.type)
        ? document.createElement("video")
        : document.createElement("audio");
    el.preload = "metadata";
    el.muted = true; // video 自动加载元数据在某些浏览器需要非 autoplay；muted 仅避免噪音
    try {
        const timeout = new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("probe timeout")), PROBE_TIMEOUT_MS);
        });
        const meta = new Promise<number>((resolve) => {
            el.onloadedmetadata = () => {
                const d = el.duration;
                resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0);
            };
            el.onerror = () => resolve(0);
        });
        el.src = url;
        const durationMs = await Promise.race([meta, timeout]);
        return durationMs > 0 ? durationMs : undefined;
    } catch {
        return undefined;
    } finally {
        el.removeAttribute("src");
        el.load();
        URL.revokeObjectURL(url);
    }
}
