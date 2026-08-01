import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { saveAs } from "file-saver";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { FRAME_COLLAPSED_HEIGHT, FRAME_COLLAPSED_WIDTH, getFrameChildIds, isFrameNode } from "@/lib/canvas/canvas-frame";
import { applyBatchPrimaryImage, applyNodeConfigPatch } from "@/lib/canvas/canvas-project-domain";
import { audioExtension, imageExtension, resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

type UseCanvasNodeEditorOptions = {
    canvasId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
    setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
};

export function useCanvasNodeEditor({
    canvasId,
    domainProjectId,
    nodesRef,
    setNodes,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setToolbarNodeId,
    setHoveredNodeId,
}: UseCanvasNodeEditorOptions) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                if (node.id !== nodeId || node.metadata?.locked) return node;
                const nextPosition = position || node.position;
                if (node.width === width && node.height === height && node.position.x === nextPosition.x && node.position.y === nextPosition.y) return node;
                changed = true;
                const resized = { ...node, width, height, position: nextPosition };
                if (!isFrameNode(node) || node.metadata?.frame?.collapsed) return resized;
                return { ...resized, metadata: { ...node.metadata, frame: { collapsed: false, expandedWidth: width, expandedHeight: height } } };
            });
            return changed ? next : current;
        });
    }, [setNodes]);

    const toggleFrameCollapsed = useCallback((nodeId: string) => {
        const frame = nodesRef.current.find((node) => node.id === nodeId && isFrameNode(node));
        if (!frame) return;
        const collapsed = Boolean(frame.metadata?.frame?.collapsed);
        const childIds = getFrameChildIds(nodeId, nodesRef.current);
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== nodeId) return node;
                const frameState = node.metadata?.frame;
                return collapsed
                    ? { ...node, width: frameState?.expandedWidth || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, height: frameState?.expandedHeight || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height, metadata: { ...node.metadata, frame: { collapsed: false, expandedWidth: frameState?.expandedWidth || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, expandedHeight: frameState?.expandedHeight || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height } } }
                    : { ...node, width: FRAME_COLLAPSED_WIDTH, height: FRAME_COLLAPSED_HEIGHT, metadata: { ...node.metadata, frame: { collapsed: true, expandedWidth: node.width, expandedHeight: node.height } } };
            }),
        );
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setDialogNodeId((current) => (current && childIds.has(current) ? null : current));
        setToolbarNodeId(null);
        setHoveredNodeId(null);
    }, [nodesRef, setDialogNodeId, setHoveredNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setToolbarNodeId]);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, [setNodes]);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((current) =>
            current.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, [setNodes]);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content, richText: undefined } } : node)));
    }, [setNodes]);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        const updateMotionState = isExpanded ? setCollapsingBatchIds : setOpeningBatchIds;
        updateMotionState((current) => new Set(current).add(nodeId));
        window.setTimeout(() => {
            updateMotionState((current) => {
                const next = new Set(current);
                next.delete(nodeId);
                return next;
            });
        }, isExpanded ? 320 : 260);
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } } : node)));
    }, [nodesRef, setNodes]);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((current) =>
            current.map((node) =>
                node.id === rootId
                    ? applyBatchPrimaryImage(node, child)
                    : node,
            ),
        );
    }, [setNodes]);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((current) => current.map((node) => {
            if (node.id !== nodeId) return node;
            const hasExistingContent = (node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim())) || (node.type === CanvasNodeType.Image && Boolean(node.metadata?.content));
            const previousPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
            const moderationFailure = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
            const metadata = moderationFailure && prompt !== previousPrompt
                ? resetGenerationTaskMetadata(node.metadata, node.metadata?.content ? "success" : "idle")
                : node.metadata;
            return { ...node, metadata: hasExistingContent ? { ...metadata, composerContent: prompt } : { ...metadata, prompt, composerContent: prompt } };
        }));
    }, [setNodes]);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeMetadata>) => {
        setNodes((current) => current.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
        if (!patch.assetCategory) return;
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node?.metadata?.content?.trim()) return;
        const updatedNode = applyNodeConfigPatch(node, patch);
        void ensureCanvasNodeAsset({ canvasId, domainProjectId, node: updatedNode, source: "canvas-manual", category: patch.assetCategory })
            .then(async (result) => {
                setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
                if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
                message.success("资产分类已更新");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "资产分类更新失败"));
    }, [canvasId, domainProjectId, message, nodesRef, queryClient, setNodes]);

    const downloadNodeImage = useCallback((node: CanvasNodeData) => {
        if ((node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) || !node.metadata?.content) return;
        saveAs(node.metadata.content, `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`);
    }, []);

    const saveNodeAsset = useCallback(async (node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return message.error("当前节点类型不能保存为素材");
        if (!node.metadata?.content?.trim()) return message.error("当前节点没有可保存的内容");
        try {
            const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-manual" });
            setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
            if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            message.success(result.linkedToProject ? "已加入项目资产" : "已加入我的素材");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材保存失败");
        }
    }, [canvasId, domainProjectId, message, queryClient, setNodes]);

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, [setNodes]);

    return {
        collapsingBatchIds,
        downloadNodeImage,
        handleConfigNodeChange,
        handleFontSizeChange,
        handleNodeContentChange,
        handleNodePromptChange,
        handleNodeResize,
        handleNodeTitleChange,
        openingBatchIds,
        saveNodeAsset,
        setBatchPrimary,
        toggleBatchExpanded,
        toggleFrameCollapsed,
        toggleNodeFreeResize,
    };
}
