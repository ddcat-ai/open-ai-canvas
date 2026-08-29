const VIDEO_FRAME_TIMEOUT_MS = 20_000;
const LAST_FRAME_EPSILON_MS = 1;

export type CapturedVideoFrame = {
    timeMs: number;
    blob: Blob;
    width: number;
    height: number;
};

export type VideoFrameCaptureFailure = {
    timeMs: number;
    error: string;
};

export type VideoFrameCaptureResult = {
    frames: CapturedVideoFrame[];
    failures: VideoFrameCaptureFailure[];
};

export function normalizeVideoFrameTimes(timesMs: number[], durationMs: number) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
    const lastFrameMs = Math.max(0, Math.round(durationMs) - LAST_FRAME_EPSILON_MS);
    return Array.from(new Set(timesMs.filter(Number.isFinite).map((timeMs) => Math.min(lastFrameMs, Math.max(0, Math.round(timeMs)))))).sort((left, right) => left - right);
}

export async function captureVideoFrames(source: Blob | string, timesMs: number[]): Promise<VideoFrameCaptureResult> {
    const blob = await readVideoBlob(source);
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    try {
        const loaded = waitForVideoEvent(video, "loadeddata", "视频读取超时或编码不受浏览器支持");
        video.src = objectUrl;
        video.load();
        await loaded;

        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法确定视频时长");
        if (!video.videoWidth || !video.videoHeight) throw new Error("无法读取视频画面尺寸");
        const normalizedTimes = normalizeVideoFrameTimes(timesMs, video.duration * 1000);
        if (!normalizedTimes.length) throw new Error("请至少选择一个有效时间点");
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建图片画布");
        const frames: CapturedVideoFrame[] = [];
        const failures: VideoFrameCaptureFailure[] = [];
        for (const timeMs of normalizedTimes) {
            try {
                const targetSeconds = timeMs / 1000;
                if (Math.abs(video.currentTime - targetSeconds) > 0.0005) {
                    const seeked = waitForVideoEvent(video, "seeked", `无法定位到 ${formatVideoFrameTime(timeMs)}`);
                    video.currentTime = targetSeconds;
                    await seeked;
                }
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                frames.push({ timeMs, blob: await canvasToPngBlob(canvas), width: canvas.width, height: canvas.height });
            } catch (error) {
                failures.push({ timeMs, error: error instanceof Error ? error.message : "画面提取失败" });
            }
        }
        if (!frames.length) throw new Error(failures[0]?.error || "画面提取失败");
        return { frames, failures };
    } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
    }
}

async function readVideoBlob(source: Blob | string) {
    if (source instanceof Blob) return source;
    try {
        const response = await fetch(source, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        return await response.blob();
    } catch {
        throw new Error("无法读取视频文件，请重新上传视频后再提取画面");
    }
}

export function formatVideoFrameTime(timeMs: number) {
    const totalMs = Math.max(0, Math.round(timeMs));
    const minutes = Math.floor(totalMs / 60_000);
    const seconds = Math.floor((totalMs % 60_000) / 1000);
    const milliseconds = totalMs % 1000;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadeddata" | "seeked", errorMessage: string) {
    return new Promise<void>((resolve, reject) => {
        let timer = 0;
        const cleanup = () => {
            window.clearTimeout(timer);
            video.removeEventListener(eventName, onSuccess);
            video.removeEventListener("error", onError);
        };
        const onSuccess = () => {
            cleanup();
            resolve();
        };
        const onError = () => {
            cleanup();
            reject(new Error(errorMessage));
        };
        video.addEventListener(eventName, onSuccess, { once: true });
        video.addEventListener("error", onError, { once: true });
        timer = window.setTimeout(onError, VIDEO_FRAME_TIMEOUT_MS);
    });
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画面图片编码失败"))), "image/png"));
}
