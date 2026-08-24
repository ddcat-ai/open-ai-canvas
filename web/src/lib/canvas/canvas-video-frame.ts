import { t } from "@/i18n";
const VIDEO_FRAME_TIMEOUT_MS = 20_000;
const LAST_FRAME_EPSILON_SECONDS = 0.001;

export async function captureVideoLastFrame(source: Blob | string) {
    const blob = await readVideoBlob(source);
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    try {
        const loaded = waitForVideoEvent(video, "loadeddata", t("canvas:video-read-timed-out-or-its-codec-is-unsupported-by-this-browser"));
        video.src = objectUrl;
        video.load();
        await loaded;

        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error(t("canvas:unable-to-determine-the-video-duration"));
        const targetTime = Math.max(0, video.duration - LAST_FRAME_EPSILON_SECONDS);
        if (targetTime > 0) {
            const seeked = waitForVideoEvent(video, "seeked", t("canvas:unable-to-locate-the-last-video-frame"));
            video.currentTime = targetTime;
            await seeked;
        }

        if (!video.videoWidth || !video.videoHeight) throw new Error(t("canvas:unable-to-read-the-video-frame-size"));
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error(t("canvas:the-browser-failed-to-create-the-image-canvas"));
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvasToPngBlob(canvas);
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
        const response = await fetch(source);
        if (!response.ok) throw new Error(String(response.status));
        return await response.blob();
    } catch {
        throw new Error(t("canvas:unable-to-read-the-video-file-re-upload-the-video-before-grabbing-the-la"));
    }
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
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("canvas:failed-to-encode-the-last-frame-image")))), "image/png"));
}
