import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getNodeResizeMinSize } from "@/lib/canvas/node-registry";
import { solveNodeResize } from "@/lib/canvas/node-resize-geometry";
import type { CanvasNodeData, Position } from "@/types/canvas";

export function imageWheelSize(node: CanvasNodeData, delta: number) {
    const minimum = getNodeResizeMinSize({ ...node, metadata: { ...node.metadata, freeResize: false } });
    const factor = Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.0015);
    const size = solveNodeResize(
        { position: node.position, width: node.width, height: node.height, minimumWidth: minimum.width, minimumHeight: minimum.height, ratio: node.width / node.height, corner: "bottom-right" },
        { x: node.width * (factor - 1), y: node.height * (factor - 1) },
    );
    return { ...size, position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 } };
}

export function useCanvasImageWheelResize({
    projectId,
    nodesRef,
    selectedNodeIdsRef,
    historyPausedRef,
    setNodes,
    onResize,
}: {
    projectId: string;
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    historyPausedRef: { current: boolean };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    onResize: (id: string, width: number, height: number, position?: Position) => void;
}) {
    const active = useRef(false);
    const pending = useRef<{ id: string; size: ReturnType<typeof imageWheelSize> } | null>(null);
    const frame = useRef<number | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flush = useCallback(() => {
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        const next = pending.current;
        pending.current = null;
        if (next) onResize(next.id, next.size.width, next.size.height, next.size.position);
    }, [onResize]);
    const finish = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        if (!active.current) return;
        flush();
        active.current = false;
        historyPausedRef.current = false;
        // Publish once after the pause so history and persistence observe the whole gesture.
        setNodes((current) => [...current]);
    }, [flush, historyPausedRef, setNodes]);
    useEffect(() => {
        const keyup = (event: KeyboardEvent) => {
            if (event.key === "Control") finish();
        };
        window.addEventListener("keyup", keyup, true);
        window.addEventListener("pointerdown", finish, true);
        window.addEventListener("blur", finish);
        return () => {
            window.removeEventListener("keyup", keyup, true);
            window.removeEventListener("pointerdown", finish, true);
            window.removeEventListener("blur", finish);
            if (timer.current) clearTimeout(timer.current);
            if (frame.current !== null) cancelAnimationFrame(frame.current);
            pending.current = null;
            frame.current = null;
            timer.current = null;
            if (active.current) historyPausedRef.current = false;
            active.current = false;
        };
    }, [finish, historyPausedRef, projectId]);
    return useCallback(
        (delta: number) => {
            if (!Number.isFinite(delta) || !delta || (historyPausedRef.current && !active.current) || selectedNodeIdsRef.current.size !== 1) return false;
            const id = selectedNodeIdsRef.current.values().next().value;
            const node = nodesRef.current.find((node) => node.id === id);
            if (!node || node.type !== "image" || node.metadata?.locked || node.metadata?.imageLayerGroup || node.metadata?.imageLayer || !(node.width > 0 && node.height > 0)) return false;
            active.current = true;
            historyPausedRef.current = true;
            const queued = pending.current;
            const current = queued && queued.id === id ? { ...node, ...queued.size } : node;
            pending.current = { id: node.id, size: imageWheelSize(current, delta) };
            if (frame.current === null) frame.current = requestAnimationFrame(flush);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(finish, 240);
            return true;
        },
        [finish, flush, historyPausedRef, nodesRef, selectedNodeIdsRef],
    );
}
