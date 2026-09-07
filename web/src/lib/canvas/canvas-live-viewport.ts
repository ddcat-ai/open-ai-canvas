import type { Position, SelectionBox, ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_PREVIEW_EVENT = "canvas:viewport-preview";
export const CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT = "canvas:graphics-viewport-preview";
export const CANVAS_SELECTION_PREVIEW_EVENT = "canvas:selection-preview";
export const CANVAS_NODE_DRAG_PREVIEW_EVENT = "canvas:node-drag-preview";
export const CANVAS_ALIGNMENT_GUIDES_PREVIEW_EVENT = "canvas:alignment-guides-preview";
export const CANVAS_CONNECTION_PREVIEW_EVENT = "canvas:connection-preview";

export type CanvasNodeDragPreview = {
    x: number;
    y: number;
    nodeIds: ReadonlySet<string>;
};

export type CanvasAlignmentGuidesPreview = {
    vertical?: number;
    horizontal?: number;
};

export type CanvasConnectionPreview = {
    mouseWorld: Position;
    targetNodeId: string | null;
    targetAnchorRatio?: number;
};
type NodeDragPreviewDomState = {
    elementsById: Map<string, HTMLElement>;
    previousIds: Set<string>;
    preview: CanvasNodeDragPreview | null;
    observer?: MutationObserver;
};

type NodeSelectionPreviewDomState = {
    elementsById: Map<string, HTMLElement>;
    previousStates: Map<string, "include" | "remove">;
};

export type CanvasNodeSelectionPreview = {
    includeNodeIds: ReadonlySet<string>;
    removeNodeIds: ReadonlySet<string>;
};

const nodeDragPreviewDomStates = new WeakMap<HTMLDivElement, NodeDragPreviewDomState>();
const nodeSelectionPreviewDomStates = new WeakMap<HTMLDivElement, NodeSelectionPreviewDomState>();
const liveViewportElements = new WeakMap<HTMLDivElement, { worldLayer: HTMLElement | null; gridLayer: HTMLElement | null }>();

// 空间网格点模式的点半径（像素单位）。远距时使用更小半径，避免点阵糊成一团。
export function canvasDotPx(scale: number): string {
    return scale < 0.12 ? "0.6px" : "0.8px";
}

// 点阵在缩小时不再无限压缩到屏幕像素，避免密集视觉噪声。
export function canvasDotGridPx(scale: number): number {
    return Math.max(48 * scale, 32);
}

export function applyCanvasLiveViewport(container: HTMLDivElement | null, viewport: ViewportTransform, notify = true) {
    if (!container) return;
    const gridSize = 48 * viewport.k;
    const dotGridSize = canvasDotGridPx(viewport.k);
    const committedScale = Number(container.style.getPropertyValue("--canvas-committed-scale")) || viewport.k;
    let elements = liveViewportElements.get(container);
    if (!elements) {
        elements = {
            worldLayer: container.querySelector<HTMLElement>("[data-canvas-world-layer]"),
            gridLayer: container.querySelector<HTMLElement>("[data-canvas-grid-layer]"),
        };
        liveViewportElements.set(container, elements);
    }
    const worldLayer = elements.worldLayer;
    if (worldLayer) {
        // 平移期间直接更新合成层，避免修改容器继承变量导致所有节点重新计算样式。
        worldLayer.style.transformOrigin = "0 0";
        worldLayer.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k / committedScale})`;
        worldLayer.style.willChange = container.dataset.canvasViewportInteracting === "true" ? "transform" : "";
    }
    container.style.setProperty("--canvas-live-scale", String(viewport.k));
    // 外置节点标题用同一帧逆倍率抵消世界层缩放，避免等待 React 提交后再校正尺寸。
    container.style.setProperty("--canvas-live-inverse-scale", String(1 / Math.max(viewport.k, 0.05)));
    const gridLayer = elements.gridLayer;
    if (gridLayer) {
        // 网格是唯一需要每帧更新背景偏移的元素，不把这些变量放在画布根节点上继承。
        gridLayer.style.setProperty("--canvas-grid-size", `${gridSize}px`);
        gridLayer.style.setProperty("--canvas-grid-x", `${viewport.x % gridSize}px`);
        gridLayer.style.setProperty("--canvas-grid-y", `${viewport.y % gridSize}px`);
        gridLayer.style.setProperty("--canvas-dot-grid-size", `${dotGridSize}px`);
        gridLayer.style.setProperty("--canvas-dot-grid-x", `${viewport.x % dotGridSize}px`);
        gridLayer.style.setProperty("--canvas-dot-grid-y", `${viewport.y % dotGridSize}px`);
        gridLayer.style.setProperty("--canvas-dot-size", canvasDotPx(viewport.k));
    }
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

export function applyCanvasAlignmentGuidesPreview(container: HTMLDivElement | null, guides: CanvasAlignmentGuidesPreview) {
    container?.dispatchEvent(new CustomEvent<CanvasAlignmentGuidesPreview>(CANVAS_ALIGNMENT_GUIDES_PREVIEW_EVENT, { detail: guides }));
}

export function subscribeCanvasAlignmentGuidesPreview(container: HTMLDivElement, listener: (guides: CanvasAlignmentGuidesPreview) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<CanvasAlignmentGuidesPreview>).detail);
    container.addEventListener(CANVAS_ALIGNMENT_GUIDES_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_ALIGNMENT_GUIDES_PREVIEW_EVENT, handlePreview);
}

/**
 * Publishes the transient pin-to-pointer line without scheduling a React
 * render. The graphics layer consumes this event and updates its Leafer Path
 * directly once per animation frame.
 */
export function applyCanvasConnectionPreview(container: HTMLDivElement | null, preview: CanvasConnectionPreview | null) {
    container?.dispatchEvent(new CustomEvent<CanvasConnectionPreview | null>(CANVAS_CONNECTION_PREVIEW_EVENT, { detail: preview }));
}

export function subscribeCanvasConnectionPreview(container: HTMLDivElement, listener: (preview: CanvasConnectionPreview | null) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<CanvasConnectionPreview | null>).detail);
    container.addEventListener(CANVAS_CONNECTION_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_CONNECTION_PREVIEW_EVENT, handlePreview);
}

/**
 * Applies transient node movement without changing React state. Only nodes
 * currently mounted in the virtualized world are touched; the committed
 * positions are still written by the drag-end path.
 */
export function applyCanvasNodeDragPreview(container: HTMLDivElement | null, preview: CanvasNodeDragPreview | null) {
    if (!container) return;

    let state = nodeDragPreviewDomStates.get(container);
    if (!state) {
        state = { elementsById: new Map(), previousIds: new Set(), preview: null };
        nodeDragPreviewDomStates.set(container, state);
        state.observer = new MutationObserver((records) => {
            const active = state?.preview;
            if (!active) return;
            const syncElement = (element: HTMLElement) => {
                const nodeId = element.dataset.nodeId;
                if (!nodeId) return;
                state?.elementsById.set(nodeId, element);
                if (!active.nodeIds.has(nodeId)) return;
                const nextTranslate = `${active.x}px ${active.y}px`;
                if (element.style.getPropertyValue("translate") !== nextTranslate) element.style.setProperty("translate", nextTranslate);
            };
            records.forEach((record) => {
                if (record.type === "attributes" && record.target instanceof HTMLElement) {
                    syncElement(record.target);
                    return;
                }
                record.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;
                    syncElement(node);
                    node.querySelectorAll<HTMLElement>("[data-node-id]").forEach(syncElement);
                });
            });
        });
        state.observer.observe(container, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });
    }

    state.preview = preview;
    const nextIds = preview?.nodeIds || null;
    // Update active nodes in place; only departing nodes need translation cleanup.
    for (const nodeId of state.previousIds) {
        if (!nextIds?.has(nodeId)) state.elementsById.get(nodeId)?.style.removeProperty("translate");
    }

    if (preview) {
        // Build the lookup once per drag session. A single DOM scan is much
        // cheaper than one selector query per selected node on every frame.
        if (state.elementsById.size === 0) {
            container.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
                const nodeId = element.dataset.nodeId;
                if (nodeId) state?.elementsById.set(nodeId, element);
            });
        }
        for (const nodeId of preview.nodeIds) {
            const element = state.elementsById.get(nodeId);
            if (!element || !element.isConnected) continue;
            element.style.setProperty("translate", `${preview.x}px ${preview.y}px`);
        }
        state.previousIds = new Set(preview.nodeIds);
    } else {
        state.previousIds.clear();
        state.elementsById.clear();
    }

    container.dispatchEvent(new CustomEvent<CanvasNodeDragPreview | null>(CANVAS_NODE_DRAG_PREVIEW_EVENT, { detail: preview }));
}

export function subscribeCanvasNodeDragPreview(container: HTMLDivElement, listener: (preview: CanvasNodeDragPreview | null) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<CanvasNodeDragPreview | null>).detail);
    container.addEventListener(CANVAS_NODE_DRAG_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_NODE_DRAG_PREVIEW_EVENT, handlePreview);
}

/**
 * Shows the selection delta on mounted nodes without changing React state.
 * The controller commits the final Set once on pointer-up.
 */
export function applyCanvasNodeSelectionPreview(container: HTMLDivElement | null, preview: CanvasNodeSelectionPreview | null) {
    if (!container) return;

    let state = nodeSelectionPreviewDomStates.get(container);
    if (!state) {
        state = { elementsById: new Map(), previousStates: new Map() };
        nodeSelectionPreviewDomStates.set(container, state);
    }

    const nextStates = new Map<string, "include" | "remove">();
    if (preview) {
        for (const nodeId of preview.includeNodeIds) nextStates.set(nodeId, "include");
        for (const nodeId of preview.removeNodeIds) nextStates.set(nodeId, "remove");
    }

    if (state.elementsById.size === 0 && nextStates.size > 0) {
        container.querySelectorAll<HTMLElement>("[data-node-id]").forEach((element) => {
            const nodeId = element.dataset.nodeId;
            if (nodeId) state?.elementsById.set(nodeId, element);
        });
    }

    for (const [nodeId, previousState] of state.previousStates) {
        if (nextStates.get(nodeId) === previousState) continue;
        state.elementsById.get(nodeId)?.removeAttribute("data-canvas-selection-preview");
    }
    for (const [nodeId, nextState] of nextStates) {
        if (state.previousStates.get(nodeId) === nextState) continue;
        const element = state.elementsById.get(nodeId);
        if (!element || !element.isConnected) continue;
        element.dataset.canvasSelectionPreview = nextState;
    }

    state.previousStates = nextStates;
    if (!preview) state.elementsById.clear();
}

export function applyCanvasSelectionPreview(container: HTMLDivElement | null, selection: SelectionBox) {
    container?.dispatchEvent(new CustomEvent<SelectionBox>(CANVAS_SELECTION_PREVIEW_EVENT, { detail: selection }));
}

export function subscribeCanvasSelectionPreview(container: HTMLDivElement, listener: (selection: SelectionBox) => void) {
    const handlePreview = (event: Event) => listener((event as CustomEvent<SelectionBox>).detail);
    container.addEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
    return () => container.removeEventListener(CANVAS_SELECTION_PREVIEW_EVENT, handlePreview);
}
