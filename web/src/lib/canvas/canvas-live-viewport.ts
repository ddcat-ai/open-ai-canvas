import type { SelectionBox, ViewportTransform } from "@/types/canvas";

export const CANVAS_VIEWPORT_PREVIEW_EVENT = "canvas:viewport-preview";
export const CANVAS_GRAPHICS_VIEWPORT_PREVIEW_EVENT = "canvas:graphics-viewport-preview";
export const CANVAS_SELECTION_PREVIEW_EVENT = "canvas:selection-preview";
export const CANVAS_NODE_DRAG_PREVIEW_EVENT = "canvas:node-drag-preview";
const CANVAS_INTERACTION_CHANGE_EVENT = "canvas:interaction-change";

export function setCanvasGestureActive(container: HTMLDivElement | null, attribute: "canvasNodeDragging" | "canvasViewportInteracting", active: boolean) {
    if (!container || (container.dataset[attribute] === "true") === active) return;
    if (active) container.dataset[attribute] = "true";
    else delete container.dataset[attribute];
    container.ownerDocument.dispatchEvent(new Event(CANVAS_INTERACTION_CHANGE_EVENT));
}

export function observeCanvasGestureActive(doc: Document, listener: (active: boolean) => void) {
    const update = () => listener(Boolean(doc.querySelector('[data-canvas-viewport-interacting="true"],[data-canvas-node-dragging="true"]')));
    doc.addEventListener(CANVAS_INTERACTION_CHANGE_EVENT, update);
    update();
    return () => doc.removeEventListener(CANVAS_INTERACTION_CHANGE_EVENT, update);
}

export type CanvasNodeDragPreview = {
    x: number;
    y: number;
    nodeIds: ReadonlySet<string>;
    guides?: { vertical?: number; horizontal?: number };
};

type NodeDragPreviewDomState = {
    elementsById: Map<string, HTMLElement>;
    previousIds: Set<string>;
    selectionBounds: HTMLElement | null;
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

/** 网格层向左上多铺的像素，需大于最大网格间距，保证平移取模后仍覆盖视口。 */
export const CANVAS_GRID_BLEED = 64;

/**
 * 网格跟随视口平移与缩放：间距随 k 缩放，并在 [base*2/3, base*4/3) 内按 2 倍折叠，
 * 保持屏幕密度稳定。平移只改 transform（合成层），缩放才改 background-size。
 */
export function canvasGridMetrics(viewport: ViewportTransform, base: number) {
    let spacing = base * viewport.k;
    if (!Number.isFinite(spacing) || spacing <= 0) spacing = base;
    while (spacing < (base * 2) / 3) spacing *= 2;
    while (spacing >= (base * 4) / 3) spacing /= 2;
    const wrap = (value: number) => ((value % spacing) + spacing) % spacing;
    return { spacing, offsetX: wrap(viewport.x + CANVAS_GRID_BLEED), offsetY: wrap(viewport.y + CANVAS_GRID_BLEED) };
}

function applyCanvasGridViewport(gridLayer: HTMLElement, viewport: ViewportTransform) {
    const base = Number(gridLayer.dataset.canvasGridBase) || 24;
    const { spacing, offsetX, offsetY } = canvasGridMetrics(viewport, base);
    const size = `${spacing}px ${spacing}px`;
    if (gridLayer.style.backgroundSize !== size) gridLayer.style.backgroundSize = size;
    gridLayer.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
}

export function applyCanvasLiveViewport(container: HTMLDivElement | null, viewport: ViewportTransform, notify = true) {
    if (!container) return;
    const committedScale = Number(container.style.getPropertyValue("--canvas-committed-scale")) || viewport.k;
    let elements = liveViewportElements.get(container);
    if (!elements) {
        elements = { worldLayer: null, gridLayer: null };
        liveViewportElements.set(container, elements);
    }
    if (!elements.worldLayer?.isConnected) elements.worldLayer = container.querySelector<HTMLElement>("[data-canvas-world-layer]");
    // 网格层会随“点/线/空白”切换挂载与卸载，失联后重新查找。
    if (!elements.gridLayer?.isConnected) elements.gridLayer = container.querySelector<HTMLElement>("[data-canvas-grid-layer]");
    const worldLayer = elements.worldLayer;
    if (worldLayer) {
        // 平移期间直接更新合成层，避免修改容器继承变量导致所有节点重新计算样式。
        worldLayer.style.transformOrigin = "0 0";
        worldLayer.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k / committedScale})`;
        const willChange = container.dataset.canvasViewportInteracting === "true" ? "transform" : "";
        if (worldLayer.style.willChange !== willChange) worldLayer.style.willChange = willChange;
    }
    if (elements.gridLayer) applyCanvasGridViewport(elements.gridLayer, viewport);
    // 交互期不要修改根容器上的继承变量。它们会让整棵节点 DOM 子树失效并
    // 触发样式重算；交互结束后由 CanvasViewport 的 committed render 一次性校正。
    // 标题和选框在交互期暂时跟随世界层缩放，换取连续帧的合成路径。
    if (container.dataset.canvasViewportInteracting !== "true") {
        container.style.setProperty("--canvas-live-scale", String(viewport.k));
        container.style.setProperty("--canvas-live-inverse-scale", String(1 / Math.max(viewport.k, 0.05)));
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

/**
 * Applies transient node movement without changing React state. Only nodes
 * currently mounted in the virtualized world are touched; the committed
 * positions are still written by the drag-end path.
 */
export function applyCanvasNodeDragPreview(container: HTMLDivElement | null, preview: CanvasNodeDragPreview | null, selectionBounds: HTMLElement | null = null) {
    if (!container) return;
    setCanvasGestureActive(container, "canvasNodeDragging", Boolean(preview));

    let state = nodeDragPreviewDomStates.get(container);
    if (!state) {
        state = { elementsById: new Map(), previousIds: new Set(), selectionBounds: null };
        nodeDragPreviewDomStates.set(container, state);
    }

    for (const nodeId of state.previousIds) {
        if (!preview?.nodeIds.has(nodeId)) state.elementsById.get(nodeId)?.style.removeProperty("translate");
    }
    if (state.selectionBounds !== selectionBounds) state.selectionBounds?.style.removeProperty("translate");
    state.selectionBounds = selectionBounds;

    state.previousIds.clear();
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
            state.previousIds.add(nodeId);
        }
        state.selectionBounds?.style.setProperty("translate", `${preview.x}px ${preview.y}px`);
    } else {
        state.elementsById.clear();
        state.selectionBounds = null;
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
