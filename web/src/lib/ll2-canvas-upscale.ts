import type { CanvasNodeData } from "@/types/canvas";
import { ll2UpscaleTargetsFor, ll2UpscaleTargetLabel } from "@/lib/ll2-upscale";

/**
 * 无限画布接 LL2 auto-hd 的纯函数。
 *
 * auto-hd 只接受公网 HTTPS 视频地址；画布上的本机视频（data:/blob:/仅本机 storageKey）
 * 无法直接超分，所以在入口和弹层里都要按这条边界判断。
 */
export function ll2CanvasUpscaleSourceUrl(node: CanvasNodeData | null | undefined): string {
    const content = String(node?.metadata?.content || "").trim();
    return /^https:\/\//i.test(content) ? content : "";
}

/** 原片档位：优先用节点记录的视频清晰度，其次用像素尺寸反推。 */
export function ll2CanvasVideoResolution(node: CanvasNodeData | null | undefined): string {
    const quality = String(node?.metadata?.vquality || "").trim();
    if (quality) return quality;
    const height = Number(node?.metadata?.naturalHeight || 0) || Number(node?.height || 0);
    if (height >= 2160) return "4K";
    if (height >= 1440) return "2K";
    if (height >= 1080) return "1080P";
    if (height >= 768) return "768P";
    if (height >= 720) return "720P";
    if (height >= 540) return "540P";
    if (height >= 480) return "480P";
    return "768P";
}

export function ll2CanvasVideoSeconds(node: CanvasNodeData | null | undefined): number {
    const fromMetadata = (Number(node?.metadata?.durationMs || 0) || 0) / 1000;
    const fromSeconds = Number(node?.metadata?.seconds || 0) || 0;
    return Math.max(1, Math.round(fromMetadata || fromSeconds || 5));
}

/** 只给比原片更高的档位；4K 原片返回空数组。 */
export function ll2CanvasUpscaleTargets(node: CanvasNodeData | null | undefined) {
    return ll2UpscaleTargetsFor(ll2CanvasVideoResolution(node));
}

export function ll2CanvasUpscaleTargetName(target: string) {
    return ll2UpscaleTargetLabel(target);
}
