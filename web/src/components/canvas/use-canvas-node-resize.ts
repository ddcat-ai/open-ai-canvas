import { useEffect, useRef, type PointerEvent } from "react";
import type { CanvasNodeData, Position } from "@/types/canvas";
import { getNodeMinSize, shouldKeepAspectRatio } from "@/lib/canvas/node-registry";
import { solveNodeResize, type NodeResizeCorner } from "@/lib/canvas/node-resize-geometry";

type ResizeCallback = (id: string, width: number, height: number, position?: Position) => void;

export function useCanvasNodeResize(node: CanvasNodeData, scale: number, minimumHeight: number | null, onResize: ResizeCallback, readOnly = false) {
    const dispose = useRef<(() => void) | null>(null);
    const latest = useRef(onResize);
    latest.current = onResize;
    const disabled = readOnly || Boolean(node.metadata?.locked);
    useEffect(() => {
        if (disabled) dispose.current?.();
        return () => dispose.current?.();
    }, [node.id, disabled]);

    return (event: PointerEvent<HTMLElement>, corner: NodeResizeCorner) => {
        event.stopPropagation();
        if (disabled || dispose.current || event.button !== 0 || !(scale > 0) || !Number.isFinite(scale)) return;
        event.preventDefault();
        const target: HTMLElement = event.currentTarget;
        const pointer = event.pointerId;
        const origin = { x: event.clientX, y: event.clientY };
        let previous = origin;
        const minimum = getNodeMinSize(node.type);
        const snapshot = {
            position: { ...node.position },
            width: node.width,
            height: node.height,
            corner,
            minimumWidth: minimum.width,
            minimumHeight: minimumHeight ?? minimum.height,
            ratio: shouldKeepAspectRatio(node) ? (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1) : undefined,
        };
        const listeners = new AbortController();
        const stop = () => {
            listeners.abort();
            if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
            dispose.current = null;
        };
        const move = (next: globalThis.PointerEvent) => {
            if (next.pointerId !== pointer || (previous.x === next.clientX && previous.y === next.clientY)) return;
            previous = { x: next.clientX, y: next.clientY };
            const size = solveNodeResize(snapshot, { x: (next.clientX - origin.x) / scale, y: (next.clientY - origin.y) / scale });
            latest.current(node.id, size.width, size.height, size.position);
        };
        target.setPointerCapture(pointer);
        target.addEventListener("pointermove", move, { signal: listeners.signal });
        target.addEventListener(
            "pointerup",
            (next) => {
                if (next.pointerId !== pointer) return;
                try {
                    move(next);
                } finally {
                    stop();
                }
            },
            { signal: listeners.signal },
        );
        target.addEventListener(
            "pointercancel",
            (next) => {
                if (next.pointerId === pointer) stop();
            },
            { signal: listeners.signal },
        );
        target.addEventListener(
            "lostpointercapture",
            (next) => {
                if (next.pointerId === pointer) stop();
            },
            { signal: listeners.signal },
        );
        window.addEventListener("blur", stop, { signal: listeners.signal });
        dispose.current = stop;
    };
}
