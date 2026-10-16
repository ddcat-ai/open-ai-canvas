import { getResourceAccess, resourceIdFromStorageKey, resolveResourceAccessURL } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { TimelineDirectMedia } from "@/types/timeline";

const frames = new Map<string, string>();
const MAX_CACHED_FRAMES = 640;
let decoders = 0;
const waiting: (() => void)[] = [];

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("已取消", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
    });
}

async function takeDecoder(signal: AbortSignal) {
    signal.throwIfAborted();
    if (decoders < 2) {
        decoders += 1;
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const enter = () => {
            signal.removeEventListener("abort", cancel);
            resolve();
        };
        const cancel = () => {
            const index = waiting.indexOf(enter);
            if (index >= 0) waiting.splice(index, 1);
            reject(new DOMException("已取消", "AbortError"));
        };
        waiting.push(enter);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
    });
}

function waitForFrame(video: HTMLVideoElement, event: "loadeddata" | "seeked", signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
            clearTimeout(timer);
            video.removeEventListener(event, ready);
            video.removeEventListener("error", failed);
            signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
        };
        const ready = () => finish();
        const failed = () => finish(new Error("无法读取视频缩略图"));
        const aborted = () => finish(new DOMException("已取消", "AbortError"));
        const timer = setTimeout(failed, 12000);
        video.addEventListener(event, ready, { once: true });
        video.addEventListener("error", failed, { once: true });
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
    });
}

/** 缩略图使用独立解码器，不 seek 正在播放的预览；全局最多两个解码器，缓存仅在当前进程内按用户隔离。 */
export async function readTimelineFrames(media: TimelineDirectMedia, times: number[], signal: AbortSignal, onFrame: (timeMs: number, url: string) => void): Promise<void> {
    const scope = getActiveUserScope();
    signal.throwIfAborted();
    const source = media.storageKey || media.url || media.dataUrl;
    if (!source) throw new Error("素材没有可读取的画面");
    const keyFor = (time: number) => `${scope}:${source}:${time}`;
    const missing: number[] = [];
    for (const time of times) {
        const key = keyFor(time);
        const cached = frames.get(key);
        if (cached) {
            frames.delete(key);
            frames.set(key, cached);
            onFrame(time, cached);
        } else missing.push(time);
    }
    if (!missing.length) return;
    signal.throwIfAborted();
    await takeDecoder(signal);
    let video: HTMLVideoElement | undefined;
    try {
        signal.throwIfAborted();
        const resourceId = resourceIdFromStorageKey(media.storageKey);
        const access = resourceId ? await abortable(getResourceAccess(media.storageKey, "browser-process", "playback"), signal) : null;
        const url = access ? resolveResourceAccessURL(access.url) : media.storageKey ? await abortable(resolveMediaUrl(media.storageKey, media.url || media.dataUrl || ""), signal) : media.url || media.dataUrl;
        signal.throwIfAborted();
        if (!url) throw new Error("素材画面不可用");
        video = document.createElement("video");
        video.crossOrigin = access?.delivery === "platform-local" || access?.delivery === "platform-proxy" ? "use-credentials" : "anonymous";
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        const loaded = waitForFrame(video, "loadeddata", signal);
        video.src = url;
        video.load();
        await loaded;
        if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) throw new Error("无法读取视频画面尺寸");
        const canvas = document.createElement("canvas");
        const ratio = Math.min(128 / video.videoWidth, 96 / video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
        canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法生成缩略图");
        for (const time of missing) {
            signal.throwIfAborted();
            if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
            const target = Math.max(0, Math.min(time / 1000, video.duration - 0.001));
            if (Math.abs(video.currentTime - target) > 0.0005) {
                const seeked = waitForFrame(video, "seeked", signal);
                video.currentTime = target;
                await seeked;
            }
            signal.throwIfAborted();
            if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = canvas.toDataURL("image/jpeg", 0.65);
            frames.set(keyFor(time), frame);
            while (frames.size > MAX_CACHED_FRAMES) frames.delete(frames.keys().next().value!);
            onFrame(time, frame);
        }
    } finally {
        if (video) {
            video.pause();
            video.removeAttribute("src");
            video.load();
        }
        const next = waiting.shift();
        if (next) next();
        else decoders -= 1;
    }
}
