import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type CanvasViewportSize = {
    width: number;
    height: number;
};

// 在浮窗四周选择最大的完整矩形；坐标均相对画布容器。
export function unobscuredCanvasArea(size: CanvasViewportSize, overlay?: CanvasBounds): CanvasBounds {
    const full = { left: 0, top: 0, right: size.width, bottom: size.height };
    if (!overlay || overlay.right <= 0 || overlay.bottom <= 0 || overlay.left >= size.width || overlay.top >= size.height) return full;
    const left = Math.max(0, overlay.left);
    const top = Math.max(0, overlay.top);
    const right = Math.min(size.width, overlay.right);
    const bottom = Math.min(size.height, overlay.bottom);
    const candidates = [
        { ...full, right: left }, { ...full, left: right },
        { ...full, bottom: top }, { ...full, top: bottom },
    ].filter((area) => area.right - area.left >= 160 && area.bottom - area.top >= 160);
    return candidates.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0] ?? full;
}

export function viewportForAgentNodes(nodes: CanvasNodeData[], current: ViewportTransform, area: CanvasBounds): ViewportTransform | null {
    const bounds = getCanvasNodesBounds(nodes);
    if (!bounds) return null;
    const next = viewportForBounds(bounds, { width: area.right - area.left, height: area.bottom - area.top }, { padding: 56, maxScale: current.k });
    return { ...next, x: next.x + area.left, y: next.y + area.top };
}

export function getCanvasNodesBounds(nodes: CanvasNodeData[]): CanvasBounds | null {
    if (!nodes.length) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;

    nodes.forEach((node) => {
        left = Math.min(left, node.position.x);
        top = Math.min(top, node.position.y);
        right = Math.max(right, node.position.x + node.width);
        bottom = Math.max(bottom, node.position.y + node.height);
    });

    return { left, top, right, bottom };
}

export function viewportForBounds(bounds: CanvasBounds, viewportSize: CanvasViewportSize, options: { padding?: number; minScale?: number; maxScale?: number } = {}): ViewportTransform {
    const padding = options.padding ?? 96;
    const minScale = options.minScale ?? 0.05;
    const maxScale = options.maxScale ?? 1;
    const boundsWidth = Math.max(1, bounds.right - bounds.left);
    const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
    const availableWidth = Math.max(1, viewportSize.width - padding * 2);
    const availableHeight = Math.max(1, viewportSize.height - padding * 2);
    const k = Math.min(maxScale, Math.max(minScale, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)));
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    return {
        x: viewportSize.width / 2 - centerX * k,
        y: viewportSize.height / 2 - centerY * k,
        k,
    };
}

export function viewportAtScale(viewport: ViewportTransform, viewportSize: CanvasViewportSize, scale: number): ViewportTransform {
    const k = Math.min(2, Math.max(0.05, scale));
    const centerWorldX = (viewportSize.width / 2 - viewport.x) / viewport.k;
    const centerWorldY = (viewportSize.height / 2 - viewport.y) / viewport.k;
    return {
        x: viewportSize.width / 2 - centerWorldX * k,
        y: viewportSize.height / 2 - centerWorldY * k,
        k,
    };
}

export function interpolateViewport(from: ViewportTransform, to: ViewportTransform, progress: number): ViewportTransform {
    const t = 1 - Math.pow(1 - Math.min(1, Math.max(0, progress)), 3);
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        k: from.k + (to.k - from.k) * t,
    };
}
