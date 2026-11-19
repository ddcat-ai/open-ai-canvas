import { LL2_CONNECTED_VIDEO_MODELS, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import { ll2UpscaleTargetsFor } from "@/lib/ll2-upscale";
import { ll2FetchHdBlob, ll2RunHd } from "@/services/ll2/ll2-hd";
import { ll2BuildMediaContent, type LL2MediaInput } from "@/services/ll2/ll2-media";
import { ll2GenerateVideo } from "@/services/ll2/ll2-video";
import { uploadMediaFile } from "@/services/file-storage";
import { captureVideoPoster } from "@/lib/video-poster";
import { useLL2Store } from "@/stores/use-ll2-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";

/**
 * 画布视频节点的 LL2 直连执行：复用首页一句话成片的同一条客户端链路。
 * 生成 →（可选）超分 → 本地/远端落盘，返回可直接写进节点 metadata 的内容。
 */
/** 画布配置里的模型带渠道前缀（ll2-primary::MiniMax-H3），生成时要用最后一段。 */
export function ll2BaseVideoModel(model: string): string {
    return String(model || "").split("::").pop() || "";
}

export function isLL2CanvasVideoModel(config: AiConfig): boolean {
    if (!useLL2Store.getState().apiKey.trim()) return false;
    return (LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes(ll2BaseVideoModel(config.model));
}

export type LL2CanvasVideoResult = {
    content: string;
    storageKey?: string;
    /** 首帧海报 dataURL，给画布节点当预览图，避免只显示相机占位。 */
    posterUrl?: string;
    seconds: number;
    resolution: string;
    requiresAuth?: boolean;
    durationMs?: number;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export async function runLL2CanvasVideo(input: {
    config: AiConfig;
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    signal?: AbortSignal;
}): Promise<LL2CanvasVideoResult> {
    const apiKey = useLL2Store.getState().apiKey.trim();
    if (!apiKey) throw new Error("先连接 LL2 Key 才能在画布里生成");
    const model = ll2BaseVideoModel(input.config.model) as LL2ConnectedVideoModel;
    if (!(LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes(model)) throw new Error(`${model} 不是 LL2 视频模型`);

    const items: LL2MediaInput[] = [];
    for (const ref of input.referenceImages) {
        const url = String(ref.dataUrl || ref.url || "").trim();
        if (url) {
            items.push({
                id: `ref-image-${items.length}`,
                kind: "image",
                dataUrl: url,
                name: "参考图",
                mimeType: url.startsWith("data:") ? url.slice(5, url.indexOf(";")) || "image/png" : "image/png",
                bytes: url.length,
                encodedBytes: url.length,
                durationSeconds: 0,
            });
        }
    }
    for (const ref of input.referenceVideos) {
        const url = String(ref.url || "").trim();
        if (url) {
            items.push({
                id: `ref-video-${items.length}`,
                kind: "video",
                dataUrl: url,
                name: "参考视频",
                mimeType: "video/mp4",
                bytes: url.length,
                encodedBytes: url.length,
                durationSeconds: 0,
            });
        }
    }
    const media = ll2BuildMediaContent(items).items;

    const seconds = Number(input.config.videoSeconds) || 5;
    const generated = await ll2GenerateVideo({
        apiKey,
        model,
        prompt: input.prompt,
        seconds,
        resolution: input.config.vquality,
        ratio: input.config.size,
        media,
        signal: input.signal,
        promptOptimizer: input.config.ll2PromptOptimizer === "1",
    });

    let blob: Blob | null = null;
    let finalUrl = generated.url;
    let finalResolution = generated.resolution;
    let finalSeconds = generated.seconds;

    // 超分只接受公网视频直链；需要 Bearer 的 artifact 不能作为 /hd/tasks 的输入。
    const upscaleTarget = String(input.config.ll2Upscale || "");
    const canUpscale = upscaleTarget && !generated.requiresAuth && ll2UpscaleTargetsFor(generated.resolution).some((item) => item.id === upscaleTarget);
    if (canUpscale) {
        const hd = await ll2RunHd({ apiKey, videoUrl: generated.url, resolution: upscaleTarget as "1080p" | "2k" | "4k", duration: generated.seconds, signal: input.signal });
        blob = await ll2FetchHdBlob(hd.url, apiKey, input.signal);
        finalResolution = hd.resolution;
    } else if (generated.previewUrl) {
        try { blob = await fetch(generated.previewUrl, { signal: input.signal }).then((response) => response.blob()); } catch { blob = null; }
    } else if (!generated.requiresAuth) {
        try { blob = await fetch(finalUrl, { signal: input.signal }).then((response) => response.blob()); } catch { blob = null; }
    }

    // 公开直链（H3 / wan3）直接写远程地址：画布能播放，也不会出现「未同步」。
    // 只有需要 Bearer 的 artifact（seedance / vidu / vega）才落盘成本机/远端资源。
    const mustPersist = generated.requiresAuth || Boolean(canUpscale);
    if (blob && mustPersist) {
        const uploaded = await uploadMediaFile(blob, "ll2-canvas");
        const poster = await posterDataUrl(blob);
        return {
            content: uploaded.url,
            storageKey: uploaded.storageKey,
            posterUrl: poster?.dataUrl,
            seconds: uploaded.durationMs ? uploaded.durationMs / 1000 : finalSeconds,
            resolution: finalResolution,
            durationMs: uploaded.durationMs,
            width: uploaded.width || poster?.width,
            height: uploaded.height || poster?.height,
            bytes: uploaded.bytes,
            mimeType: uploaded.mimeType,
        };
    }

    let poster = blob ? await posterDataUrl(blob) : null;
    if (!poster && !generated.requiresAuth) {
        // 公开直链也尽量取一次首帧当海报；CORS 不通就退化成占位图，不影响播放。
        try {
            const posterBlob = await fetch(finalUrl, { signal: input.signal }).then((response) => response.blob());
            poster = await posterDataUrl(posterBlob);
        } catch { poster = null; }
    }
    return {
        content: finalUrl,
        seconds: finalSeconds,
        resolution: finalResolution,
        posterUrl: poster?.dataUrl,
        width: poster?.width,
        height: poster?.height,
        durationMs: poster?.durationMs,
        requiresAuth: false,
    };
}
async function posterDataUrl(blob: Blob): Promise<{ dataUrl: string; width?: number; height?: number; durationMs?: number } | null> {
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
        return { dataUrl, width: captured.width, height: captured.height, durationMs: captured.durationMs };
    } catch {
        return null;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}
