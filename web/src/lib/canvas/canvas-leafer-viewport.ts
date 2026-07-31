import type { ViewportTransform } from "@/types/canvas";

const MIN_VIEWPORT_SCALE = 0.05;
const MIN_PREVIEW_RATIO = 0.85;
const MAX_PREVIEW_RATIO = 1.25;

export function calculateCanvasPreviewTransform(viewport: ViewportTransform, rasterViewport: ViewportTransform) {
    const ratio = viewport.k / Math.max(rasterViewport.k, MIN_VIEWPORT_SCALE);
    // 将旧 backing store 的屏幕坐标映射到实时视口，避免缩放手势逐帧触发矢量重绘。
    return {
        ratio,
        x: viewport.x - rasterViewport.x * ratio,
        y: viewport.y - rasterViewport.y * ratio,
    };
}

export function shouldRebaseCanvasRaster(viewport: ViewportTransform, rasterViewport: ViewportTransform) {
    const { ratio } = calculateCanvasPreviewTransform(viewport, rasterViewport);
    return ratio < MIN_PREVIEW_RATIO || ratio > MAX_PREVIEW_RATIO;
}

export function sameCanvasViewport(left: ViewportTransform, right: ViewportTransform) {
    return left.x === right.x && left.y === right.y && left.k === right.k;
}
