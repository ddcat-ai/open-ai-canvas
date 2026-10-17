import type { CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";

export type CanvasOverlayBounds = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
const NODE_PANEL_LAYOUT_EVENT = "canvas:node-panel-layout";
const nodePanelLayouts = new WeakMap<HTMLElement, Map<HTMLElement, CanvasOverlayBounds>>();

export function updateCanvasNodePanelBounds(container: HTMLElement, panel: HTMLElement, bounds: CanvasOverlayBounds | null) {
    let layouts = nodePanelLayouts.get(container);
    const previous = layouts?.get(panel);
    if (bounds && previous && bounds.left === previous.left && bounds.top === previous.top && bounds.right === previous.right && bounds.bottom === previous.bottom) return;
    if (!bounds && !previous) return;
    if (!layouts) {
        layouts = new Map();
        nodePanelLayouts.set(container, layouts);
    }
    if (bounds) layouts.set(panel, bounds);
    else layouts.delete(panel);
    container.dispatchEvent(new Event(NODE_PANEL_LAYOUT_EVENT));
}

export function canvasNodePanelBounds(container: HTMLElement) {
    return [...(nodePanelLayouts.get(container)?.values() || [])];
}

export function subscribeCanvasNodePanelBounds(container: HTMLElement, listener: () => void) {
    container.addEventListener(NODE_PANEL_LAYOUT_EVENT, listener);
    return () => container.removeEventListener(NODE_PANEL_LAYOUT_EVENT, listener);
}

export function canvasOverlayBounds(size: Size, insets: Partial<CanvasOverlayBounds> = {}): CanvasOverlayBounds {
    const right = Math.max(12, Math.min(size.width - 12, insets.right ?? size.width));
    const bottom = Math.max(12, Math.min(size.height - 12, insets.bottom ?? size.height));
    return { left: Math.min(Math.max(12, insets.left ?? 12), right), top: Math.min(Math.max(12, insets.top ?? 12), bottom), right, bottom };
}

/** Measure screen-space chrome only when its size changes, never on canvas pan frames. */
export function observeCanvasOverlayBounds(container: HTMLElement, onChange: (bounds: CanvasOverlayBounds) => void) {
    const root = container.closest("main") || container;
    const left = [...root.querySelectorAll<HTMLElement>(".canvas-workspace-shell, .canvas-project-sidebar")];
    const top = [...root.querySelectorAll<HTMLElement>(".canvas-topbar")];
    const bottom = [...root.querySelectorAll<HTMLElement>(".canvas-floating-dock, .canvas-workspace-zoom-controls")];
    const measure = () => {
        const rect = container.getBoundingClientRect();
        const visibleRects = (elements: HTMLElement[]) =>
            elements.map((element) => element.getBoundingClientRect()).filter((item) => item.width > 0 && item.height > 0 && item.right > rect.left && item.left < rect.right && item.bottom > rect.top && item.top < rect.bottom);
        onChange(
            canvasOverlayBounds(rect, {
                left: Math.max(12, ...visibleRects(left).map((item) => item.right - rect.left + 12)),
                top: Math.max(12, ...visibleRects(top).map((item) => item.bottom - rect.top + 12)),
                bottom: Math.min(rect.height - 12, ...visibleRects(bottom).map((item) => item.top - rect.top - 12)),
            }),
        );
    };
    const resizeObserver = new ResizeObserver(measure);
    for (const element of new Set([container, root, ...left, ...top, ...bottom])) resizeObserver.observe(element);
    const stateObserver = new MutationObserver(measure);
    stateObserver.observe(root, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", measure);
    measure();
    return () => {
        resizeObserver.disconnect();
        stateObserver.disconnect();
        window.removeEventListener("resize", measure);
    };
}

export function canvasToolbarLayoutLevel(availableWidth: number, measuredWidths: readonly number[], current: number) {
    for (let level = 0; level < current; level++) {
        if (measuredWidths[level] > 0 && measuredWidths[level] <= availableWidth) return level;
    }
    return measuredWidths[current] > availableWidth ? Math.min(2, current + 1) : current;
}

/** Toolbar anchors are their horizontal center and bottom edge. */
export function avoidCanvasNodePanels(anchor: { left: number; top: number }, size: Size, bounds: CanvasOverlayBounds, panels: readonly CanvasOverlayBounds[]) {
    let { left, top } = anchor;
    const halfWidth = size.width / 2;
    for (const panel of panels) {
        if (left + halfWidth <= panel.left || left - halfWidth >= panel.right || top <= panel.top || top - size.height >= panel.bottom) continue;
        if (panel.left - bounds.left >= size.width + 8) left = panel.left - halfWidth - 8;
        else if (bounds.right - panel.right >= size.width + 8) left = panel.right + halfWidth + 8;
        else if (panel.top - bounds.top >= size.height + 8) top = panel.top - 8;
        else if (bounds.bottom - panel.bottom >= size.height + 8) top = panel.bottom + size.height + 8;
    }
    return { left, top };
}

export function placeCanvasNodePanel(node: CanvasNodeData, viewport: ViewportTransform, bounds: CanvasOverlayBounds, size: Size, dragOffset?: Position | null) {
    const width = Math.min(size.width, Math.max(0, bounds.right - bounds.left));
    const height = Math.min(size.height, Math.max(0, bounds.bottom - bounds.top));
    const center = viewport.x + (node.position.x + (dragOffset?.x || 0) + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + (node.position.y + (dragOffset?.y || 0)) * viewport.k;
    const nodeBottom = nodeTop + node.height * viewport.k;
    const below = nodeBottom + 10;
    const above = nodeTop - height - 10;
    const placement = below + height > bounds.bottom && above >= bounds.top ? "above" : "below";
    return {
        left: Math.min(Math.max(center - width / 2, bounds.left), bounds.right - width),
        top: Math.min(Math.max(placement === "above" ? above : below, bounds.top), bounds.bottom - height),
        placement,
    };
}
