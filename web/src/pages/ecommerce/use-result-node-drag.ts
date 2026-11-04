import { useEffect, useLayoutEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { COMMERCE_SNAP_THRESHOLD, measureCommerceSnapScene, paintCommerceSnapGuides, snapCommerceMove, type SnapGuide, type SnapScene } from "./canvas-snap";

export type ResultPosition = { id: string; x: number; y: number };
type DragNode = ResultPosition & { element: HTMLElement };
type Gesture = { pointerId: number; target: HTMLElement; startX: number; startY: number; scale: number; dx: number; dy: number; moved: boolean; nodes: DragNode[]; snap: SnapScene | null; guides: SnapGuide[] };

/** Preview directly on the nodes; commit one undoable edit when the pointer is released. */
export function useResultNodeDrag({
    content,
    root,
    enabled,
    positions,
    selected,
    onSelect,
    onDragStart,
    onCommit,
}: {
    content: RefObject<HTMLDivElement | null>;
    root: RefObject<HTMLElement | null>;
    enabled: boolean;
    positions: ResultPosition[];
    selected: Set<string>;
    onSelect?: (ids: string[]) => void;
    onDragStart?: () => void;
    onCommit: (positions: ResultPosition[]) => void;
}) {
    const gesture = useRef<Gesture | null>(null);
    const frame = useRef<number | null>(null);
    const suppressClick = useRef(false);
    const spacePressed = useRef(false);
    const groupOutline = () => root.current?.querySelector<HTMLElement>(".commerce-canvas-group-outline");
    const paint = (state: Gesture, restore = false) => {
        for (const node of state.nodes) {
            node.element.style.translate = `${node.x + (restore ? 0 : state.dx)}px ${node.y + (restore ? 0 : state.dy)}px`;
            node.element.toggleAttribute("data-node-dragging", !restore && state.moved);
        }
        const outline = groupOutline();
        if (outline) outline.style.translate = restore ? "" : `${state.dx * state.scale}px ${state.dy * state.scale}px`;
        paintCommerceSnapGuides(content.current?.querySelector<HTMLElement>(".commerce-snap-guides"), restore ? [] : state.guides, state.scale);
    };
    /** 指针位移换算成世界坐标后吸附到其他元素；按住 Ctrl/⌘ 时自由移动。 */
    const resolve = (state: Gesture, clientX: number, clientY: number, free: boolean) => {
        const dx = (clientX - state.startX) / state.scale;
        const dy = (clientY - state.startY) / state.scale;
        if (free || !state.snap?.moving) return { dx, dy, guides: [] };
        return snapCommerceMove(state.snap.moving, dx, dy, state.snap.targets, COMMERCE_SNAP_THRESHOLD / state.scale);
    };
    useLayoutEffect(() => {
        if (gesture.current?.moved) return;
        const saved = new Map(positions.map((item) => [item.id, item]));
        content.current?.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]").forEach((node) => {
            const point = saved.get(node.dataset.ecommerceImageId!);
            node.style.translate = point ? `${point.x}px ${point.y}px` : "";
        });
    });
    useEffect(() => {
        const cancel = () => {
            const state = gesture.current;
            if (!state) return;
            gesture.current = null;
            if (frame.current !== null) {
                cancelAnimationFrame(frame.current);
                frame.current = null;
            }
            paint(state, true);
            root.current?.removeAttribute("data-result-dragging");
            suppressClick.current = state.moved;
            if (state.target.hasPointerCapture(state.pointerId)) state.target.releasePointerCapture(state.pointerId);
        };
        const key = (event: KeyboardEvent) => {
            if (event.code === "Space" && !(event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]"))) spacePressed.current = event.type === "keydown";
            if (event.key === "Escape" && event.type === "keydown") cancel();
        };
        const blur = () => {
            spacePressed.current = false;
            cancel();
        };
        window.addEventListener("keydown", key, true);
        window.addEventListener("keyup", key, true);
        window.addEventListener("blur", blur);
        return () => {
            window.removeEventListener("keydown", key, true);
            window.removeEventListener("keyup", key, true);
            window.removeEventListener("blur", blur);
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            root.current?.removeAttribute("data-result-dragging");
        };
    }, []);
    const start = (event: PointerEvent<HTMLDivElement>) => {
        suppressClick.current = false;
        if (!enabled || event.button !== 0 || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || spacePressed.current || gesture.current) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const node = target?.closest<HTMLElement>("[data-ecommerce-image-id]");
        if (!target || !node || target.closest("[data-canvas-no-zoom],.commerce-selection-handle,.commerce-selection-rotate,input,textarea,[contenteditable=true]") || (target.closest("button") && !target.closest(".ecommerce-result-open"))) return;
        const id = node.dataset.ecommerceImageId!;
        const ids = selected.has(id) ? selected : new Set([id]);
        const saved = new Map(positions.map((item) => [item.id, item]));
        const nodes = Array.from(content.current!.querySelectorAll<HTMLElement>("[data-ecommerce-image-id]"))
            .filter((item) => ids.has(item.dataset.ecommerceImageId!))
            .map((element) => ({ element, id: element.dataset.ecommerceImageId!, x: saved.get(element.dataset.ecommerceImageId!)?.x || 0, y: saved.get(element.dataset.ecommerceImageId!)?.y || 0 }));
        const scale = content.current!.getBoundingClientRect().width / content.current!.offsetWidth || 1;
        // Keep capture on the original control so a stationary click still selects the image.
        const capture = target.closest<HTMLElement>(".ecommerce-result-open") || node;
        capture.setPointerCapture(event.pointerId);
        gesture.current = { pointerId: event.pointerId, target: capture, startX: event.clientX, startY: event.clientY, scale, dx: 0, dy: 0, moved: false, nodes, snap: null, guides: [] };
        event.stopPropagation();
    };
    const move = (event: PointerEvent<HTMLDivElement>) => {
        const state = gesture.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (!state.moved && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < 4) return;
        event.preventDefault();
        event.stopPropagation();
        if (!state.moved) {
            state.moved = true;
            root.current?.setAttribute("data-result-dragging", "true");
            onDragStart?.();
            // 真正开始拖动时才测量其他元素的位置（单击不产生额外布局读取）。
            if (content.current)
                state.snap = measureCommerceSnapScene(
                    content.current,
                    state.nodes.map((node) => node.element),
                    state.scale,
                );
            root.current?.focus({ preventScroll: true });
            onSelect?.(state.nodes.map((node) => node.id));
        }
        const next = resolve(state, event.clientX, event.clientY, event.ctrlKey || event.metaKey);
        state.dx = next.dx;
        state.dy = next.dy;
        state.guides = next.guides;
        if (frame.current === null)
            frame.current = requestAnimationFrame(() => {
                frame.current = null;
                if (gesture.current) paint(gesture.current);
            });
    };
    const end = (event: PointerEvent<HTMLDivElement>) => {
        const state = gesture.current;
        if (!state || state.pointerId !== event.pointerId) return;
        if (frame.current !== null) {
            cancelAnimationFrame(frame.current);
            frame.current = null;
        }
        gesture.current = null;
        const cancelled = event.type === "pointercancel" || event.type === "lostpointercapture";
        if (cancelled || !state.moved) paint(state, true);
        else {
            const final = resolve(state, event.clientX, event.clientY, event.ctrlKey || event.metaKey);
            state.dx = final.dx;
            state.dy = final.dy;
            state.guides = [];
            paint(state);
            for (const node of state.nodes) node.element.removeAttribute("data-node-dragging");
        }
        root.current?.removeAttribute("data-result-dragging");
        suppressClick.current = state.moved;
        if (state.moved && !cancelled) {
            // The final pointerup can arrive before the next animation frame or pointermove.
            const { dx, dy } = resolve(state, event.clientX, event.clientY, event.ctrlKey || event.metaKey);
            onCommit(state.nodes.map(({ id, x, y }) => ({ id, x: x + dx, y: y + dy })));
        }
        if (state.target.hasPointerCapture(event.pointerId)) state.target.releasePointerCapture(event.pointerId);
    };
    return {
        onPointerDown: start,
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: end,
        onLostPointerCapture: end,
        onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
            if (suppressClick.current) {
                event.preventDefault();
                event.stopPropagation();
                suppressClick.current = false;
            }
        },
        onDragStartCapture: (event: DragEvent<HTMLDivElement>) => {
            if (gesture.current) event.preventDefault();
        },
    };
}
