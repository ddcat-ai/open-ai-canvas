import { useEffect, useRef, type RefObject } from "react";

import type { ViewportTransform } from "@/types/canvas";

const FOLLOW_PER_FRAME = 0.3;
const REFERENCE_FRAME_MS = 1000 / 60;
const SETTLE_EPSILON_PX = 0.4;
const MAX_FRAME_MS = 64;

type UseCanvasMinimapPanOptions = {
    enabled: boolean;
    minimapRef: RefObject<HTMLDivElement | null>;
    viewportRef: { current: ViewportTransform };
    getMoveScale: () => number;
    onPreview: (viewport: ViewportTransform) => void;
    onSettled: (viewport: ViewportTransform) => void;
    onPanStart?: () => void;
    onPanEnd?: (pointerInsideMinimap: boolean) => void;
};

export function useCanvasMinimapPan({ enabled, minimapRef, viewportRef, getMoveScale, onPreview, onSettled, onPanStart, onPanEnd }: UseCanvasMinimapPanOptions) {
    const callbacks = useRef({ getMoveScale, onPreview, onSettled, onPanStart, onPanEnd });
    callbacks.current = { getMoveScale, onPreview, onSettled, onPanStart, onPanEnd };

    useEffect(() => {
        if (!enabled) return;
        const minimap = minimapRef.current;
        if (!minimap) return;
        const minimapEl = minimap;

        let pointerId: number | null = null;
        let startClientX = 0;
        let startClientY = 0;
        let startViewportX = 0;
        let startViewportY = 0;
        let moveScale = 1;
        let targetX = viewportRef.current.x;
        let targetY = viewportRef.current.y;
        let rafId = 0;
        let lastFrameTime = 0;
        let pendingEndInside: boolean | null = null;

        const stopLoop = () => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
            lastFrameTime = 0;
        };
        const flushEnd = () => {
            if (pendingEndInside === null) return;
            const inside = pendingEndInside;
            pendingEndInside = null;
            callbacks.current.onPanEnd?.(inside);
        };
        const step = (now: number) => {
            const current = viewportRef.current;
            const deltaMs = lastFrameTime ? Math.min(MAX_FRAME_MS, now - lastFrameTime) : REFERENCE_FRAME_MS;
            lastFrameTime = now;
            const t = 1 - Math.pow(1 - FOLLOW_PER_FRAME, deltaMs / REFERENCE_FRAME_MS);
            let nextX = current.x + (targetX - current.x) * t;
            let nextY = current.y + (targetY - current.y) * t;
            const settled = Math.abs(targetX - nextX) < SETTLE_EPSILON_PX && Math.abs(targetY - nextY) < SETTLE_EPSILON_PX;
            if (settled) {
                nextX = targetX;
                nextY = targetY;
            }
            if (current.x !== nextX || current.y !== nextY) callbacks.current.onPreview({ x: nextX, y: nextY, k: current.k });
            if (settled) {
                stopLoop();
                const finalViewport = { x: nextX, y: nextY, k: current.k };
                callbacks.current.onSettled(finalViewport);
                flushEnd();
                return;
            }
            rafId = requestAnimationFrame(step);
        };
        const startLoop = () => {
            if (!rafId) {
                lastFrameTime = 0;
                rafId = requestAnimationFrame(step);
            }
        };
        const handlePointerMove = (event: PointerEvent) => {
            if (pointerId !== event.pointerId) return;
            targetX = startViewportX - (event.clientX - startClientX) * moveScale;
            targetY = startViewportY - (event.clientY - startClientY) * moveScale;
            if (Math.abs(event.clientX - startClientX) > 3 || Math.abs(event.clientY - startClientY) > 3) {
                minimapEl.dataset.canvasMinimapDidPan = "true";
            }
            startLoop();
            event.preventDefault();
        };
        const detachWindowListeners = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", endPan);
            window.removeEventListener("pointercancel", endPan);
        };
        function endPan(event: PointerEvent) {
            if (pointerId !== event.pointerId) return;
            const activePointerId = pointerId;
            pointerId = null;
            detachWindowListeners();
            if (minimapEl.hasPointerCapture?.(activePointerId)) minimapEl.releasePointerCapture(activePointerId);
            const rect = minimapEl.getBoundingClientRect();
            pendingEndInside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
            startLoop();
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || pointerId !== null) return;
            pendingEndInside = null;
            delete minimapEl.dataset.canvasMinimapDidPan;
            const viewport = viewportRef.current;
            moveScale = Math.max(0.01, callbacks.current.getMoveScale()) * viewport.k;
            pointerId = event.pointerId;
            startClientX = event.clientX;
            startClientY = event.clientY;
            startViewportX = viewport.x;
            startViewportY = viewport.y;
            targetX = viewport.x;
            targetY = viewport.y;
            minimapEl.setPointerCapture?.(event.pointerId);
            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", endPan);
            window.addEventListener("pointercancel", endPan);
            callbacks.current.onPanStart?.();
            event.stopPropagation();
        };

        minimapEl.addEventListener("pointerdown", handlePointerDown);
        return () => {
            minimapEl.removeEventListener("pointerdown", handlePointerDown);
            detachWindowListeners();
            stopLoop();
            if (pointerId !== null) {
                if (minimapEl.hasPointerCapture?.(pointerId)) minimapEl.releasePointerCapture(pointerId);
                pointerId = null;
                pendingEndInside = false;
            }
            flushEnd();
        };
    }, [enabled, minimapRef, viewportRef]);
}
