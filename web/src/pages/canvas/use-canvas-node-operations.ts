import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";

import { FRAME_HEADER_HEIGHT, getFrameChildIds, getFrameChildren, isFrameNode } from "@/lib/canvas/canvas-frame";
import { alignCanvasNodes, layoutCanvasFlow, layoutCanvasNodes, nextCanvasVersionLabel, type CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import { createCanvasNode, removeCanvasNodes } from "@/lib/canvas/canvas-project-domain";
import { isolateCopiedNodeMetadata } from "@/lib/canvas/canvas-node-copy";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
import { cloneCanvasDrawing } from "@/lib/canvas/canvas-drawing-storage";
import { isDrawingEngineAvailable, type CanvasDrawingEngine } from "@/lib/canvas/canvas-drawing-engine";
import { useUserStore } from "@/stores/use-user-store";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

const CANVAS_NODES_CLIPBOARD_PREFIX = "open-ai-canvas-nodes:";
const CANVAS_NODES_JSON_CLIPBOARD_PREFIX = "open-ai-canvas-nodes-json:";
const CANVAS_NODES_CLIPBOARD_STORAGE_KEY = "open-ai-canvas:nodes-clipboard";

type UseCanvasNodeOperationsOptions = {
    projectId: string;
    defaultDrawingEngine: CanvasDrawingEngine;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    onNodesDeleted: (removedIds: Set<string>, nextNodes: CanvasNodeData[], removedNodes: CanvasNodeData[]) => void;
};

export function useCanvasNodeOperations({
    projectId,
    defaultDrawingEngine,
    nodesRef,
    connectionsRef,
    selectedNodeIdsRef,
    getCanvasCenter,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
    onNodesDeleted,
}: UseCanvasNodeOperationsOptions) {
    const { message } = App.useApp();
    const tldrawLicenseKey = useUserStore((state) => state.drawingEngine.tldrawLicenseKey);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const preferCopiedNodesRef = useRef(false);
    const markerWritePendingRef = useRef(false);
    const markerWriteSequenceRef = useRef(0);
    const internalMarkerWriteRef = useRef(false);
    const [hasCopiedNodes, setHasCopiedNodes] = useState(false);

    const releaseCopiedNodesPastePriority = useCallback(() => {
        if (internalMarkerWriteRef.current) return;
        markerWriteSequenceRef.current += 1;
        markerWritePendingRef.current = false;
        preferCopiedNodesRef.current = false;
    }, []);

    const shouldPreferCopiedNodes = useCallback(() => markerWritePendingRef.current || preferCopiedNodesRef.current, []);

    useEffect(() => {
        window.addEventListener("copy", releaseCopiedNodesPastePriority);
        window.addEventListener("cut", releaseCopiedNodesPastePriority);
        window.addEventListener("blur", releaseCopiedNodesPastePriority);
        return () => {
            window.removeEventListener("copy", releaseCopiedNodesPastePriority);
            window.removeEventListener("cut", releaseCopiedNodesPastePriority);
            window.removeEventListener("blur", releaseCopiedNodesPastePriority);
        };
    }, [releaseCopiedNodesPastePriority]);

    const commitNodes = useCallback((nextNodes: CanvasNodeData[]) => {
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
    }, [nodesRef, setNodes]);

    const commitConnections = useCallback((nextConnections: CanvasConnection[]) => {
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
    }, [connectionsRef, setConnections]);

    const cloneDrawingForNode = useCallback((source: CanvasNodeData, target: CanvasNodeData, failureMessage: string) => {
        const sourceDrawingId = source.metadata?.drawingId;
        const targetDrawingId = target.metadata?.drawingId;
        if (!projectId || !sourceDrawingId || !targetDrawingId) return;
        void cloneCanvasDrawing(projectId, sourceDrawingId, targetDrawingId).then((saved) => {
            if (!saved) {
                if (source.metadata?.drawingShapeCount) message.warning("原绘图内容未在本机找到，已创建空白副本");
                return;
            }
            // 克隆落盘后提升修订号，确保已经挂载的新卡片重新读取派生预览。
            commitNodes(nodesRef.current.map((node) => node.id === target.id ? {
                ...node,
                metadata: {
                    ...node.metadata,
                    drawingEngine: saved.engine,
                    drawingRevision: saved.revision,
                    drawingUpdatedAt: saved.updatedAt,
                    drawingShapeCount: saved.shapeCount,
                    drawingPageCount: saved.pageCount,
                },
            } : node));
        }).catch(() => message.error(failureMessage));
    }, [commitNodes, message, nodesRef, projectId]);

    const selectNodes = useCallback((ids: Set<string>) => {
        selectedNodeIdsRef.current = ids;
        setSelectedNodeIds(ids);
        setSelectedConnectionId(null);
    }, [selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const createNode = useCallback((type: CanvasNodeType, position?: Position) => {
        if (type === CanvasNodeType.Drawing && !isDrawingEngineAvailable(defaultDrawingEngine, tldrawLicenseKey)) {
            message.error("当前生产构建未配置 tldraw License Key，不能创建 tldraw 绘图");
            return;
        }
        const node = createCanvasNode(type, position || getCanvasCenter(), type === CanvasNodeType.Drawing ? { drawingEngine: defaultDrawingEngine } : undefined);
        commitNodes([...nodesRef.current, node]);
        selectNodes(new Set([node.id]));
        if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Script && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Frame && type !== CanvasNodeType.Drawing) setDialogNodeId(node.id);
    }, [commitNodes, defaultDrawingEngine, getCanvasCenter, message, nodesRef, selectNodes, setDialogNodeId, tldrawLicenseKey]);

    const arrangeSelectedNodes = useCallback((mode: "row" | "column" | "grid" | "flow") => {
        const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && !node.metadata?.locked && !isFrameNode(node));
        if (selected.length < 2) return;
        const positions = mode === "flow" ? layoutCanvasFlow(selected, connectionsRef.current) : layoutCanvasNodes(selected, mode);
        commitNodes(nodesRef.current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
        message.success(mode === "flow" ? "已按连线整理" : "已整理选中节点");
    }, [commitNodes, connectionsRef, message, nodesRef, selectedNodeIdsRef]);

    const alignSelectedNodes = useCallback((mode: CanvasAlignmentMode) => {
        const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id) && !node.metadata?.locked && !isFrameNode(node));
        if (selected.length < 2 || ((mode === "distributeX" || mode === "distributeY") && selected.length < 3)) return;
        const positions = alignCanvasNodes(selected, mode);
        commitNodes(nodesRef.current.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node));
        message.success(mode === "distributeX" || mode === "distributeY" ? "已等距分布选中节点" : "已对齐选中节点");
    }, [commitNodes, message, nodesRef, selectedNodeIdsRef]);

    const createStoryboardGroup = useCallback(() => {
        const images = nodesRef.current
            .filter((node) => selectedNodeIdsRef.current.has(node.id) && !node.metadata?.locked && node.type === CanvasNodeType.Image && Boolean(node.metadata?.content))
            .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        if (images.length < 2) {
            message.warning("请至少选择两张已有图片");
            return;
        }
        const gap = 24;
        const padding = 24;
        const columns = Math.min(4, Math.ceil(Math.sqrt(images.length)));
        const rows = Math.ceil(images.length / columns);
        const cellWidth = Math.max(...images.map((node) => node.width));
        const cellHeight = Math.max(...images.map((node) => node.height));
        const left = Math.min(...images.map((node) => node.position.x));
        const top = Math.min(...images.map((node) => node.position.y));
        const frameWidth = padding * 2 + columns * cellWidth + (columns - 1) * gap;
        const frameHeight = FRAME_HEADER_HEIGHT + padding * 2 + rows * cellHeight + (rows - 1) * gap;
        const frame = createCanvasNode(CanvasNodeType.Frame, { x: left + frameWidth / 2 - padding, y: top + frameHeight / 2 - FRAME_HEADER_HEIGHT - padding }, {
            workflowKind: "storyboard",
            workflowTitle: "分镜组",
            frame: { collapsed: false, expandedWidth: frameWidth, expandedHeight: frameHeight },
        });
        frame.title = `分镜组 · ${images.length} 镜`;
        frame.position = { x: left - padding, y: top - FRAME_HEADER_HEIGHT - padding };
        frame.width = frameWidth;
        frame.height = frameHeight;
        const imageIndex = new Map(images.map((node, index) => [node.id, index]));
        const nextNodes: CanvasNodeData[] = [
            ...nodesRef.current.map((node) => {
                const index = imageIndex.get(node.id);
                if (index === undefined) return node;
                const column = index % columns;
                const row = Math.floor(index / columns);
                return {
                    ...node,
                    parentId: frame.id,
                    position: {
                        x: frame.position.x + padding + column * (cellWidth + gap) + (cellWidth - node.width) / 2,
                        y: frame.position.y + FRAME_HEADER_HEIGHT + padding + row * (cellHeight + gap) + (cellHeight - node.height) / 2,
                    },
                    metadata: { ...node.metadata, workflowKind: node.metadata?.workflowKind || "shot", shotIndex: node.metadata?.shotIndex || index + 1 },
                };
            }),
            frame,
        ];
        commitNodes(nextNodes);
        selectNodes(new Set([frame.id]));
        message.success(`已创建 ${images.length} 镜分镜组`);
    }, [commitNodes, message, nodesRef, selectNodes, selectedNodeIdsRef]);

    const createReferenceGroup = useCallback(() => {
        const media = nodesRef.current
            .filter((node) => selectedNodeIdsRef.current.has(node.id) && !node.metadata?.locked && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) && Boolean(node.metadata?.content))
            .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        if (media.length < 2) {
            message.warning("请至少选择两个已有图片或视频节点");
            return;
        }
        const gap = 20;
        const padding = 24;
        const columns = Math.min(3, Math.ceil(Math.sqrt(media.length)));
        const rows = Math.ceil(media.length / columns);
        const cellWidth = Math.max(...media.map((node) => node.width));
        const cellHeight = Math.max(...media.map((node) => node.height));
        const left = Math.min(...media.map((node) => node.position.x));
        const top = Math.min(...media.map((node) => node.position.y));
        const frameWidth = padding * 2 + columns * cellWidth + (columns - 1) * gap;
        const frameHeight = FRAME_HEADER_HEIGHT + padding * 2 + rows * cellHeight + (rows - 1) * gap;
        const frame = createCanvasNode(CanvasNodeType.Frame, { x: left + frameWidth / 2, y: top + frameHeight / 2 }, {
            workflowKind: "reference_set",
            workflowTitle: "引用组",
            referenceAssetNodeIds: media.map((node) => node.id),
            frame: { collapsed: false, expandedWidth: frameWidth, expandedHeight: frameHeight },
        });
        frame.title = `引用组 · ${media.length} 项`;
        frame.position = { x: left - padding, y: top - FRAME_HEADER_HEIGHT - padding };
        frame.width = frameWidth;
        frame.height = frameHeight;
        const mediaIndex = new Map(media.map((node, index) => [node.id, index]));
        commitNodes([
            ...nodesRef.current.map((node) => {
                const index = mediaIndex.get(node.id);
                if (index === undefined) return node;
                const column = index % columns;
                const row = Math.floor(index / columns);
                return {
                    ...node,
                    parentId: frame.id,
                    position: {
                        x: frame.position.x + padding + column * (cellWidth + gap) + (cellWidth - node.width) / 2,
                        y: frame.position.y + FRAME_HEADER_HEIGHT + padding + row * (cellHeight + gap) + (cellHeight - node.height) / 2,
                    },
                    metadata: { ...node.metadata, referenceSetId: frame.id },
                };
            }),
            frame,
        ]);
        selectNodes(new Set([frame.id]));
        message.success(`已创建 ${media.length} 项引用组，折叠后可作为路由节点`);
    }, [commitNodes, message, nodesRef, selectNodes, selectedNodeIdsRef]);

    const toggleNodeLocked = useCallback((nodeId: string) => {
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (!target) return;
        const locked = !target.metadata?.locked;
        commitNodes(nodesRef.current.map((node) => node.id === nodeId ? { ...node, metadata: { ...node.metadata, locked } } : node));
        message.success(locked ? "节点已锁定位置和尺寸" : "节点已解锁");
    }, [commitNodes, message, nodesRef]);

    const deleteNodes = useCallback((ids: Set<string>) => {
        if (!ids.size) return;
        const result = removeCanvasNodes(nodesRef.current, ids);
        const removedNodes = nodesRef.current.filter((node) => result.removedIds.has(node.id));
        const nextConnections = connectionsRef.current.filter((connection) => !result.removedIds.has(connection.fromNodeId) && !result.removedIds.has(connection.toNodeId));
        commitNodes(result.nodes);
        commitConnections(nextConnections);
        selectNodes(new Set());
        onNodesDeleted(result.removedIds, result.nodes, removedNodes);
    }, [commitConnections, commitNodes, connectionsRef, nodesRef, onNodesDeleted, selectNodes]);

    const deleteConnection = useCallback((connectionId: string) => {
        commitConnections(connectionsRef.current.filter((connection) => connection.id !== connectionId));
        setSelectedConnectionId((current) => current === connectionId ? null : current);
        setContextMenu((current) => current?.type === "connection" && current.connectionId === connectionId ? null : current);
    }, [commitConnections, connectionsRef, setContextMenu, setSelectedConnectionId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;
        const sources = isFrameNode(source) ? [source, ...getFrameChildren(source.id, nodesRef.current)] : [source];
        const idMap = new Map(sources.map((node, index) => [node.id, `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`]));
        const versionRootId = isFrameNode(source) ? undefined : source.metadata?.versionOfNodeId || source.id;
        const versionLabel = versionRootId ? nextCanvasVersionLabel(versionRootId, nodesRef.current) : undefined;
        const copiedNodes = sources.map((node) => {
            const metadata = isolateCopiedNodeMetadata(node, idMap);
            if (node.type === CanvasNodeType.Drawing) {
                metadata.drawingId = `${idMap.get(node.id)}-document`;
                metadata.drawingRevision = 0;
                metadata.drawingUpdatedAt = undefined;
                metadata.drawingShapeCount = 0;
                metadata.drawingPageCount = 1;
            }
            if (node.id === source.id && versionRootId) {
                metadata.versionOfNodeId = versionRootId;
                metadata.versionLabel = versionLabel;
                metadata.versionPrimary = false;
            }
            return {
                ...node,
                id: idMap.get(node.id)!,
                title: node.id === source.id ? `${node.title.replace(/ · [A-Z]$/, "")} · ${versionLabel || "副本"}` : node.title,
                position: { x: node.position.x + 36, y: node.position.y + 36 },
                parentId: node.parentId ? idMap.get(node.parentId) || node.parentId : undefined,
                metadata,
            };
        });
        const copiedIds = new Set(sources.map((node) => node.id));
        const copiedConnections = connectionsRef.current
            .filter((connection) => copiedIds.has(connection.fromNodeId) && copiedIds.has(connection.toNodeId))
            .map((connection) => ({ ...connection, id: nanoid(), fromNodeId: idMap.get(connection.fromNodeId)!, toNodeId: idMap.get(connection.toNodeId)! }));
        if (!isFrameNode(source)) {
            connectionsRef.current.filter((connection) => connection.toNodeId === source.id && !copiedIds.has(connection.fromNodeId)).forEach((connection) => copiedConnections.push({ ...connection, id: nanoid(), toNodeId: idMap.get(source.id)! }));
        }
        const id = idMap.get(source.id)!;
        const nextNodes = [
            ...nodesRef.current.map((node) => node.id === source.id && versionRootId && !node.metadata?.versionLabel ? { ...node, title: `${node.title} · A`, metadata: { ...node.metadata, versionOfNodeId: versionRootId, versionLabel: "A", versionPrimary: true } } : node),
            ...copiedNodes,
        ];
        commitNodes(nextNodes);
        commitConnections([...connectionsRef.current, ...copiedConnections]);
        selectNodes(new Set([id]));
        const sourceByTargetId = new Map(sources.map((sourceNode) => [idMap.get(sourceNode.id), sourceNode]));
        copiedNodes.filter((node) => node.type === CanvasNodeType.Drawing).forEach((targetNode) => {
            const sourceNode = sourceByTargetId.get(targetNode.id);
            if (sourceNode) cloneDrawingForNode(sourceNode, targetNode, "绘图副本保存失败，请重新复制");
        });
        if (!isFrameNode(source) && source.type !== CanvasNodeType.Drawing) setDialogNodeId(id);
    }, [cloneDrawingForNode, commitConnections, commitNodes, connectionsRef, nodesRef, selectNodes, setDialogNodeId]);

    const setPrimaryVersion = useCallback((nodeId: string) => {
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (!target) return;
        const rootId = target.metadata?.versionOfNodeId || target.id;
        commitNodes(nodesRef.current.map((node) => (node.metadata?.versionOfNodeId || node.id) === rootId ? { ...node, metadata: { ...node.metadata, versionPrimary: node.id === nodeId } } : node));
        message.success(`已将 ${target.metadata?.versionLabel || target.title} 设为主版本`);
    }, [commitNodes, message, nodesRef]);

    const copyNodesToClipboard = useCallback((targetIds: Set<string>) => {
        if (!targetIds.size) return;
        const copyIds = new Set(targetIds);
        nodesRef.current.forEach((node) => {
            if (targetIds.has(node.id) && isFrameNode(node)) getFrameChildIds(node.id, nodesRef.current).forEach((childId) => copyIds.add(childId));
        });
        const copiedNodes = nodesRef.current
            .filter((node) => copyIds.has(node.id))
            .map((node) => ({ ...node, position: { ...node.position }, metadata: node.metadata ? { ...node.metadata, frame: node.metadata.frame ? { ...node.metadata.frame } : undefined } : undefined }));
        if (!copiedNodes.length) return;
        const copiedConnections = connectionsRef.current.filter((connection) => copyIds.has(connection.fromNodeId) && copyIds.has(connection.toNodeId)).map((connection) => ({ ...connection }));
        clipboardRef.current = { nodes: copiedNodes, connections: copiedConnections };
        try {
            sessionStorage.setItem(CANVAS_NODES_CLIPBOARD_STORAGE_KEY, JSON.stringify(clipboardRef.current));
        } catch {
            // 大型媒体节点可能超过浏览器存储配额，当前页面内仍可正常粘贴。
        }
        setHasCopiedNodes(true);
        // 写入完成前或写入失败时优先内部节点，避免快速粘贴读到系统残留图片。
        const marker = `${CANVAS_NODES_CLIPBOARD_PREFIX}${Date.now()}:${copiedNodes.length}`;
        const sequence = markerWriteSequenceRef.current + 1;
        markerWriteSequenceRef.current = sequence;
        markerWritePendingRef.current = true;
        preferCopiedNodesRef.current = true;
        try {
            internalMarkerWriteRef.current = true;
            copyToClipboard(marker, { format: "text/plain" });
            internalMarkerWriteRef.current = false;
            if (markerWriteSequenceRef.current !== sequence) return;
            markerWritePendingRef.current = false;
            preferCopiedNodesRef.current = true;
        } catch {
            internalMarkerWriteRef.current = false;
            if (markerWriteSequenceRef.current !== sequence) return;
            markerWritePendingRef.current = false;
            preferCopiedNodesRef.current = true;
        }
    }, [connectionsRef, nodesRef]);

    const copySelectedNodes = useCallback(() => {
        copyNodesToClipboard(new Set(selectedNodeIdsRef.current));
    }, [copyNodesToClipboard, selectedNodeIdsRef]);

    const pasteCopiedNodes = useCallback((position?: Position) => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;
        const center = position || getCanvasCenter();
        const bounds = clipboard.nodes.reduce((current, node) => ({
            left: Math.min(current.left, node.position.x),
            top: Math.min(current.top, node.position.y),
            right: Math.max(current.right, node.position.x + node.width),
            bottom: Math.max(current.bottom, node.position.y + node.height),
        }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map(clipboard.nodes.map((node, index) => [node.id, `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`]));
        const copiedSourceIds = new Set(clipboard.nodes.map((node) => node.id));
        const nextNodes = clipboard.nodes.map((node) => {
            const metadata = isolateCopiedNodeMetadata(node, idMap);
            if (node.type === CanvasNodeType.Drawing && metadata) {
                metadata.drawingId = `${idMap.get(node.id)}-document`;
                metadata.drawingRevision = 0;
                metadata.drawingUpdatedAt = undefined;
                metadata.drawingShapeCount = 0;
                metadata.drawingPageCount = 1;
            }
            return {
                ...node,
                id: idMap.get(node.id)!,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: { x: node.position.x + dx, y: node.position.y + dy },
                parentId: node.parentId ? idMap.get(node.parentId) : undefined,
                metadata,
            };
        });
        // 1) 剪贴板内部连线；2) 仍保留到画布上未复制参考节点的入边（只复制结果节点时常见）。
        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            return fromNodeId && toNodeId ? [{ ...connection, id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, fromNodeId, toNodeId }] : [];
        });
        connectionsRef.current.forEach((connection) => {
            if (!copiedSourceIds.has(connection.toNodeId) || copiedSourceIds.has(connection.fromNodeId)) return;
            const toNodeId = idMap.get(connection.toNodeId);
            if (!toNodeId) return;
            // 参考节点仍在画布上时，粘贴结果应重新挂上同一入边。
            if (!nodesRef.current.some((node) => node.id === connection.fromNodeId)) return;
            nextConnections.push({ ...connection, id: nanoid(), toNodeId });
        });
        commitNodes([...nodesRef.current, ...nextNodes]);
        commitConnections([...connectionsRef.current, ...nextConnections]);
        const sourceByTargetId = new Map(clipboard.nodes.map((sourceNode) => [idMap.get(sourceNode.id), sourceNode]));
        nextNodes.filter((node) => node.type === CanvasNodeType.Drawing).forEach((targetNode) => {
            const sourceNode = sourceByTargetId.get(targetNode.id);
            if (sourceNode) cloneDrawingForNode(sourceNode, targetNode, "绘图副本保存失败，请重新粘贴");
        });
        const topLevelIds = new Set(nextNodes.filter((node) => !node.parentId).map((node) => node.id));
        selectNodes(topLevelIds);
        setContextMenu(null);
        const primaryNode = nextNodes.find((node) => !node.parentId);
        setDialogNodeId(primaryNode && !isFrameNode(primaryNode) && primaryNode.type !== CanvasNodeType.Drawing ? primaryNode.id : null);
        return true;
    }, [cloneDrawingForNode, commitConnections, commitNodes, connectionsRef, getCanvasCenter, nodesRef, selectNodes, setContextMenu, setDialogNodeId]);

    const restoreCopiedNodesFromText = useCallback((value: string) => {
        const isMarker = value.startsWith(CANVAS_NODES_CLIPBOARD_PREFIX);
        const isLegacyJSON = value.startsWith(CANVAS_NODES_JSON_CLIPBOARD_PREFIX);
        if (!isMarker && !isLegacyJSON) return false;
        try {
            const serialized = isLegacyJSON ? value.slice(CANVAS_NODES_JSON_CLIPBOARD_PREFIX.length) : sessionStorage.getItem(CANVAS_NODES_CLIPBOARD_STORAGE_KEY);
            if (!serialized) return false;
            const parsed = JSON.parse(serialized) as Partial<CanvasClipboard>;
            if (!parsed.nodes?.length) return false;
            clipboardRef.current = { nodes: parsed.nodes, connections: parsed.connections || [] };
            setHasCopiedNodes(true);
            preferCopiedNodesRef.current = true;
            markerWritePendingRef.current = false;
            return true;
        } catch {
            return false;
        }
    }, []);

    return {
        alignSelectedNodes,
        arrangeSelectedNodes,
        copyNodesToClipboard,
        copySelectedNodes,
        createNode,
        createReferenceGroup,
        createStoryboardGroup,
        deleteConnection,
        deleteNodes,
        duplicateNode,
        hasCopiedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        releaseCopiedNodesPastePriority,
        setPrimaryVersion,
        shouldPreferCopiedNodes,
        toggleNodeLocked,
    };
}
