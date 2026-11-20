// 已有视频的「直接超分」：识别当前清晰度，选一个更高档，接 LL2 auto-hd 后处理。
import { captureVideoPoster } from "@/lib/video-poster";
import { ll2ResolutionRank, ll2UpscaleEstimate, ll2UpscaleTargetLabel, ll2UpscaleTargetsFor, type LL2UpscaleTarget } from "@/lib/ll2-upscale";
import { ll2FetchHdBlob, ll2RunHd } from "@/services/ll2/ll2-hd";
import { uploadMediaFile } from "@/services/file-storage";
import { useLL2Store } from "@/stores/use-ll2-store";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasVideoUpscaleOption = {
    id: LL2UpscaleTarget;
    label: string;
    detail: string;
    seconds: number;
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

/** 已生成视频可选的超分目标；本机视频/需要鉴权的 artifact 不能作为 /hd 输入。 */
export function canvasVideoUpscaleOptions(node: CanvasNodeData): CanvasVideoUpscaleOption[] {
    const content = String(node.metadata?.content || "");
    if (!/^https:\/\//i.test(content) || node.metadata?.requiresAuth) return [];
    const current = canvasVideoResolution(node);
    const seconds = canvasVideoDurationSeconds(node);
    return ll2UpscaleTargetsFor(current.label).map((target) => {
        const estimate = ll2UpscaleEstimate(seconds, target.id);
        return { id: target.id, label: target.label, detail: `当前 ${current.label} · ${estimate.label}（${seconds} 秒）`, seconds };
    });
}

export async function upscaleCanvasVideo(input: {
    node: CanvasNodeData;
    target: LL2UpscaleTarget;
    signal?: AbortSignal;
    onStage?: (detail: string) => void;
    onHdTaskId?: (taskId: string) => void;
}) {
    const apiKey = useLL2Store.getState().apiKey.trim();
    if (!apiKey) throw new Error("先连接 LL2 Key 才能超分");
    const videoUrl = String(input.node.metadata?.content || "");
    if (!/^https:\/\//i.test(videoUrl)) throw new Error("这条视频不是公网地址，LL2 超分读不到；请重新生成一条云端视频后再超分");
    if (input.node.metadata?.requiresAuth) throw new Error("这条视频需要 Bearer 才能下载，不能直接做超分");
    const seconds = canvasVideoDurationSeconds(input.node);

    input.onStage?.(`正在超分 ${ll2UpscaleTargetLabel(input.target)}`);
    const hd = await ll2RunHd(
        { apiKey, videoUrl, resolution: input.target, duration: seconds, signal: input.signal },
        (progress) => {
            if (progress.taskId) input.onHdTaskId?.(progress.taskId);
            input.onStage?.(`正在超分 ${ll2UpscaleTargetLabel(input.target)} · 已查询 ${progress.pollCount || 0} 次`);
        },
    );
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