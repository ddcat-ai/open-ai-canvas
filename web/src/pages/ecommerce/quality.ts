import type { Asset } from "@/stores/use-asset-store";

/** Deterministic file checks only. Product fidelity and platform compliance need visual review. */
export function inspectCommerceImageAsset(asset: Asset, expectedRatio: string): string[] {
    if (asset.kind !== "image") return ["生成资产不是图片"];
    const { width, height, bytes, mimeType } = asset.data;
    const issues: string[] = [];
    if (!/^image\/(png|jpeg|webp)$/i.test(mimeType)) issues.push("文件格式需要核对");
    if (!Number.isFinite(bytes) || bytes < 1024) issues.push("文件大小异常");
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        issues.push("图片尺寸不可读取");
        return issues;
    }
    const ratio = expectedRatio.split(":").map(Number);
    if (ratio.length === 2 && ratio.every((value) => Number.isFinite(value) && value > 0)) {
        const target = ratio[0] / ratio[1];
        if (Math.abs(width / height - target) / target > 0.08) issues.push(`比例与设定 ${expectedRatio} 不符`);
    }
    return issues;
}
