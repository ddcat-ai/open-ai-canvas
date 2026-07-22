import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import { interpolateViewport } from "@/lib/canvas/canvas-viewport";
import type { ViewportTransform } from "@/types/canvas";

export function useCanvasViewportTransition(viewportRef: MutableRefObject<ViewportTransform>, onPreview: (viewport: ViewportTransform) => void, onCommit: (viewport: ViewportTransform) => void) {
    const frameRef = useRef<number | null>(null);

    const cancel = useCallback(() => {
        if (frameRef.current === null) return;
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
    }, []);

    useEffect(() => cancel, [cancel]);

    const transitionTo = useCallback(
        (target: ViewportTransform) => {
            cancel();
            const from = viewportRef.current;
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reducedMotion) {
                viewportRef.current = target;
                onPreview(target);
                onCommit(target);
                return;
            }

            const startedAt = performance.now();
            const duration = 220;
            // 新导航指令会取消上一段动画，避免快捷键、滚轮和双击争夺视口。
            const step = (now: number) => {
                const next = interpolateViewport(from, target, (now - startedAt) / duration);
                viewportRef.current = next;
                onPreview(next);
                if (now - startedAt >= duration) {
                    frameRef.current = null;
                    viewportRef.current = target;
                    onPreview(target);
                    onCommit(target);
                    return;
                }
                frameRef.current = requestAnimationFrame(step);
            };
            frameRef.current = requestAnimationFrame(step);
        },
        [cancel, onCommit, onPreview, viewportRef],
    );

    return { cancelViewportTransition: cancel, transitionViewportTo: transitionTo };
}
