import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import type { PendingConnectionCreate } from "@/components/canvas/canvas-workspace-overlays";
import { getNodeSpec } from "@/constant/canvas";
import { attachNodeToStoryboardRow, createCanvasNode, getConnectionTargetAnchor, isHiddenBatchChild, normalizeConnection, storyboardHandleAtY, storyboardPromptTemplateMetadata, storyboardRowFromHandle } from "@/lib/canvas/canvas-project-domain";
import { createCanvasDrawingFromImage } from "@/lib/canvas/canvas-drawing-storage";
import { isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ConnectionHandle, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";

type UseCanvasConnectionControllerOptions = {
    projectId: string;
    defaultDrawingEngine: CanvasDrawingEngine;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    viewportRef: { current: ViewportTransform };
    scriptScrollTopById: Record<string, number>;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setDrawingNodeId: Dispatch<SetStateAction<string | null>>;
};

type ConnectionDropTarget = {
    nodeId: string | null;
    handleId?: string;
    anchorRatio?: number;
    isNearNode: boolean;
};

const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;

export function useCanvasConnectionController({
    projectId,
    defaultDrawingEngine,
    nodesRef,
    connectionsRef,
    viewportRef,
    scriptScrollTopById,
    screenToCanvas,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
    setDrawingNodeId,
}: UseCanvasConnectionControllerOptions) {
    const { message } = App.useApp();
    const tldrawLicenseKey = useUserStore((state) => state.drawingEngine.tldrawLicenseKey);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [connectionTargetAnchorRatio, setConnectionTargetAnchorRatio] = useState<number | undefined>();
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const connectingParamsRef = useRef(connectingParams);
    const connectingPointerIdRef = useRef<number | null>(null);
    const connectingPointerStartRef = useRef<Position | null>(null);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);

    useLayoutEffect(() => {
        connectingParamsRef.current = connectingParams;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [connectingParams, pendingConnectionCreate]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectingPointerIdRef.current = null;
            connectingPointerStartRef.current = null;
            setConnectionTargetNodeId(null);
            setConnectionTargetAnchorRatio(undefined);
        }
    }, []);

    const closeConnectionCreateMenu = useCallback(() => {
        pendingConnectionCreateRef.current = null;
        setPendingConnectionCreate(null);
    }, []);

    const cancelPendingConnectionCreate = useCallback(() => {
        closeConnectionCreateMenu();
        setConnecting(null);
    }, [closeConnectionCreateMenu, setConnecting]);

    const connectNodes = useCallback((current: ConnectionHandle, targetNodeId: string, targetHandleId?: string, targetAnchorRatio?: number) => {
        if (current.nodeId === targetNodeId) return;
        const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
        if (!connection) {
            message.warning("配置节点之间不能连接");
            return;
        }
        const { fromNodeId, toNodeId } = connection;
        const fromHandleId = fromNodeId === current.nodeId ? current.handleId : targetHandleId;
        const toHandleId = toNodeId === current.nodeId ? current.handleId : targetHandleId;
        const fromAnchorRatio = fromNodeId === current.nodeId ? current.anchorRatio : targetAnchorRatio;
        const toAnchorRatio = toNodeId === current.nodeId ? current.anchorRatio : targetAnchorRatio;
        const exists = connectionsRef.current.find((item) => item.fromNodeId === fromNodeId && item.toNodeId === toNodeId && item.fromHandleId === fromHandleId && item.toHandleId === toHandleId);
        if (exists) {
            setConnections((currentConnections) => currentConnections.map((item) => item.id === exists.id ? { ...item, fromAnchorRatio, toAnchorRatio } : item));
        } else {
            setConnections((currentConnections) => [...currentConnections, { id: `conn-${Date.now()}`, fromNodeId, toNodeId, fromHandleId, toHandleId, fromAnchorRatio, toAnchorRatio }]);
            setNodes((currentNodes) => attachNodeToStoryboardRow(currentNodes, { fromNodeId, toNodeId, fromHandleId, toHandleId }));
        }
        setContextMenu(null);
    }, [connectionsRef, message, nodesRef, setConnections, setContextMenu, setNodes]);

    const createConnectedNode = useCallback(async (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing, pending: PendingConnectionCreate) => {
        if (type === CanvasNodeType.Drawing && !isDrawingEngineAvailable(defaultDrawingEngine, tldrawLicenseKey)) {
            message.error("当前生产构建未配置 tldraw License Key，不能创建 tldraw 绘图");
            return;
        }
        const storyboardRow = type === CanvasNodeType.Video ? storyboardRowFromHandle(nodesRef.current, pending.connection.nodeId, pending.connection.handleId) : undefined;
        const videoPrompt = storyboardRow ? (storyboardRow.videoMotionPrompt || storyboardRow.plotDescription).trim() : "";
        const sourceNode = pending.connection.handleType === "source" ? nodesRef.current.find((node) => node.id === pending.connection.nodeId) : undefined;
        const scriptPrompt = type === CanvasNodeType.Script && sourceNode?.type === CanvasNodeType.Text ? (sourceNode.metadata?.content || sourceNode.metadata?.prompt || "").trim() : "";
        const metadata = type === CanvasNodeType.Drawing
            ? { drawingEngine: defaultDrawingEngine }
            : type === CanvasNodeType.Script && scriptPrompt
              ? { prompt: scriptPrompt, composerContent: scriptPrompt }
            : type === CanvasNodeType.Video && storyboardRow
              ? { prompt: videoPrompt, composerContent: videoPrompt, ...storyboardPromptTemplateMetadata(storyboardRow, "video"), generationMode: "video" as const, videoEditOperation: "text_to_video" as const, workflowKind: "shot" as const, workflowTitle: `镜头 ${storyboardRow.shotNumber} 视频`, shotIndex: storyboardRow.shotNumber, seconds: String(storyboardRow.durationSeconds), status: NODE_STATUS_IDLE }
              : undefined;
        const sourceNodeForQuickCreate = pending.quick ? nodesRef.current.find((node) => node.id === pending.connection.nodeId) : undefined;
        const spec = getNodeSpec(type);
        const anchorY = sourceNodeForQuickCreate ? sourceNodeForQuickCreate.position.y + sourceNodeForQuickCreate.height * (pending.connection.anchorRatio ?? 0.5) : pending.position.y;
        const position = sourceNodeForQuickCreate
            ? {
                  x: pending.connection.handleType === "source"
                      ? sourceNodeForQuickCreate.position.x + sourceNodeForQuickCreate.width + 96 + spec.width / 2
                      : sourceNodeForQuickCreate.position.x - 96 - spec.width / 2,
                  y: anchorY,
              }
            : pending.position;
        const newNode = createCanvasNode(type, position, metadata);
        if (storyboardRow) newNode.title = `镜头 ${storyboardRow.shotNumber} · 视频`;
        const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
        if (!connection) {
            message.warning("配置节点之间不能连接");
            return;
        }
        if (type === CanvasNodeType.Drawing) {
            const drawingSourceNode = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            const sourceUrl = drawingSourceNode?.type === CanvasNodeType.Image ? drawingSourceNode.metadata?.content : "";
            if (pending.connection.handleType !== "source" || !drawingSourceNode || !sourceUrl || !newNode.metadata?.drawingId) {
                message.error("只有已有图片内容的输出连线可以创建绘图");
                return;
            }
            closeConnectionCreateMenu();
            setConnecting(null);
            try {
                const saved = await createCanvasDrawingFromImage(projectId, newNode.metadata.drawingId, defaultDrawingEngine, {
                    url: sourceUrl,
                    storageKey: drawingSourceNode.metadata?.storageKey,
                    name: drawingSourceNode.title || "来源图片",
                    mimeType: drawingSourceNode.metadata?.mimeType,
                });
                newNode.title = `${drawingSourceNode.title || "图片"} · 绘图`;
                newNode.metadata = {
                    ...newNode.metadata,
                    drawingEngine: saved.engine,
                    drawingRevision: saved.revision,
                    drawingUpdatedAt: saved.updatedAt,
                    drawingShapeCount: saved.shapeCount,
                    drawingPageCount: saved.pageCount,
                };
            } catch (error) {
                message.error(error instanceof Error ? `创建绘图失败：${error.message}` : "创建绘图失败");
                return;
            }
        }
        const fromHandleId = connection.fromNodeId === pending.connection.nodeId ? pending.connection.handleId : undefined;
        const toHandleId = connection.toNodeId === pending.connection.nodeId ? pending.connection.handleId : undefined;
        const fromAnchorRatio = connection.fromNodeId === pending.connection.nodeId ? pending.connection.anchorRatio : 0.5;
        const toAnchorRatio = connection.toNodeId === pending.connection.nodeId ? pending.connection.anchorRatio : 0.5;
        const connected = { ...connection, fromHandleId, toHandleId, fromAnchorRatio, toAnchorRatio };
        setNodes((currentNodes) => attachNodeToStoryboardRow([...currentNodes, newNode], connected));
        setConnections((currentConnections) => [...currentConnections, { id: nanoid(), ...connected }]);
        setSelectedNodeIds(new Set([newNode.id]));
        setSelectedConnectionId(null);
        if (type === CanvasNodeType.Drawing) setDrawingNodeId(newNode.id);
        else if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Script && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        closeConnectionCreateMenu();
        setConnecting(null);
    }, [closeConnectionCreateMenu, defaultDrawingEngine, message, nodesRef, projectId, setConnecting, setConnections, setDialogNodeId, setDrawingNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, tldrawLicenseKey]);

    const getConnectionDropTarget = useCallback((clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
        const world = screenToCanvas(clientX, clientY);
        const scale = Math.max(viewportRef.current.k, 0.05);
        const padding = CONNECTION_NODE_HIT_PADDING / scale;
        const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
        let isNearNode = false;
        let bestNodeId: string | null = null;
        let bestHandleId: string | undefined;
        let bestAnchorRatio: number | undefined;
        let bestPriority = Number.POSITIVE_INFINITY;

        [...nodesRef.current]
            .filter((node) => !isHiddenBatchChild(node, nodesRef.current) && !isNodeHiddenByCollapsedFrame(node, nodesRef.current) && !isFrameNode(node))
            .reverse()
            .forEach((node) => {
                const scrollTop = scriptScrollTopById[node.id] || 0;
                const targetHandleId = node.type === CanvasNodeType.Script ? storyboardHandleAtY(node, world.y, scrollTop) : undefined;
                if (node.type === CanvasNodeType.Script && !targetHandleId) return;
                const targetAnchorRatio = node.type === CanvasNodeType.Script ? undefined : Math.min(0.94, Math.max(0.06, (world.y - node.position.y) / Math.max(node.height, 1)));
                const anchor = getConnectionTargetAnchor(node, current, targetHandleId, scrollTop, targetAnchorRatio);
                const dx = world.x - anchor.x;
                const dy = world.y - anchor.y;
                const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;
                if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                isNearNode = true;
                if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;
                const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                if (priority < bestPriority) {
                    bestNodeId = node.id;
                    bestHandleId = targetHandleId;
                    bestAnchorRatio = targetAnchorRatio;
                    bestPriority = priority;
                }
            });
        return { nodeId: bestNodeId, handleId: bestHandleId, anchorRatio: bestAnchorRatio, isNearNode };
    }, [nodesRef, screenToCanvas, scriptScrollTopById, viewportRef]);

    const finishConnection = useCallback((clientX: number, clientY: number) => {
        if (pendingConnectionCreateRef.current) return;
        const currentConnection = connectingParamsRef.current;
        if (!currentConnection) return;
        const dropTarget = getConnectionDropTarget(clientX, clientY, currentConnection);
        if (dropTarget.nodeId) {
            connectNodes(currentConnection, dropTarget.nodeId, dropTarget.handleId, dropTarget.anchorRatio);
            setConnecting(null);
        } else if (dropTarget.isNearNode) {
            setConnecting(null);
        } else {
            const position = screenToCanvas(clientX, clientY);
            setMouseWorld(position);
            const pending = { connection: currentConnection, position };
            pendingConnectionCreateRef.current = pending;
            setPendingConnectionCreate(pending);
        }
    }, [connectNodes, getConnectionDropTarget, screenToCanvas, setConnecting]);

    const handleConnectStart = useCallback((event: ReactPointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string, anchorRatio?: number) => {
        event.preventDefault();
        event.stopPropagation();
        connectingPointerIdRef.current = event.pointerId;
        connectingPointerStartRef.current = { x: event.clientX, y: event.clientY };
        setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        setConnecting({ nodeId, handleType, handleId, anchorRatio });
        setConnectionTargetNodeId(null);
        setConnectionTargetAnchorRatio(undefined);
        setSelectedConnectionId(null);
    }, [screenToCanvas, setConnecting, setSelectedConnectionId]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const current = connectingParamsRef.current;
            if (!current || connectingPointerIdRef.current !== event.pointerId || pendingConnectionCreateRef.current) return;
            const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, current);
            setConnectionTargetNodeId(dropTarget.nodeId);
            setConnectionTargetAnchorRatio(dropTarget.anchorRatio);
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        };
        const handlePointerUp = (event: PointerEvent) => {
            if (connectingPointerIdRef.current !== event.pointerId) return;
            const start = connectingPointerStartRef.current;
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) {
                const current = connectingParamsRef.current;
                if (current) {
                    const pending = { connection: current, position: screenToCanvas(event.clientX, event.clientY), quick: true };
                    pendingConnectionCreateRef.current = pending;
                    setPendingConnectionCreate(pending);
                    setConnecting(null);
                    return;
                }
            }
            finishConnection(event.clientX, event.clientY);
        };
        const handlePointerCancel = (event: PointerEvent) => {
            if (connectingPointerIdRef.current === event.pointerId) setConnecting(null);
        };
        const cancel = () => {
            if (connectingParamsRef.current) setConnecting(null);
        };
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);
        window.addEventListener("blur", cancel);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerCancel);
            window.removeEventListener("blur", cancel);
        };
    }, [finishConnection, getConnectionDropTarget, screenToCanvas, setConnecting]);

    return {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetNodeId,
        connectionTargetAnchorRatio,
        connectingParams,
        createConnectedNode,
        handleConnectStart,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    };
}
