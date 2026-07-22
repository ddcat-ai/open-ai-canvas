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
        const loaded = waitForVideoEvent(video, "loadeddata", "视频读取超时或编码不受浏览器支持");
        video.src = objectUrl;
        video.load();
        await loaded;

        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法确定视频时长");
        const targetTime = Math.max(0, video.duration - LAST_FRAME_EPSILON_SECONDS);
        if (targetTime > 0) {
            const seeked = waitForVideoEvent(video, "seeked", "无法定位到视频最后一帧");
            video.currentTime = targetTime;
            await seeked;
        }

        if (!video.videoWidth || !video.videoHeight) throw new Error("无法读取视频画面尺寸");
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建图片画布");
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
        throw new Error("无法读取视频文件，请重新上传视频后再截取尾帧");
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
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("尾帧图片编码失败"))), "image/png"));
}
