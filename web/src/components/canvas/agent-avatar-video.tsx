import { useEffect, useRef } from "react";

/**
 * 绿幕形象视频：每帧把视频画到画布上做抠像。抠像在主线程逐像素处理，开销不小，
 * 所以 paused（入口被面板挡住时）和页面隐藏时都不处理帧，也暂停视频解码。
 */
export function AgentAvatarVideo({ src, loop = true, paused = false, onError, className }: { src: string; loop?: boolean; paused?: boolean; onError?: () => void; className?: string }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const errorRef = useRef(onError);
    errorRef.current = onError;

    useEffect(() => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", { willReadFrequently: true });
        if (paused || !video || !canvas || !context) return;
        let animationFrame = 0;
        let videoFrame = 0;
        let disposed = false;
        let lastFrameTime = -1;
        const drawFrame = () => {
            if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0 || video.currentTime === lastFrameTime) return;
            lastFrameTime = video.currentTime;
            const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
            const width = Math.max(1, Math.round(video.videoWidth * scale));
            const height = Math.max(1, Math.round(video.videoHeight * scale));
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            context.drawImage(video, 0, 0, width, height);
            const image = context.getImageData(0, 0, width, height);
            const pixels = image.data;
            for (let index = 0; index < pixels.length; index += 4) {
                const red = pixels[index];
                const green = pixels[index + 1];
                const blue = pixels[index + 2];
                const greenLead = green - Math.max(red, blue);
                if (green > 70 && greenLead > 12 && green > red * 1.12 && green > blue * 1.08) {
                    const opacity = Math.max(0, Math.min(1, (38 - greenLead) / 26));
                    pixels[index + 1] = Math.max(red, blue, green - Math.round((1 - opacity) * greenLead * 0.75));
                    pixels[index + 3] = Math.round(pixels[index + 3] * opacity);
                }
            }
            context.putImageData(image, 0, 0);
        };
        const scheduleFrame = () => {
            if (disposed || document.visibilityState === "hidden") return;
            if (typeof video.requestVideoFrameCallback === "function") {
                videoFrame = video.requestVideoFrameCallback(() => {
                    drawFrame();
                    scheduleFrame();
                });
            } else {
                animationFrame = requestAnimationFrame(() => {
                    drawFrame();
                    scheduleFrame();
                });
            }
        };
        const cancelFrame = () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
            if (videoFrame && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(videoFrame);
            animationFrame = 0;
            videoFrame = 0;
        };
        // 回到前台时重新排帧；隐藏时 scheduleFrame 不再续排。
        const resumeWhenVisible = () => {
            if (document.visibilityState === "hidden") return;
            cancelFrame();
            scheduleFrame();
        };
        document.addEventListener("visibilitychange", resumeWhenVisible);
        drawFrame();
        scheduleFrame();
        return () => {
            disposed = true;
            cancelFrame();
            document.removeEventListener("visibilitychange", resumeWhenVisible);
        };
    }, [src, paused]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.loop = loop;
        if (paused) {
            video.pause();
            return;
        }
        // pause() 会清掉 autoplay 标记，恢复时必须显式播放；已在播放时 play() 不会重来。
        void video.play().catch(() => undefined);
    }, [src, loop, paused]);

    return (
        <>
            <canvas ref={canvasRef} className={className ?? "canvas-agent-keyed-video"} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", userSelect: "none" }} aria-hidden="true" />
            <video
                ref={videoRef}
                src={src}
                autoPlay={!paused}
                muted
                loop={loop}
                playsInline
                preload="auto"
                aria-hidden="true"
                draggable={false}
                onError={() => errorRef.current?.()}
                className="canvas-agent-video-source"
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
            />
        </>
    );
}
