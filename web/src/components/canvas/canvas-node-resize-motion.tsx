import { animate } from "motion";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { createCanvasNodeResizeMotion, type CanvasNodeResizeMotion } from "@/lib/canvas/canvas-node-resize-motion";
import type { CanvasNodeData, Position } from "@/types/canvas";

// 比例过渡沿用 BeUI AspectRatio 的弹簧手感，直接插值几何以保留画布坐标与媒体比例。
const RESIZE_SPRING = { type: "spring", stiffness: 360, damping: 32, mass: 0.6, restDelta: 0.0005, restSpeed: 0.005 } as const;
const ResizeMotionContext = createContext<CanvasNodeResizeMotion | null>(null);

export function CanvasNodeResizeMotionProvider({ nodes, children }: { nodes: CanvasNodeData[]; children: ReactNode }) {
    const [enabled, setEnabled] = useState(() => typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && !motionDisabled());
    const [motion] = useState(() =>
        createCanvasNodeResizeMotion((onUpdate, onComplete) => {
            const animation = animate(0, 1, { ...RESIZE_SPRING, onUpdate, onComplete });
            return () => animation.stop();
        }),
    );

    useLayoutEffect(() => {
        motion.sync(nodes, enabled);
    }, [motion, nodes, enabled]);

    useLayoutEffect(() => {
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        const updatePreference = () => setEnabled(!preference.matches && !motionDisabled());
        updatePreference();
        preference.addEventListener("change", updatePreference);
        const observer = new MutationObserver(updatePreference);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        const onVisibilityChange = () => {
            if (document.hidden) motion.finishAll();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            observer.disconnect();
            preference.removeEventListener("change", updatePreference);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            motion.reset();
        };
    }, [motion]);

    return <ResizeMotionContext value={motion}>{children}</ResizeMotionContext>;
}

export function useCanvasNodeResizeMotion() {
    return useContext(ResizeMotionContext);
}

/** 节点只更新 DOM 几何，不逐帧重渲染媒体、编辑器或整张画布。 */
export function useCanvasNodeResizeStyle(ref: RefObject<HTMLDivElement | null>, node: CanvasNodeData, dragOffset?: Position) {
    const motion = useCanvasNodeResizeMotion();
    useLayoutEffect(() => {
        if (!motion) return;
        const update = () => {
            const element = ref.current;
            if (!element) return;
            const visual = motion.resolveNode(node);
            element.style.transform = `translate(${visual.position.x + (dragOffset?.x || 0)}px, ${visual.position.y + (dragOffset?.y || 0)}px)`;
            element.style.width = `${visual.width}px`;
            element.style.height = `${visual.height}px`;
        };
        update();
        return motion.subscribeNode(node.id, update);
    }, [motion, node, ref, dragOffset]);
    return motion;
}

/** SVG 命中路径订阅端点；仅受影响的连线参与重渲染。 */
export function useCanvasVisualNode(node: CanvasNodeData) {
    const motion = useCanvasNodeResizeMotion();
    const subscribe = useCallback((listener: () => void) => motion?.subscribeNode(node.id, listener) || (() => {}), [motion, node.id]);
    const snapshot = useCallback(() => motion?.getGeometry(node.id), [motion, node.id]);
    const geometry = useSyncExternalStore(subscribe, snapshot, () => undefined);
    return useMemo(() => (geometry ? { ...node, ...geometry } : node), [node, geometry]);
}

function motionDisabled() {
    return typeof document !== "undefined" && Boolean(document.documentElement.classList.contains("no-motion") || document.body?.classList.contains("no-motion"));
}
