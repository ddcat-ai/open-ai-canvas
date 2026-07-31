import type { SelectionBox, ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_PREVIEW_EVENT = "canvas:viewport-preview";
export const CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT = "canvas:graphics-viewport-preview";
export const CANVAS_SELECTION_PREVIEW_EVENT = "canvas:selection-preview";

export function applyCanvasLiveViewport(container: HTMLDivElement | null, viewport: ViewportTransform, notify = true) {
    if (!container) return;
    const gridSize = 48 * viewport.k;
    const committedScale = Number(container.style.getPropertyValue("--canvas-committed-scale")) || viewport.k;
    container.style.setProperty("--canvas-live-x", `${viewport.x}px`);
    container.style.setProperty("--canvas-live-y", `${viewport.y}px`);
    container.style.setProperty("--canvas-live-scale", String(viewport.k));
    container.style.setProperty("--canvas-live-scale-ratio", String(viewport.k / committedScale));
    container.style.setProperty("--canvas-grid-size", `${gridSize}px`);
    container.style.setProperty("--canvas-grid-x", `${viewport.x % gridSize}px`);
    container.style.setProperty("--canvas-grid-y", `${viewport.y % gridSize}px`);
    container.style.setProperty("--canvas-dot-size", viewport.k < 0.12 ? "0.8px" : "1.15px");
    // 图形层必须逐帧跟随 DOM 世界层；浮层和滚动通知仍可按原频率节流。
    container.dispatchEvent(new CustomEvent<ViewportTransform>(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, { detail: viewport }));
    if (notify) {
        container.dispatchEvent(new CustomEvent<ViewportTransform>(CANVAS_VIEWPORT_PREVIEW_EVENT, { detail: viewport }));
        // Ant Design overlays watch scrollable ancestors, but CSS transforms do not emit layout events.
        container.dispatchEvent(new Event("scroll"));
    }
}

export function subscribeCanvasGraphicsViewportPreview(container: HTMLDivElement, listener: (viewport: ViewportTransform) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<ViewportTransform>).detail);
    container.addEventListener(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT, handlePreview);
}

export function subscribeCanvasViewportPreview(container: HTMLDivElement, listener: (viewport: ViewportTransform) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<ViewportTransform>).detail);
    container.addEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_VIEWPORT_PREVIEW_EVENT, handlePreview);
}

export function applyCanvasSelectionPreview(container: HTMLDivElement | null, selection: SelectionBox) {
    container?.dispatchEvent(new CustomEvent<SelectionBox>(CANVAS_SELECTION_PREVIEW_EVENT, { detail: selection }));
}

export function subscribeCanvasSelectionPreview(container: HTMLDivElement, listener: (selection: SelectionBox) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<SelectionBox>).detail);
    container.addEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
}
