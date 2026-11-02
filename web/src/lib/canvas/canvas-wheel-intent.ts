export const CANVAS_WHEEL_HOVER_MS = 160;
export const CANVAS_WHEEL_GESTURE_IDLE_MS = 180;
const CANVAS_WHEEL_POINTER_SLOP = 6;

export const CANVAS_WHEEL_INTENT_SELECTOR = "[data-canvas-wheel-intent]";
export const CANVAS_WHEEL_POPUP_SELECTOR = ".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,[role='dialog'],[role='menu'],[role='listbox'],[data-canvas-resource-mention-menu]";
const CANVAS_EDITOR_ZOOM_SCOPE_SELECTOR = "[data-canvas-viewport],[data-canvas-node-panel],.canvas-prompt-editor-modal";

type WheelPoint = { clientX: number; clientY: number };

/** A settled hover can claim the next gesture, never the tail of a canvas pan. */
export function createCanvasWheelIntent<T>() {
    let hovered: T | null = null;
    let settledAt = 0;
    let anchorX = 0;
    let anchorY = 0;
    let lastWheelAt = -Infinity;
    let scrollOwner: T | null = null;
    let gestureActive = false;

    const move = (target: T | null, point: WheelPoint, now: number) => {
        if (target !== hovered || Math.hypot(point.clientX - anchorX, point.clientY - anchorY) > CANVAS_WHEEL_POINTER_SLOP) {
            hovered = target;
            settledAt = now;
            anchorX = point.clientX;
            anchorY = point.clientY;
        }
    };

    return {
        move,
        resolve(target: T | null, point: WheelPoint, now: number, forceCanvas = false): "canvas" | "scroll" {
            move(target, point, now);
            if (forceCanvas) {
                scrollOwner = null;
                gestureActive = true;
            } else if (!gestureActive || now - lastWheelAt >= CANVAS_WHEEL_GESTURE_IDLE_MS) {
                scrollOwner = target && now - settledAt >= CANVAS_WHEEL_HOVER_MS ? target : null;
                gestureActive = true;
            } else if (scrollOwner !== target) {
                scrollOwner = null;
            }
            lastWheelAt = now;
            return scrollOwner ? "scroll" : "canvas";
        },
        reset() {
            hovered = null;
            scrollOwner = null;
            lastWheelAt = -Infinity;
            gestureActive = false;
        },
    };
}

export function canvasWheelIntentTarget(target: Element | null) {
    if (target?.closest(CANVAS_WHEEL_POPUP_SELECTOR) || target?.closest("input,select")) return null;
    return target?.closest(CANVAS_WHEEL_INTENT_SELECTOR) ?? null;
}

/** Node panels are siblings of the viewport; unrelated page controls stay outside. */
export function canvasWheelBelongsToViewport(target: Element | null, viewport: HTMLElement) {
    if (!target) return false;
    if (viewport.contains(target)) return true;
    const panel = target.closest("[data-canvas-node-panel]");
    let host = panel?.parentElement;
    while (host) {
        const viewports = host.querySelectorAll("[data-canvas-viewport]");
        if (viewports.length) return viewports.length === 1 && viewports[0] === viewport;
        host = host.parentElement;
    }
    return false;
}

/** Portalled prompt editors also need a non-passive guard against page zoom. */
export function observeCanvasEditorWheelZoom(container: HTMLElement) {
    const guard = (event: WheelEvent) => {
        if ((event.ctrlKey || event.metaKey) && container.closest(CANVAS_EDITOR_ZOOM_SCOPE_SELECTOR)) event.preventDefault();
    };
    container.addEventListener("wheel", guard, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", guard, true);
}
