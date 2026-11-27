import type { CanvasNodeData } from "@/types/canvas";

/** 火山增强模型的价格档位按输出帧率计算。 */
export function videoEnhanceFpsBand(fps?: number) {
    if (!fps || fps <= 30) return "le30";
    return fps <= 60 ? "le60" : "le120";
}

export function videoEnhanceResolutionShortEdge(resolution: string) {
    const value = resolution.trim().toLowerCase();
    if (value === "2k") return 1440;
    if (value === "4k") return 2160;
    const numeric = Number.parseInt(value, 10);
    return Number.isFinite(numeric) ? numeric : 0;
}

/** 提前提示已知输入限制，执行时仍由服务端读取真实资源重新校验。 */
export function videoEnhanceSourceError(node: CanvasNodeData, maxSourceSeconds: number) {
    const metadata = node.metadata;
    if (!metadata?.storageKey && !metadata?.content) return "视频节点为空，无法画质增强";
    if ((metadata.durationMs || 0) > maxSourceSeconds * 1000) return `源视频时长超过 ${maxSourceSeconds} 秒上限，请先截取片段后再增强`;
    const width = metadata.naturalWidth || 0;
    const height = metadata.naturalHeight || 0;
    if (width > 0 && height > 0) {
        const short = Math.min(width, height);
        const long = Math.max(width, height);
        if (short < 360 || short > 1080 || long > 1920) return `源视频分辨率 ${width}×${height} 不受支持：短边需在 360–1080、长边不超过 1920`;
    }
    return "";
}
