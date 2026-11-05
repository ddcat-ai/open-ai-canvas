import { useCallback, useEffect, useRef, type Dispatch, type MouseEvent, type SetStateAction } from "react";

import { isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { isHiddenBatchChild } from "@/lib/canvas/canvas-project-domain";
import { applyCanvasLiveViewport } from "@/lib/canvas/canvas-live-viewport";
import { getCanvasNodesBounds, viewportAtScale, viewportForBounds, type CanvasViewportSize } from "@/lib/canvas/canvas-viewport";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";
import { useCanvasViewportTransition } from "./use-canvas-viewport-transition";
import { unobscuredCanvasArea, viewportForAgentNodes } from "@/lib/canvas/canvas-viewport";
import { agentFocusDuration, canvasNodesVisibleInArea, interpolateCameraViewport, type AgentCanvasFocus } from "@/lib/canvas/agent-canvas-focus";

/** 同一批 Agent 增量的合并窗口。 */
const AGENT_FOCUS_COALESCE_MS = 160;
/** 用户最近一次平移/缩放后的静默期，期间只轻闪不移动镜头。 */
const AGENT_FOCUS_USER_IDLE_MS = 2500;
const AGENT_FOCUS_PULSE_MS = 1400;
const AGENT_FOCUS_PULSE_LIMIT = 12;

// 用户正在画布里的输入框、富文本或节点提示词里打字时，移动镜头会把光标所在面板挪走。
function agentFocusEditingInside(container: HTMLElement) {
    const active = container.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !container.contains(active)) return false;
    return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

type UseCanvasViewportControllerOptions = {
    agentFocus: AgentCanvasFocus | null;
    /** false 时 Agent 改动只轻闪节点，不移动镜头（HUD 上的"镜头跟随 Agent"开关）。 */
    agentFollowCamera?: boolean;
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
    agentFocus,
    agentFollowCamera = true,
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

    // Agent 镜头跟随：Agent 新建或操作节点后，平滑飞到这些节点并轻闪提示。
    // 同一批 SSE 增量会连续到达，先短暂合并再移动一次；用户刚操作过视口或正在拖拽/输入时不抢镜头。
    const lastUserViewportInputRef = useRef(0);
    const handledAgentFocusRef = useRef<AgentCanvasFocus | null>(null);
    const pendingAgentFocusRef = useRef<{ nodeIds: Set<string>; created: boolean } | null>(null);
    const agentFollowCameraRef = useRef(agentFollowCamera);
    agentFollowCameraRef.current = agentFollowCamera;
    const agentFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pulseTimersRef = useRef(new Map<HTMLElement, ReturnType<typeof setTimeout>>());

    const pulseAgentNodes = useCallback((nodes: CanvasNodeData[]) => {
        const container = containerRef.current;
        if (!container) return;
        for (const node of nodes.slice(0, AGENT_FOCUS_PULSE_LIMIT)) {
            const element = container.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(node.id)}"]`);
            if (!element) continue;
            const previous = pulseTimersRef.current.get(element);
            if (previous) clearTimeout(previous);
            // 先移除再强制回流，连续操作同一节点时动画能重新播放。
            delete element.dataset.agentFocusPulse;
            void element.offsetWidth;
            element.dataset.agentFocusPulse = "true";
            pulseTimersRef.current.set(element, setTimeout(() => {
                delete element.dataset.agentFocusPulse;
                pulseTimersRef.current.delete(element);
            }, AGENT_FOCUS_PULSE_MS));
        }
    }, [containerRef]);

    const runAgentFocusRef = useRef<() => void>(() => {});
    runAgentFocusRef.current = () => {
        agentFocusTimerRef.current = null;
        const pending = pendingAgentFocusRef.current;
        pendingAgentFocusRef.current = null;
        const container = containerRef.current;
        if (!pending || !container || size.width <= 0 || size.height <= 0) return;
        const nodes = nodesRef.current;
        const targets = nodes.filter((node) => pending.nodeIds.has(node.id) && !isHiddenBatchChild(node, nodes) && !isNodeHiddenByCollapsedFrame(node, nodes));
        if (!targets.length) return;
        const userBusy = container.dataset.canvasNodeDragging === "true" || performance.now() - lastUserViewportInputRef.current < AGENT_FOCUS_USER_IDLE_MS || agentFocusEditingInside(container);
        if (userBusy || !agentFollowCameraRef.current) {
            pulseAgentNodes(targets);
            return;
        }
        const rect = container.getBoundingClientRect();
        const panel = container.ownerDocument.querySelector(".canvas-agent-panel")?.getBoundingClientRect();
        const area = unobscuredCanvasArea(size, panel ? { left: panel.left - rect.left, top: panel.top - rect.top, right: panel.right - rect.left, bottom: panel.bottom - rect.top } : undefined);
        const current = viewportRef.current;
        // 仅更新的节点已在视野内时只轻闪，不移动镜头。
        if (!pending.created && canvasNodesVisibleInArea(targets, current, area)) {
            pulseAgentNodes(targets);
            return;
        }
        const target = viewportForAgentNodes(targets, current, area);
        if (!target) return;
        if (pending.created) {
            setSelectedNodeIds(new Set(targets.map((node) => node.id)));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(null);
            setToolbarNodeId(null);
        }
        const anchor = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
        transitionViewportTo(target, {
            duration: agentFocusDuration(current, target, size),
            interpolate: (from, to, progress) => interpolateCameraViewport(from, to, progress, anchor, size),
            onComplete: () => pulseAgentNodes(targets),
        });
    };

    useEffect(() => {
        if (!agentFocus || handledAgentFocusRef.current === agentFocus) return;
        handledAgentFocusRef.current = agentFocus;
        const pending = pendingAgentFocusRef.current;
        // 合并窗口内新建优先：已有新建批次时，后续纯更新不再扩大取景范围。
        if (!pending || (agentFocus.created && !pending.created)) {
            pendingAgentFocusRef.current = { nodeIds: new Set(agentFocus.nodes.map((node) => node.id)), created: agentFocus.created };
        } else if (agentFocus.created || !pending.created) {
            for (const node of agentFocus.nodes) pending.nodeIds.add(node.id);
        }
        if (agentFocusTimerRef.current) clearTimeout(agentFocusTimerRef.current);
        agentFocusTimerRef.current = setTimeout(() => runAgentFocusRef.current(), AGENT_FOCUS_COALESCE_MS);
    }, [agentFocus]);

    useEffect(() => {
        const pulseTimers = pulseTimersRef.current;
        return () => {
            if (agentFocusTimerRef.current) clearTimeout(agentFocusTimerRef.current);
            for (const [element, timer] of pulseTimers) {
                clearTimeout(timer);
                delete element.dataset.agentFocusPulse;
            }
            pulseTimers.clear();
        };
    }, []);

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
        event.stopPropagation();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY), createOpen: true });
    }, [screenToCanvas, setContextMenu, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds, setToolbarNodeId]);

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
        setDialogNodeId(node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Script ? null : node.id);
    }, [nodesRef, selectFocusedNode, setDialogNodeId, size.height, size.width, transitionViewportTo, viewportRef]);

    const setZoomScale = useCallback((scale: number) => {
        cancelViewportTransition();
        const next = viewportAtScale(viewportRef.current, size, scale);
        previewViewport(next);
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(() => commitViewport(viewportRef.current), 120);
        setContextMenu(null);
    }, [cancelViewportTransition, commitViewport, previewViewport, setContextMenu, size, viewportRef]);

    const zoomCanvasIn = useCallback(() => setZoomScale(viewportRef.current.k + 0.1), [setZoomScale, viewportRef]);
    const zoomCanvasOut = useCallback(() => setZoomScale(viewportRef.current.k - 0.1), [setZoomScale, viewportRef]);

    const zoomToActualSize = useCallback(() => {
        transitionViewportTo(viewportAtScale(viewportRef.current, size, 1));
    }, [size, transitionViewportTo, viewportRef]);

    // 这两个入口只由用户的滚轮、拖拽和小地图触发；记录时间供 Agent 镜头跟随避让。
    const handleViewportChange = useCallback((next: ViewportTransform) => {
        lastUserViewportInputRef.current = performance.now();
        cancelViewportTransition();
        commitViewport(next);
        setContextMenu(null);
    }, [cancelViewportTransition, commitViewport, setContextMenu]);

    const handleViewportPreviewChange = useCallback((next: ViewportTransform) => {
        lastUserViewportInputRef.current = performance.now();
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
        screenToCanvas,
        setZoomScale,
        zoomCanvasIn,
        zoomCanvasOut,
        zoomToActualSize,
    };
}
