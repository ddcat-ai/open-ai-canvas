import { translate } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { FOLDER_COLLAPSED_HEIGHT, FOLDER_COLLAPSED_WIDTH, FRAME_COLLAPSED_HEIGHT, FRAME_COLLAPSED_WIDTH, getFrameChildIds, isCanvasFolderNode, isFrameNode } from "@/lib/canvas/canvas-frame";
import { buildCanvasMediaDownloadFileName, canDownloadCanvasNodeMedia, isCanvasMediaCompositePending } from "@/lib/canvas/canvas-media-download";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { applyBatchPrimaryImage, applyNodeConfigPatch } from "@/lib/canvas/canvas-project-domain";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { downloadBrowserMedia, resolveBrowserMediaDownloadHref, startBrowserDownload } from "@/services/browser-download";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { canvasEditLeases } from "@/services/canvas-edit-leases";
import { CanvasNodeType, type CanvasFolderStyle, type CanvasFolderTheme, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

// Chrome 对同一页面连续触发的下载会先询问一次「下载多个文件」，间隔过短时后续点击可能被丢弃。
const BATCH_DOWNLOAD_INTERVAL_MS = 400;

type UseCanvasNodeEditorOptions = {
    canvasId: string;
    canvasTitle: string;
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
    canvasTitle,
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
    const batchMotionTimers = useRef(new Map<string, number>());
    useEffect(() => () => {
        batchMotionTimers.current.forEach((timer) => window.clearTimeout(timer));
    }, []);

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((current) => {
            let changed = false;
            const next = current.map((node) => {
                if (node.id !== nodeId || node.metadata?.locked) return node;
                const nextPosition = position || node.position;
                if (node.width === width && node.height === height && node.position.x === nextPosition.x && node.position.y === nextPosition.y) return node;
                changed = true;
                // 打上「用户手动定过尺寸」标记：图片按真实比例自动适配时要避让它，
                // 否则每次图片重新加载都会把用户拉过的尺寸改回去。
                const resized = { ...node, width, height, position: nextPosition, metadata: { ...node.metadata, manualSize: true } };
                if (!isFrameNode(node) || node.metadata?.frame?.collapsed) return resized;
                return { ...resized, metadata: { ...resized.metadata, frame: { collapsed: false, expandedWidth: width, expandedHeight: height } } };
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
                const folder = isCanvasFolderNode(node);
                return collapsed
                    ? { ...node, width: frameState?.expandedWidth || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, height: frameState?.expandedHeight || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height, metadata: { ...node.metadata, frame: { collapsed: false, expandedWidth: frameState?.expandedWidth || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].width, expandedHeight: frameState?.expandedHeight || NODE_DEFAULT_SIZE[CanvasNodeType.Frame].height } } }
                    : { ...node, width: folder ? FOLDER_COLLAPSED_WIDTH : FRAME_COLLAPSED_WIDTH, height: folder ? FOLDER_COLLAPSED_HEIGHT : FRAME_COLLAPSED_HEIGHT, metadata: { ...node.metadata, frame: { collapsed: true, expandedWidth: node.width, expandedHeight: node.height } } };
            }),
        );
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        setDialogNodeId((current) => (current && childIds.has(current) ? null : current));
        setToolbarNodeId(null);
        setHoveredNodeId(null);
    }, [nodesRef, setDialogNodeId, setHoveredNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setToolbarNodeId]);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        const node = nodesRef.current.find((node) => node.id === nodeId);
        if (!node || node.metadata?.locked || node.title === title || !canvasEditLeases.input(canvasId, nodeId)) return;
        // 标记为用户命名：之后原位重新生成沿用这个名称，不再用提示词开头覆盖。标题逐字输入时 metadata 只换一次引用。
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, title, metadata: node.metadata?.manualTitle ? node.metadata : { ...node.metadata, manualTitle: true } } : node)));
    }, [canvasId, nodesRef, setNodes]);

    const handleFolderStyleChange = useCallback((nodeId: string, style: CanvasFolderStyle) => {
        setNodes((current) => current.map((node) => {
            if (node.id !== nodeId || !isCanvasFolderNode(node)) return node;
            const folder = node.metadata!.folder!;
            return { ...node, metadata: { ...node.metadata, folder: { ...folder, style, createdAt: folder.createdAt || new Date().toISOString() } } };
        }));
    }, [setNodes]);

    const handleFolderThemeChange = useCallback((nodeId: string, theme: CanvasFolderTheme) => {
        setNodes((current) => current.map((node) => {
            if (node.id !== nodeId || !isCanvasFolderNode(node)) return node;
            const folder = node.metadata!.folder!;
            return { ...node, metadata: { ...node.metadata, folder: { ...folder, theme, themeCover: undefined, createdAt: folder.createdAt || new Date().toISOString() } } };
        }));
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
        const node = nodesRef.current.find((node) => node.id === nodeId);
        if (!node || node.metadata?.locked || node.metadata?.content === content || !canvasEditLeases.input(canvasId, nodeId)) return;
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content, richText: undefined } } : node)));
    }, [canvasId, nodesRef, setNodes]);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const root = nodesRef.current.find((node) => node.id === nodeId);
        if (!root?.metadata?.isBatchRoot) return;
        const isExpanded = Boolean(root.metadata.imageBatchExpanded);
        window.clearTimeout(batchMotionTimers.current.get(nodeId));
        const updateMotionState = isExpanded ? setCollapsingBatchIds : setOpeningBatchIds;
        const clearMotionState = isExpanded ? setOpeningBatchIds : setCollapsingBatchIds;
        clearMotionState((current) => {
            const next = new Set(current);
            next.delete(nodeId);
            return next;
        });
        updateMotionState((current) => new Set(current).add(nodeId));
        batchMotionTimers.current.set(nodeId, window.setTimeout(() => {
            batchMotionTimers.current.delete(nodeId);
            updateMotionState((current) => {
                const next = new Set(current);
                next.delete(nodeId);
                return next;
            });
        }, isExpanded ? 320 : 445 + (root.metadata.batchChildIds?.length || 1) * 24));
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

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string): boolean => {
        const node = nodesRef.current.find((node) => node.id === nodeId);
        if (!node || node.metadata?.locked) return false;
        if (prompt === (node.metadata?.composerContent ?? node.metadata?.prompt ?? "")) return true;
        if (!canvasEditLeases.input(canvasId, nodeId)) return false;
        setNodes((current) => current.map((node) => {
            if (node.id !== nodeId) return node;
            const previousPrompt = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
            const promptChanged = prompt !== previousPrompt;
            const moderationFailure = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
            const metadata = moderationFailure && promptChanged
                ? resetGenerationTaskMetadata(node.metadata, node.metadata?.content ? "success" : "idle")
                : node.metadata;
            return writeCanvasNodePrompt(node, prompt, {
                metadata,
                clearPromptTemplate: promptChanged && Boolean(metadata?.promptTemplateOperation),
            });
        }));
        return true;
    }, [canvasId, nodesRef, setNodes]);

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeMetadata>): boolean => {
        const target = nodesRef.current.find((node) => node.id === nodeId);
        if (!target) return false;
        const changesPrompt = (["prompt", "composerContent"] as const).some((key) => Object.hasOwn(patch, key) && patch[key] !== target.metadata?.[key]);
        if (changesPrompt && (target.metadata?.locked || !canvasEditLeases.input(canvasId, nodeId))) return false;
        setNodes((current) => {
            const next = current.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node));
            // 生成入口读取 nodesRef；同步写入，避免刚修改工作流比例就立即生成时仍提交旧值。
            nodesRef.current = next;
            return next;
        });
        if (!patch.assetCategory) return true;
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node?.metadata?.content?.trim()) return true;
        const updatedNode = applyNodeConfigPatch(node, patch);
        void ensureCanvasNodeAsset({ canvasId, domainProjectId, node: updatedNode, source: "canvas-manual", category: patch.assetCategory })
            .then(async (result) => {
                setNodes((current) => current.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
                if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
                message.success(translate("canvasPage.nodeEditor.assetCategoryUpdated"));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : translate("canvasPage.nodeEditor.assetCategoryFailed")));
        return true;
    }, [canvasId, domainProjectId, message, nodesRef, queryClient, setNodes]);

    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if (node.metadata?.imageLayerGroup?.compositeStatus && node.metadata.imageLayerGroup.compositeStatus !== "ready") { message.warning(translate("canvasPage.nodeEditor.waitCompositeDownload")); return; }
        const supported = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
        const content = node.metadata?.content?.trim();
        const storageKey = node.metadata?.storageKey?.trim();
        if (!supported || (!content && !storageKey)) return;
        try {
            const downloadName = buildCanvasMediaDownloadFileName(canvasTitle, node);
            await downloadBrowserMedia({ storageKey, url: content, fileName: downloadName });
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("canvasPage.nodeEditor.downloadFailed"));
        }
    }, [canvasTitle, message]);

    // 框选批量下载：每个媒体节点单独下载一次。先并发换取全部下载地址（资源访问请求会合并为一次），
    // 再按固定间隔逐个交给浏览器，避免连续点击被浏览器合并或丢弃。
    const downloadNodesMedia = useCallback(async (nodes: CanvasNodeData[]) => {
        const media = nodes.filter(canDownloadCanvasNodeMedia);
        const pendingCount = media.filter(isCanvasMediaCompositePending).length;
        const targets = media.filter((node) => !isCanvasMediaCompositePending(node));
        if (!targets.length) {
            message.warning(pendingCount ? translate("canvasPage.nodeEditor.waitCompositeDownload") : translate("canvasPage.nodeEditor.noDownloadableMedia"));
            return;
        }
        const now = new Date();
        const items = targets.map((node) => ({ node, fileName: buildCanvasMediaDownloadFileName(canvasTitle, node, now) }));
        const resolved = await Promise.allSettled(items.map(({ node, fileName }) => resolveBrowserMediaDownloadHref({
            storageKey: node.metadata?.storageKey?.trim(),
            url: node.metadata?.content?.trim(),
            fileName,
        })));
        let started = 0;
        const failures: string[] = [];
        for (const [index, result] of resolved.entries()) {
            if (result.status === "rejected") {
                failures.push(result.reason instanceof Error ? result.reason.message : translate("canvasPage.nodeEditor.downloadFailed"));
                continue;
            }
            if (started > 0) await new Promise((resolve) => window.setTimeout(resolve, BATCH_DOWNLOAD_INTERVAL_MS));
            startBrowserDownload(result.value, items[index].fileName);
            started += 1;
        }
        const skipped = nodes.length - targets.length;
        const skippedNote = skipped ? translate("canvasPage.nodeEditor.skippedNote", { count: skipped }) : "";
        if (!started) message.error(translate("canvasPage.nodeEditor.downloadFailedWithReason", { error: failures[0] || translate("canvasPage.nodeEditor.noDownloadableResource") }));
        else if (failures.length) message.warning(translate("canvasPage.nodeEditor.downloadPartial", { count: started, failed: failures.length, error: failures[0], skipped: skippedNote }));
        else message.success(translate("canvasPage.nodeEditor.downloadStarted", { count: started, skipped: skippedNote }));
    }, [canvasTitle, message]);

    const saveNodeAsset = useCallback(async (node: CanvasNodeData) => {
        if (node.metadata?.imageLayerGroup?.compositeStatus && node.metadata.imageLayerGroup.compositeStatus !== "ready") { message.warning(translate("canvasPage.nodeEditor.waitCompositeSave")); return; }
        if (node.type !== CanvasNodeType.Text && node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return message.error(translate("canvasPage.nodeEditor.typeNotSavable"));
        if (!node.metadata?.content?.trim()) return message.error(translate("canvasPage.nodeEditor.nothingToSave"));
        try {
            const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-manual" });
            setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
            if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            if (result.syncPending) message.info(domainProjectId ? translate("canvasPage.nodeEditor.savedLocalProjectSync") : translate("canvasPage.nodeEditor.savedLocalAssetSync"));
            else message.success(result.linkedToProject ? translate("canvasPage.nodeEditor.addedToProject") : translate("canvasPage.nodeEditor.addedToMyAssets"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : translate("canvasPage.nodeEditor.saveAssetFailed"));
        }
    }, [canvasId, domainProjectId, message, queryClient, setNodes]);

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, [setNodes]);

    return {
        collapsingBatchIds,
        downloadNodeImage,
        downloadNodesMedia,
        handleConfigNodeChange,
        handleFolderStyleChange,
        handleFolderThemeChange,
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
