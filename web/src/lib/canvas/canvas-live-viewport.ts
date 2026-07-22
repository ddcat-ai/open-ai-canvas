import type { ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_PREVIEW_EVENT = "canvas:viewport-preview";

export function applyCanvasLiveViewport(container: HTMLDivElement | null, viewport: ViewportTransform, notify = true) {
    if (!container) return;
    const gridSize = 48 * viewport.k;
    container.style.setProperty("--canvas-live-x", `${viewport.x}px`);
    container.style.setProperty("--canvas-live-y", `${viewport.y}px`);
    container.style.setProperty("--canvas-live-scale", String(viewport.k));
    container.style.setProperty("--canvas-grid-size", `${gridSize}px`);
    container.style.setProperty("--canvas-grid-x", `${viewport.x % gridSize}px`);
    container.style.setProperty("--canvas-grid-y", `${viewport.y % gridSize}px`);
    container.style.setProperty("--canvas-dot-size", viewport.k < 0.12 ? "0.8px" : "1.15px");
    if (notify) container.dispatchEvent(new CustomEvent<ViewportTransform>(CANVAS_VIEWPORT_PREVIEW_EVENT, { detail: viewport }));
}

export function subscribeCanvasViewportPreview(container: HTMLDivElement, listener: (viewport: ViewportTransform) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<ViewportTransform>).detail);
    container.addEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
}
