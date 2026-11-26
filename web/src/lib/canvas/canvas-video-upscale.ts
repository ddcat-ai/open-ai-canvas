// 已有视频的「直接超分」：识别当前清晰度，选一个更高档，接 LL2 auto-hd 后处理。
import { fetchFile } from "@ffmpeg/util";

import { captureVideoPoster } from "@/lib/video-poster";
import { ll2ResolutionRank, ll2UpscaleEstimate, ll2UpscaleTargetLabel, ll2UpscaleTargetsFor, type LL2UpscaleTarget } from "@/lib/ll2-upscale";
import { ll2FetchHdBlob, ll2RunHd } from "@/services/ll2/ll2-hd";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { runFFmpegTask } from "@/lib/canvas/canvas-video-merge";
import { useLL2Store } from "@/stores/use-ll2-store";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasVideoUpscaleOption = {
    id: LL2UpscaleTarget;
    label: string;
    detail: string;
    seconds: number;
    mode: "cloud" | "local";
};

/** 识别节点当前分辨率：优先 metadata.vquality，其次从画幅短边推断。 */
export function canvasVideoResolution(node: CanvasNodeData) {
    const width = Number(node.metadata?.naturalWidth) || 0;
    const height = Number(node.metadata?.naturalHeight) || 0;
    const pixels = Math.min(width, height);
    const rank = ll2ResolutionRank(String(node.metadata?.vquality || "")) || pixels;
    return { rank, label: rank ? `${rank}P` : "未知" };
}

export function canvasVideoDurationSeconds(node: CanvasNodeData) {
    const durationMs = Number(node.metadata?.durationMs) || 0;
    if (durationMs > 0) return Math.max(1, Math.round(durationMs / 1000));
    return Math.max(1, Number(node.metadata?.seconds) || 5);
}

/** 已生成视频走云端 AI 超分；拖进画布的本机视频走本机高清放大（LL2 /hd 只读公网 URL）。 */
export function canvasVideoUpscaleOptions(node: CanvasNodeData): CanvasVideoUpscaleOption[] {
    const content = String(node.metadata?.content || "");
    const storageKey = String(node.metadata?.storageKey || "");
    const isPublic = /^https:\/\//i.test(content);
    const isLocal = Boolean(storageKey) || /^(blob:|data:video\/)/i.test(content);
    if ((!isPublic && !isLocal) || node.metadata?.requiresAuth) return [];
    const current = canvasVideoResolution(node);
    const seconds = canvasVideoDurationSeconds(node);
    return ll2UpscaleTargetsFor(current.label).map((target) => {
        const estimate = ll2UpscaleEstimate(seconds, target.id);
        return {
            id: target.id,
            label: target.label,
            detail: isPublic ? `当前 ${current.label} · ${estimate.label}（${seconds} 秒）` : `当前 ${current.label} · 本机高清放大到 ${target.label}（${seconds} 秒，不消耗 LL2 额度）`,
            seconds,
            mode: isPublic ? "cloud" : "local",
        };
    });
}

export async function upscaleCanvasVideo(input: { node: CanvasNodeData; target: LL2UpscaleTarget; signal?: AbortSignal; onStage?: (detail: string) => void; onHdTaskId?: (taskId: string) => void }) {
    const apiKey = useLL2Store.getState().apiKey.trim();
    const videoUrl = String(input.node.metadata?.content || "");
    const isPublic = /^https:\/\//i.test(videoUrl);
    if (!isPublic) {
        return upscaleCanvasVideoLocally(input);
    }
    if (!apiKey) throw new Error("先连接 LL2 Key 才能超分");
    if (input.node.metadata?.requiresAuth) throw new Error("这条视频需要 Bearer 才能下载，不能直接做超分");
    const seconds = canvasVideoDurationSeconds(input.node);

    input.onStage?.(`正在超分 ${ll2UpscaleTargetLabel(input.target)}`);
    const hd = await ll2RunHd({ apiKey, videoUrl, resolution: input.target, duration: seconds, signal: input.signal }, (progress) => {
        if (progress.taskId) input.onHdTaskId?.(progress.taskId);
        input.onStage?.(`正在超分 ${ll2UpscaleTargetLabel(input.target)} · 已查询 ${progress.pollCount || 0} 次`);
    });
    input.onStage?.("超分完成，正在保存");
    const blob = await ll2FetchHdBlob(hd.url, apiKey, input.signal);
    const uploaded = await uploadMediaFile(blob, "ll2-upscale");
    const poster = await posterDataUrl(blob);
    return {
        content: uploaded.url,
        storageKey: uploaded.storageKey,
        resolution: ll2UpscaleTargetLabel(hd.resolution),
        seconds: uploaded.durationMs ? uploaded.durationMs / 1000 : seconds,
        durationMs: uploaded.durationMs,
        width: uploaded.width || poster?.width,
        height: uploaded.height || poster?.height,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
        posterUrl: poster?.dataUrl,
    };
}

/**
 * 本机视频没有公网 URL，LL2 /hd 无法读取。这里用 ffmpeg.wasm 做 Lanczos 高清放大，
 * 不消耗额度、不上传视频；它不是云端 AI 超分，UI 会明确标注。
 */
async function upscaleCanvasVideoLocally(input: { node: CanvasNodeData; target: LL2UpscaleTarget; signal?: AbortSignal; onStage?: (detail: string) => void }) {
    const source = String(input.node.metadata?.content || "");
    const storageKey = String(input.node.metadata?.storageKey || "");
    let sourceBlob: Blob | null = storageKey ? await getMediaBlob(storageKey) : null;
    if (!sourceBlob && source) {
        try {
            sourceBlob = await fetch(source).then((response) => (response.ok ? response.blob() : null));
        } catch {
            sourceBlob = null;
        }
    }
    if (!sourceBlob) throw new Error("本机视频文件已失效，请重新拖入视频后再放大");

    const sourceWidth = Number(input.node.metadata?.naturalWidth) || 1280;
    const sourceHeight = Number(input.node.metadata?.naturalHeight) || 720;
    const targetHeight = input.target === "4k" ? 2160 : input.target === "2k" ? 1440 : 1080;
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    const targetWidth = even((targetHeight * sourceWidth) / Math.max(1, sourceHeight));
    const seconds = canvasVideoDurationSeconds(input.node);

    input.onStage?.(`正在本机放大到 ${ll2UpscaleTargetLabel(input.target)}（${targetWidth}×${targetHeight}）`);
    const output = await runFFmpegTask(
        async (ffmpeg) => {
            await ffmpeg.writeFile("upscale-input.mp4", await fetchFile(sourceBlob));
            try {
                await ffmpeg.exec([
                    "-y",
                    "-i",
                    "upscale-input.mp4",
                    "-vf",
                    `scale=${targetWidth}:${targetHeight}:flags=lanczos`,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    "upscale-output.mp4",
                ]);
                const data = await ffmpeg.readFile("upscale-output.mp4");
                const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
                const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
                return new Blob([buffer], { type: "video/mp4" });
            } finally {
                await Promise.all(["upscale-input.mp4", "upscale-output.mp4"].map((file) => ffmpeg.deleteFile(file).catch(() => undefined)));
            }
        },
        undefined,
        input.signal,
    );

    input.onStage?.("本机放大完成，正在保存");
    const uploaded = await uploadMediaFile(output, "ll2-local-upscale");
    const poster = await posterDataUrl(output);
    return {
        content: uploaded.url,
        storageKey: uploaded.storageKey,
        resolution: ll2UpscaleTargetLabel(input.target),
        seconds: uploaded.durationMs ? uploaded.durationMs / 1000 : seconds,
        durationMs: uploaded.durationMs,
        width: uploaded.width || targetWidth,
        height: uploaded.height || targetHeight,
        bytes: uploaded.bytes,
        mimeType: uploaded.mimeType,
        posterUrl: poster?.dataUrl,
    };
}

async function posterDataUrl(blob: Blob): Promise<{ dataUrl: string; width?: number; height?: number } | null> {
    const objectUrl = URL.createObjectURL(blob);
    try {
        const captured = await captureVideoPoster(objectUrl, { maxWidth: 480, timeoutMs: 8000 });
        if (!captured.poster) return null;
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("读取视频首帧失败"));
            reader.readAsDataURL(captured.poster!);
        });
        return { dataUrl, width: captured.width, height: captured.height };
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
