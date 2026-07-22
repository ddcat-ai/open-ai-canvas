import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { FRAME_HEADER_HEIGHT, getFrameChildIds, getFrameChildren, isFrameNode } from "@/lib/canvas/canvas-frame";
import { alignCanvasNodes, layoutCanvasFlow, layoutCanvasNodes, nextCanvasVersionLabel, type CanvasAlignmentMode } from "@/lib/canvas/canvas-layout";
import { createCanvasNode, removeCanvasNodes } from "@/lib/canvas/canvas-project-domain";
import { getGenerationCount } from "@/lib/canvas/canvas-project-generation";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ContextMenuState, type Position } from "@/types/canvas";

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type UseCanvasNodeOperationsOptions = {
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
    onNodesDeleted: (removedIds: Set<string>, nextNodes: CanvasNodeData[]) => void;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_SUCCESS = "success" as const;

export function useCanvasNodeOperations({
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
    const effectiveConfig = useEffectiveConfig();
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const [hasCopiedNodes, setHasCopiedNodes] = useState(false);

    const commitNodes = useCallback((nextNodes: CanvasNodeData[]) => {
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
    }, [nodesRef, setNodes]);

    const commitConnections = useCallback((nextConnections: CanvasConnection[]) => {
        connectionsRef.current = nextConnections;
        setConnections(nextConnections);
    }, [connectionsRef, setConnections]);

    const selectNodes = useCallback((ids: Set<string>) => {
        selectedNodeIdsRef.current = ids;
        setSelectedNodeIds(ids);
        setSelectedConnectionId(null);
    }, [selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds]);

    const createNode = useCallback((type: CanvasNodeType, position?: Position) => {
        const configMetadata = type === CanvasNodeType.Config
            ? {
                  model: effectiveConfig.imageModel || effectiveConfig.model,
                  size: effectiveConfig.size,
                  count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
              }
            : undefined;
        const node = createCanvasNode(type, position || getCanvasCenter(), configMetadata);
        commitNodes([...nodesRef.current, node]);
        selectNodes(new Set([node.id]));
        if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Script && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Frame) setDialogNodeId(node.id);
    }, [commitNodes, effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter, nodesRef, selectNodes, setDialogNodeId]);

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
        const nextConnections = connectionsRef.current.filter((connection) => !result.removedIds.has(connection.fromNodeId) && !result.removedIds.has(connection.toNodeId));
        commitNodes(result.nodes);
        commitConnections(nextConnections);
        selectNodes(new Set());
        onNodesDeleted(result.removedIds, result.nodes);
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
            const metadata: CanvasNodeMetadata = { ...node.metadata, frame: node.metadata?.frame ? { ...node.metadata.frame } : undefined };
            if (node.id === source.id && versionRootId) {
                delete metadata.taskId;
                delete metadata.taskStatus;
                delete metadata.taskProgress;
                delete metadata.taskStage;
                delete metadata.taskCreatedAt;
                delete metadata.taskUpdatedAt;
                delete metadata.errorDetails;
                metadata.status = metadata.content ? NODE_STATUS_SUCCESS : NODE_STATUS_IDLE;
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
        if (!isFrameNode(source)) setDialogNodeId(id);
    }, [commitConnections, commitNodes, connectionsRef, nodesRef, selectNodes, setDialogNodeId]);

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
        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => copyIds.has(connection.fromNodeId) && copyIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
        setHasCopiedNodes(true);
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
        const nextNodes = clipboard.nodes.map((node) => ({
            ...node,
            id: idMap.get(node.id)!,
            title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
            position: { x: node.position.x + dx, y: node.position.y + dy },
            parentId: node.parentId ? idMap.get(node.parentId) : undefined,
            metadata: node.metadata ? { ...node.metadata, frame: node.metadata.frame ? { ...node.metadata.frame } : undefined } : undefined,
        }));
        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            return fromNodeId && toNodeId ? [{ ...connection, id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`, fromNodeId, toNodeId }] : [];
        });
        commitNodes([...nodesRef.current, ...nextNodes]);
        commitConnections([...connectionsRef.current, ...nextConnections]);
        const topLevelIds = new Set(nextNodes.filter((node) => !node.parentId).map((node) => node.id));
        selectNodes(topLevelIds);
        setContextMenu(null);
        const primaryNode = nextNodes.find((node) => !node.parentId);
        setDialogNodeId(primaryNode && !isFrameNode(primaryNode) ? primaryNode.id : null);
        return true;
    }, [commitConnections, commitNodes, connectionsRef, getCanvasCenter, nodesRef, selectNodes, setContextMenu, setDialogNodeId]);

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
        setPrimaryVersion,
        toggleNodeLocked,
    };
}
