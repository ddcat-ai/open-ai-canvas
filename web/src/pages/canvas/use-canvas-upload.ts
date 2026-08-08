import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/components/canvas/canvas-asset-tray";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CANVAS_PROJECT_CHAPTER_DND_TYPE, type CanvasProjectChapterPayload } from "@/components/canvas/canvas-project-sidebar";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { isAudioFile } from "@/lib/canvas/canvas-project-generation";
import { fitNodeSize, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
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

export type StartCanvasUploadStatus = (title: string, detail: string, total?: number) => {
    update: (detail: string, step: number) => void;
    done: (detail?: string) => void;
    fail: (detail?: string) => void;
};

const NODE_STATUS_SUCCESS = "success" as const;
const BATCH_UPLOAD_COLUMNS = 3;
const BATCH_UPLOAD_COLUMN_GAP = 380;
const BATCH_UPLOAD_ROW_GAP = 300;

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

    const startUploadStatus = useCallback<StartCanvasUploadStatus>((title, detail, total = 3) => {
        const id = (uploadStatusIdRef.current += 1);
        setUploadStatus({ id, title, detail, step: 1, total });
        const dismiss = (delay: number) => {
            const timer = window.setTimeout(() => {
                statusTimersRef.current.delete(timer);
                setUploadStatus((current) => (current?.id === id ? null : current));
            }, delay);
            statusTimersRef.current.add(timer);
        };
        return {
            update: (nextDetail: string, step: number) => setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: Math.min(Math.max(step, 1), total) } : current)),
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

    const persistMediaNode = useCallback(async (node: CanvasNodeData) => {
        try {
            const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-upload" });
            setNodes((current) => current.map((item) => item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item));
            if (domainProjectId) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            return true;
        } catch (error) {
            message.warning(error instanceof Error ? `媒体已添加到画布，但素材同步失败：${error.message}` : "媒体已添加到画布，但素材同步失败");
            return false;
        }
    }, [canvasId, domainProjectId, message, queryClient, setNodes]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const progress = startUploadStatus("上传图片", "读取图片文件", domainProjectId ? 4 : 3);
        try {
            progress.update("上传到服务器并同步资源", 2);
            const image = await uploadImage(file);
            progress.update("更新画布节点", 3);
            const size = fitNodeSize(image.width, image.height);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "open");
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node);
            progress.done(persisted ? "图片已添加到画布" : "图片已添加，项目资产待重试");
            return id;
        } catch (error) {
            const details = error instanceof Error ? error.message : "图片上传失败";
            progress.fail(details);
            message.error(details);
            return null;
        }
    }, [domainProjectId, message, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

    const createImageAssetNode = useCallback(async (asset: ImageAsset, position?: Position) => {
        try {
            const content = asset.data.storageKey ? await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl) : asset.data.dataUrl || asset.coverUrl;
            if (!content) {
                message.error("素材图片不可用");
                return;
            }
            const size = fitNodeSize(asset.data.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, asset.data.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height);
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

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const progress = startUploadStatus("上传视频", "读取视频文件", domainProjectId ? 4 : 3);
        try {
            progress.update("上传到服务器并同步资源", 2);
            const video = await uploadMediaFile(file, "video");
            progress.update("更新画布节点", 3);
            const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node = { id, type: CanvasNodeType.Video, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, metadata: videoMetadata(video) } satisfies CanvasNodeData;
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "open");
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node);
            progress.done(persisted ? "视频已添加到画布" : "视频已添加，项目资产待重试");
            return id;
        } catch (error) {
            const details = error instanceof Error ? error.message : "视频上传失败";
            progress.fail(details);
            message.error(details);
            return null;
        }
    }, [domainProjectId, message, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const progress = startUploadStatus("上传音频", "读取音频文件", domainProjectId ? 4 : 3);
        try {
            progress.update("上传到服务器并同步资源", 2);
            const audio = await uploadMediaFile(file, "audio");
            progress.update("更新画布节点", 3);
            const size = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
            const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node = { id, type: CanvasNodeType.Audio, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, metadata: audioMetadata(audio) } satisfies CanvasNodeData;
            setNodes((current) => [...current, node]);
            selectInsertedNode(id, "preserve");
            if (domainProjectId) progress.update("写入项目资产", 4);
            const persisted = await persistMediaNode(node);
            progress.done(persisted ? "音频已添加到画布" : "音频已添加，项目资产待重试");
            return id;
        } catch (error) {
            const details = error instanceof Error ? error.message : "音频上传失败";
            progress.fail(details);
            message.error(details);
            return null;
        }
    }, [domainProjectId, message, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

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
                    ? "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                    : "image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
        }
        imageInputRef.current?.click();
    }, [nodesRef]);

    const closeUploadModal = useCallback(() => {
        uploadTargetRef.current = null;
        setUploadModalOpen(false);
    }, []);

    const handleUploadFiles = useCallback(async (files: File[]) => {
        const supportedFiles = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || isAudioFile(file));
        if (!supportedFiles.length) {
            message.warning("请选择图片、视频、MP3 或 WAV 文件");
            return false;
        }
        const center = uploadTargetRef.current?.position || getCanvasCenter();
        const columns = Math.min(BATCH_UPLOAD_COLUMNS, supportedFiles.length);
        const originX = center.x - ((columns - 1) * BATCH_UPLOAD_COLUMN_GAP) / 2;
        const createdIds: string[] = [];
        for (let index = 0; index < supportedFiles.length; index += 1) {
            const file = supportedFiles[index];
            const position = {
                x: originX + (index % columns) * BATCH_UPLOAD_COLUMN_GAP,
                y: center.y + Math.floor(index / columns) * BATCH_UPLOAD_ROW_GAP,
            };
            const createdId = await (isAudioFile(file)
                ? createAudioFileNode(file, position)
                : file.type.startsWith("video/")
                  ? createVideoFileNode(file, position)
                  : createImageFileNode(file, position));
            if (createdId) createdIds.push(createdId);
        }
        if (!createdIds.length) return false;
        setSelectedNodeIds(new Set(createdIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        const failedCount = supportedFiles.length - createdIds.length;
        if (failedCount) message.warning(`已添加 ${createdIds.length} 个文件，${failedCount} 个上传失败`);
        else message.success(`已添加 ${createdIds.length} 个文件到画布`);
        return true;
    }, [createAudioFileNode, createImageFileNode, createVideoFileNode, getCanvasCenter, message, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds]);

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
                    created.push({
                        id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        kind: "audio",
                        title: file.name,
                        storageKey: audio.storageKey,
                        url: audio.url,
                        durationMs: audio.durationMs,
                        bytes: audio.bytes,
                        mimeType: audio.mimeType,
                    });
                } else {
                    const video = await uploadMediaFile(file, "video");
                    created.push({
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
                    });
                }
            } catch (error) {
                message.error(error instanceof Error ? `素材上传失败：${error.message}` : "素材上传失败");
            }
        }
        if (created.length) message.success(`已上传 ${created.length} 个素材到时间线`);
        return created;
    }, [message]);

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
            progress.done(persisted ? "已生成新视频片段并加入项目资产" : "已生成新视频片段，项目资产待重试");
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
        if (!currentNode) return false;
        if (isAudioFile(file)) {
            const progress = startUploadStatus("替换音频", "读取音频文件");
            try {
                progress.update("上传到服务器并同步资源", 2);
                const audio = await uploadMediaFile(file, "audio");
                progress.update("更新画布节点", 3);
                const node = { ...currentNode, type: CanvasNodeType.Audio, title: file.name, metadata: { ...currentNode.metadata, ...audioMetadata(audio), assetId: undefined, taskId: undefined, errorDetails: undefined } } satisfies CanvasNodeData;
                setNodes((current) => current.map((item) => item.id === nodeId ? node : item));
                selectInsertedNode(nodeId, "preserve");
                const persisted = await persistMediaNode(node);
                progress.done(persisted ? "音频已替换，可撤销恢复" : "音频已替换，项目资产待重试");
                return true;
            } catch (error) {
                const details = error instanceof Error ? error.message : "音频替换失败";
                progress.fail(details);
                message.error(details);
                return false;
            }
        }
        if (file.type.startsWith("video/")) {
            const progress = startUploadStatus("替换视频", "读取视频文件");
            try {
                progress.update("上传到服务器并同步资源", 2);
                const video = await uploadMediaFile(file, "video");
                progress.update("更新画布节点", 3);
                const node = { ...currentNode, type: CanvasNodeType.Video, title: file.name, metadata: { ...currentNode.metadata, ...videoMetadata(video), assetId: undefined, taskId: undefined, errorDetails: undefined } } satisfies CanvasNodeData;
                setNodes((current) => current.map((item) => item.id === nodeId ? node : item));
                selectInsertedNode(nodeId, "open");
                const persisted = await persistMediaNode(node);
                progress.done(persisted ? "视频已替换，可撤销恢复" : "视频已替换，项目资产待重试");
                return true;
            } catch (error) {
                const details = error instanceof Error ? error.message : "视频替换失败";
                progress.fail(details);
                message.error(details);
                return false;
            }
        }
        const progress = startUploadStatus("替换图片", "读取图片文件");
        try {
            progress.update("上传到服务器并同步资源", 2);
            const image = await uploadImage(file);
            progress.update("更新画布节点", 3);
            const node = {
                ...currentNode,
                type: CanvasNodeType.Image,
                title: file.name,
                metadata: {
                    ...currentNode.metadata,
                    ...imageMetadata(image),
                    assetId: undefined,
                    taskId: undefined,
                    errorDetails: undefined,
                    freeResize: false,
                    isBatchRoot: undefined,
                    batchRootId: undefined,
                    batchChildIds: undefined,
                    batchUsesReferenceImages: undefined,
                    generationType: undefined,
                    model: undefined,
                    size: undefined,
                    quality: undefined,
                    transparentBackground: undefined,
                    count: undefined,
                    references: undefined,
                    primaryImageId: undefined,
                    imageBatchExpanded: undefined,
                },
            } satisfies CanvasNodeData;
            setNodes((current) => current.map((item) => item.id === nodeId ? node : item));
            selectInsertedNode(nodeId, "open");
            const persisted = await persistMediaNode(node);
            progress.done(persisted ? "图片已替换，可撤销恢复" : "图片已替换，项目资产待重试");
            return true;
        } catch (error) {
            const details = error instanceof Error ? error.message : "图片替换失败";
            progress.fail(details);
            message.error(details);
            return false;
        }
    }, [message, nodesRef, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus]);

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
            const inserted = await createImageFileNode(file, position || getCanvasCenter());
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
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message, nodesRef, replaceNodeMedia, selectedNodeIdsRef]);

    const handleImageInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        const target = uploadTargetRef.current;
        try {
            if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !isAudioFile(file))) return;
            if (target?.nodeId) {
                const targetNode = nodesRef.current.find((node) => node.id === target.nodeId);
                const compatible = !targetNode
                    || (targetNode.type === CanvasNodeType.Image && file.type.startsWith("image/"))
                    || (targetNode.type === CanvasNodeType.Video && file.type.startsWith("video/"))
                    || (targetNode.type === CanvasNodeType.Audio && isAudioFile(file))
                    || ![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio].includes(targetNode.type);
                if (!compatible) {
                    message.warning("请选择与当前节点相同类型的媒体文件");
                    return;
                }
                await replaceNodeMedia(target.nodeId, file);
                return;
            }
            const position = target?.position || getCanvasCenter();
            await (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
        } finally {
            uploadTargetRef.current = null;
            event.target.value = "";
        }
    }, [createAudioFileNode, createImageFileNode, createVideoFileNode, getCanvasCenter, message, nodesRef, replaceNodeMedia]);

    const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
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
        const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/") || item.type.startsWith("video/") || isAudioFile(item));
        if (!file) return;
        const position = screenToCanvas(event.clientX, event.clientY);
        const target = [...nodesRef.current].reverse().find((node) => {
            const compatible = (node.type === CanvasNodeType.Image && file.type.startsWith("image/"))
                || (node.type === CanvasNodeType.Video && file.type.startsWith("video/"))
                || (node.type === CanvasNodeType.Audio && isAudioFile(file));
            return compatible && position.x >= node.position.x && position.x <= node.position.x + node.width && position.y >= node.position.y && position.y <= node.position.y + node.height;
        });
        if (target) {
            void replaceNodeMedia(target.id, file).then((replaced) => {
                if (replaced) message.success("媒体已替换，可撤销恢复");
            });
            return;
        }
        void (isAudioFile(file) ? createAudioFileNode(file, position) : file.type.startsWith("video/") ? createVideoFileNode(file, position) : createImageFileNode(file, position));
    }, [createAudioFileNode, createImageAssetNode, createImageFileNode, createVideoFileNode, handleProjectChapterInsert, message, nodesRef, replaceNodeMedia, screenToCanvas]);

    const handleFileDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDropActive(true);
    }, []);

    const handleFileDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event) && !Array.from(event.dataTransfer.types).includes(CANVAS_PROJECT_CHAPTER_DND_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const handleFileDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
        if (fileDragDepthRef.current === 0) setFileDropActive(false);
    }, []);

    const pasteAssistantImage = useCallback((file: File) => {
        void createImageFileNode(file, getCanvasCenter()).then((inserted) => {
            if (inserted) message.success("已从剪切板添加图片");
        });
    }, [createImageFileNode, getCanvasCenter, message]);

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
            const width = 320;
            const height = 260;
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
            return { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height, durationMs: payload.durationMs, bytes: payload.bytes, mimeType: payload.mimeType || "video/mp4", assetId: payload.assetId } } satisfies CanvasNodeData;
        }
        const storedImage = payload.storageKey ? { url: payload.dataUrl, storageKey: payload.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(payload.dataUrl);
        const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
        const size = fitNodeSize(meta.width, meta.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        return { id, type: CanvasNodeType.Image, title: payload.title.slice(0, 32) || "Generated Image", position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: payload.title, assetId: payload.assetId } } satisfies CanvasNodeData;
    }, []);

    const handleAssetInsert = useCallback(async (payload: InsertAssetPayload, options: { openDialog?: boolean } = {}): Promise<CanvasNodeData | null> => {
        const center = assetInsertPositionRef.current || getCanvasCenter();
        try {
            const node = await createAssetPayloadNode(payload, center);
            setNodes((current) => [...current, node]);
            selectInsertedNode(node.id, options.openDialog === false ? "preserve" : payload.kind === "image" || payload.kind === "video" ? "open" : "preserve");
            closeAssetPicker();
            return node;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "素材插入失败");
            return null;
        }
    }, [closeAssetPicker, createAssetPayloadNode, getCanvasCenter, message, selectInsertedNode, setNodes]);

    const handleProjectAssetsInsert = useCallback(async (payloads: InsertAssetPayload[], position?: Position): Promise<CanvasNodeData[]> => {
        const origin = position || getCanvasCenter();
        try {
            const created = await Promise.all(payloads.map((payload, index) => createAssetPayloadNode(payload, {
                x: origin.x + (index % 3) * 380,
                y: origin.y + Math.floor(index / 3) * 300,
            })));
            setNodes((current) => [...current, ...created]);
            setSelectedNodeIds(new Set(created.map((node) => node.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已引入 ${created.length} 项项目资产`);
            return created;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "项目资产引入失败");
            throw error;
        }
    }, [createAssetPayloadNode, getCanvasCenter, message, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds]);

    return {
        assetPickerOpen,
        closeAssetPicker,
        createVideoNodeFromBlob,
        createAssetPayloadNode,
        createImageAssetNode,
        fileDropActive,
        handleAssetInsert,
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
