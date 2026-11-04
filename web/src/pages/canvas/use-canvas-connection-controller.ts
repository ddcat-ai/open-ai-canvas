import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";
import { latchCanvasConnectionApproach, type CanvasConnectionApproach } from "@/lib/canvas/canvas-connection-tilt";

import type { PendingConnectionCreate } from "@/components/canvas/canvas-workspace-overlays";
import { getNodeSpec } from "@/constant/canvas";
import { batchCellSourcesError, batchConnectionRejectReason, batchSourceRestriction, buildBatchConnectionCreateRequest, hasBatchConnectionCandidate, planBatchConnections, type CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { batchCellConnectionError, batchCellHandle, parseBatchCellHandle, type BatchScroll } from "@/lib/canvas/canvas-batch-references";
import { connectedNodeCenterFromEdgeDrop } from "@/lib/canvas/canvas-connected-node-placement";
import { canvasConnectionError, connectionInputSummary } from "@/lib/canvas/canvas-connection-policy";
import { resolveCanvasConnectionTarget, type CanvasConnectionDropTarget as ConnectionDropTarget } from "@/lib/canvas/canvas-connection-hit";
import { CANVAS_WHEEL_POPUP_SELECTOR } from "@/lib/canvas/canvas-wheel-intent";
import { audioModelForConnectionInput } from "@/lib/model-selection";
import { attachNodeToStoryboardRow, createCanvasNode, normalizeConnection, storyboardPromptTemplateMetadata, storyboardRowFromHandle, storyboardRowVideoPrompt } from "@/lib/canvas/canvas-project-domain";
import { canvasImageNodeDimensions } from "@/lib/canvas/canvas-reference-image-size";
import { imageNodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { createCanvasDrawingFromImage } from "@/lib/canvas/canvas-drawing-storage";
import { isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
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
    batchScrollById?: Record<string, BatchScroll>;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setDrawingNodeId: Dispatch<SetStateAction<string | null>>;
    onReplaceReference?: (targetNodeId: string, oldReference: { id: string; nodeId?: string; label?: string; title?: string }, sourceNodeId: string) => void;
    onBatchCellConnect?: (tableId: string, rowId: string, columnId: string, sourceId: string) => void;
};

export type ConnectionReplaceHover = {
    targetNodeId: string;
    referenceLabel: string;
    clientX: number;
    clientY: number;
};

type BatchConnectionDropTarget = ConnectionDropTarget;

// LibTV's 80px world-space quick-add zone renders at roughly 110px on the
// reference canvas. Use the same generous 112px screen-space diameter here,
// while retaining a circular boundary around the corresponding side anchor.
const CONNECTION_SNAP_RADIUS = 56;
// 松手后没有 click 到来时（指针移出窗口、触摸的 click 来得晚）守卫最多保留这么久。
const BATCH_PRESS_GUARD_MS = 500;
const NODE_STATUS_IDLE = "idle" as const;

function selectRunningHubWorkflow(config: AiConfig) {
    const capability = normalizeRunningHubCapability(config.runningHub.capability);
    return config.runningHub.workflows.find((item) => item.workflowId.trim() === config.runningHub.workflowId.trim()
        && (item.kind === "app" ? "app" : "workflow") === config.runningHub.selectedKind)
        || config.runningHub.workflows.find((item) => normalizeRunningHubCapability(item.capability, capability) === capability)
        || config.runningHub.workflows[0];
}

export function useCanvasConnectionController({
    projectId,
    config,
    defaultDrawingEngine,
    nodesRef,
    connectionsRef,
    viewportRef,
    scriptScrollTopById,
    batchScrollById,
    screenToCanvas,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
    setDrawingNodeId,
    onReplaceReference,
    onBatchCellConnect,
}: UseCanvasConnectionControllerOptions) {
    const { message } = App.useApp();
    const tldrawLicenseKey = useUserStore((state) => state.drawingEngine.tldrawLicenseKey);
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [connectionApproach, setConnectionApproach] = useState<CanvasConnectionApproach>(null);
    const [connectionReplaceHover, setConnectionReplaceHover] = useState<ConnectionReplaceHover | null>(null);
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
    const pointerMoveFrameRef = useRef<number | null>(null);
    const latestPointerMoveRef = useRef<PointerEvent | null>(null);
    const hoveredReplaceElRef = useRef<HTMLElement | null>(null);
    // 按钮入口的按下被接管后，同一次操作随后的鼠标事件和 click 由它吞掉。
    const batchPressGuardRef = useRef<{ pointerId: number; timer: number | null } | null>(null);

    const releaseBatchPressGuard = useCallback(() => {
        const guard = batchPressGuardRef.current;
        if (!guard) return;
        if (guard.timer !== null) window.clearTimeout(guard.timer);
        batchPressGuardRef.current = null;
    }, []);

    const updateConnectionReplaceHover = useCallback((element: HTMLElement | null, clientX = 0, clientY = 0) => {
        if (hoveredReplaceElRef.current === element) {
            if (element) {
                setConnectionReplaceHover((prev) => prev ? { ...prev, clientX, clientY } : null);
            }
            return;
        }
        if (hoveredReplaceElRef.current) {
            hoveredReplaceElRef.current.removeAttribute("data-connection-hover-replace");
        }
        hoveredReplaceElRef.current = element;
        if (element) {
            element.setAttribute("data-connection-hover-replace", "true");
            const targetNodeId = element.getAttribute("data-target-node-id") || "";
            const referenceLabel = element.getAttribute("data-reference-label") || "参考图";
            setConnectionReplaceHover({ targetNodeId, referenceLabel, clientX, clientY });
        } else {
            setConnectionReplaceHover(null);
        }
    }, []);

    useLayoutEffect(() => {
        connectingParamsRef.current = connectingParams;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [connectingParams, pendingConnectionCreate]);

    const updateBatchConnectionPreview = useCallback((next: CanvasBatchConnectionPreview | null) => {
        batchConnectionPreviewRef.current = next;
        setBatchConnectionPreview(next);
        setConnectionApproach((previous) => latchCanvasConnectionApproach(previous, next && next.status !== "invalid" ? next.targetNodeId : null, next?.mouseWorld || { x: 0, y: 0 }));
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
            updateConnectionReplaceHover(null);
            setConnectionApproach(null);
            connectingPointerIdRef.current = null;
            connectingPointerStartRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, [updateConnectionReplaceHover]);

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
        const cell = parseBatchCellHandle(targetHandleId);
        if (cell) {
            const error = batchCellSourcesError(nodesRef.current, sourceNodeIds, targetNodeId, targetHandleId);
            if (error) message.warning(error);
            else onBatchCellConnect?.(targetNodeId, cell.rowId, cell.columnId, sourceNodeIds[0]);
            return plan;
        }
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
    }, [config, connectionsRef, message, nodesRef, onBatchCellConnect, setConnections, setContextMenu, setNodes]);

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
        const cell = parseBatchCellHandle(toHandleId);
        if (cell) {
            const error = batchCellConnectionError(nodesRef.current, fromNodeId, toNodeId, toHandleId);
            if (error) message.warning(error);
            else onBatchCellConnect?.(toNodeId, cell.rowId, cell.columnId, fromNodeId);
            setContextMenu(null);
            return;
        }
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
    }, [config, connectionsRef, message, nodesRef, onBatchCellConnect, setConnections, setContextMenu, setNodes]);

    const createConnectedNode = useCallback(async (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.BatchTable | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion, pending: PendingConnectionCreate, workflowProvider?: "runninghub") => {
        const nodeType = type;
        if (nodeType === CanvasNodeType.Drawing && !isDrawingEngineAvailable(defaultDrawingEngine, tldrawLicenseKey)) {
            message.error("当前生产构建未配置 tldraw License Key，不能创建 tldraw 绘图");
            closeConnectionCreateMenu();
            setConnecting(null);
            return;
        }
        const batchSourceNodeIds = pending.batchSourceNodeIds?.length ? Array.from(new Set(pending.batchSourceNodeIds)) : [];
        const batchSourceNodes = batchSourceNodeIds
            .map((nodeId) => nodesRef.current.find((node) => node.id === nodeId))
            .filter((node): node is CanvasNodeData => Boolean(node));
        const storyboardRow = batchSourceNodeIds.length ? undefined : nodeType === CanvasNodeType.Video ? storyboardRowFromHandle(nodesRef.current, pending.connection.nodeId, pending.connection.handleId) : undefined;
        const videoPrompt = storyboardRow ? storyboardRowVideoPrompt(storyboardRow) : "";
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
            ? workflowProvider || (workflowProviderPluginEnabled(runtimeStatuses, "runninghub") ? "runninghub" : undefined)
            : undefined;
        if (selectedWorkflowProvider && !workflowProviderPluginEnabled(runtimeStatuses, selectedWorkflowProvider)) {
            message.error("RunningHub 工作流插件未启用");
            closeConnectionCreateMenu();
            setConnecting(null);
            return;
        }
        const runningHubWorkflow = selectedWorkflowProvider === "runninghub" ? selectRunningHubWorkflow(config) : undefined;
        const workflowCapability = normalizeRunningHubCapability(runningHubWorkflow?.capability, normalizeRunningHubCapability(config.runningHub.capability));
        const metadata: CanvasNodeMetadata | undefined = nodeType === CanvasNodeType.Config
            ? {
                generationMode: selectedWorkflowProvider ? workflowCapability === "video" ? "video" as const : workflowCapability === "audio" ? "audio" as const : "image" as const : "image" as const,
                workflowProvider: selectedWorkflowProvider || "model",
                status: NODE_STATUS_IDLE,
                ...(selectedWorkflowProvider === "runninghub" ? {
                    workflowTitle: "RunningHub 工作流",
                    ...(runningHubWorkflow ? { runningHubWorkflowId: runningHubWorkflow.workflowId, runningHubWorkflowKind: runningHubWorkflow.kind === "app" ? "app" as const : "workflow" as const } : {}),
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
        // 从图片拖出的新图片节点按来源比例占位；生成时未选尺寸也按这张参考图的比例。
        const referenceSize = nodeType === CanvasNodeType.Image && !batchSourceNodeIds.length ? canvasImageNodeDimensions(sourceNode) : undefined;
        const referenceNodeSize = referenceSize ? imageNodeSizeFromRatio(`${referenceSize.width}:${referenceSize.height}`) : null;
        if (referenceNodeSize) {
            // 新节点在来源右侧，保持靠近来源的左边缘和垂直中心。
            newNode.position = { x: newNode.position.x, y: newNode.position.y + newNode.height / 2 - referenceNodeSize.height / 2 };
            newNode.width = referenceNodeSize.width;
            newNode.height = referenceNodeSize.height;
        }
        if (nodeType === CanvasNodeType.Audio) {
            const probe = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            const input = probe ? connectionInputSummary(newNode.id, [...nodesRef.current, newNode], connectionsRef.current, probe) : undefined;
            const model = input ? audioModelForConnectionInput(config, input) : audioModelForConnectionInput(config, { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0, characterCount: 0 });
            if (model) newNode.metadata = { ...newNode.metadata, model, generationMode: "audio" };
        }
        if (nodeType === CanvasNodeType.Config && selectedWorkflowProvider) newNode.title = "RunningHub 工作流";
        if (storyboardRow) newNode.title = `镜头 ${storyboardRow.shotNumber} · 视频`;
        if (batchSourceNodeIds.length && nodeType === CanvasNodeType.Drawing) {
            message.error("批量连接暂不支持创建绘图，请先连接到普通节点");
            closeConnectionCreateMenu();
            setConnecting(null);
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
            if (nodeType === CanvasNodeType.Script) setDialogNodeId(null);
            else if (nodeType !== CanvasNodeType.Text && nodeType !== CanvasNodeType.BatchTable && nodeType !== CanvasNodeType.Audio && nodeType !== CanvasNodeType.MediaConversion) setDialogNodeId(newNode.id);
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
            closeConnectionCreateMenu();
            setConnecting(null);
            return;
        }
        const policyError = canvasConnectionError(config, [...nodesRef.current, newNode], connectionsRef.current, connection);
        if (policyError) {
            message.warning(policyError);
            closeConnectionCreateMenu();
            setConnecting(null);
            return;
        }
        if (nodeType === CanvasNodeType.Drawing) {
            const drawingSourceNode = nodesRef.current.find((node) => node.id === pending.connection.nodeId);
            const sourceUrl = drawingSourceNode?.type === CanvasNodeType.Image ? drawingSourceNode.metadata?.content : "";
            if (pending.connection.handleType !== "source" || !drawingSourceNode || !sourceUrl || !newNode.metadata?.drawingId) {
                message.error("只有已有图片内容的输出连线可以创建绘图");
                closeConnectionCreateMenu();
                setConnecting(null);
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
        else if (nodeType === CanvasNodeType.Script) setDialogNodeId(null);
        else if (nodeType !== CanvasNodeType.Text && nodeType !== CanvasNodeType.BatchTable && nodeType !== CanvasNodeType.Audio && nodeType !== CanvasNodeType.MediaConversion) setDialogNodeId(newNode.id);
        closeConnectionCreateMenu();
        setConnecting(null);
    }, [closeConnectionCreateMenu, config, connectionsRef, defaultDrawingEngine, message, nodesRef, projectId, runtimeStatuses, setConnecting, setConnections, setDialogNodeId, setDrawingNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, tldrawLicenseKey]);

    const getConnectionCreateDisabledReason = useCallback((type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.BatchTable | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion, pending: PendingConnectionCreate, workflowProvider?: "runninghub") => {
        const nodeType = type;
        if (nodeType === CanvasNodeType.Config) {
            if (workflowProvider && !workflowProviderPluginEnabled(runtimeStatuses, workflowProvider)) return "RunningHub 工作流插件未启用";
        }
        if (pending.batchSourceNodeIds?.length) {
            if (nodeType === CanvasNodeType.Drawing || nodeType === CanvasNodeType.Config) return "批量连接暂不支持此节点类型";
            const pendingNode: CanvasNodeData = { id: "__pending-connection-node__", type: nodeType, title: "", position: pending.position, width: getNodeSpec(nodeType).width, height: getNodeSpec(nodeType).height };
            const plan = planBatchConnections({ sourceNodeIds: pending.batchSourceNodeIds, targetNodeId: pendingNode.id, nodes: [...nodesRef.current, pendingNode], connections: connectionsRef.current, config, allowCapacityOverflow: true });
            return plan.connections.length ? "" : plan.skipped[0]?.reason || "当前选中的节点不能连接到此类型";
        }
        const spec = getNodeSpec(nodeType);
        const basePendingNode: CanvasNodeData = { id: "__pending-connection-node__", type: nodeType, title: "", position: pending.position, width: spec.width, height: spec.height };
        const connection = normalizeConnection(pending.connection.nodeId, basePendingNode.id, [...nodesRef.current, basePendingNode], pending.connection.handleType);
        if (!connection) return "当前节点类型不能这样连接";
        // 新建音频节点还没有模型，按这条连线的输入挑一个接得住的音频模型再校验。
        const pendingAudioModel = nodeType === CanvasNodeType.Audio
            ? audioModelForConnectionInput(config, connectionInputSummary(basePendingNode.id, [...nodesRef.current, basePendingNode], connectionsRef.current, connection))
            : "";
        const pendingNode: CanvasNodeData = pendingAudioModel ? { ...basePendingNode, metadata: { model: pendingAudioModel, generationMode: "audio" } } : basePendingNode;
        const pendingNodes = [...nodesRef.current, pendingNode];
        return canvasConnectionError(config, pendingNodes, connectionsRef.current, connection);
    }, [config, connectionsRef, nodesRef, runtimeStatuses]);

    const getConnectionDropTarget = useCallback((clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
        const cell = batchCellAtPoint(clientX, clientY);
        if (cell && current.handleType === "source") {
            const handleId = batchCellHandle(cell.rowId, cell.columnId);
            const error = batchCellConnectionError(nodesRef.current, current.nodeId, cell.tableId, handleId);
            return { nodeId: error ? null : cell.tableId, handleId, isNearNode: true };
        }
        return resolveCanvasConnectionTarget({
            nodes: nodesRef.current,
            current,
            point: screenToCanvas(clientX, clientY),
            radius: CONNECTION_SNAP_RADIUS / Math.max(viewportRef.current.k, 0.05),
            bodyNodeId: nodeAtPoint(clientX, clientY),
            scriptScrollTopById,
            batchScrollById,
            canConnect: (node) => {
                const normalized = node.id === current.nodeId ? null : normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType);
                return Boolean(normalized && !canvasConnectionError(config, nodesRef.current, connectionsRef.current, normalized));
            },
        });
    }, [batchScrollById, config, connectionsRef, nodesRef, screenToCanvas, scriptScrollTopById, viewportRef]);

    const getBatchConnectionDropTarget = useCallback((clientX: number, clientY: number, sourceNodeIds: string[]): BatchConnectionDropTarget => {
        const cell = batchCellAtPoint(clientX, clientY);
        if (cell) {
            const handleId = batchCellHandle(cell.rowId, cell.columnId);
            // 连不上时带上表格节点，提交时据此说明原因；悬停只读 nodeId，高亮不变。
            return batchCellSourcesError(nodesRef.current, sourceNodeIds, cell.tableId, handleId)
                ? { nodeId: null, handleId, isNearNode: true, rejectedNodeId: cell.tableId }
                : { nodeId: cell.tableId, handleId, isNearNode: true };
        }
        const source = sourceNodeIds
            .map((id) => nodesRef.current.find((node) => node.id === id))
            .find((node): node is CanvasNodeData => Boolean(node && !batchSourceRestriction(node)));
        if (!source) return { nodeId: null, isNearNode: false };

        return resolveCanvasConnectionTarget({
            nodes: nodesRef.current,
            current: { nodeId: source.id, handleType: "source" },
            point: screenToCanvas(clientX, clientY),
            radius: CONNECTION_SNAP_RADIUS / Math.max(viewportRef.current.k, 0.05),
            bodyNodeId: nodeAtPoint(clientX, clientY),
            scriptScrollTopById,
            batchScrollById,
            canConnect: (node) => hasBatchConnectionCandidate(sourceNodeIds, node.id, nodesRef.current),
        });
    }, [batchScrollById, nodesRef, screenToCanvas, scriptScrollTopById, viewportRef]);

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

    // 两个批量入口共用的提交。命中可连目标就提交；落在连不上的节点上说明原因并结束预览；
    // 什么都没命中交回调用方（拖拽入口打开批量新建菜单）。判定与悬停高亮是同一个 getBatchConnectionDropTarget。
    // 按钮 / Alt+L 入口的预览不绑定指针：连不上时保留预览，用户按提示重新对准即可，不必重新进入批量连接。
    const submitBatchConnection = useCallback((sourceNodeIds: string[], target: BatchConnectionDropTarget, options: { keepPreviewOnReject?: boolean } = {}): "committed" | "rejected" | "none" => {
        if (target.nodeId) {
            commitBatchConnection(sourceNodeIds, target.nodeId, target.handleId, target.anchorRatio);
            clearBatchConnection();
            return "committed";
        }
        if (!target.isNearNode) return "none";
        message.warning(batchConnectionRejectReason({ sourceNodeIds, target, nodes: nodesRef.current, connections: connectionsRef.current, config }));
        if (!options.keepPreviewOnReject) clearBatchConnection();
        return "rejected";
    }, [clearBatchConnection, commitBatchConnection, config, connectionsRef, message, nodesRef]);

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
        updateConnectionReplaceHover(null);
        if (pendingConnectionCreateRef.current) return;
        const currentConnection = connectingParamsRef.current;
        if (!currentConnection) return;

        // 1. 如果是从输出端（source）拖出的连线，检查是否拖到了参考图卡片或参考区上进行替换
        if (currentConnection.handleType === "source" && typeof document !== "undefined") {
            const hitElement = document.elementFromPoint(clientX, clientY);
            if (hitElement) {
                // A) 直接释放在提示词面板的参考图卡片上
                const refChip = hitElement.closest<HTMLElement>("[data-reference-chip]");
                if (refChip) {
                    const targetNodeId = refChip.getAttribute("data-target-node-id");
                    const oldNodeId = refChip.getAttribute("data-reference-node-id");
                    const oldLabel = refChip.getAttribute("data-reference-label") || "";
                    const oldRefId = refChip.getAttribute("data-reference-id") || "";
                    const oldTitle = refChip.getAttribute("data-reference-title") || oldLabel;
                    if (targetNodeId && oldNodeId && targetNodeId !== currentConnection.nodeId && onReplaceReference) {
                        if (oldNodeId === currentConnection.nodeId) {
                            setConnecting(null);
                            return;
                        }
                        onReplaceReference(targetNodeId, { id: oldRefId, nodeId: oldNodeId, label: oldLabel, title: oldTitle }, currentConnection.nodeId);
                        setConnecting(null);
                        return;
                    }
                }

                // B) 释放在提示词参考架容器内（自动就近匹配最近的参考卡片）
                const refShelf = hitElement.closest<HTMLElement>(".canvas-node-composer-references");
                if (refShelf) {
                    const chips = Array.from(refShelf.querySelectorAll<HTMLElement>("[data-reference-chip]"));
                    let closestChip: HTMLElement | null = null;
                    let minDistance = Number.POSITIVE_INFINITY;
                    chips.forEach((chip) => {
                        const rect = chip.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        const dist = Math.abs(clientX - centerX);
                        if (dist < minDistance) {
                            minDistance = dist;
                            closestChip = chip;
                        }
                    });
                    if (closestChip) {
                        const targetNodeId = (closestChip as HTMLElement).getAttribute("data-target-node-id");
                        const oldNodeId = (closestChip as HTMLElement).getAttribute("data-reference-node-id");
                        const oldLabel = (closestChip as HTMLElement).getAttribute("data-reference-label") || "";
                        const oldRefId = (closestChip as HTMLElement).getAttribute("data-reference-id") || "";
                        const oldTitle = (closestChip as HTMLElement).getAttribute("data-reference-title") || oldLabel;
                        if (targetNodeId && oldNodeId && targetNodeId !== currentConnection.nodeId && onReplaceReference) {
                            if (oldNodeId === currentConnection.nodeId) {
                                setConnecting(null);
                                return;
                            }
                            onReplaceReference(targetNodeId, { id: oldRefId, nodeId: oldNodeId, label: oldLabel, title: oldTitle }, currentConnection.nodeId);
                            setConnecting(null);
                            return;
                        }
                    }
                }
            }
        }

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
    }, [connectNodes, getConnectionDropTarget, onReplaceReference, screenToCanvas, setConnecting, updateConnectionReplaceHover]);

    const handleConnectStart = useCallback((event: ReactPointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string, anchorRatio?: number) => {
        event.preventDefault();
        event.stopPropagation();
        // A new pin interaction always starts a fresh session. Without this
        // reset, an old quick-create menu can coexist with the new draft line;
        // pointerup then sees the stale pending menu and silently aborts.
        if (pendingConnectionCreateRef.current) closeConnectionCreateMenu();
        if (batchConnectionPreviewRef.current && handleType === "target") {
            commitBatchConnection(batchConnectionPreviewRef.current.sourceNodeIds, nodeId, handleId, anchorRatio);
            clearBatchConnection();
            return;
        }
        // A batch table exposes real target pins inside its content. When a normal
        // image output is dragged onto one, commit that active connection instead
        // of starting a new connection session from the target pin.
        const activeConnection = connectingParamsRef.current;
        if (activeConnection && handleType === "target" && activeConnection.nodeId !== nodeId) {
            connectNodes(activeConnection, nodeId, handleId, anchorRatio);
            setConnecting(null);
            return;
        }
        if (activeConnection) setConnecting(null);
        if (batchConnectionPreviewRef.current) clearBatchConnection();
        connectingPointerIdRef.current = event.pointerId;
        connectingPointerStartRef.current = { x: event.clientX, y: event.clientY };
        setMouseWorld(screenToCanvas(event.clientX, event.clientY));
        setConnecting({ nodeId, handleType, handleId, anchorRatio });
        setConnectionTargetNodeId(null);
        setSelectedConnectionId(null);
    }, [clearBatchConnection, closeConnectionCreateMenu, commitBatchConnection, connectNodes, screenToCanvas, setConnecting, setSelectedConnectionId]);

    const handleConnectDrop = useCallback((event: ReactPointerEvent, nodeId: string, handleId?: string) => {
        event.preventDefault();
        event.stopPropagation();
        if (batchConnectionPreviewRef.current) {
            commitBatchConnection(batchConnectionPreviewRef.current.sourceNodeIds, nodeId, handleId);
            clearBatchConnection();
            return;
        }
        const current = connectingParamsRef.current;
        if (!current || current.nodeId === nodeId) return;
        connectNodes(current, nodeId, handleId);
        setConnecting(null);
    }, [clearBatchConnection, commitBatchConnection, connectNodes, setConnecting]);

    useEffect(() => {
        const cancelPendingPointerMove = () => {
            latestPointerMoveRef.current = null;
            if (pointerMoveFrameRef.current !== null) window.cancelAnimationFrame(pointerMoveFrameRef.current);
            pointerMoveFrameRef.current = null;
        };
        const flushPointerMove = () => {
            pointerMoveFrameRef.current = null;
            const event = latestPointerMoveRef.current;
            latestPointerMoveRef.current = null;
            if (!event) return;
            const batch = batchConnectionPreviewRef.current;
            if (batch && (batchConnectionPointerIdRef.current === null || batchConnectionPointerIdRef.current === event.pointerId)) {
                const target = getBatchConnectionDropTarget(event.clientX, event.clientY, batch.sourceNodeIds);
                const mouseWorld = screenToCanvas(event.clientX, event.clientY);
                previewBatchConnection(batch.sourceNodeIds, target.nodeId, target.handleId, target.anchorRatio, mouseWorld);
                return;
            }
            const current = connectingParamsRef.current;
            if (!current || connectingPointerIdRef.current !== event.pointerId || pendingConnectionCreateRef.current) return;
            if (current.handleType === "source" && typeof document !== "undefined") {
                const el = document.elementFromPoint(event.clientX, event.clientY);
                let chip = el?.closest<HTMLElement>("[data-batch-reference-cell],[data-reference-chip]");
                if (chip?.hasAttribute("data-batch-reference-cell")) {
                    const tableId = chip.dataset.targetNodeId || "";
                    const handleId = batchCellHandle(chip.dataset.rowId || "", chip.dataset.columnId || "");
                    if (batchCellConnectionError(nodesRef.current, current.nodeId, tableId, handleId)) chip = undefined;
                }
                if (!chip) {
                    const shelf = el?.closest<HTMLElement>(".canvas-node-composer-references");
                    if (shelf) {
                        const chips = Array.from(shelf.querySelectorAll<HTMLElement>("[data-reference-chip]"));
                        let closestChip: HTMLElement | null = null;
                        let minDistance = Number.POSITIVE_INFINITY;
                        chips.forEach((c) => {
                            const rect = c.getBoundingClientRect();
                            const dist = Math.abs(event.clientX - (rect.left + rect.width / 2));
                            if (dist < minDistance) {
                                minDistance = dist;
                                closestChip = c;
                            }
                        });
                        chip = closestChip;
                    }
                }
                updateConnectionReplaceHover(chip || null, event.clientX, event.clientY);
            } else {
                updateConnectionReplaceHover(null);
            }
            const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, current);
            const point = screenToCanvas(event.clientX, event.clientY);
            setConnectionApproach((previous) => latchCanvasConnectionApproach(previous, dropTarget.nodeId, point));
            setConnectionTargetNodeId(dropTarget.nodeId);
            setMouseWorld(point);
        };
        const handlePointerMove = (event: PointerEvent) => {
            // Pointer events can arrive faster than the canvas can paint. Keep
            // only the latest position and update the preview once per frame,
            // which prevents redundant React/Leafer work and visible jitter.
            latestPointerMoveRef.current = event;
            if (pointerMoveFrameRef.current === null) pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
        };
        const handlePointerUp = (event: PointerEvent) => {
            latestPointerMoveRef.current = null;
            if (pointerMoveFrameRef.current !== null) {
                window.cancelAnimationFrame(pointerMoveFrameRef.current);
                pointerMoveFrameRef.current = null;
            }
            if (batchConnectionPointerIdRef.current === event.pointerId) {
                const batch = batchConnectionPreviewRef.current;
                if (!batch) {
                    clearBatchConnection();
                    return;
                }
                // 短按和拖动松手原来是两段相同的判定，合成一次提交；落在连不上的节点上
                // 改为说明原因再结束预览（原来静默清除），什么都没命中才打开批量新建菜单。
                const result = submitBatchConnection(batch.sourceNodeIds, getBatchConnectionDropTarget(event.clientX, event.clientY, batch.sourceNodeIds));
                if (result === "none") openBatchConnectionCreateMenu(event.clientX, event.clientY);
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
            cancelPendingPointerMove();
            updateConnectionReplaceHover(null);
            if (batchConnectionPointerIdRef.current === event.pointerId) {
                clearBatchConnection();
                return;
            }
            if (connectingPointerIdRef.current === event.pointerId) setConnecting(null);
        };
        const cancel = () => {
            cancelPendingPointerMove();
            updateConnectionReplaceHover(null);
            releaseBatchPressGuard();
            if (connectingParamsRef.current) setConnecting(null);
            if (batchConnectionPreviewRef.current) clearBatchConnection();
        };
        // 按钮 / Alt+L 入口的预览不绑定指针，悬停时整个节点都会高亮，提交却原来只认卡面和输入端口。
        // 这里在 document 捕获阶段先接管节点上（含标题行、四角、角标、卡内控件、两侧加号）的主键按下，按悬停同一判定当场连接
        // 或说明原因；子组件拿不到这次按下，不会缩放、改名、开单条线或执行控件动作。挂在 document 而不是 window：
        // document 捕获阶段的其他监听（播放器焦点、浮层点外关闭等）照常运行，同一目标上的监听不受 stopPropagation 影响。
        const handleBatchPressCapture = (event: PointerEvent) => {
            releaseBatchPressGuard();
            const batch = batchConnectionPreviewRef.current;
            if (!batch || batchConnectionPointerIdRef.current !== null || event.button !== 0) return;
            const element = event.target instanceof Element ? event.target : null;
            if (!element?.closest("[data-canvas-viewport]")) return;
            // 节点里弹出的浮层（设置气泡、下拉、颜色选择、新建菜单）照常交给浮层自己处理，不当成连接。
            if (element.closest(`${CANVAS_WHEEL_POPUP_SELECTOR},[data-connection-create-menu]`)) return;
            const inNode = Boolean(element.closest(".node-element[data-node-id]"));
            // 吸附圈（56 屏幕像素）总有一部分落在画布底面上，缩小画布时更大。
            // 底面只在悬停已高亮同一目标时接管，其余空白、平移和框选照旧交给视口。
            const onBackground = !inNode && (element.matches("[data-canvas-viewport],[data-canvas-world-layer],[data-canvas-world-raster-layer]") || Boolean(element.closest("[data-connection-id]")));
            if (!inNode && !onBackground) return;
            const target = getBatchConnectionDropTarget(event.clientX, event.clientY, batch.sourceNodeIds);
            if (inNode && !target.nodeId && !target.isNearNode) return;
            if (onBackground && (!target.nodeId || target.nodeId !== batch.targetNodeId)) return;
            event.preventDefault();
            event.stopPropagation();
            cancelPendingPointerMove();
            batchPressGuardRef.current = { pointerId: event.pointerId, timer: null };
            // 右键菜单靠 window 冒泡阶段的 pointerdown 关闭，这次按下到不了那里。
            setContextMenu(null);
            submitBatchConnection(batch.sourceNodeIds, target, { keepPreviewOnReject: true });
        };
        // 同一次操作随后的兼容鼠标事件和 click 也不交给节点，避免改名、点按钮、选图。
        const swallowGuardedMouse = (event: MouseEvent) => {
            if (!batchPressGuardRef.current || !(event.target instanceof Element) || !event.target.closest("[data-canvas-viewport]")) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.type === "click") releaseBatchPressGuard();
        };
        const scheduleBatchPressGuardRelease = (event: PointerEvent) => {
            const guard = batchPressGuardRef.current;
            if (!guard || guard.pointerId !== event.pointerId || guard.timer !== null) return;
            guard.timer = window.setTimeout(() => {
                if (batchPressGuardRef.current === guard) batchPressGuardRef.current = null;
            }, BATCH_PRESS_GUARD_MS);
        };
        const releaseGuardForPointer = (event: PointerEvent) => {
            if (batchPressGuardRef.current?.pointerId === event.pointerId) releaseBatchPressGuard();
        };
        document.addEventListener("pointerdown", handleBatchPressCapture, true);
        document.addEventListener("mousedown", swallowGuardedMouse, true);
        document.addEventListener("mouseup", swallowGuardedMouse, true);
        document.addEventListener("click", swallowGuardedMouse, true);
        document.addEventListener("pointerup", scheduleBatchPressGuardRelease, true);
        document.addEventListener("pointercancel", releaseGuardForPointer, true);
        document.addEventListener("keydown", releaseBatchPressGuard, true);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerCancel);
        window.addEventListener("blur", cancel);
        return () => {
            document.removeEventListener("pointerdown", handleBatchPressCapture, true);
            document.removeEventListener("mousedown", swallowGuardedMouse, true);
            document.removeEventListener("mouseup", swallowGuardedMouse, true);
            document.removeEventListener("click", swallowGuardedMouse, true);
            document.removeEventListener("pointerup", scheduleBatchPressGuardRelease, true);
            document.removeEventListener("pointercancel", releaseGuardForPointer, true);
            document.removeEventListener("keydown", releaseBatchPressGuard, true);
            cancelPendingPointerMove();
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerCancel);
            window.removeEventListener("blur", cancel);
        };
    }, [clearBatchConnection, finishConnection, getBatchConnectionDropTarget, getConnectionDropTarget, openBatchConnectionCreateMenu, previewBatchConnection, releaseBatchPressGuard, screenToCanvas, setConnecting, setContextMenu, submitBatchConnection, updateConnectionReplaceHover]);

    // 守卫存在 ref 里：上面的 effect 每次渲染都会重新订阅，提交引起的渲染可能落在按下和 click 之间。只在卸载时清掉。
    useEffect(() => releaseBatchPressGuard, [releaseBatchPressGuard]);

    return {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetNodeId,
        connectionApproach,
        connectionReplaceHover,
        connectingParams,
        createConnectedNode,
        getConnectionCreateDisabledReason,
        handleConnectStart,
        handleConnectDrop,
        handleBatchConnectionTargetClick,
        batchConnectionPreview,
        beginBatchConnectionMode,
        startBatchConnection,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    };
}

function batchCellAtPoint(clientX: number, clientY: number) {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-batch-reference-cell]");
    const tableId = element?.dataset.targetNodeId;
    const rowId = element?.dataset.rowId;
    const columnId = element?.dataset.columnId;
    return tableId && rowId && columnId ? { tableId, rowId, columnId } : undefined;
}

function nodeAtPoint(clientX: number, clientY: number) {
    return document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".node-element[data-node-id]")?.dataset.nodeId || null;
}
