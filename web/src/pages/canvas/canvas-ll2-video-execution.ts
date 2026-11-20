import { LL2_CONNECTED_VIDEO_MODELS, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import { ll2UpscaleTargetsFor } from "@/lib/ll2-upscale";
import { ll2FetchHdBlob, ll2RunHd } from "@/services/ll2/ll2-hd";
import { ll2BuildMediaContent, type LL2MediaInput } from "@/services/ll2/ll2-media";
import { ll2GenerateVideo, ll2ResumeVideo } from "@/services/ll2/ll2-video";
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
    /** 给画布节点显示当前阶段，避免「LL2 已出片、画布还在转圈」时用户不知道在等什么。 */
    onStage?: (detail: string) => void;
    /** 持久化 LL2 任务号，页面刷新后可用于排查/恢复。 */
    onTaskId?: (taskId: string) => void;
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
    }, (progress) => {
        if (progress.taskId) input.onTaskId?.(progress.taskId);
        const status = String(progress.status || "").toLowerCase();
        const queued = status.includes("queued") || status.includes("pending");
        input.onStage?.(queued ? "排队中" : `生成中 · 已查询 ${progress.pollCount || 0} 次`);
    });

    return finalizeLL2CanvasVideo(generated, {
        apiKey,
        upscaleTarget: String(input.config.ll2Upscale || ""),
        signal: input.signal,
        onStage: input.onStage,
    });
}

/** 刷新后恢复：按已保存的 LL2 taskId 继续查询，然后把成片按同样的落盘/超分规则写回节点。 */
export async function resumeLL2CanvasVideo(input: {
    model: string;
    taskId: string;
    prompt?: string;
    seconds?: number;
    resolution?: string;
    ratio?: string;
    upscaleTarget?: string;
    signal?: AbortSignal;
    onStage?: (detail: string) => void;
}): Promise<LL2CanvasVideoResult> {
    const apiKey = useLL2Store.getState().apiKey.trim();
    if (!apiKey) throw new Error("先连接 LL2 Key 才能恢复生成");
    const model = ll2BaseVideoModel(input.model) as LL2ConnectedVideoModel;
    if (!(LL2_CONNECTED_VIDEO_MODELS as readonly string[]).includes(model)) throw new Error(`${model} 不是 LL2 视频模型`);
    const generated = await ll2ResumeVideo(
        {
            apiKey,
            model,
            prompt: String(input.prompt || ""),
            seconds: Math.max(1, Number(input.seconds) || 4),
            resolution: String(input.resolution || (model === "MiniMax-H3" ? "768P" : "480P")),
            ratio: input.ratio,
            signal: input.signal,
        },
        input.taskId,
        (progress) => {
            const status = String(progress.status || "").toLowerCase();
            input.onStage?.(status.includes("queued") || status.includes("pending") ? "恢复中 · 排队" : `恢复中 · 已查询 ${progress.pollCount || 0} 次`);
        },
    );
    return finalizeLL2CanvasVideo(generated, { apiKey, upscaleTarget: input.upscaleTarget, signal: input.signal, onStage: input.onStage });
}

async function finalizeLL2CanvasVideo(
    generated: Awaited<ReturnType<typeof ll2GenerateVideo>>,
    options: { apiKey: string; upscaleTarget?: string; signal?: AbortSignal; onStage?: (detail: string) => void },
): Promise<LL2CanvasVideoResult> {
    const { apiKey, upscaleTarget = "", signal, onStage } = options;
    let blob: Blob | null = null;
    let finalUrl = generated.url;
    let finalResolution = generated.resolution;
    let finalSeconds = generated.seconds;

    // 超分只接受公网视频直链；需要 Bearer 的 artifact 不能作为 /hd/tasks 的输入。
    const canUpscale = Boolean(upscaleTarget) && !generated.requiresAuth && ll2UpscaleTargetsFor(generated.resolution).some((item) => item.id === upscaleTarget);
    if (canUpscale) {
        // 超分比生成更慢；这一步必须让用户看到，别让节点一直只显示「正在生成」。
        onStage?.(`视频已生成，正在超分 ${upscaleTarget.toUpperCase()}（会更久一点）`);
        const hd = await ll2RunHd({ apiKey, videoUrl: generated.url, resolution: upscaleTarget as "1080p" | "2k" | "4k", duration: generated.seconds, signal });
        onStage?.("超分完成，正在取回成片");
        blob = await ll2FetchHdBlob(hd.url, apiKey, signal);
        finalResolution = hd.resolution;
    } else if (generated.previewUrl) {
        try { blob = await fetch(generated.previewUrl, { signal }).then((response) => response.blob()); } catch { blob = null; }
    } else if (!generated.requiresAuth) {
        // 公开直链只用来取首帧海报；COS 卡住/不支持 CORS 时不能把节点一直挂在生成中。
        onStage?.("生成完成，正在取回首帧");
        blob = await fetchBlobWithTimeout(finalUrl, 12000, signal);
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
            const posterBlob = await fetchBlobWithTimeout(finalUrl, 12000, signal);
            poster = posterBlob ? await posterDataUrl(posterBlob) : null;
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
async function fetchBlobWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Blob | null> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    try {
        const response = await fetch(url, { signal: combined });
        if (!response.ok) return null;
        return await response.blob();
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
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
