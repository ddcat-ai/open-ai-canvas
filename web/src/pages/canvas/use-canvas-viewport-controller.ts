import { useCallback, useEffect, useRef, type Dispatch, type MouseEvent, type SetStateAction } from "react";

import { isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { isHiddenBatchChild } from "@/lib/canvas/canvas-project-domain";
import { applyCanvasLiveViewport } from "@/lib/canvas/canvas-live-viewport";
import { getCanvasNodesBounds, viewportAtScale, viewportForBounds, type CanvasViewportSize } from "@/lib/canvas/canvas-viewport";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";
import { useCanvasViewportTransition } from "./use-canvas-viewport-transition";

type UseCanvasViewportControllerOptions = {
    containerRef: { current: HTMLDivElement | null };
    size: CanvasViewportSize;
    viewportRef: { current: ViewportTransform };
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
};

export function useCanvasViewportController({
    containerRef,
    size,
    viewportRef,
    nodesRef,
    selectedNodeIdsRef,
    setViewport,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
    setToolbarNodeId,
}: UseCanvasViewportControllerOptions) {
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const previewViewport = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        if (containerRef.current) containerRef.current.dataset.canvasViewportInteracting = "true";
        applyCanvasLiveViewport(containerRef.current, next);
    }, [containerRef, viewportRef]);

    const commitViewport = useCallback((next: ViewportTransform) => {
        if (commitTimerRef.current) {
            clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
        }
        viewportRef.current = next;
        delete containerRef.current?.dataset.canvasViewportInteracting;
        setViewport((current) => current.x === next.x && current.y === next.y && current.k === next.k ? current : next);
    }, [containerRef, setViewport, viewportRef]);

    useEffect(() => () => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        delete containerRef.current?.dataset.canvasViewportInteracting;
    }, [containerRef]);

    const { cancelViewportTransition, transitionViewportTo } = useCanvasViewportTransition(viewportRef, previewViewport, commitViewport);

    const screenToCanvas = useCallback((clientX: number, clientY: number): Position => {
        const rect = containerRef.current?.getBoundingClientRect();
        const viewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);
        return { x: (localX - viewport.x) / viewport.k, y: (localY - viewport.y) / viewport.k };
    }, [containerRef, viewportRef]);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [containerRef, screenToCanvas, size.height, size.width]);

    const focusNodesInView = useCallback((targetNodes: CanvasNodeData[], maxScale = 1) => {
        const bounds = getCanvasNodesBounds(targetNodes);
        if (!bounds) return false;
        transitionViewportTo(viewportForBounds(bounds, size, { padding: 88, maxScale }));
        setContextMenu(null);
        return true;
    }, [setContextMenu, size, transitionViewportTo]);

    const fitCanvasContent = useCallback(() => {
        const nodes = nodesRef.current;
        return focusNodesInView(nodes.filter((node) => !isHiddenBatchChild(node, nodes) && !isNodeHiddenByCollapsedFrame(node, nodes)));
    }, [focusNodesInView, nodesRef]);

    const fitCanvasSelection = useCallback(() => {
        const nodes = nodesRef.current;
        return focusNodesInView(nodes.filter((node) => selectedNodeIdsRef.current.has(node.id) && !isHiddenBatchChild(node, nodes) && !isNodeHiddenByCollapsedFrame(node, nodes)), 1.25);
    }, [focusNodesInView, nodesRef, selectedNodeIdsRef]);

    const handleCanvasDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        if (!fitCanvasSelection()) fitCanvasContent();
    }, [fitCanvasContent, fitCanvasSelection]);

    const selectFocusedNode = useCallback((nodeId: string) => {
        const selection = new Set([nodeId]);
        selectedNodeIdsRef.current = selection;
        setSelectedNodeIds(selection);
        setSelectedConnectionId(null);
        setContextMenu(null);
    }, [selectedNodeIdsRef, setContextMenu, setSelectedConnectionId, setSelectedNodeIds]);

    const focusCanvasImageNode = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId && item.type === CanvasNodeType.Image);
        if (!node) return;
        const scale = Math.min(1.25, Math.max(viewportRef.current.k, 0.78));
        transitionViewportTo({ x: size.width / 2 - (node.position.x + node.width / 2) * scale, y: size.height / 2 - (node.position.y + node.height / 2) * scale, k: scale });
        selectFocusedNode(node.id);
        setDialogNodeId(null);
        setToolbarNodeId(node.id);
    }, [nodesRef, selectFocusedNode, setDialogNodeId, setToolbarNodeId, size.height, size.width, transitionViewportTo, viewportRef]);

    const focusCanvasNode = useCallback((nodeId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node) return;
        const scale = Math.min(1.18, Math.max(viewportRef.current.k, 0.72));
        transitionViewportTo({ x: size.width / 2 - (node.position.x + node.width / 2) * scale, y: size.height / 2 - (node.position.y + node.height / 2) * scale, k: scale });
        selectFocusedNode(node.id);
        setDialogNodeId(node.id);
    }, [nodesRef, selectFocusedNode, setDialogNodeId, size.height, size.width, transitionViewportTo, viewportRef]);

    const resetViewport = useCallback(() => {
        transitionViewportTo({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [setContextMenu, size.height, size.width, transitionViewportTo]);

    const setZoomScale = useCallback((scale: number) => {
        cancelViewportTransition();
        const next = viewportAtScale(viewportRef.current, size, scale);
        previewViewport(next);
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(() => commitViewport(viewportRef.current), 120);
        setContextMenu(null);
    }, [cancelViewportTransition, commitViewport, previewViewport, setContextMenu, size, viewportRef]);

    const zoomToActualSize = useCallback(() => {
        transitionViewportTo(viewportAtScale(viewportRef.current, size, 1));
    }, [size, transitionViewportTo, viewportRef]);

    const handleViewportChange = useCallback((next: ViewportTransform) => {
        cancelViewportTransition();
        commitViewport(next);
        setContextMenu(null);
    }, [cancelViewportTransition, commitViewport, setContextMenu]);

    const handleViewportPreviewChange = useCallback((next: ViewportTransform) => {
        cancelViewportTransition();
        viewportRef.current = next;
    }, [cancelViewportTransition, viewportRef]);

    return {
        fitCanvasContent,
        fitCanvasSelection,
        focusCanvasImageNode,
        focusCanvasNode,
        getCanvasCenter,
        handleCanvasDoubleClick,
        handleViewportChange,
        handleViewportPreviewChange,
        previewViewport,
        resetViewport,
        screenToCanvas,
        setZoomScale,
        zoomToActualSize,
    };
}
