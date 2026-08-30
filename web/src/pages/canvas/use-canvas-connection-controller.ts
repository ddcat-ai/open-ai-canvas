import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import type { PendingConnectionCreate } from "@/components/canvas/canvas-workspace-overlays";
import { getNodeSpec } from "@/constant/canvas";
import { batchSourceRestriction, buildBatchConnectionCreateRequest, hasBatchConnectionCandidate, planBatchConnections, type CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { connectedNodeCenterFromEdgeDrop } from "@/lib/canvas/canvas-connected-node-placement";
import { canvasConnectionError } from "@/lib/canvas/canvas-connection-policy";
import { attachNodeToStoryboardRow, createCanvasNode, getConnectionTargetAnchor, isHiddenBatchChild, normalizeConnection, storyboardHandleAtY, storyboardPromptTemplateMetadata, storyboardRowFromHandle } from "@/lib/canvas/canvas-project-domain";
import { createCanvasDrawingFromImage } from "@/lib/canvas/canvas-drawing-storage";
import { isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { normalizeRunningHubCapability, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ConnectionHandle, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";
import { workflowProviderPluginEnabled } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";

type UseCanvasConnectionControllerOptions = {
    projectId: string;
    config: AiConfig;
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

type BatchConnectionDropTarget = ConnectionDropTarget;

const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;

function selectRunningHubWorkflow(config: AiConfig) {
    const capability = normalizeRunningHubCapability(config.runningHub.capability);
    return config.runningHub.workflows.find((item) => item.workflowId.trim() === config.runningHub.workflowId.trim()
        && (item.kind === "app" ? "app" : "workflow") === config.runningHub.selectedKind)
        || config.runningHub.workflows.find((item) => normalizeRunningHubCapability(item.capability, capability) === capability)
        || config.runningHub.workflows[0];
}

function selectComfyBridgeWorkflow(config: AiConfig) {
    return config.comfyBridge.workflows.find((item) => item.workflowId.trim() === config.comfyBridge.workflowId.trim())
        || config.comfyBridge.workflows.find((item) => item.capability === config.comfyBridge.capability)
        || config.comfyBridge.workflows[0];
}

export function useCanvasConnectionController({
    projectId,
    config,
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
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [connectionTargetAnchorRatio, setConnectionTargetAnchorRatio] = useState<number | undefined>();
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [batchConnectionPreview, setBatchConnectionPreview] = useState<CanvasBatchConnectionPreview | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const connectingParamsRef = useRef(connectingParams);
    const connectingPointerIdRef = useRef<number | null>(null);
    const connectingPointerStartRef = useRef<Position | null>(null);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const batchConnectionPreviewRef = useRef<CanvasBatchConnectionPreview | null>(null);
    const batchConnectionPointerIdRef = useRef<number | null>(null);
    const batchConnectionPointerStartRef = useRef<Position | null>(null);

    useLayoutEffect(() => {
        connectingParamsRef.current = connectingParams;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [connectingParams, pendingConnectionCreate]);

    const updateBatchConnectionPreview = useCallback((next: CanvasBatchConnectionPreview | null) => {
        batchConnectionPreviewRef.current = next;
        setBatchConnectionPreview(next);
    }, []);

    const clearBatchConnection = useCallback(() => {
        batchConnectionPointerIdRef.current = null;
        batchConnectionPointerStartRef.current = null;
        updateBatchConnectionPreview(null);
    }, [updateBatchConnectionPreview]);

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
        clearBatchConnection();
    }, [clearBatchConnection, closeConnectionCreateMenu, setConnecting]);

    const previewBatchConnection = useCallback((sourceNodeIds: string[], targetNodeId: string | null, targetHandleId: string | undefined, targetAnchorRatio: number | undefined, mouseWorld: Position) => {
        const plan = targetNodeId
            ? planBatchConnections({ sourceNodeIds, targetNodeId, targetHandleId, targetAnchorRatio, nodes: nodesRef.current, connections: connectionsRef.current, config })
            : null;
        const eligibleSourceCount = sourceNodeIds.filter((id) => {
            const node = nodesRef.current.find((item) => item.id === id);
            return Boolean(node && !batchSourceRestriction(node));
        }).length;
        const status = !targetNodeId || !plan ? "idle" : plan.connections.length === eligibleSourceCount ? "valid" : plan.connections.length ? "partial" : "invalid";
        updateBatchConnectionPreview({ sourceNodeIds, targetNodeId, targetHandleId, targetAnchorRatio, mouseWorld, status });
        return plan;
    }, [config, connectionsRef, nodesRef, updateBatchConnectionPreview]);

    const commitBatchConnection = useCallback((sourceNodeIds: string[], targetNodeId: string, targetHandleId?: string, targetAnchorRatio?: number) => {
        const plan = planBatchConnections({ sourceNodeIds, targetNodeId, targetHandleId, targetAnchorRatio, nodes: nodesRef.current, connections: connectionsRef.current, config });
        if (!plan.connections.length) {
            const reason = plan.skipped[0]?.reason || "没有可建立的连接";
            message.warning(reason);
            return plan;
        }
        setNodes((currentNodes) => plan.connections.reduce((current, connection) => attachNodeToStoryboardRow(current, connection), currentNodes));
        setConnections((currentConnections) => [...currentConnections, ...plan.connections]);
        setContextMenu(null);
        const skippedCount = plan.skipped.length;
        const duplicateCount = plan.duplicates.length;
        const suffix = skippedCount || duplicateCount ? `，跳过 ${skippedCount + duplicateCount} 个` : "";
        if (skippedCount) message.warning(`已连接 ${plan.connected.length} 个节点${suffix}：${plan.skipped[0].reason}`);
        else message.success(`已连接 ${plan.connected.length} 个节点${suffix}`);
        return plan;
    }, [config, connectionsRef, message, nodesRef, setConnections, setContextMenu, setNodes]);

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
        const policyError = canvasConnectionError(config, nodesRef.current, connectionsRef.current, { fromNodeId, toNodeId });
        if (policyError) {
            message.warning(policyError);
            return;
        }
        const exists = connectionsRef.current.find((item) => item.fromNodeId === fromNodeId && item.toNodeId === toNodeId && item.fromHandleId === fromHandleId && item.toHandleId === toHandleId);
        if (exists) {
            setConnections((currentConnections) => currentConnections.map((item) => item.id === exists.id ? { ...item, fromAnchorRatio, toAnchorRatio } : item));
        } else {
            setConnections((currentConnections) => [...currentConnections, { id: `conn-${Date.now()}`, fromNodeId, toNodeId, fromHandleId, toHandleId, fromAnchorRatio, toAnchorRatio }]);
            setNodes((currentNodes) => attachNodeToStoryboardRow(currentNodes, { fromNodeId, toNodeId, fromHandleId, toHandleId }));
        }
        setContextMenu(null);
    }, [config, connectionsRef, message, nodesRef, setConnections, setContextMenu, setNodes]);

    const createConnectedNode = useCallback(async (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config, pending: PendingConnectionCreate, workflowProvider?: "runninghub" | "comfyui") => {
        const nodeType = type;
        if (nodeType === CanvasNodeType.Drawing && !isDrawingEngineAvailable(defaultDrawingEngine, tldrawLicenseKey)) {
            message.error("当前生产构建未配置 tldraw License Key，不能创建 tldraw 绘图");
            return;
        }
        const batchSourceNodeIds = pending.batchSourceNodeIds?.length ? Array.from(new Set(pending.batchSourceNodeIds)) : [];
        const batchSourceNodes = batchSourceNodeIds
            .map((nodeId) => nodesRef.current.find((node) => node.id === nodeId))
            .filter((node): node is CanvasNodeData => Boolean(node));
        const storyboardRow = batchSourceNodeIds.length ? undefined : nodeType === CanvasNodeType.Video ? storyboardRowFromHandle(nodesRef.current, pending.connection.nodeId, pending.connection.handleId) : undefined;
        const videoPrompt = storyboardRow ? (storyboardRow.videoMotionPrompt || storyboardRow.plotDescription).trim() : "";
        const sourceNode = pending.connection.handleType === "source" ? nodesRef.current.find((node) => node.id === pending.connection.nodeId) : undefined;
        const batchScriptPrompt = batchSourceNodes
            .filter((node) => node.type === CanvasNodeType.Text)
            .map((node) => (node.metadata?.content || node.metadata?.prompt || "").trim())
            .filter(Boolean)
            .join("\n\n");
        const scriptPrompt = nodeType === CanvasNodeType.Script
            ? batchSourceNodeIds.length ? batchScriptPrompt : sourceNode?.type === CanvasNodeType.Text ? (sourceNode.metadata?.content || sourceNode.metadata?.prompt || "").trim() : ""
            : "";
        const selectedWorkflowProvider = nodeType === CanvasNodeType.Config
            ? workflowProvider || (workflowProviderPluginEnabled(runtimeStatuses, "runninghub") ? "runninghub" : workflowProviderPluginEnabled(runtimeStatuses, "comfyui") ? "comfyui" : undefined)
            : undefined;
        if (selectedWorkflowProvider && !workflowProviderPluginEnabled(runtimeStatuses, selectedWorkflowProvider)) {
            message.error(`${selectedWorkflowProvider === "runninghub" ? "RunningHub" : "ComfyUI"} 工作流插件未启用`);
            closeConnectionCreateMenu();
            return;
        }
        const runningHubWorkflow = selectedWorkflowProvider === "runninghub" ? selectRunningHubWorkflow(config) : undefined;
        const comfyBridgeWorkflow = selectedWorkflowProvider === "comfyui" ? selectComfyBridgeWorkflow(config) : undefined;
        const workflowCapability = selectedWorkflowProvider === "runninghub"
            ? normalizeRunningHubCapability(runningHubWorkflow?.capability, normalizeRunningHubCapability(config.runningHub.capability))
            : comfyBridgeWorkflow?.capability || "image";
        const metadata: CanvasNodeMetadata | undefined = nodeType === CanvasNodeType.Config
            ? {
                generationMode: selectedWorkflowProvider ? workflowCapability === "video" ? "video" as const : workflowCapability === "audio" ? "audio" as const : "image" as const : "image" as const,
                workflowProvider: selectedWorkflowProvider || "model",
                status: NODE_STATUS_IDLE,
                ...(selectedWorkflowProvider === "runninghub" ? {
                    workflowTitle: "RunningHub 工作流",
                    ...(runningHubWorkflow ? { runningHubWorkflowId: runningHubWorkflow.workflowId, runningHubWorkflowKind: runningHubWorkflow.kind === "app" ? "app" as const : "workflow" as const } : {}),
                } : selectedWorkflowProvider === "comfyui" ? {
                    workflowTitle: "ComfyUI Bridge",
                    ...(comfyBridgeWorkflow ? { comfyBridgeWorkflowId: comfyBridgeWorkflow.workflowId } : {}),
                } : {})
              }
            : nodeType === CanvasNodeType.Drawing
            ? { drawingEngine: defaultDrawingEngine }
            : nodeType === CanvasNodeType.Script && scriptPrompt
              ? { prompt: scriptPrompt, composerContent: scriptPrompt }
            : nodeType === CanvasNodeType.Video && storyboardRow
              ? { prompt: videoPrompt, composerContent: videoPrompt, ...storyboardPromptTemplateMetadata(storyboardRow, "video"), generationMode: "video" as const, videoEditOperation: "text_to_video" as const, workflowKind: "shot" as const, workflowTitle: `镜头 ${storyboardRow.shotNumber} 视频`, shotIndex: storyboardRow.shotNumber, seconds: String(storyboardRow.durationSeconds), status: NODE_STATUS_IDLE }
              : undefined;
        const sourceNodeForQuickCreate = pending.quick ? nodesRef.current.find((node) => node.id === pending.connection.nodeId) : undefined;
        const spec = getNodeSpec(nodeType);
        const anchorY = sourceNodeForQuickCreate ? sourceNodeForQuickCreate.position.y + sourceNodeForQuickCreate.height * (pending.connection.anchorRatio ?? 0.5) : pending.position.y;
        const position = sourceNodeForQuickCreate
            ? {
                  x: pending.connection.handleType === "source"
                      ? sourceNodeForQuickCreate.position.x + sourceNodeForQuickCreate.width + 96 + spec.width / 2
                      : sourceNodeForQuickCreate.position.x - 96 - spec.width / 2,
                  y: anchorY,
              }
            : batchSourceNodeIds.length
              ? pending.position
              : connectedNodeCenterFromEdgeDrop(pending.position, spec, pending.connection.handleType);
        const newNode = createCanvasNode(nodeType, position, metadata);
        if (nodeType === CanvasNodeType.Config && selectedWorkflowProvider) newNode.title = selectedWorkflowProvider === "runninghub" ? "RunningHub 工作流" : "ComfyUI Bridge";
        if (storyboardRow) newNode.title = `镜头 ${storyboardRow.shotNumber} · 视频`;
        if (batchSourceNodeIds.length && nodeType === CanvasNodeType.Drawing) {
            message.error("批量连接暂不支持创建绘图，请先连接到普通节点");
            closeConnectionCreateMenu();
            return;
        }
        const batchPlan = batchSourceNodeIds.length
            ? planBatchConnections({ sourceNodeIds: batchSourceNodeIds, targetNodeId: newNode.id, nodes: [...nodesRef.current, newNode], connections: connectionsRef.current, config, allowCapacityOverflow: true })
            : null;
        if (batchPlan) {
            if (!batchPlan.connections.length) {
                const detail = batchPlan.skipped.slice(0, 3).map((item) => item.reason).join("；");
                message.warning(detail ? `没有可建立的连接：${detail}` : "没有可建立的连接");
                closeConnectionCreateMenu();
                setConnecting(null);
                return;
            }
            const nextConnections = [...connectionsRef.current, ...batchPlan.connections];
            const nextNodes = batchPlan.connections.reduce((currentNodes, connection) => attachNodeToStoryboardRow(currentNodes, connection), [...nodesRef.current, newNode]);
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (nodeType !== CanvasNodeType.Text && nodeType !== CanvasNodeType.Script && nodeType !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            const skippedCount = batchPlan.skipped.length;
            const duplicateCount = batchPlan.duplicates.length;
            const suffix = skippedCount || duplicateCount ? `，跳过 ${skippedCount + duplicateCount} 个` : "";
            if (skippedCount) message.warning(`已创建并连接 ${batchPlan.connections.length} 个源节点${suffix}：${batchPlan.skipped[0].reason}`);
            else message.success(`已创建节点并连接 ${batchPlan.connections.length} 个源节点${suffix}`);
            closeConnectionCreateMenu();
            setConnecting(null);
            return;
        }
        const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
        if (!connection) {
            message.warning("当前节点不能建立这条连线");
            return;
        }
        const policyError = canvasConnectionError(config, [...nodesRef.current, newNode], connectionsRef.current, connection);
        if (policyError) {
            message.warning(policyError);
            return;
        }
        if (nodeType === CanvasNodeType.Drawing) {
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
        if (nodeType === CanvasNodeType.Drawing) setDrawingNodeId(newNode.id);
        else if (nodeType !== CanvasNodeType.Text && nodeType !== CanvasNodeType.Script && nodeType !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
        closeConnectionCreateMenu();
        setConnecting(null);
    }, [closeConnectionCreateMenu, config, connectionsRef, defaultDrawingEngine, message, nodesRef, projectId, runtimeStatuses, setConnecting, setConnections, setDialogNodeId, setDrawingNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, tldrawLicenseKey]);

    const getConnectionCreateDisabledReason = useCallback((type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config, pending: PendingConnectionCreate, workflowProvider?: "runninghub" | "comfyui") => {
        const nodeType = type;
        if (nodeType === CanvasNodeType.Config) {
            if (workflowProvider && !workflowProviderPluginEnabled(runtimeStatuses, workflowProvider)) return `${workflowProvider === "runninghub" ? "RunningHub" : "ComfyUI"} 工作流插件未启用`;
        }
        if (pending.batchSourceNodeIds?.length) {
            if (nodeType === CanvasNodeType.Drawing || nodeType === CanvasNodeType.Config) return "批量连接暂不支持此节点类型";
            const pendingNode: CanvasNodeData = { id: "__pending-connection-node__", type: nodeType, title: "", position: pending.position, width: getNodeSpec(nodeType).width, height: getNodeSpec(nodeType).height };
            const plan = planBatchConnections({ sourceNodeIds: pending.batchSourceNodeIds, targetNodeId: pendingNode.id, nodes: [...nodesRef.current, pendingNode], connections: connectionsRef.current, config, allowCapacityOverflow: true });
            return plan.connections.length ? "" : plan.skipped[0]?.reason || "当前选中的节点不能连接到此类型";
        }
        const spec = getNodeSpec(nodeType);
        const pendingNode: CanvasNodeData = { id: "__pending-connection-node__", type: nodeType, title: "", position: pending.position, width: spec.width, height: spec.height };
        const pendingNodes = [...nodesRef.current, pendingNode];
        const connection = normalizeConnection(pending.connection.nodeId, pendingNode.id, pendingNodes, pending.connection.handleType);
        if (!connection) return "当前节点类型不能这样连接";
        return canvasConnectionError(config, pendingNodes, connectionsRef.current, connection);
    }, [config, connectionsRef, nodesRef, runtimeStatuses]);

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
                const anchor = getConnectionTargetAnchor(node, current, targetHandleId, scrollTop);
                const dx = world.x - anchor.x;
                const dy = world.y - anchor.y;
                const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;
                if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                isNearNode = true;
                const normalized = node.id === current.nodeId ? null : normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType);
                if (!normalized || canvasConnectionError(config, nodesRef.current, connectionsRef.current, normalized)) return;
                const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                if (priority < bestPriority) {
                    bestNodeId = node.id;
                    bestHandleId = targetHandleId;
                    bestAnchorRatio = targetAnchorRatio;
                    bestPriority = priority;
                }
            });
        return { nodeId: bestNodeId, handleId: bestHandleId, anchorRatio: bestAnchorRatio, isNearNode };
    }, [config, connectionsRef, nodesRef, screenToCanvas, scriptScrollTopById, viewportRef]);

    const getBatchConnectionDropTarget = useCallback((clientX: number, clientY: number, sourceNodeIds: string[]): BatchConnectionDropTarget => {
        const source = sourceNodeIds
            .map((id) => nodesRef.current.find((node) => node.id === id))
            .find((node): node is CanvasNodeData => Boolean(node && !batchSourceRestriction(node)));
        if (!source) return { nodeId: null, isNearNode: false };

        const world = screenToCanvas(clientX, clientY);
        const scale = Math.max(viewportRef.current.k, 0.05);
        const padding = CONNECTION_NODE_HIT_PADDING / scale;
        const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
        let isNearNode = false;
        let bestNodeId: string | null = null;
        let bestHandleId: string | undefined;
        let bestAnchorRatio: number | undefined;
        let bestPriority = Number.POSITIVE_INFINITY;
        const current: ConnectionHandle = { nodeId: source.id, handleType: "source" };

        [...nodesRef.current]
            .filter((node) => !isHiddenBatchChild(node, nodesRef.current) && !isNodeHiddenByCollapsedFrame(node, nodesRef.current) && !isFrameNode(node))
            .reverse()
            .forEach((node) => {
                const scrollTop = scriptScrollTopById[node.id] || 0;
                const targetHandleId = node.type === CanvasNodeType.Script ? storyboardHandleAtY(node, world.y, scrollTop) : undefined;
                if (node.type === CanvasNodeType.Script && !targetHandleId) return;
                const targetAnchorRatio = node.type === CanvasNodeType.Script ? undefined : Math.min(0.94, Math.max(0.06, (world.y - node.position.y) / Math.max(node.height, 1)));
                const anchor = getConnectionTargetAnchor(node, current, targetHandleId, scrollTop);
                const dx = world.x - anchor.x;
                const dy = world.y - anchor.y;
                const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;
                if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                isNearNode = true;
                if (!hasBatchConnectionCandidate(sourceNodeIds, node.id, nodesRef.current)) return;
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

    const startBatchConnection = useCallback((event: ReactPointerEvent, sourceNodeIds: string[]) => {
        const eligible = sourceNodeIds.filter((id) => {
            const node = nodesRef.current.find((item) => item.id === id);
            return Boolean(node && !batchSourceRestriction(node));
        });
        if (!eligible.length) {
            message.warning("当前选区没有可作为连接源的节点");
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        batchConnectionPointerIdRef.current = event.pointerId;
        batchConnectionPointerStartRef.current = { x: event.clientX, y: event.clientY };
        setSelectedConnectionId(null);
        const mouseWorld = screenToCanvas(event.clientX, event.clientY);
        previewBatchConnection(eligible, null, undefined, undefined, mouseWorld);
    }, [message, nodesRef, previewBatchConnection, screenToCanvas, setSelectedConnectionId]);

    const beginBatchConnectionMode = useCallback((sourceNodeIds: string[]) => {
        const eligible = sourceNodeIds.filter((id) => {
            const node = nodesRef.current.find((item) => item.id === id);
            return Boolean(node && !batchSourceRestriction(node));
        });
        const source = eligible.map((id) => nodesRef.current.find((node) => node.id === id)).find((node): node is CanvasNodeData => Boolean(node));
        if (!source) {
            message.warning("当前选区没有可作为连接源的节点");
            return;
        }
        previewBatchConnection(eligible, null, undefined, undefined, { x: source.position.x + source.width, y: source.position.y + source.height / 2 });
        setSelectedConnectionId(null);
    }, [message, nodesRef, previewBatchConnection, setSelectedConnectionId]);

    const finishBatchConnection = useCallback((clientX: number, clientY: number) => {
        const batch = batchConnectionPreviewRef.current;
        if (!batch) return false;
        const target = getBatchConnectionDropTarget(clientX, clientY, batch.sourceNodeIds);
        if (!target.nodeId) return false;
        commitBatchConnection(batch.sourceNodeIds, target.nodeId, target.handleId, target.anchorRatio);
        clearBatchConnection();
        return true;
    }, [clearBatchConnection, commitBatchConnection, getBatchConnectionDropTarget]);

    const openBatchConnectionCreateMenu = useCallback((clientX: number, clientY: number) => {
        const batch = batchConnectionPreviewRef.current;
        if (!batch) return false;
        const position = screenToCanvas(clientX, clientY);
        const request = buildBatchConnectionCreateRequest(batch.sourceNodeIds, nodesRef.current, position);
        if (!request) {
            clearBatchConnection();
            message.warning("当前选区没有可作为连接源的节点");
            return false;
        }
        const pending: PendingConnectionCreate = request;
        pendingConnectionCreateRef.current = pending;
        setPendingConnectionCreate(pending);
        setMouseWorld(position);
        clearBatchConnection();
        return true;
    }, [clearBatchConnection, message, nodesRef, screenToCanvas]);

    const handleBatchConnectionTargetClick = useCallback((event: ReactPointerEvent | ReactMouseEvent) => {
        if (!batchConnectionPreviewRef.current) return false;
        const completed = finishBatchConnection(event.clientX, event.clientY);
        if (!completed) message.warning("请点击目标节点的输入端");
        return true;
    }, [finishBatchConnection, message]);

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
        if (batchConnectionPreviewRef.current && handleType === "target") {
            commitBatchConnection(batchConnectionPreviewRef.current.sourceNodeIds, nodeId, handleId, anchorRatio);
            clearBatchConnection();
            return;
        }
        if (batchConnectionPreviewRef.current) clearBatchConnection();
        connectingPointerIdRef.current = event.pointerId;
        connectingPointerStartRef.current = { x: event.clientX, y: event.clientY };
        setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        setConnecting({ nodeId, handleType, handleId, anchorRatio });
        setConnectionTargetNodeId(null);
        setConnectionTargetAnchorRatio(undefined);
        setSelectedConnectionId(null);
    }, [clearBatchConnection, commitBatchConnection, screenToCanvas, setConnecting, setSelectedConnectionId]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const batch = batchConnectionPreviewRef.current;
            if (batch && (batchConnectionPointerIdRef.current === null || batchConnectionPointerIdRef.current === event.pointerId)) {
                const target = getBatchConnectionDropTarget(event.clientX, event.clientY, batch.sourceNodeIds);
                const mouseWorld = screenToCanvas(event.clientX, event.clientY);
                previewBatchConnection(batch.sourceNodeIds, target.nodeId, target.handleId, target.anchorRatio, mouseWorld);
                return;
            }
            const current = connectingParamsRef.current;
            if (!current || connectingPointerIdRef.current !== event.pointerId || pendingConnectionCreateRef.current) return;
            const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, current);
            setConnectionTargetNodeId(dropTarget.nodeId);
            setConnectionTargetAnchorRatio(dropTarget.anchorRatio);
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        };
        const handlePointerUp = (event: PointerEvent) => {
            if (batchConnectionPointerIdRef.current === event.pointerId) {
                const start = batchConnectionPointerStartRef.current;
                const batch = batchConnectionPreviewRef.current;
                if (batch && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) {
                    const target = getBatchConnectionDropTarget(event.clientX, event.clientY, batch.sourceNodeIds);
                    if (target.nodeId) {
                        commitBatchConnection(batch.sourceNodeIds, target.nodeId, target.handleId, target.anchorRatio);
                        clearBatchConnection();
                    } else if (!target.isNearNode) openBatchConnectionCreateMenu(event.clientX, event.clientY);
                    else clearBatchConnection();
                    return;
                }
                const completed = finishBatchConnection(event.clientX, event.clientY);
                if (!completed) {
                    const target = getBatchConnectionDropTarget(event.clientX, event.clientY, batch?.sourceNodeIds || []);
                    if (!target.isNearNode) openBatchConnectionCreateMenu(event.clientX, event.clientY);
                    else clearBatchConnection();
                }
                return;
            }
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
            if (batchConnectionPointerIdRef.current === event.pointerId) {
                clearBatchConnection();
                return;
            }
            if (connectingPointerIdRef.current === event.pointerId) setConnecting(null);
        };
        const cancel = () => {
            if (connectingParamsRef.current) setConnecting(null);
            if (batchConnectionPreviewRef.current) clearBatchConnection();
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
    }, [clearBatchConnection, commitBatchConnection, finishBatchConnection, finishConnection, getBatchConnectionDropTarget, getConnectionDropTarget, openBatchConnectionCreateMenu, previewBatchConnection, screenToCanvas, setConnecting]);

    return {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetNodeId,
        connectionTargetAnchorRatio,
        connectingParams,
        createConnectedNode,
        getConnectionCreateDisabledReason,
        handleConnectStart,
        handleBatchConnectionTargetClick,
        batchConnectionPreview,
        beginBatchConnectionMode,
        startBatchConnection,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    };
}
