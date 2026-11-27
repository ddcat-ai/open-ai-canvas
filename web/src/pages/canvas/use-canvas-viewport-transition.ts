import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

import { interpolateViewport } from "@/lib/canvas/canvas-viewport";
import type { ViewportTransform } from "@/types/canvas";

export type CanvasViewportTransitionOptions = {
    /** 默认 220ms，供快捷键、双击等即时导航使用。 */
    duration?: number;
    /** 自定义插值；缺省为位置与缩放同步的 ease-out。 */
    interpolate?: (from: ViewportTransform, to: ViewportTransform, progress: number) => ViewportTransform;
    /** 动画结束（未被打断）后回调。 */
    onComplete?: () => void;
};

export function useCanvasViewportTransition(viewportRef: MutableRefObject<ViewportTransform>, onPreview: (viewport: ViewportTransform) => void, onCommit: (viewport: ViewportTransform) => void) {
    const frameRef = useRef<number | null>(null);

    const cancel = useCallback(() => {
        if (frameRef.current === null) return;
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
    }, []);

    useEffect(() => cancel, [cancel]);

    const transitionTo = useCallback(
        (target: ViewportTransform, options: CanvasViewportTransitionOptions = {}) => {
            cancel();
            const from = viewportRef.current;
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reducedMotion || (from.x === target.x && from.y === target.y && from.k === target.k)) {
                viewportRef.current = target;
                onPreview(target);
                onCommit(target);
                options.onComplete?.();
                return;
            }

            const startedAt = performance.now();
            const duration = options.duration ?? 220;
            const interpolate = options.interpolate ?? interpolateViewport;
            // 新导航指令会取消上一段动画，避免快捷键、滚轮和双击争夺视口。
            const step = (now: number) => {
                const next = interpolate(from, target, (now - startedAt) / duration);
                viewportRef.current = next;
                onPreview(next);
                if (now - startedAt >= duration) {
                    frameRef.current = null;
                    viewportRef.current = target;
                    onPreview(target);
                    onCommit(target);
                    options.onComplete?.();
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
