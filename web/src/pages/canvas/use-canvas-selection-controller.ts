import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";

import { applyCanvasAlignmentGuidesPreview, applyCanvasNodeDragPreview, applyCanvasNodeSelectionPreview, applyCanvasSelectionPreview, type CanvasNodeDragPreview } from "@/lib/canvas/canvas-live-viewport";
import { calculateNodeAlignment, createNodeAlignmentContext, sameStringSet, type NodeAlignmentContext, type NodeAlignmentSnapState } from "@/lib/canvas/canvas-project-domain";
import { applyFrameDrop, buildCanvasFrameDropIndex, findFrameDropTargetFromIndex, getFrameChildIds, isFrameNode } from "@/lib/canvas/canvas-frame";
import { applyCanvasSelectionStrategy, canvasSelectionHitsBounds, createCanvasSelectionBounds, createCanvasSelectionSpatialIndexCache, resolveCanvasSelectionHitMode, resolveCanvasSelectionPreviewDelta, resolveCanvasSelectionStrategy } from "@/lib/canvas/canvas-selection";
import { canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";
import { CanvasNodeType, type CanvasNodeData, type Position, type SelectionBox, type ViewportTransform } from "@/types/canvas";

type UseCanvasSelectionControllerOptions = {
    containerRef: RefObject<HTMLDivElement | null>;
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
    onNodeBringToFront?: (nodeId: string) => void;
    onNodeClick: (node: CanvasNodeData) => void;
    onNodeDragEnd?: (nodeId: string) => void;
    onBatchConnectionTarget?: (event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => boolean;
    onLinkedFolderDrop?: (folder: CanvasNodeData, nodes: CanvasNodeData[]) => void;
    onDeselect: () => void;
    onSelectionBoxEnd?: () => void;
};

type DragState = {
    isDraggingNode: boolean;
    hasMoved: boolean;
    openPanelOnClick: boolean;
    startX: number;
    startY: number;
    draggedNodeIds: string[];
    draggedRenderNodeIds: string[];
    draggedRenderNodeIdSet: Set<string>;
    initialSelectedNodes: Array<{ id: string; x: number; y: number }>;
};

type SelectionGestureState =
    | { phase: "idle" }
    | { phase: "pending" | "selecting"; initialSelection: Set<string>; selection: SelectionBox };

const EMPTY_DRAG_STATE: DragState = {
    isDraggingNode: false,
    hasMoved: false,
    openPanelOnClick: true,
    startX: 0,
    startY: 0,
    draggedNodeIds: [],
    draggedRenderNodeIds: [],
    draggedRenderNodeIdSet: new Set(),
    initialSelectedNodes: [],
};

export function useCanvasSelectionController({
    containerRef,
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
    onNodeBringToFront,
    onNodeClick,
    onNodeDragEnd,
    onBatchConnectionTarget,
    onLinkedFolderDrop,
    onDeselect,
    onSelectionBoxEnd,
}: UseCanvasSelectionControllerOptions) {
    const dragFrameRef = useRef<number | null>(null);
    const pendingNodeDragRef = useRef<Position>({ x: 0, y: 0 });
    const pendingAlignmentGuidesRef = useRef<{ vertical?: number; horizontal?: number }>({});
    const alignmentContextRef = useRef<NodeAlignmentContext | null>(null);
    const alignmentSnapRef = useRef<NodeAlignmentSnapState>({});
    const lastFrameDropCheckRef = useRef(0);
    const selectionFrameRef = useRef<number | null>(null);
    const selectionBoundsElementRef = useRef<HTMLDivElement>(null);
    const selectionSpatialIndexCacheRef = useRef(createCanvasSelectionSpatialIndexCache());
    const pendingSelectionPointRef = useRef<Position | null>(null);
    const selectionGestureRef = useRef<SelectionGestureState>({ phase: "idle" });
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<DragState>({ ...EMPTY_DRAG_STATE });
    const frameDropIndexRef = useRef(buildCanvasFrameDropIndex([]));
    const draggedNodesRef = useRef<CanvasNodeData[]>([]);
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [frameDropTargetId, setFrameDropTargetId] = useState<string | null>(null);
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dragPreview, setDragPreview] = useState<{ x: number; y: number; nodeIds: Set<string> } | null>(null);
    const dragPreviewRef = useRef<CanvasNodeDragPreview | null>(null);
    const dragPreviewClearPendingRef = useRef(false);
    const dragPreviewContainerRef = useRef<HTMLDivElement | null>(null);
    const selectionPreviewClearPendingRef = useRef(false);
    const [alignmentGuides, setAlignmentGuides] = useState<{ vertical?: number; horizontal?: number }>({});

    // React may repaint for alignment/drop-target state while a drag is active.
    // Re-apply the compositor offset after such commits so React's style diff
    // cannot clear the imperative `translate` property.
    useLayoutEffect(() => {
        if (selectionPreviewClearPendingRef.current) {
            selectionPreviewClearPendingRef.current = false;
            applyCanvasNodeSelectionPreview(containerRef.current, null);
        }
        if (dragPreviewClearPendingRef.current) {
            dragPreviewClearPendingRef.current = false;
            dragPreviewRef.current = null;
            applyCanvasNodeDragPreview(containerRef.current || dragPreviewContainerRef.current, null);
            setDragPreview(null);
            setIsNodeDragging(false);
            return;
        }
        const preview = dragPreviewRef.current;
        if (preview) applyCanvasNodeDragPreview(containerRef.current || dragPreviewContainerRef.current, preview);
    });

    const resetSelectionBox = useCallback((preserveNodePreview = false) => {
        selectionGestureRef.current = { phase: "idle" };
        pendingSelectionPointRef.current = null;
        if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
        if (preserveNodePreview) selectionPreviewClearPendingRef.current = true;
        else applyCanvasNodeSelectionPreview(containerRef.current, null);
        setSelectionBox(null);
    }, [containerRef]);

    const cancelSelectionBox = useCallback(() => {
        const gesture = selectionGestureRef.current;
        const initialSelection = gesture.phase === "selecting" ? gesture.initialSelection : null;
        resetSelectionBox();
        if (!initialSelection) return;
        const restoredSelection = new Set(initialSelection);
        if (sameStringSet(restoredSelection, selectedNodeIdsRef.current)) return;
        selectedNodeIdsRef.current = restoredSelection;
        setSelectedNodeIds(restoredSelection);
    }, [resetSelectionBox, selectedNodeIdsRef, setSelectedNodeIds]);

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
        const strategy = resolveCanvasSelectionStrategy(event);
        const initialSelection = new Set(selectedNodeIdsRef.current);
        const nextSelectionBox: SelectionBox = {
            startWorldX: world.x,
            startWorldY: world.y,
            currentWorldX: world.x,
            currentWorldY: world.y,
            strategy,
            hitMode: "intersect",
            initialSelectedNodeIds: Array.from(initialSelection),
        };
        selectionGestureRef.current = { phase: "pending", initialSelection, selection: nextSelectionBox };
        selectionSpatialIndexCacheRef.current.get(nodesRef.current);
        setSelectedConnectionId(null);
    }, [cancelPendingConnectionCreate, nodesRef, onCanvasSelectionStart, screenToCanvas, selectedNodeIdsRef, setSelectedConnectionId]);

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        if (onBatchConnectionTarget?.(event, nodeId)) return;
        // Paint order is session-local UI state. Update it once at the start
        // of a real node interaction so dragging also survives deselection.
        onNodeBringToFront?.(nodeId);
        setSelectedConnectionId(null);
        const currentNodes = nodesRef.current;
        const clickedNode = currentNodes.find((node) => node.id === nodeId);
        // The second press of a text-node double click belongs to inline
        // editing, not a new drag gesture. Starting a drag here briefly clears
        // the node toolbar and generation panel before the double-click event
        // arrives, which causes a visible flash.
        if (event.detail >= 2 && clickedNode?.type === CanvasNodeType.Text && !nodeDraggingRef.current) return;
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

        frameDropIndexRef.current = buildCanvasFrameDropIndex(currentNodes);
        draggedNodesRef.current = currentNodes.filter((node) => dragIds.has(node.id) && !node.metadata?.locked);
        const draggedRenderNodeIds = initialSelectedNodes.map((item) => item.id);
        const draggedRenderNodeIdSet = new Set(draggedRenderNodeIds);
        dragRef.current = { isDraggingNode: true, hasMoved: false, openPanelOnClick: !isMultiSelectClick, startX: event.clientX, startY: event.clientY, draggedNodeIds, draggedRenderNodeIds, draggedRenderNodeIdSet, initialSelectedNodes };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        pendingNodeDragRef.current = { x: 0, y: 0 };
        alignmentContextRef.current = createNodeAlignmentContext(currentNodes, initialSelectedNodes);
        alignmentSnapRef.current = {};
        lastFrameDropCheckRef.current = 0;
        setIsNodeDragging(true);
        setAlignmentGuides({});
        applyCanvasAlignmentGuidesPreview(containerRef.current, {});
        const preview = { x: 0, y: 0, nodeIds: draggedRenderNodeIdSet };
        dragPreviewContainerRef.current = containerRef.current;
        dragPreviewRef.current = preview;
        setDragPreview(preview);
        applyCanvasNodeDragPreview(containerRef.current, preview);
    }, [containerRef, historyPausedRef, nodesRef, onBatchConnectionTarget, onNodeBringToFront, onNodeClick, onNodeInteractionStart, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

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
        const alignedAtEnd = calculateNodeAlignment(alignmentContextRef.current, rawOffset, 7 / currentViewport.k, alignmentSnapRef.current);
        const { x: dx, y: dy } = alignedAtEnd.offset;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setAlignmentGuides({});
        applyCanvasAlignmentGuidesPreview(containerRef.current, {});
        if (dragRef.current.hasMoved) {
            const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
            const positioned = clientX == null || clientY == null ? nodesRef.current : nodesRef.current.map((node) => {
                const initial = initialById.get(node.id);
                return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
            });
            const targetId = findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, draggedNodeIds, { x: dx, y: dy });
            const target = targetId ? positioned.find((node) => node.id === targetId) : undefined;
            const linkedFolder = target?.metadata?.folder?.assetFolderId ? target : undefined;
            // 素材库文件夹只建立归档关系，不把画布节点变成其本地子节点。
            setNodes(linkedFolder ? positioned : applyFrameDrop(positioned, draggedNodeIds, targetId));
            if (linkedFolder) onLinkedFolderDrop?.(linkedFolder, positioned.filter((node) => draggedNodeIds.has(node.id)));
            if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);
        }
        // React commits the final node coordinates asynchronously. Defer
        // clearing the compositor preview to the next layout effect so the
        // old translate cannot combine with the newly committed transform.
        if (containerRef.current || dragPreviewContainerRef.current) {
            dragPreviewClearPendingRef.current = true;
        } else {
            dragPreviewRef.current = null;
            setDragPreview(null);
            setIsNodeDragging(false);
        }
        setFrameDropTargetId(null);
        alignmentContextRef.current = null;
        alignmentSnapRef.current = {};
        draggedNodesRef.current = [];
        dragRef.current = { ...EMPTY_DRAG_STATE };
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            if (clickedNode) onNodeClick(clickedNode);
        }
    }, [historyPausedRef, nodesRef, onLinkedFolderDrop, onNodeClick, onNodeDragEnd, setNodes, viewportRef]);

    const handleNodeDragMove = useCallback((event: MouseEvent | PointerEvent) => {
        if (!dragRef.current.isDraggingNode) return;
        const currentViewport = viewportRef.current;
        pendingNodeDragRef.current = { x: (event.clientX - dragRef.current.startX) / currentViewport.k, y: (event.clientY - dragRef.current.startY) / currentViewport.k };
        if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) dragRef.current.hasMoved = true;
        if (dragFrameRef.current) return;
        dragFrameRef.current = requestAnimationFrame(() => {
            const aligned = calculateNodeAlignment(alignmentContextRef.current, pendingNodeDragRef.current, 7 / viewportRef.current.k, alignmentSnapRef.current);
            alignmentSnapRef.current = aligned.snapState;
            const latest = aligned.offset;
            pendingAlignmentGuidesRef.current = aligned.guides;
            const now = performance.now();
            if (now - lastFrameDropCheckRef.current >= 100) {
                lastFrameDropCheckRef.current = now;
                const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
                setFrameDropTargetId(findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, draggedNodeIds, latest));
            }
            dragPreviewRef.current = {
                x: latest.x,
                y: latest.y,
                nodeIds: dragRef.current.draggedRenderNodeIdSet,
            };
            applyCanvasNodeDragPreview(containerRef.current, {
                x: latest.x,
                y: latest.y,
                nodeIds: dragRef.current.draggedRenderNodeIdSet,
            });
            const nextGuides = dragRef.current.hasMoved ? pendingAlignmentGuidesRef.current : {};
            applyCanvasAlignmentGuidesPreview(containerRef.current, nextGuides);
            dragFrameRef.current = null;
        });
    }, [containerRef, viewportRef]);

    const updateSelectionPreview = useCallback((world: Position, commit: boolean) => {
        let gesture = selectionGestureRef.current;
        if (gesture.phase === "idle") return false;
        let selection = gesture.selection;
        if (gesture.phase === "pending") {
            const threshold = 4 / viewportRef.current.k;
            if (Math.hypot(world.x - selection.startWorldX, world.y - selection.startWorldY) < threshold) return false;
            selection = { ...selection, currentWorldX: world.x, currentWorldY: world.y, hitMode: resolveCanvasSelectionHitMode(selection.startWorldX, world.x) };
            gesture = { phase: "selecting", initialSelection: gesture.initialSelection, selection };
            selectionGestureRef.current = gesture;
            // React only learns that a gesture exists. All subsequent geometry
            // and node feedback stays outside React until pointer-up.
            setSelectionBox(selection);
        }
        const bounds = createCanvasSelectionBounds(selection.startWorldX, selection.startWorldY, world.x, world.y);
        selection = { ...selection, currentWorldX: world.x, currentWorldY: world.y, hitMode: resolveCanvasSelectionHitMode(selection.startWorldX, world.x) };
        selectionGestureRef.current = { phase: "selecting", initialSelection: gesture.initialSelection, selection };
        applyCanvasSelectionPreview(containerRef.current, selection);
        const queryBounds = { ...bounds, right: Math.max(bounds.right, bounds.left + 0.01), bottom: Math.max(bounds.bottom, bounds.top + 0.01) };
        const hitNodeIds = new Set(selectionSpatialIndexCacheRef.current
            .get(nodesRef.current)
            .query(queryBounds)
            .filter((node) => canvasSelectionHitsBounds(queryBounds, canvasNodeBounds(node), selection.hitMode || "intersect"))
            .map((node) => node.id));
        applyCanvasNodeSelectionPreview(containerRef.current, resolveCanvasSelectionPreviewDelta(gesture.initialSelection, hitNodeIds, selection.strategy || "replace"));
        if (!commit) return true;
        const nextSelected = applyCanvasSelectionStrategy(gesture.initialSelection, hitNodeIds, selection.strategy || "replace");
        if (!sameStringSet(nextSelected, selectedNodeIdsRef.current)) {
            selectedNodeIdsRef.current = nextSelected;
            setSelectedNodeIds(nextSelected);
        }
        return true;
    }, [containerRef, nodesRef, selectedNodeIdsRef, setSelectedNodeIds, viewportRef]);

    const handlePointerMove = useCallback((event: PointerEvent) => {
        if (dragRef.current.isDraggingNode) {
            handleNodeDragMove(event);
            return;
        }
        const currentGesture = selectionGestureRef.current;
        if (currentGesture.phase === "idle") return;
        pendingSelectionPointRef.current = screenToCanvas(event.clientX, event.clientY);
        if (selectionFrameRef.current) return;
        selectionFrameRef.current = requestAnimationFrame(() => {
            selectionFrameRef.current = null;
            const world = pendingSelectionPointRef.current;
            if (world) updateSelectionPreview(world, false);
        });
    }, [handleNodeDragMove, screenToCanvas, updateSelectionPreview]);

    const finishSelection = useCallback((clientX: number, clientY: number) => {
        const gesture = selectionGestureRef.current;
        const hadPendingSelection = gesture.phase !== "idle";
        const strategy = gesture.phase === "idle" ? null : gesture.selection.strategy;
        if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
        const wasSelection = hadPendingSelection && updateSelectionPreview(screenToCanvas(clientX, clientY), true);
        resetSelectionBox(wasSelection);
        if (hadPendingSelection && !wasSelection && strategy === "replace") deselectCanvas();
        onSelectionBoxEnd?.();
    }, [deselectCanvas, onSelectionBoxEnd, resetSelectionBox, screenToCanvas, updateSelectionPreview]);

    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
        };
        const handlePointerUp = (event: PointerEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            finishSelection(event.clientX, event.clientY);
        };
        const cancel = () => {
            finishNodeDrag();
            cancelSelectionBox();
        };
        window.addEventListener("mousemove", handleNodeDragMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        return () => {
            if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
            if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
            window.removeEventListener("mousemove", handleNodeDragMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("blur", cancel);
        };
    }, [cancelSelectionBox, finishNodeDrag, finishSelection, handleNodeDragMove, handlePointerMove]);

    // The listener effect can be recreated when a caller supplies a new
    // callback identity. Do not tear down an active drag in that dependency
    // cleanup; only clear DOM previews when this controller is unmounted.
    useEffect(() => () => {
        dragPreviewClearPendingRef.current = false;
        dragPreviewRef.current = null;
        const container = containerRef.current || dragPreviewContainerRef.current;
        applyCanvasNodeDragPreview(container, null);
        applyCanvasAlignmentGuidesPreview(container, {});
        dragPreviewContainerRef.current = null;
    }, [containerRef]);

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
    };
}
