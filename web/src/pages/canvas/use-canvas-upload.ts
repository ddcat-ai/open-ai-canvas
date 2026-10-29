import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/components/canvas/canvas-asset-tray";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CANVAS_PROJECT_CHAPTER_DND_TYPE, type CanvasProjectChapterPayload } from "@/lib/canvas/canvas-project-chapter-dnd";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { isAudioFile } from "@/lib/canvas/canvas-project-generation";
import { fitImageNodeSize, fitNodeSize, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { CANVAS_UPLOAD_ACCEPT, createFileUploadPlaceholder, uploadNodeType, uploadPercent } from "@/lib/canvas/canvas-file-upload";
import { recordReplacedMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { prepareCanvasImage } from "@/services/canvas-image-loader";
import { registerUploadPreview, releaseUploadPreview } from "@/services/canvas-upload-preview";
import { peekCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { getProjectUnit } from "@/services/api/projects";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
import type { TimelineDirectMedia } from "@/types/timeline";
import type { CanvasUploadStatus } from "./canvas-project-feedback";

type UseCanvasUploadOptions = {
    canvasId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    getCanvasCenter: () => Position;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
};

export type StartCanvasUploadStatus = (title: string, detail: string, total?: number, initialStep?: number) => CanvasUploadProgress;

type CanvasUploadProgress = {
    update: (detail: string, step: number) => void;
    done: (detail?: string) => void;
    fail: (detail?: string) => void;
};

type FileNodeUploadOptions = {
    // 批量上传由批量入口统一展示进度、选中结果和汇总提示，并在全部完成后只刷新一次项目。
    batch?: { onLocalOnly: () => void };
};

const SILENT_UPLOAD_PROGRESS: CanvasUploadProgress = { update: () => {}, done: () => {}, fail: () => {} };
const NODE_STATUS_SUCCESS = "success" as const;
// 同时上传的文件数：足以重叠网络等待与素材同步，又不会一次性抢满后端上传限流。
const BATCH_UPLOAD_CONCURRENCY = 3;
// 进度回调可能每几毫秒触发一次；节点进度按此间隔合并，避免整份节点数组被高频重建。
const UPLOAD_PROGRESS_PAINT_MS = 120;
const UPLOAD_WARM_TIMEOUT_MS = 1500;
const BATCH_UPLOAD_COLUMNS = 3;
const BATCH_UPLOAD_COLUMN_GAP = 380;
const BATCH_UPLOAD_ROW_GAP = 300;
const CANVAS_BATCH_TABLE_SELECTOR = "[data-canvas-batch-table]";

function isBatchTableDragEvent(event: DragEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    return Boolean(target?.closest(CANVAS_BATCH_TABLE_SELECTOR));
}

// 切换为正式图片节点前先解码本地原图，节点首帧即可上屏；超时或失败只放弃预热，不影响上传结果。
async function warmUploadedImage(storageKey?: string) {
    const url = storageKey ? peekCachedResourceObjectUrl(storageKey) : "";
    if (!url) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), UPLOAD_WARM_TIMEOUT_MS);
    try {
        await prepareCanvasImage(url, controller.signal);
    } catch {
        // 预热只是体验优化；节点仍会按正常资源加载路径显示。
    } finally {
        window.clearTimeout(timer);
    }
}

export function useCanvasUpload({
    canvasId,
    domainProjectId,
    nodesRef,
    selectedNodeIdsRef,
    getCanvasCenter,
    screenToCanvas,
    setNodes,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setDialogNodeId,
}: UseCanvasUploadOptions) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const assetInsertPositionRef = useRef<Position | null>(null);
    const uploadStatusIdRef = useRef(0);
    const statusTimersRef = useRef<Set<number>>(new Set());
    const fileDragDepthRef = useRef(0);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<CanvasUploadStatus | null>(null);
    const [fileDropActive, setFileDropActive] = useState(false);

    useEffect(() => () => {
        statusTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    }, []);

    const startUploadStatus = useCallback<StartCanvasUploadStatus>((title, detail, total = 3, initialStep = 1) => {
        const id = (uploadStatusIdRef.current += 1);
        setUploadStatus({ id, title, detail, step: initialStep, total });
        const dismiss = (delay: number) => {
            const timer = window.setTimeout(() => {
                statusTimersRef.current.delete(timer);
                setUploadStatus((current) => (current?.id === id ? null : current));
            }, delay);
            statusTimersRef.current.add(timer);
        };
        return {
            update: (nextDetail: string, step: number) => setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: Math.min(Math.max(step, 0), total) } : current)),
            done: (nextDetail = "处理完成") => {
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: total, done: true } : current));
                dismiss(850);
            },
            fail: (nextDetail = "处理失败") => {
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, error: true } : current));
                dismiss(1800);
            },
        };
    }, []);

    const selectInsertedNode = useCallback((nodeId: string, dialog: "open" | "close" | "preserve") => {
        setSelectedNodeIds(new Set([nodeId]));
        setSelectedConnectionId(null);
        if (dialog !== "preserve") setDialogNodeId(dialog === "open" ? nodeId : null);
    }, [setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds]);

    const persistMediaNode = useCallback(async (node: CanvasNodeData, options: { refreshProject?: boolean } = {}) => {
        try {
            const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-upload" });
            setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
            if (domainProjectId && options.refreshProject !== false) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            return { persisted: true, syncPending: result.syncPending };
        } catch (error) {
            message.warning(error instanceof Error ? `媒体已添加到画布，但素材同步失败：${error.message}` : "媒体已添加到画布，但素材同步失败");
            return { persisted: false, syncPending: false };
        }
    }, [canvasId, domainProjectId, message, queryClient, setNodes]);

    const persistTimelineMedia = useCallback(async (media: TimelineDirectMedia) => {
        const type = media.kind === "audio" ? CanvasNodeType.Audio : media.kind === "video" ? CanvasNodeType.Video : CanvasNodeType.Image;
        const defaults = NODE_DEFAULT_SIZE[type];
        const node: CanvasNodeData = {
            id: media.id,
            type,
            title: media.title,
            position: { x: 0, y: 0 },
            width: media.width || defaults.width,
            height: media.height || defaults.height,
            metadata: {
                content: media.url || media.dataUrl || media.content || "",
                storageKey: media.storageKey,
                naturalWidth: media.width,
                naturalHeight: media.height,
                durationMs: media.durationMs,
                bytes: media.bytes,
                mimeType: media.mimeType,
            },
        };
        const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-upload" });
        if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
        return result.assetId;
    }, [canvasId, domainProjectId, queryClient]);

    const activeUploadsRef = useRef(new Set<string>());
    const createFileNode = useCallback(async (file: File, position: Position, replaceId?: string, options: FileNodeUploadOptions = {}) => {
        const original = replaceId ? nodesRef.current.find((node) => node.id === replaceId) : undefined;
        if (replaceId && (!original || activeUploadsRef.current.has(replaceId))) return null;
        const id = replaceId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const batch = options.batch;
        activeUploadsRef.current.add(id);
        const progress = batch ? SILENT_UPLOAD_PROGRESS : startUploadStatus(replaceId ? "替换文件" : "上传文件", "读取文件信息", domainProjectId ? 4 : 3);
        const fileType = uploadNodeType(file);
        // 占位节点首帧就显示本地文件，上传进度叠加在预览之上，不再是一块空白。
        if (fileType === CanvasNodeType.Image || fileType === CanvasNodeType.Video) registerUploadPreview(id, file);
        try {
            const placeholder = await createFileUploadPlaceholder(id, file, position);
            setNodes((current) => replaceId ? current.map((item) => item.id === id ? {
                ...item, width: placeholder.width, height: placeholder.height,
                metadata: { ...item.metadata, fileUpload: "uploading", fileUploadProgress: undefined, status: undefined, size: undefined, errorDetails: undefined },
            } : item) : [...current, placeholder]);
            if (!batch) selectInsertedNode(id, "close");
            let lastPercent: number | undefined;
            let lastPaintAt = 0;
            const onProgress = (loaded: number, total: number) => {
                const percent = uploadPercent(loaded, total);
                if (percent === undefined || percent === lastPercent) return;
                const now = performance.now();
                if (percent < 100 && now - lastPaintAt < UPLOAD_PROGRESS_PAINT_MS) return;
                lastPercent = percent;
                lastPaintAt = now;
                setNodes((current) => current.map((item) => item.id === id ? { ...item, metadata: { ...item.metadata, fileUploadProgress: percent } } : item));
                progress.update(percent === 100 ? "文件已传输，正在保存与处理" : `已上传 ${percent}%`, 2);
            };
            progress.update("上传文件并同步资源", 2);
            let metadata: CanvasNodeData["metadata"];
            if (placeholder.type === CanvasNodeType.Image) {
                const naturalSize = { width: placeholder.metadata?.naturalWidth || 0, height: placeholder.metadata?.naturalHeight || 0 };
                const uploaded = await uploadImage(file, onProgress, naturalSize);
                metadata = imageMetadata(uploaded);
                await warmUploadedImage(uploaded.storageKey);
            } else if (placeholder.type === CanvasNodeType.Text) {
                const content = await file.text();
                const resource = await uploadResourceFile(file, "file", { fileName: file.name }, onProgress);
                metadata = { content, prompt: content, storageKey: resourceStorageKey(resource.id), mimeType: file.type || "text/plain", bytes: file.size, status: "success" };
            } else {
                const media = await uploadMediaFile(file, placeholder.type === CanvasNodeType.Video ? "video" : "audio", onProgress);
                metadata = placeholder.type === CanvasNodeType.Video ? videoMetadata(media) : audioMetadata(media);
            }
            progress.update("更新画布节点", 3);
            const currentNode = nodesRef.current.find((item) => item.id === id);
            if (!currentNode) {
                progress.done("上传完成，画布占位已移除");
                return null;
            }
            const uploadedNode: CanvasNodeData = {
                ...currentNode, type: placeholder.type,
                metadata: {
                    ...currentNode.metadata, ...metadata,
                    fileUpload: undefined, fileUploadProgress: undefined, errorDetails: undefined,
                    producedModel: undefined, producedModelCandidate: undefined,
                    ...(replaceId ? {
                        assetId: undefined, taskId: undefined, freeResize: false,
                        isBatchRoot: undefined, batchRootId: undefined, batchChildIds: undefined,
                        batchFailedCount: undefined, batchUsesReferenceImages: undefined,
                        generationType: undefined, generationResultPlacement: undefined,
                        copiedFromNodeId: undefined, versionOfNodeId: undefined,
                        model: undefined, size: undefined, quality: undefined,
                        transparentBackground: undefined, count: undefined, references: undefined,
                        primaryImageId: undefined, imageBatchExpanded: undefined,
                        richText: undefined, composerContent: undefined,
                    } : {}),
                },
            };
            // 替换文件保留旧媒体为历史版本，可在版本面板切回。
            const node = replaceId ? recordReplacedMediaVersion(original, uploadedNode, "upload") : uploadedNode;
            setNodes((current) => current.map((item) => item.id === id ? { ...item, type: node.type, metadata: node.metadata } : item));
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node, { refreshProject: !batch });
            const localOnly = metadata.storageKey && !resourceIdFromStorageKey(metadata.storageKey);
            const pendingLabel = domainProjectId ? "项目资产正在自动同步" : "云端素材正在自动同步";
            progress.done(localOnly ? "已保存在本机，尚未上传到服务器" : persisted.syncPending ? `文件已添加到画布，${pendingLabel}` : persisted.persisted ? "文件已添加到画布" : "文件已添加，项目资产待重试");
            if (localOnly) {
                if (batch) batch.onLocalOnly();
                else message.warning("文件已保存在本机，尚未上传到服务器");
            }
            return id;
        } catch (error) {
            const details = error instanceof Error ? error.message : "文件上传失败";
            setNodes((current) => current.map((item) => item.id !== id ? item : original?.metadata?.content ? {
                ...item, width: original.width, height: original.height, metadata: original.metadata,
            } : { ...item, metadata: { ...item.metadata, fileUpload: "error", fileUploadProgress: undefined, errorDetails: details } }));
            progress.fail(details);
            // 批量上传的失败原因留在各自节点上，并由批量汇总提示数量，避免逐个弹错。
            if (!batch) message.error(details);
            return null;
        } finally {
            activeUploadsRef.current.delete(id);
            releaseUploadPreview(id);
        }
    }, [domainProjectId, message, nodesRef, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

    const createImageAssetNode = useCallback(async (asset: ImageAsset, position?: Position) => {
        try {
            const content = asset.data.storageKey ? await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl) : asset.data.dataUrl || asset.coverUrl;
            if (!content) {
                message.error("素材图片不可用");
                return;
            }
            const size = fitImageNodeSize(asset.data.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, asset.data.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height);
            const center = position || getCanvasCenter();
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: asset.title || "素材图片",
                position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: {
                    content,
                    storageKey: asset.data.storageKey,
                    status: NODE_STATUS_SUCCESS,
                    naturalWidth: asset.data.width,
                    naturalHeight: asset.data.height,
                    bytes: asset.data.bytes || getDataUrlByteSize(content.startsWith("data:") ? content : ""),
                    mimeType: asset.data.mimeType || "image/png",
                    prompt: typeof asset.metadata?.prompt === "string" ? asset.metadata.prompt : asset.title,
                    assetId: asset.id,
                    assetTags: asset.tags || [],
                },
            };
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "close");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材图片读取失败");
        }
    }, [getCanvasCenter, message, selectInsertedNode, setNodes]);

    const createTextNodeFromClipboard = useCallback((text: string, position?: Position) => {
        const trimmed = text.trim();
        if (!trimmed) return false;
        const node = {
            ...createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
            title: trimmed.slice(0, 32) || "剪切板文本",
        };
        setNodes((current) => [...current, node]);
        selectInsertedNode(node.id, "open");
        setContextMenu(null);
        return true;
    }, [getCanvasCenter, selectInsertedNode, setContextMenu, setNodes]);

    const handleProjectChapterInsert = useCallback(async (chapter: CanvasProjectChapterPayload, position?: Position) => {
        let sourceText = chapter.sourceText;
        if (sourceText === undefined) {
            try {
                sourceText = (await getProjectUnit(chapter.projectId, chapter.id)).unit.sourceText;
            } catch (error) {
                message.error(error instanceof Error ? `章节正文读取失败：${error.message}` : "章节正文读取失败");
                return;
            }
        }
        const content = htmlToPlainText(sourceText);
        const node = createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), {
            content,
            prompt: content,
            status: NODE_STATUS_SUCCESS,
            workflowKind: "free",
            workflowTitle: "项目章节",
            workflowDescription: `第 ${chapter.position + 1} 章`,
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            fontSize: 14,
        });
        node.title = `章节 · ${chapter.title}`;
        node.width = 460;
        node.height = 280;
        setNodes((current) => [...current, node]);
        selectInsertedNode(node.id, "preserve");
        setContextMenu(null);
        message.success(`已添加“${chapter.title}”`);
    }, [getCanvasCenter, message, selectInsertedNode, setContextMenu, setNodes]);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        if (!nodeId) {
            setUploadModalOpen(true);
            return;
        }
        const target = nodeId ? nodesRef.current.find((node) => node.id === nodeId) : null;
        if (imageInputRef.current) {
            imageInputRef.current.accept = target?.type === CanvasNodeType.Image
                ? "image/*"
                : target?.type === CanvasNodeType.Video
                  ? "video/*"
                  : target?.type === CanvasNodeType.Audio
                    ? "audio/*,.mp3,.wav"
                    : target?.type === CanvasNodeType.Text ? "text/plain,text/markdown,.txt,.md,.markdown" : CANVAS_UPLOAD_ACCEPT;
        }
        imageInputRef.current?.click();
    }, [nodesRef]);

    const closeUploadModal = useCallback(() => {
        uploadTargetRef.current = null;
        setUploadModalOpen(false);
    }, []);

    const handleUploadFiles = useCallback(async (files: File[]) => {
        const supportedFiles = files.filter((file) => uploadNodeType(file));
        if (!supportedFiles.length) {
            message.warning("请选择图片、视频、音频或 TXT / Markdown 文件");
            return false;
        }
        const center = uploadTargetRef.current?.position || getCanvasCenter();
        const total = supportedFiles.length;
        const columns = Math.min(BATCH_UPLOAD_COLUMNS, total);
        const originX = center.x - ((columns - 1) * BATCH_UPLOAD_COLUMN_GAP) / 2;
        const positionAt = (index: number) => ({
            x: originX + (index % columns) * BATCH_UPLOAD_COLUMN_GAP,
            y: center.y + Math.floor(index / columns) * BATCH_UPLOAD_ROW_GAP,
        });
        // 单个文件沿用逐步进度；多个文件改为有限并发，整体进度按已完成数量展示。
        const progress = total > 1 ? startUploadStatus(`上传 ${total} 个文件`, `已完成 0/${total}`, total, 0) : null;
        const results: Array<string | null> = new Array(total).fill(null);
        let nextIndex = 0;
        let settled = 0;
        let localOnlyCount = 0;
        const batch = progress ? { onLocalOnly: () => { localOnlyCount += 1; } } : undefined;
        const worker = async () => {
            while (nextIndex < total) {
                const index = nextIndex;
                nextIndex += 1;
                results[index] = await createFileNode(supportedFiles[index], positionAt(index), undefined, { batch });
                settled += 1;
                progress?.update(`已完成 ${settled}/${total}`, settled);
            }
        };
        await Promise.all(Array.from({ length: Math.min(BATCH_UPLOAD_CONCURRENCY, total) }, worker));
        const createdIds = results.filter((id): id is string => Boolean(id));
        if (batch && domainProjectId && createdIds.length) void queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
        if (!createdIds.length) {
            progress?.fail("文件均未上传成功，请查看节点上的失败原因");
            return false;
        }
        setSelectedNodeIds(new Set(createdIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        const failedCount = total - createdIds.length;
        progress?.done(failedCount ? `已添加 ${createdIds.length} 个，${failedCount} 个失败` : `已添加 ${createdIds.length} 个文件`);
        if (failedCount) message.warning(`已添加 ${createdIds.length} 个文件，${failedCount} 个上传失败`);
        else if (localOnlyCount) message.warning(`已添加 ${createdIds.length} 个文件，其中 ${localOnlyCount} 个暂存在本机，稍后自动同步`);
        else message.success(`已添加 ${createdIds.length} 个文件到画布`);
        return true;
    }, [createFileNode, domainProjectId, getCanvasCenter, message, queryClient, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds, startUploadStatus]);

    // 时间线专用：把本地音视频文件上传为直连媒体（仅时间线作用域，不创建画布节点），返回媒体描述数组。
    const uploadTimelineMedia = useCallback(async (files: File[]): Promise<TimelineDirectMedia[]> => {
        const supportedFiles = files.filter((file) => file.type.startsWith("video/") || isAudioFile(file));
        if (!supportedFiles.length) {
            message.warning("请选择视频、MP3 或 WAV 文件");
            return [];
        }
        const created: TimelineDirectMedia[] = [];
        for (const file of supportedFiles) {
            try {
                if (isAudioFile(file)) {
                    const audio = await uploadMediaFile(file, "audio");
                    const media: TimelineDirectMedia = {
                        id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        kind: "audio",
                        title: file.name,
                        storageKey: audio.storageKey,
                        url: audio.url,
                        durationMs: audio.durationMs,
                        bytes: audio.bytes,
                        mimeType: audio.mimeType,
                    };
                    media.assetId = await persistTimelineMedia(media);
                    created.push(media);
                } else {
                    const video = await uploadMediaFile(file, "video");
                    const media: TimelineDirectMedia = {
                        id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        kind: "video",
                        title: file.name,
                        storageKey: video.storageKey,
                        url: video.url,
                        width: video.width,
                        height: video.height,
                        durationMs: video.durationMs,
                        bytes: video.bytes,
                        mimeType: video.mimeType,
                    };
                    media.assetId = await persistTimelineMedia(media);
                    created.push(media);
                }
            } catch (error) {
                message.error(error instanceof Error ? `素材上传失败：${error.message}` : "素材上传失败");
            }
        }
        if (created.length) message.success(`已上传 ${created.length} 个素材到时间线`);
        return created;
    }, [message, persistTimelineMedia]);

    // 组装能力闭环：把时间线合成结果（MP4 Blob）上传并创建为新的视频节点放回画布，
    // 复用上传/持久化/选中逻辑，新节点可继续编辑字幕与样式。
    const createVideoNodeFromBlob = useCallback(async (blob: Blob, title: string): Promise<CanvasNodeData | null> => {
        const progress = startUploadStatus("合成视频片段", "上传合成结果", domainProjectId ? 4 : 3);
        try {
            progress.update("上传到服务器并同步资源", 2);
            const video = await uploadMediaFile(blob, "video");
            progress.update("更新画布节点", 3);
            const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
            const center = getCanvasCenter();
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node = {
                id,
                type: CanvasNodeType.Video,
                title,
                position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: { ...videoMetadata(video), status: NODE_STATUS_SUCCESS },
            } satisfies CanvasNodeData;
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "preserve");
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node);
            progress.done(
                persisted.syncPending
                    ? domainProjectId
                        ? "已生成新视频片段，本地素材已保存，项目资产正在自动同步"
                        : "已生成新视频片段，本地素材已保存，云端素材正在自动同步"
                    : persisted.persisted
                      ? "已生成新视频片段并加入项目资产"
                      : "已生成新视频片段，项目资产待重试",
            );
            return node;
        } catch (error) {
            const details = error instanceof Error ? error.message : "合成视频片段失败";
            progress.fail(details);
            message.error(details);
            return null;
        }
    }, [domainProjectId, getCanvasCenter, message, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

    const replaceNodeMedia = useCallback(async (nodeId: string, file: File) => {
        const currentNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!currentNode || !uploadNodeType(file)) return false;
        const typedNode = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(currentNode.type as CanvasNodeType);
        if (typedNode && uploadNodeType(file) !== currentNode.type) return false;
        return Boolean(await createFileNode(file, currentNode.position, nodeId));
    }, [createFileNode, nodesRef]);

    const pasteSystemClipboard = useCallback(async (position?: Position, clipboardEvent?: ClipboardEvent | null) => {
        const isNodeMarker = (value: string) => {
            const trimmed = value.trim();
            return trimmed.startsWith("open-ai-canvas-nodes:") || trimmed.startsWith("open-ai-canvas-nodes-json:");
        };
        const pasteImageFile = async (file: File) => {
            const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
            if (selected.length === 1 && selected[0].type === CanvasNodeType.Image) {
                if (await replaceNodeMedia(selected[0].id, file)) message.success("已用剪切板图片替换，可撤销恢复");
                return true;
            }
            const inserted = await createFileNode(file, position || getCanvasCenter());
            if (inserted) message.success("已从剪切板添加图片");
            return Boolean(inserted);
        };

        // 1) paste 事件里的图片文件（截图/资源管理器复制）优先。
        const filesFromEvent = clipboardEvent
            ? Array.from(clipboardEvent.clipboardData?.items || [])
                .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => Boolean(file))
            : [];
        if (filesFromEvent.length) return pasteImageFile(filesFromEvent[0]);

        // 2) 若系统文本是节点标记，说明最近一次复制是画布节点，不要再读旧图片。
        const eventText = clipboardEvent?.clipboardData?.getData("text/plain") || "";
        if (isNodeMarker(eventText)) return false;

        // 3) 异步读系统剪贴板：有图片才导入；若文本是节点标记则让位给节点粘贴。
        if (navigator.clipboard?.read) {
            try {
                const items = await navigator.clipboard.read();
                const textItem = items.find((item) => item.types.includes("text/plain"));
                if (textItem) {
                    const textBlob = await textItem.getType("text/plain");
                    const text = await textBlob.text();
                    if (isNodeMarker(text)) return false;
                }
                const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
                if (imageItem) {
                    const imageType = imageItem.types.find((type) => type.startsWith("image/"));
                    if (!imageType) return false;
                    const blob = await imageItem.getType(imageType);
                    return pasteImageFile(new File([blob], "clipboard-image.png", { type: imageType }));
                }
            } catch {
                // 无权限时继续文本分支。
            }
        }

        try {
            const text = eventText || (navigator.clipboard?.readText ? await navigator.clipboard.readText() : "");
            if (isNodeMarker(text)) return false;
            if (createTextNodeFromClipboard(text, position)) {
                message.success("已从剪切板添加文本");
                return true;
            }
        } catch {
            // ignore
        }
        return false;
    }, [createFileNode, createTextNodeFromClipboard, getCanvasCenter, message, nodesRef, replaceNodeMedia, selectedNodeIdsRef]);

    const handleImageInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const target = uploadTargetRef.current;
        try {
            if (!file || !uploadNodeType(file)) return;
            if (target?.nodeId) {
                const targetNode = nodesRef.current.find((node) => node.id === target.nodeId);
                const compatible = targetNode && (targetNode.type === uploadNodeType(file)
                    || ![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(targetNode.type as CanvasNodeType));
                if (!compatible) {
                    message.warning("请选择与当前节点相同类型的媒体文件");
                    return;
                }
                await replaceNodeMedia(target.nodeId, file);
                return;
            }
            const position = target?.position || getCanvasCenter();
            await createFileNode(file, position);
        } finally {
            uploadTargetRef.current = null;
            event.target.value = "";
        }
    }, [createFileNode, getCanvasCenter, message, nodesRef, replaceNodeMedia]);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (isBatchTableDragEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
            fileDragDepthRef.current = 0;
            setFileDropActive(false);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        fileDragDepthRef.current = 0;
        setFileDropActive(false);
        const chapterPayload = parseProjectChapterPayload(event.dataTransfer.getData(CANVAS_PROJECT_CHAPTER_DND_TYPE));
        if (chapterPayload) {
            void handleProjectChapterInsert(chapterPayload, screenToCanvas(event.clientX, event.clientY));
            return;
        }
        const imageAssetId = event.dataTransfer.getData(CANVAS_IMAGE_ASSET_DND_TYPE);
        if (imageAssetId) {
            const asset = useAssetStore.getState().assets.find((item): item is ImageAsset => item.kind === "image" && item.id === imageAssetId);
            if (!asset) {
                message.warning("素材不存在");
                return;
            }
            void createImageAssetNode(asset, screenToCanvas(event.clientX, event.clientY));
            return;
        }
        const files = Array.from(event.dataTransfer.files).filter((item) => uploadNodeType(item));
        if (!files.length) return;
        if (files.length > 1) {
            void handleUploadFiles(files);
            return;
        }
        const file = files[0];
        const position = screenToCanvas(event.clientX, event.clientY);
        const target = [...nodesRef.current].reverse().find((node) => {
            const compatible = node.type === uploadNodeType(file);
            return compatible && position.x >= node.position.x && position.x <= node.position.x + node.width && position.y >= node.position.y && position.y <= node.position.y + node.height;
        });
        if (target) {
            void replaceNodeMedia(target.id, file).then((replaced) => {
                if (replaced) message.success("媒体已替换，可撤销恢复");
            });
            return;
        }
        void createFileNode(file, position);
    }, [createFileNode, createImageAssetNode, handleProjectChapterInsert, handleUploadFiles, message, nodesRef, replaceNodeMedia, screenToCanvas]);

    const handleFileDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (isBatchTableDragEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
            fileDragDepthRef.current = 0;
            setFileDropActive(false);
            return;
        }
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        fileDragDepthRef.current += 1;
        setFileDropActive(true);
    }, []);

    const handleFileDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (isBatchTableDragEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
            fileDragDepthRef.current = 0;
            setFileDropActive(false);
            return;
        }
        if (!hasDraggedFiles(event) && !Array.from(event.dataTransfer.types).includes(CANVAS_PROJECT_CHAPTER_DND_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const handleFileDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (isBatchTableDragEvent(event)) {
            event.preventDefault();
            event.stopPropagation();
            fileDragDepthRef.current = 0;
            setFileDropActive(false);
            return;
        }
        if (!hasDraggedFiles(event)) return;
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setFileDropActive(false);
    }, []);

    const pasteAssistantImage = useCallback((file: File) => {
        void createFileNode(file, getCanvasCenter()).then((inserted) => {
            if (inserted) message.success("已从剪切板添加图片");
        });
    }, [createFileNode, getCanvasCenter, message]);

    const openAssetsAtPosition = useCallback((position?: Position) => {
        assetInsertPositionRef.current = position || null;
        setAssetPickerOpen(true);
    }, []);

    const closeAssetPicker = useCallback(() => {
        assetInsertPositionRef.current = null;
        setAssetPickerOpen(false);
    }, []);

    const createAssetPayloadNode = useCallback(async (payload: InsertAssetPayload, center: Position) => {
        if (payload.kind === "character") {
            // 角色卡是竖版海报式主视觉，默认用 3:4 竖幅。
            const width = 264;
            const height = 352;
            return {
                id: `character-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                type: CanvasNodeType.Text,
                title: payload.title,
                position: { x: center.x - width / 2, y: center.y - height / 2 },
                width,
                height,
                metadata: {
                    workflowKind: "character",
                    characterAssetId: payload.assetId,
                    characterVersionId: payload.versionId,
                    characterVersionPolicy: "current",
                    characterName: payload.title,
                    characterPrompt: payload.prompt,
                    characterAliases: payload.aliases,
                    characterDefinition: payload.definition,
                    characterCoverUrl: payload.coverUrl,
                    characterVisualStatus: payload.visualStatus,
                    characterVoiceStatus: payload.voiceStatus,
                    characterVoiceName: payload.voiceName,
                    characterVoiceProfile: payload.voiceProfile,
                    characterVoiceInstructions: payload.voiceInstructions,
                    assetId: payload.assetId,
                    status: NODE_STATUS_SUCCESS,
                    fontSize: 14,
                },
            } satisfies CanvasNodeData;
        }
        if (payload.kind === "text") {
            const node = { ...createCanvasNode(CanvasNodeType.Text, center, { content: payload.content, status: NODE_STATUS_SUCCESS, assetId: payload.assetId }), title: payload.content.slice(0, 32) || "Assistant Text" };
            return node;
        }
        if (payload.kind === "audio") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
            const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            return { id, type: CanvasNodeType.Audio, title: payload.title, position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 }, width: spec.width, height: spec.height, metadata: { content: payload.url, storageKey: payload.storageKey, durationMs: payload.durationMs, bytes: payload.bytes, mimeType: payload.mimeType || "audio/mpeg", assetId: payload.assetId, status: NODE_STATUS_SUCCESS } } satisfies CanvasNodeData;
        }
        if (payload.kind === "video") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const size = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            return { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height, durationMs: payload.durationMs, hasAudio: payload.hasAudio, bytes: payload.bytes, mimeType: payload.mimeType || "video/mp4", assetId: payload.assetId } } satisfies CanvasNodeData;
        }
        const storedImage = payload.url
            ? { url: payload.url, storageKey: undefined, width: payload.width || 1, height: payload.height || 1, bytes: payload.bytes || 0, mimeType: payload.mimeType || "image/png" }
            : payload.storageKey
                ? { url: payload.dataUrl, storageKey: payload.storageKey, width: payload.width || 1, height: payload.height || 1, bytes: payload.bytes || 0, mimeType: payload.mimeType || "image/png" }
                : await uploadImage(payload.dataUrl);
        const meta = !payload.storageKey && (!payload.width || !payload.height) ? await readImageMeta(storedImage.url) : storedImage;
        const size = fitImageNodeSize(meta.width, meta.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const metadata = storedImage.storageKey
            ? imageMetadata({ ...storedImage, storageKey: storedImage.storageKey, width: meta.width, height: meta.height })
            : { content: storedImage.url, status: NODE_STATUS_SUCCESS, naturalWidth: meta.width, naturalHeight: meta.height, bytes: storedImage.bytes, mimeType: storedImage.mimeType };
        return { id, type: CanvasNodeType.Image, title: payload.title.slice(0, 32) || "Generated Image", position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { ...metadata, prompt: payload.title, assetId: payload.assetId } } satisfies CanvasNodeData;
    }, []);

    const insertAssetPayloads = useCallback(async (payloads: InsertAssetPayload[], origin: Position, successMessage: string, failureMessage: string): Promise<CanvasNodeData[]> => {
        try {
            const created = await Promise.all(payloads.map((payload, index) => createAssetPayloadNode(payload, {
                x: origin.x + (index % BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_COLUMN_GAP,
                y: origin.y + Math.floor(index / BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_ROW_GAP,
            })));
            setNodes((current) => [...current, ...created]);
            setSelectedNodeIds(new Set(created.map((node) => node.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(successMessage);
            return created;
        } catch (error) {
            message.error(error instanceof Error ? error.message : failureMessage);
            throw error;
        }
    }, [createAssetPayloadNode, message, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    const handleAssetsInsert = useCallback(async (payloads: InsertAssetPayload[]): Promise<CanvasNodeData[]> => {
        const origin = assetInsertPositionRef.current || getCanvasCenter();
        return insertAssetPayloads(payloads, origin, `已插入 ${payloads.length} 项素材`, "素材插入失败");
    }, [getCanvasCenter, insertAssetPayloads]);

    const handleProjectAssetsInsert = useCallback(async (payloads: InsertAssetPayload[], position?: Position): Promise<CanvasNodeData[]> => {
        const origin = position || getCanvasCenter();
        return insertAssetPayloads(payloads, origin, `已引入 ${payloads.length} 项项目资产`, "项目资产引入失败");
    }, [getCanvasCenter, insertAssetPayloads]);

    return {
        assetPickerOpen,
        closeAssetPicker,
        createFileNode,
        createVideoNodeFromBlob,
        createAssetPayloadNode,
        createImageAssetNode,
        fileDropActive,
        handleAssetsInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleProjectAssetsInsert,
        handleProjectChapterInsert,
        handleUploadFiles,
        handleUploadRequest,
        imageInputRef,
        closeUploadModal,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        replaceNodeMedia,
        startUploadStatus,
        uploadModalOpen,
        uploadStatus,
        uploadTimelineMedia,
    };
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
}

function parseProjectChapterPayload(value: string): CanvasProjectChapterPayload | null {
    if (!value) return null;
    try {
        const payload = JSON.parse(value) as Partial<CanvasProjectChapterPayload>;
        const validSource = payload.sourceText === undefined || typeof payload.sourceText === "string";
        return typeof payload.id === "string" && typeof payload.projectId === "string" && typeof payload.title === "string" && validSource && typeof payload.position === "number" ? payload as CanvasProjectChapterPayload : null;
    } catch {
        return null;
    }
}

function htmlToPlainText(value: string) {
    if (!value) return "";
    const document = new DOMParser().parseFromString(value, "text/html");
    return document.body.textContent?.trim() || "";
}
