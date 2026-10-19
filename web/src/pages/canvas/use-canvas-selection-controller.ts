import { useCallback, useEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";

import { applyCanvasNodeDragPreview, applyCanvasNodeSelectionPreview, applyCanvasSelectionPreview } from "@/lib/canvas/canvas-live-viewport";
import { calculateNodeAlignment, createNodeAlignmentContext, sameStringSet, type NodeAlignmentContext } from "@/lib/canvas/canvas-project-domain";
import { applyFrameDrop, buildCanvasFrameDropIndex, findFrameDropTargetFromIndex, getFrameChildIds, isFrameNode } from "@/lib/canvas/canvas-frame";
import { applyCanvasSelectionStrategy, canvasSelectionHitsBounds, createCanvasSelectionBounds, createCanvasSelectionSpatialIndexCache, resolveCanvasSelectionHitMode, resolveCanvasSelectionPreviewDelta, resolveCanvasSelectionStrategy } from "@/lib/canvas/canvas-selection";
import { canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";
import type { CanvasNodeData, Position, SelectionBox, ViewportTransform } from "@/types/canvas";

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
    /** 本次手势若为非修饰键的纯单击单节点，则该节点 id；否则 null。用于编组后区分"单击弹面板"与"拖动整组"。 */
    singleClickNodeId: string | null;
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
    singleClickNodeId: null,
    initialSelectedNodes: [],
};

// 拖拽结束后按节点最终位置与各编组框的关系自动编组（同一 setNodes 提交，可随拖拽一起撤销）：
// - 组外节点外接盒与某编组可见框（含内边距）重叠 → 加入该组（重叠多个时取最小框），随后派生框自动撑大；
// - 组内节点被单独拖出同组其余成员的包围盒（含内边距）→ 移出该组，其余成员保持原组；
// - 同组其余成员随该节点一起以相同位移移动（整组平移）→ 强制保留编组，避免稀疏编组被误解除。
function applyCanvasDragAutoGrouping(nodes: CanvasNodeData[], movingIds: Set<string>, initialPositions: Map<string, { x: number; y: number }>): CanvasNodeData[] {
    if (!movingIds.size) return nodes;
    const byGroup = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        if (!node.groupId) continue;
        const list = byGroup.get(node.groupId);
        if (list) list.push(node);
        else byGroup.set(node.groupId, [node]);
    }
    if (!byGroup.size) return nodes;

    const GROUP_PADDING = 12;
    // 含内边距的框（用于"拖出"判定与最小框排序）。
    const boxOf = (members: CanvasNodeData[]): { left: number; top: number; right: number; bottom: number } | null => {
        if (!members.length) return null;
        const left = Math.min(...members.map((n) => n.position.x));
        const top = Math.min(...members.map((n) => n.position.y));
        const right = Math.max(...members.map((n) => n.position.x + n.width));
        const bottom = Math.max(...members.map((n) => n.position.y + n.height));
        return { left: left - GROUP_PADDING, top: top - GROUP_PADDING, right: right + GROUP_PADDING, bottom: bottom + GROUP_PADDING };
    };
    const center = (n: CanvasNodeData) => ({ x: n.position.x + n.width / 2, y: n.position.y + n.height / 2 });
    const contains = (box: { left: number; top: number; right: number; bottom: number } | null, p: { x: number; y: number }) => box != null && p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
    const intersects = (box: { left: number; top: number; right: number; bottom: number } | null, rect: { x: number; y: number; right: number; bottom: number }) =>
        box != null && rect.x < box.right && rect.right > box.left && rect.y < box.bottom && rect.bottom > box.top;
    const deltaOf = (node: CanvasNodeData) => {
        const initial = initialPositions.get(node.id);
        return initial ? { x: node.position.x - initial.x, y: node.position.y - initial.y } : { x: 0, y: 0 };
    };
    const MOVE_TOGETHER_EPS = 2;

    const desired = new Map<string, string | null>();
    for (const node of nodes) {
        if (!movingIds.has(node.id)) continue;
        if (node.parentId || node.metadata?.locked) continue;
        const originalGroupId = node.groupId;
        if (originalGroupId) {
            const members = byGroup.get(originalGroupId) ?? [];
            const others = members.filter((m) => m.id !== node.id);
            const delta = deltaOf(node);
            const othersMoving = others.filter((m) => movingIds.has(m.id));
            const movedTogether = othersMoving.length > 0 && othersMoving.every((m) => {
                const d = deltaOf(m);
                return Math.abs(d.x - delta.x) < MOVE_TOGETHER_EPS && Math.abs(d.y - delta.y) < MOVE_TOGETHER_EPS;
            });
            if (movedTogether) {
                // 整组一起平移：相对位置不变，强制保留编组。
                desired.set(node.id, originalGroupId);
            } else {
                // 仅该节点被拖离：中心是否仍在同组其余成员框内（含内边距），否则解除编组。
                desired.set(node.id, contains(boxOf(others), center(node)) ? originalGroupId : null);
            }
        } else {
            // 拖入编组：节点外接盒与某编组可见框（含内边距）重叠即加入（重叠多个取最小框）；与拖拽预览的撑大逻辑一致，松手即定。
            const nodeRect = { x: node.position.x, y: node.position.y, right: node.position.x + node.width, bottom: node.position.y + node.height };
            const containing = [...byGroup.entries()]
                .filter(([, members]) => intersects(boxOf(members), nodeRect))
                .sort((a, b) => {
                    const ba = boxOf(a[1])!;
                    const bb = boxOf(b[1])!;
                    return ba.right - ba.left + (ba.bottom - ba.top) - (bb.right - bb.left + (bb.bottom - bb.top));
                });
            desired.set(node.id, containing.length ? containing[0][0] : null);
        }
    }
    if (!desired.size) return nodes;

    const targetName = new Map<string, string | undefined>();
    for (const [nodeId, targetGroupId] of desired) {
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) continue;
        if (targetGroupId !== null && targetGroupId === node.groupId) continue;
        if (targetGroupId === null) {
            targetName.set(nodeId, undefined);
        } else {
            const name = nodes.find((m) => m.groupId === targetGroupId && m.id !== nodeId)?.groupName ?? nodes.find((m) => m.groupId === targetGroupId)?.groupName;
            targetName.set(nodeId, name);
        }
    }
    return nodes.map((node) => {
        if (!targetName.has(node.id)) return node;
        const target = desired.get(node.id)!;
        return { ...node, groupId: target ?? undefined, groupName: targetName.get(node.id) };
    });
}

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
}: UseCanvasSelectionControllerOptions) {
    const dragFrameRef = useRef<number | null>(null);
    const pendingNodeDragRef = useRef<Position>({ x: 0, y: 0 });
    const pendingAlignmentGuidesRef = useRef<{ vertical?: number; horizontal?: number }>({});
    const alignmentContextRef = useRef<NodeAlignmentContext | null>(null);
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
    const [alignmentGuides, setAlignmentGuides] = useState<{ vertical?: number; horizontal?: number }>({});

    const resetSelectionBox = useCallback(() => {
        selectionGestureRef.current = { phase: "idle" };
        pendingSelectionPointRef.current = null;
        if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
        selectionFrameRef.current = null;
        applyCanvasNodeSelectionPreview(containerRef.current, null);
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

    // 同步选中整组（连同 ref），供组边框空白处拖拽整组时复用拖拽逻辑。
    const selectNodes = useCallback((ids: string[]) => {
        const next = new Set(ids);
        selectedNodeIdsRef.current = next;
        setSelectedNodeIds(next);
        setSelectedConnectionId(null);
    }, [selectedNodeIdsRef, setSelectedNodeIds, setSelectedConnectionId]);

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
            hitMode: "contain",
            initialSelectedNodeIds: Array.from(initialSelection),
        };
        selectionGestureRef.current = { phase: "pending", initialSelection, selection: nextSelectionBox };
        selectionSpatialIndexCacheRef.current.get(nodesRef.current);
        setSelectedConnectionId(null);
    }, [cancelPendingConnectionCreate, nodesRef, onCanvasSelectionStart, screenToCanvas, selectedNodeIdsRef, setSelectedConnectionId]);

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent | ReactPointerEvent, nodeId: string, openPanelOnClick = true) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        if (onBatchConnectionTarget?.(event, nodeId)) return;
        // Paint order is session-local UI state. Update it once at the start
        // of a real node interaction so dragging also survives deselection.
        onNodeBringToFront?.(nodeId);
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

        frameDropIndexRef.current = buildCanvasFrameDropIndex(currentNodes);
        draggedNodesRef.current = currentNodes.filter((node) => dragIds.has(node.id) && !node.metadata?.locked);
        const draggedRenderNodeIds = initialSelectedNodes.map((item) => item.id);
        const draggedRenderNodeIdSet = new Set(draggedRenderNodeIds);
        dragRef.current = { isDraggingNode: true, hasMoved: false, openPanelOnClick: openPanelOnClick && !isMultiSelectClick, startX: event.clientX, startY: event.clientY, draggedNodeIds, draggedRenderNodeIds, draggedRenderNodeIdSet, singleClickNodeId: isMultiSelectClick || isSubtractClick ? null : nodeId, initialSelectedNodes };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        pendingNodeDragRef.current = { x: 0, y: 0 };
        alignmentContextRef.current = createNodeAlignmentContext(currentNodes, initialSelectedNodes);
        lastFrameDropCheckRef.current = 0;
        setIsNodeDragging(true);
        setAlignmentGuides({});
        setDragPreview({ x: 0, y: 0, nodeIds: draggedRenderNodeIdSet });
        applyCanvasNodeDragPreview(containerRef.current, { x: 0, y: 0, nodeIds: draggedRenderNodeIdSet });
    }, [containerRef, historyPausedRef, nodesRef, onBatchConnectionTarget, onNodeBringToFront, onNodeClick, onNodeInteractionStart, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (dragFrameRef.current) {
            cancelAnimationFrame(dragFrameRef.current);
            dragFrameRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;
        const shouldOpenPanelOnClick = dragRef.current.openPanelOnClick;
        // 编组后 draggedNodeIds 可能含整组，改用 singleClickNodeId 判断是否为纯单击单节点。
        const wasClick = shouldOpenPanelOnClick && !dragRef.current.hasMoved && dragRef.current.singleClickNodeId != null;
        const clickedNodeId = dragRef.current.singleClickNodeId ?? dragRef.current.draggedNodeIds[0];
        const currentViewport = viewportRef.current;
        const rawOffset = { x: clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k, y: clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k };
        const initialPositions = dragRef.current.initialSelectedNodes;
        const initialById = new Map(initialPositions.map((item) => [item.id, item]));
        const { x: dx, y: dy } = calculateNodeAlignment(alignmentContextRef.current, rawOffset, 7 / currentViewport.k).offset;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        applyCanvasNodeDragPreview(containerRef.current, null);
        setIsNodeDragging(false);
        setDragPreview(null);
        setAlignmentGuides({});
        if (dragRef.current.hasMoved) {
            const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
            let positioned = clientX == null || clientY == null ? nodesRef.current : nodesRef.current.map((node) => {
                const initial = initialById.get(node.id);
                return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
            });
            positioned = applyCanvasDragAutoGrouping(positioned, draggedNodeIds, initialById);
            const targetId = findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, draggedNodeIds, { x: dx, y: dy });
            const target = targetId ? positioned.find((node) => node.id === targetId) : undefined;
            const linkedFolder = target?.metadata?.folder?.assetFolderId ? target : undefined;
            // 素材库文件夹只建立归档关系，不把画布节点变成其本地子节点。
            setNodes(linkedFolder ? positioned : applyFrameDrop(positioned, draggedNodeIds, targetId));
            if (linkedFolder) onLinkedFolderDrop?.(linkedFolder, positioned.filter((node) => draggedNodeIds.has(node.id)));
            if (clickedNodeId) onNodeDragEnd?.(clickedNodeId);
        }
        setFrameDropTargetId(null);
        alignmentContextRef.current = null;
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
            const aligned = calculateNodeAlignment(alignmentContextRef.current, pendingNodeDragRef.current, 7 / viewportRef.current.k);
            const latest = aligned.offset;
            pendingAlignmentGuidesRef.current = aligned.guides;
            const now = performance.now();
            if (now - lastFrameDropCheckRef.current >= 100) {
                lastFrameDropCheckRef.current = now;
                const draggedNodeIds = new Set(dragRef.current.draggedNodeIds);
                setFrameDropTargetId(findFrameDropTargetFromIndex(frameDropIndexRef.current, draggedNodesRef.current, draggedNodeIds, latest));
            }
            applyCanvasNodeDragPreview(containerRef.current, {
                x: latest.x,
                y: latest.y,
                nodeIds: dragRef.current.draggedRenderNodeIdSet,
            });
            const nextGuides = dragRef.current.hasMoved ? pendingAlignmentGuidesRef.current : {};
            setAlignmentGuides((current) => current.vertical === nextGuides.vertical && current.horizontal === nextGuides.horizontal ? current : nextGuides);
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
            .filter((node) => canvasSelectionHitsBounds(queryBounds, canvasNodeBounds(node), selection.hitMode))
            .map((node) => node.id));
        applyCanvasNodeSelectionPreview(containerRef.current, resolveCanvasSelectionPreviewDelta(gesture.initialSelection, hitNodeIds, selection.strategy));
        if (!commit) return true;
        const nextSelected = applyCanvasSelectionStrategy(gesture.initialSelection, hitNodeIds, selection.strategy);
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
        resetSelectionBox();
        if (hadPendingSelection && !wasSelection && strategy === "replace") deselectCanvas();
    }, [deselectCanvas, resetSelectionBox, screenToCanvas, updateSelectionPreview]);

    // 重渲染只更新回调，不能拆掉进行中的手势监听并清除 iframe 保护层 / 待执行帧。
    const gestureHandlersRef = useRef({ finishNodeDrag, finishSelection, cancelSelectionBox, handleNodeDragMove, handlePointerMove });
    useEffect(() => {
        gestureHandlersRef.current = { finishNodeDrag, finishSelection, cancelSelectionBox, handleNodeDragMove, handlePointerMove };
    });

    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            gestureHandlersRef.current.finishNodeDrag(event.clientX, event.clientY);
        };
        const handlePointerUp = (event: PointerEvent) => {
            gestureHandlersRef.current.finishNodeDrag(event.clientX, event.clientY);
            gestureHandlersRef.current.finishSelection(event.clientX, event.clientY);
        };
        const cancel = () => {
            gestureHandlersRef.current.finishNodeDrag();
            gestureHandlersRef.current.cancelSelectionBox();
        };
        const onMouseMove = (event: MouseEvent) => gestureHandlersRef.current.handleNodeDragMove(event);
        const onPointerMove = (event: PointerEvent) => gestureHandlersRef.current.handlePointerMove(event);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        return () => {
            if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
            if (selectionFrameRef.current) cancelAnimationFrame(selectionFrameRef.current);
            applyCanvasNodeDragPreview(containerRef.current, null);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("blur", cancel);
        };
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
        selectNodes,
        selectionBoundsElementRef,
        selectionBox,
    };
}
