import { useCallback, useEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";

import { calculateNodeAlignment, createNodeAlignmentContext, isHiddenBatchChild, sameStringSet, type NodeAlignmentContext } from "@/lib/canvas/canvas-project-domain";
import { applyFrameDrop, findFrameDropTarget, getFrameChildIds, isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import type { CanvasNodeData, Position, SelectionBox, ViewportTransform } from "@/types/canvas";

type UseCanvasSelectionControllerOptions = {
    nodesRef: { current: CanvasNodeData[] };
    viewportRef: { current: ViewportTransform };
    selectedNodeIdsRef: { current: Set<string> };
    historyPausedRef: { current: boolean };
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    cancelPendingConnectionCreate: () => void;
    onCanvasSelectionStart: () => void;
    onNodeInteractionStart: (selectionModifier: boolean) => void;
    onNodeClick: (node: CanvasNodeData) => void;
    onDeselect: () => void;
};

type DragState = {
    isDraggingNode: boolean;
    hasMoved: boolean;
    openPanelOnClick: boolean;
    startX: number;
    startY: number;
    draggedNodeIds: string[];
    initialSelectedNodes: Array<{ id: string; x: number; y: number }>;
};

const EMPTY_DRAG_STATE: DragState = {
    isDraggingNode: false,
    hasMoved: false,
    openPanelOnClick: true,
    startX: 0,
    startY: 0,
    draggedNodeIds: [],
    initialSelectedNodes: [],
};

export function useCanvasSelectionController({
    nodesRef,
    viewportRef,
    selectedNodeIdsRef,
    historyPausedRef,
    screenToCanvas,
    setNodes,
    setSelectedNodeIds,
    setSelectedConnectionId,
    cancelPendingConnectionCreate,
    onCanvasSelectionStart,
    onNodeInteractionStart,
    onNodeClick,
    onDeselect,
}: UseCanvasSelectionControllerOptions) {
    const dragFrameRef = useRef<number | null>(null);
    const pendingNodeDragRef = useRef<Position>({ x: 0, y: 0 });
    const pendingAlignmentGuidesRef = useRef<{ vertical?: number; horizontal?: number }>({});
    const alignmentContextRef = useRef<NodeAlignmentContext | null>(null);
    const lastFrameDropCheckRef = useRef(0);
    const selectionFrameRef = useRef<number | null>(null);
    const selectionBoxElementRef = useRef<HTMLDivElement>(null);
    const selectionBoundsElementRef = useRef<HTMLDivElement>(null);
    const selectionCandidatesRef = useRef<Array<{ id: string; left: number; top: number; right: number; bottom: number }>>([]);
    const pendingSelectionPointRef = useRef<Position | null>(null);
    const selectionActivatedRef = useRef(false);
    const selectionBoxRef = useRef<SelectionBox | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<DragState>({ ...EMPTY_DRAG_STATE });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [frameDropTargetId, setFrameDropTargetId] = useState<string | null>(null);
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dragPreview, setDragPreview] = useState<{ x: number; y: number; nodeIds: Set<string> } | null>(null);
    const [alignmentGuides, setAlignmentGuides] = useState<{ vertical?: number; horizontal?: number }>({});

    const cancelSelectionBox = useCallback(() => {
        selectionBoxRef.current = null;
        selectionCandidatesRef.current = [];
        pendingSelectionPointRef.current = null;
        selectionActivatedRef.current = false;
        if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
        setSelectionBox(null);
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        cancelSelectionBox();
        const emptySelection = new Set<string>();
        selectedNodeIdsRef.current = emptySelection;
        setSelectedNodeIds(emptySelection);
        setSelectedConnectionId(null);
        onDeselect();
    }, [cancelPendingConnectionCreate, cancelSelectionBox, onDeselect, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const handleCanvasMouseDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        cancelPendingConnectionCreate();
        onCanvasSelectionStart();
        if (event.button !== 0) return;
        const world = screenToCanvas(event.clientX, event.clientY);
        const subtractive = event.altKey;
        const additive = !subtractive && (event.shiftKey || event.ctrlKey || event.metaKey);
        const nextSelectionBox: SelectionBox = {
            startWorldX: world.x,
            startWorldY: world.y,
            currentWorldX: world.x,
            currentWorldY: world.y,
            additive,
            subtractive,
            initialSelectedNodeIds: additive || subtractive ? Array.from(selectedNodeIdsRef.current) : [],
        };
        selectionBoxRef.current = nextSelectionBox;
        selectionActivatedRef.current = false;
        selectionCandidatesRef.current = nodesRef.current
            .filter((node) => !isHiddenBatchChild(node, nodesRef.current) && !isNodeHiddenByCollapsedFrame(node, nodesRef.current))
            .map((node) => ({ id: node.id, left: node.position.x, top: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height }));
        setSelectedConnectionId(null);
    }, [cancelPendingConnectionCreate, nodesRef, onCanvasSelectionStart, screenToCanvas, selectedNodeIdsRef, setSelectedConnectionId]);

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        setSelectedConnectionId(null);
        const currentNodes = nodesRef.current;
        const nextSelected = new Set(selectedNodeIdsRef.current);
        const isSubtractClick = event.altKey;
        const isMultiSelectClick = !isSubtractClick && (event.shiftKey || event.metaKey || event.ctrlKey);
        const isSelectionModifier = isSubtractClick || isMultiSelectClick;
        onNodeInteractionStart(isSelectionModifier);

        if (isSubtractClick) nextSelected.delete(nodeId);
        else if (isMultiSelectClick) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }

        selectedNodeIdsRef.current = nextSelected;
        setSelectedNodeIds(nextSelected);
        if (isSelectionModifier && !nextSelected.has(nodeId)) {
            dragRef.current = { ...EMPTY_DRAG_STATE, openPanelOnClick: false };
            return;
        }

        const clickedNode = currentNodes.find((node) => node.id === nodeId);
        if (clickedNode?.metadata?.locked) {
            dragRef.current = { ...EMPTY_DRAG_STATE };
            onNodeClick(clickedNode);
            return;
        }

        const draggedNodeIds = currentNodes.filter((node) => nextSelected.has(node.id) && !node.metadata?.locked && !(node.parentId && nextSelected.has(node.parentId))).map((node) => node.id);
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (nextSelected.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
            if (nextSelected.has(node.id) && isFrameNode(node)) getFrameChildIds(node.id, currentNodes).forEach((childId) => dragIds.add(childId));
        });
        currentNodes.forEach((node) => {
            if (dragIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
        });
        const initialSelectedNodes = currentNodes.filter((node) => dragIds.has(node.id) && !node.metadata?.locked).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));
        if (!initialSelectedNodes.length) return;

        dragRef.current = { isDraggingNode: true, hasMoved: false, openPanelOnClick: !isMultiSelectClick, startX: event.clientX, startY: event.clientY, draggedNodeIds, initialSelectedNodes };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        pendingNodeDragRef.current = { x: 0, y: 0 };
        alignmentContextRef.current = createNodeAlignmentContext(currentNodes, initialSelectedNodes);
        lastFrameDropCheckRef.current = 0;
        setIsNodeDragging(true);
        setAlignmentGuides({});
        setDragPreview({ x: 0, y: 0, nodeIds: new Set(initialSelectedNodes.map((item) => item.id)) });
    }, [historyPausedRef, nodesRef, onNodeClick, onNodeInteractionStart, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (dragFrameRef.current) {
            cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;
        const shouldOpenPanelOnClick = dragRef.current.openPanelOnClick;
        const wasClick = shouldOpenPanelOnClick && !dragRef.current.hasMoved && dragRef.current.draggedNodeIds.length === 1;
        const clickedNodeId = dragRef.current.draggedNodeIds[0];
        const currentViewport = viewportRef.current;
        const rawOffset = { x: clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k, y: clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k };
        const initialPositions = dragRef.current.initialSelectedNodes;
        const initialById = new Map(initialPositions.map((item) => [item.id, item]));
        const { x: dx, y: dy } = calculateNodeAlignment(alignmentContextRef.current, rawOffset, 7 / currentViewport.k).offset;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDragPreview(null);
        setAlignmentGuides({});
        if (dragRef.current.hasMoved) {
            const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
            setNodes((currentNodes) => {
                const positioned = clientX == null || clientY == null ? currentNodes : currentNodes.map((node) => {
                    const initial = initialById.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                return applyFrameDrop(positioned, draggedNodeIds, findFrameDropTarget(positioned, draggedNodeIds));
            });
        }
        setFrameDropTargetId(null);
        alignmentContextRef.current = null;
        dragRef.current = { ...EMPTY_DRAG_STATE };
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode) onNodeClick(clickedNode);
        }
    }, [historyPausedRef, nodesRef, onNodeClick, setNodes, viewportRef]);

    const handleMouseMove = useCallback((event: MouseEvent) => {
        if (!dragRef.current.isDraggingNode) return;
        const currentViewport = viewportRef.current;
        pendingNodeDragRef.current = { x: (event.clientX - dragRef.current.startX) / currentViewport.k, y: (event.clientY - dragRef.current.startY) / currentViewport.k };
        if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) dragRef.current.hasMoved = true;
        if (dragFrameRef.current) return;
        dragFrameRef.current = requestAnimationFrame(() => {
            const aligned = calculateNodeAlignment(alignmentContextRef.current, pendingNodeDragRef.current, 7 / viewportRef.current.k);
            const latest = aligned.offset;
            pendingAlignmentGuidesRef.current = aligned.guides;
            const initialById = new Map(dragRef.current.initialSelectedNodes.map((item) => [item.id, item]));
            const now = performance.now();
            if (now - lastFrameDropCheckRef.current >= 100) {
                lastFrameDropCheckRef.current = now;
                const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
                const positioned = nodesRef.current.map((node) => {
                    const initial = initialById.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + latest.x, y: initial.y + latest.y } } : node;
                });
                setFrameDropTargetId(findFrameDropTarget(positioned, draggedNodeIds));
            }
            setDragPreview((current) => current ? { ...current, x: latest.x, y: latest.y } : current);
            const nextGuides = dragRef.current.hasMoved ? pendingAlignmentGuidesRef.current : {};
            setAlignmentGuides((current) => current.vertical === nextGuides.vertical && current.horizontal === nextGuides.horizontal ? current : nextGuides);
            dragFrameRef.current = null;
        });
    }, [nodesRef, viewportRef]);

    const handlePointerMove = useCallback((event: PointerEvent) => {
        const currentSelection = selectionBoxRef.current;
        if (!currentSelection) return;
        if (event.buttons === 0) {
            cancelSelectionBox();
            return;
        }
        pendingSelectionPointRef.current = screenToCanvas(event.clientX, event.clientY);
        if (selectionFrameRef.current) return;
        selectionFrameRef.current = requestAnimationFrame(() => {
            selectionFrameRef.current = null;
            let selection = selectionBoxRef.current;
            const world = pendingSelectionPointRef.current;
            if (!selection || !world) return;
            if (!selectionActivatedRef.current) {
                const threshold = 4 / viewportRef.current.k;
                if (Math.hypot(world.x - selection.startWorldX, world.y - selection.startWorldY) < threshold) return;
                selectionActivatedRef.current = true;
                selection = { ...selection, currentWorldX: world.x, currentWorldY: world.y };
                selectionBoxRef.current = selection;
                setSelectionBox(selection);
                if (!selection.additive) {
                    const emptySelection = new Set<string>();
                    selectedNodeIdsRef.current = emptySelection;
                    setSelectedNodeIds(emptySelection);
                }
            }
            const rectX = Math.min(selection.startWorldX, world.x);
            const rectY = Math.min(selection.startWorldY, world.y);
            const rectW = Math.abs(world.x - selection.startWorldX);
            const rectH = Math.abs(world.y - selection.startWorldY);
            const element = selectionBoxElementRef.current;
            if (element) {
                element.style.setProperty("--selection-x", `${rectX}px`);
                element.style.setProperty("--selection-y", `${rectY}px`);
                element.style.setProperty("--selection-width", `${rectW}px`);
                element.style.setProperty("--selection-height", `${rectH}px`);
            }
            const nextSelected = new Set<string>(selection.additive || selection.subtractive ? selection.initialSelectedNodeIds : []);
            selectionCandidatesRef.current.forEach((node) => {
                if (rectX >= node.right || rectX + rectW <= node.left || rectY >= node.bottom || rectY + rectH <= node.top) return;
                if (selection.subtractive) nextSelected.delete(node.id);
                else nextSelected.add(node.id);
            });
            if (sameStringSet(nextSelected, selectedNodeIdsRef.current)) return;
            selectedNodeIdsRef.current = nextSelected;
            setSelectedNodeIds(nextSelected);
        });
    }, [cancelSelectionBox, screenToCanvas, selectedNodeIdsRef, setSelectedNodeIds, viewportRef]);

    const finishSelection = useCallback(() => {
        const hadPendingSelection = Boolean(selectionBoxRef.current);
        const wasSelection = selectionActivatedRef.current;
        cancelSelectionBox();
        if (hadPendingSelection && !wasSelection) deselectCanvas();
    }, [cancelSelectionBox, deselectCanvas]);

    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishSelection();
        };
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancel = () => finishNodeDrag();
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        return () => {
            if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
            if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("blur", cancel);
        };
    }, [finishNodeDrag, finishSelection, handleMouseMove, handlePointerMove]);

    return {
        alignmentGuides,
        cancelSelectionBox,
        deselectCanvas,
        dragPreview,
        frameDropTargetId,
        handleCanvasMouseDown,
        handleNodeMouseDown,
        isNodeDragging,
        nodeDraggingRef,
        selectionBoundsElementRef,
        selectionBox,
        selectionBoxElementRef,
    };
}
