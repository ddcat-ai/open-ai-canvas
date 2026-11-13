import { translate } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/components/canvas/canvas-asset-tray";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CANVAS_PROJECT_CHAPTER_DND_TYPE, type CanvasProjectChapterPayload } from "@/lib/canvas/canvas-project-chapter-dnd";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getActiveUserScope } from "@/lib/user-scope";
import { audioUploadTitleFromFileName } from "@/lib/audio-upload-title";
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
import { acquireCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { getProjectUnit } from "@/services/api/projects";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
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
    // Agent 输入框添加的附件：用调用方给的节点 ID（输入框立即就能引用它），不弹全局进度、不改选区；
    // 进度、失败原因和「仅本机」都写在节点上，由输入框的附件卡片展示。占位节点还没建出来就失败时
    // （例如图片读不出尺寸），节点上没处写原因，由 onError 交给输入框。
    quiet?: { nodeId: string; onError?: (details: string) => void };
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
    const lease = storageKey ? acquireCachedResourceObjectUrl(storageKey) : null;
    if (!lease) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), UPLOAD_WARM_TIMEOUT_MS);
    try {
        await prepareCanvasImage(lease.url, controller.signal);
    } catch {
        // 预热只是体验优化；节点仍会按正常资源加载路径显示。
    } finally {
        window.clearTimeout(timer);
        lease.release();
    }
}

export function useCanvasUpload({ canvasId, domainProjectId, nodesRef, selectedNodeIdsRef, getCanvasCenter, screenToCanvas, setNodes, setSelectedNodeIds, setSelectedConnectionId, setContextMenu, setDialogNodeId }: UseCanvasUploadOptions) {
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

    const uploadSessionRef = useRef({ active: true });
    useEffect(() => {
        const session = { active: true };
        uploadSessionRef.current = session;
        return () => {
            session.active = false;
            statusTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        };
    }, [canvasId]);

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
            done: (nextDetail = translate("canvasPage.upload.processDone")) => {
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, step: total, done: true } : current));
                dismiss(850);
            },
            fail: (nextDetail = translate("canvasPage.upload.processFailed")) => {
                setUploadStatus((current) => (current?.id === id ? { ...current, detail: nextDetail, error: true } : current));
                dismiss(1800);
            },
        };
    }, []);

    const selectInsertedNode = useCallback(
        (nodeId: string, dialog: "open" | "close" | "preserve") => {
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            if (dialog !== "preserve") setDialogNodeId(dialog === "open" ? nodeId : null);
        },
        [setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds],
    );

    const persistMediaNode = useCallback(
        async (node: CanvasNodeData, options: { refreshProject?: boolean } = {}) => {
            try {
                const result = await ensureCanvasNodeAsset({ canvasId, domainProjectId, node, source: "canvas-upload" });
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item)));
                if (domainProjectId && options.refreshProject !== false) await queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
                return { persisted: true, syncPending: result.syncPending };
            } catch (error) {
                message.warning(error instanceof Error ? translate("canvasPage.upload.mediaSyncFailedWithReason", { error: error.message }) : translate("canvasPage.upload.mediaSyncFailed"));
                return { persisted: false, syncPending: false };
            }
        },
        [canvasId, domainProjectId, message, queryClient, setNodes],
    );

    const activeUploadsRef = useRef(new Set<string>());
    const createFileNode = useCallback(
        async (file: File, position: Position, replaceId?: string, options: FileNodeUploadOptions = {}) => {
            const session = uploadSessionRef.current;
            const scope = getActiveUserScope();
            const isCurrent = () => session.active && scope === getActiveUserScope();
            const original = replaceId ? nodesRef.current.find((node) => node.id === replaceId) : undefined;
            if (replaceId && (!original || activeUploadsRef.current.has(replaceId))) return null;
            const id = replaceId || options.quiet?.nodeId || `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const batch = options.batch;
            const silent = Boolean(batch || options.quiet);
            activeUploadsRef.current.add(id);
            const progress = silent ? SILENT_UPLOAD_PROGRESS : startUploadStatus(replaceId ? translate("canvasPage.upload.replaceFile") : translate("canvasPage.upload.uploadFile"), translate("canvasPage.upload.readingFile"), domainProjectId ? 4 : 3);
            const fileType = uploadNodeType(file);
            // 占位节点首帧就显示本地文件，上传进度叠加在预览之上，不再是一块空白。
            if (fileType === CanvasNodeType.Image || fileType === CanvasNodeType.Video) registerUploadPreview(id, file);
            try {
                const placeholder = await createFileUploadPlaceholder(id, file, position);
                if (!isCurrent()) return null;
                setNodes((current) =>
                    replaceId
                        ? current.map((item) =>
                              item.id === id
                                  ? {
                                        ...item,
                                        width: placeholder.width,
                                        height: placeholder.height,
                                        metadata: { ...item.metadata, fileUpload: "uploading", fileUploadProgress: undefined, status: undefined, size: undefined, errorDetails: undefined },
                                    }
                                  : item,
                          )
                        : [...current, placeholder],
                );
                if (!silent) selectInsertedNode(id, "close");
                let lastPercent: number | undefined;
                let lastPaintAt = 0;
                const onProgress = (loaded: number, total: number) => {
                    if (!isCurrent()) return;
                    const percent = uploadPercent(loaded, total);
                    if (percent === undefined || percent === lastPercent) return;
                    const now = performance.now();
                    if (percent < 100 && now - lastPaintAt < UPLOAD_PROGRESS_PAINT_MS) return;
                    lastPercent = percent;
                    lastPaintAt = now;
                    setNodes((current) => current.map((item) => (item.id === id ? { ...item, metadata: { ...item.metadata, fileUploadProgress: percent } } : item)));
                    progress.update(percent === 100 ? translate("canvasPage.upload.transferred") : translate("canvasPage.upload.uploadedPercent", { percent }), 2);
                };
                progress.update(translate("canvasPage.upload.uploadingAndSyncing"), 2);
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
                if (!isCurrent()) return null;
                progress.update(translate("canvasPage.upload.updatingNode"), 3);
                const currentNode = nodesRef.current.find((item) => item.id === id);
                if (!currentNode) {
                    progress.done(translate("canvasPage.upload.placeholderRemoved"));
                    return null;
                }
                const originalFileName = original?.metadata?.originalFileName;
                const hasOriginalFileTitle = typeof originalFileName === "string" && originalFileName.length > 0 && (currentNode.title === originalFileName || currentNode.title === audioUploadTitleFromFileName(originalFileName));
                const useUploadedTitle = replaceId && currentNode.title === original?.title && (placeholder.type !== CanvasNodeType.Audio || hasOriginalFileTitle);
                const uploadedNode: CanvasNodeData = {
                    ...currentNode,
                    type: placeholder.type,
                    title: useUploadedTitle ? placeholder.title : currentNode.title,
                    metadata: {
                        ...currentNode.metadata,
                        ...metadata,
                        originalFileName: file.name,
                        fileUpload: undefined,
                        fileUploadProgress: undefined,
                        errorDetails: undefined,
                        producedModel: undefined,
                        producedModelCandidate: undefined,
                        ...(replaceId
                            ? {
                                  assetId: undefined,
                                  taskId: undefined,
                                  freeResize: false,
                                  isBatchRoot: undefined,
                                  batchRootId: undefined,
                                  batchChildIds: undefined,
                                  batchFailedCount: undefined,
                                  batchUsesReferenceImages: undefined,
                                  generationType: undefined,
                                  generationResultPlacement: undefined,
                                  copiedFromNodeId: undefined,
                                  versionOfNodeId: undefined,
                                  model: undefined,
                                  size: undefined,
                                  quality: undefined,
                                  transparentBackground: undefined,
                                  count: undefined,
                                  references: undefined,
                                  primaryImageId: undefined,
                                  imageBatchExpanded: undefined,
                                  richText: undefined,
                                  composerContent: undefined,
                              }
                            : {}),
                    },
                };
                // 替换文件保留旧媒体为历史版本，可在版本面板切回。
                const node = replaceId ? recordReplacedMediaVersion(original, uploadedNode, "upload") : uploadedNode;
                setNodes((current) => current.map((item) => (item.id === id ? { ...item, title: node.title, type: node.type, metadata: node.metadata } : item)));
                if (domainProjectId) progress.update(translate("canvasPage.upload.writingProjectAssets"), 4);
                const persisted = await persistMediaNode(node, { refreshProject: !batch });
                const localOnly = metadata.storageKey && !resourceIdFromStorageKey(metadata.storageKey);
                const pendingLabel = domainProjectId ? translate("canvasPage.upload.projectAssetsSyncing") : translate("canvasPage.upload.cloudAssetsSyncing");
                progress.done(
                    localOnly
                        ? translate("canvasPage.upload.savedLocalOnly")
                        : persisted.syncPending
                          ? translate("canvasPage.upload.addedSyncing", { status: pendingLabel })
                          : persisted.persisted
                            ? translate("canvasPage.upload.added")
                            : translate("canvasPage.upload.addedProjectRetry"),
                );
                if (localOnly) {
                    if (batch) batch.onLocalOnly();
                    else if (!options.quiet) message.warning(translate("canvasPage.upload.fileSavedLocalOnly"));
                }
                return id;
            } catch (error) {
                if (!isCurrent()) return null;
                const details = error instanceof Error ? error.message : translate("canvasPage.upload.uploadFailed");
                setNodes((current) =>
                    current.map((item) =>
                        item.id !== id
                            ? item
                            : original?.metadata?.content
                              ? {
                                    ...item,
                                    width: original.width,
                                    height: original.height,
                                    metadata: original.metadata,
                                }
                              : { ...item, metadata: { ...item.metadata, fileUpload: "error", fileUploadProgress: undefined, errorDetails: details } },
                    ),
                );
                progress.fail(details);
                // 批量上传的失败原因留在各自节点上，并由批量汇总提示数量，避免逐个弹错。
                if (!silent) message.error(details);
                options.quiet?.onError?.(details);
                return null;
            } finally {
                activeUploadsRef.current.delete(id);
                releaseUploadPreview(id);
            }
        },
        [domainProjectId, message, nodesRef, persistMediaNode, selectInsertedNode, setNodes, startUploadStatus],
    );

    // quiet：Agent 输入框拖入素材时不改选区；返回新节点 ID，失败返回 null。
    const createImageAssetNode = useCallback(
        async (asset: ImageAsset, position?: Position, options: { quiet?: boolean } = {}) => {
            const session = uploadSessionRef.current;
            const scope = getActiveUserScope();
            try {
                const content = asset.data.storageKey ? await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl) : asset.data.dataUrl || asset.coverUrl;
                if (!session.active || scope !== getActiveUserScope()) return null;
                if (!content) {
                    message.error(translate("canvasPage.upload.assetImageUnavailable"));
                    return null;
                }
                const size = fitImageNodeSize(asset.data.width || NODE_DEFAULT_SIZE[CanvasNodeType.Image].width, asset.data.height || NODE_DEFAULT_SIZE[CanvasNodeType.Image].height);
                const center = position || getCanvasCenter();
                const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const node: CanvasNodeData = {
                    id,
                    type: CanvasNodeType.Image,
                    title: asset.title || translate("canvasPage.upload.assetImage"),
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
                        originalFileName: typeof asset.metadata?.originalFileName === "string" ? asset.metadata.originalFileName : undefined,
                    },
                };
                setNodes((current) => [...current, node]);
                if (!options.quiet) selectInsertedNode(id, "close");
                return id;
            } catch (error) {
                message.error(error instanceof Error ? error.message : translate("canvasPage.upload.assetImageReadFailed"));
                return null;
            }
        },
        [getCanvasCenter, message, selectInsertedNode, setNodes],
    );

    const createTextNodeFromClipboard = useCallback(
        (text: string, position?: Position) => {
            const trimmed = text.trim();
            if (!trimmed) return false;
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || translate("canvasPage.upload.clipboardText"),
            };
            setNodes((current) => [...current, node]);
            selectInsertedNode(node.id, "open");
            setContextMenu(null);
            return true;
        },
        [getCanvasCenter, selectInsertedNode, setContextMenu, setNodes],
    );

    const handleProjectChapterInsert = useCallback(
        async (chapter: CanvasProjectChapterPayload, position?: Position) => {
            let sourceText = chapter.sourceText;
            if (sourceText === undefined) {
                try {
                    sourceText = (await getProjectUnit(chapter.projectId, chapter.id)).unit.sourceText;
                } catch (error) {
                    message.error(error instanceof Error ? translate("canvasPage.upload.chapterReadFailedWithReason", { error: error.message }) : translate("canvasPage.upload.chapterReadFailed"));
                    return;
                }
            }
            const content = htmlToPlainText(sourceText);
            const node = createCanvasNode(CanvasNodeType.Text, position || getCanvasCenter(), {
                content,
                prompt: content,
                status: NODE_STATUS_SUCCESS,
                workflowKind: "free",
                workflowTitle: translate("canvasPage.upload.projectChapter"),
                workflowDescription: translate("canvasPage.upload.chapterNumber", { index: chapter.position + 1 }),
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                fontSize: 14,
            });
            node.title = translate("canvasPage.upload.chapterTitle", { title: chapter.title });
            node.width = 460;
            node.height = 280;
            setNodes((current) => [...current, node]);
            selectInsertedNode(node.id, "preserve");
            setContextMenu(null);
            message.success(translate("canvasPage.upload.chapterAdded", { title: chapter.title }));
        },
        [getCanvasCenter, message, selectInsertedNode, setContextMenu, setNodes],
    );

    const handleUploadRequest = useCallback(
        (nodeId?: string, position?: Position) => {
            uploadTargetRef.current = { nodeId, position };
            if (!nodeId) {
                setUploadModalOpen(true);
                return;
            }
            const target = nodeId ? nodesRef.current.find((node) => node.id === nodeId) : null;
            if (imageInputRef.current) {
                imageInputRef.current.accept =
                    target?.type === CanvasNodeType.Image
                        ? "image/*"
                        : target?.type === CanvasNodeType.Video
                          ? "video/*"
                          : target?.type === CanvasNodeType.Audio
                            ? "audio/*,.mp3,.wav"
                            : target?.type === CanvasNodeType.Text
                              ? "text/plain,text/markdown,.txt,.md,.markdown"
                              : CANVAS_UPLOAD_ACCEPT;
            }
            imageInputRef.current?.click();
        },
        [nodesRef],
    );

    const closeUploadModal = useCallback(() => {
        uploadTargetRef.current = null;
        setUploadModalOpen(false);
    }, []);

    const handleUploadFiles = useCallback(
        async (files: File[]) => {
            const supportedFiles = files.filter((file) => uploadNodeType(file));
            if (!supportedFiles.length) {
                message.warning(translate("canvasPage.upload.selectSupportedFiles"));
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
            const progress = total > 1 ? startUploadStatus(translate("canvasPage.upload.uploadingFiles", { count: total }), translate("canvasPage.upload.completedCount", { done: 0, total }), total, 0) : null;
            const results: Array<string | null> = new Array(total).fill(null);
            let nextIndex = 0;
            let settled = 0;
            let localOnlyCount = 0;
            const batch = progress
                ? {
                      onLocalOnly: () => {
                          localOnlyCount += 1;
                      },
                  }
                : undefined;
            const worker = async () => {
                while (nextIndex < total) {
                    const index = nextIndex;
                    nextIndex += 1;
                    results[index] = await createFileNode(supportedFiles[index], positionAt(index), undefined, { batch });
                    settled += 1;
                    progress?.update(translate("canvasPage.upload.completedCount", { done: settled, total }), settled);
                }
            };
            await Promise.all(Array.from({ length: Math.min(BATCH_UPLOAD_CONCURRENCY, total) }, worker));
            const createdIds = results.filter((id): id is string => Boolean(id));
            if (batch && domainProjectId && createdIds.length) void queryClient.invalidateQueries({ queryKey: ["project", domainProjectId] });
            if (!createdIds.length) {
                progress?.fail(translate("canvasPage.upload.allFailed"));
                return false;
            }
            setSelectedNodeIds(new Set(createdIds));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            const failedCount = total - createdIds.length;
            progress?.done(failedCount ? translate("canvasPage.upload.addedPartial", { count: createdIds.length, failed: failedCount }) : translate("canvasPage.upload.addedFiles", { count: createdIds.length }));
            if (failedCount) message.warning(translate("canvasPage.upload.addedFilesPartial", { count: createdIds.length, failed: failedCount }));
            else if (localOnlyCount) message.warning(translate("canvasPage.upload.addedFilesLocal", { count: createdIds.length, local: localOnlyCount }));
            else message.success(translate("canvasPage.upload.addedFilesToCanvas", { count: createdIds.length }));
            return true;
        },
        [createFileNode, domainProjectId, getCanvasCenter, message, queryClient, setDialogNodeId, setSelectedConnectionId, setSelectedNodeIds, startUploadStatus],
    );

    const replaceNodeMedia = useCallback(
        async (nodeId: string, file: File) => {
            const currentNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!currentNode || !uploadNodeType(file)) return false;
            const typedNode = [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(currentNode.type as CanvasNodeType);
            if (typedNode && uploadNodeType(file) !== currentNode.type) return false;
            return Boolean(await createFileNode(file, currentNode.position, nodeId));
        },
        [createFileNode, nodesRef],
    );

    const pasteSystemClipboard = useCallback(
        async (position?: Position, clipboardEvent?: ClipboardEvent | null) => {
            const isNodeMarker = (value: string) => {
                const trimmed = value.trim();
                return trimmed.startsWith("open-ai-canvas-nodes:") || trimmed.startsWith("open-ai-canvas-nodes-json:");
            };
            const pasteImageFile = async (file: File) => {
                const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
                if (selected.length === 1 && selected[0].type === CanvasNodeType.Image) {
                    if (await replaceNodeMedia(selected[0].id, file)) message.success(translate("canvasPage.upload.replacedFromClipboard"));
                    return true;
                }
                const inserted = await createFileNode(file, position || getCanvasCenter());
                if (inserted) message.success(translate("canvasPage.upload.imageFromClipboard"));
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
                    message.success(translate("canvasPage.upload.textFromClipboard"));
                    return true;
                }
            } catch {
                // ignore
            }
            return false;
        },
        [createFileNode, createTextNodeFromClipboard, getCanvasCenter, message, nodesRef, replaceNodeMedia, selectedNodeIdsRef],
    );

    const handleImageInputChange = useCallback(
        async (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            const target = uploadTargetRef.current;
            try {
                if (!file || !uploadNodeType(file)) return;
                if (target?.nodeId) {
                    const targetNode = nodesRef.current.find((node) => node.id === target.nodeId);
                    const compatible = targetNode && (targetNode.type === uploadNodeType(file) || ![CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(targetNode.type as CanvasNodeType));
                    if (!compatible) {
                        message.warning(translate("canvasPage.upload.sameTypeRequired"));
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
        },
        [createFileNode, getCanvasCenter, message, nodesRef, replaceNodeMedia],
    );

    const handleDrop = useCallback(
        (event: DragEvent<HTMLDivElement>) => {
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
                    message.warning(translate("canvasPage.upload.assetMissing"));
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
                    if (replaced) message.success(translate("canvasPage.upload.mediaReplaced"));
                });
                return;
            }
            void createFileNode(file, position);
        },
        [createFileNode, createImageAssetNode, handleProjectChapterInsert, handleUploadFiles, message, nodesRef, replaceNodeMedia, screenToCanvas],
    );

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

    const pasteAssistantImage = useCallback(
        (file: File) => {
            void createFileNode(file, getCanvasCenter()).then((inserted) => {
                if (inserted) message.success(translate("canvasPage.upload.imageFromClipboard"));
            });
        },
        [createFileNode, getCanvasCenter, message],
    );

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
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: payload.content, status: NODE_STATUS_SUCCESS, assetId: payload.assetId, originalFileName: payload.originalFileName }),
                title: payload.title || payload.content.slice(0, 32) || "Assistant Text",
            };
            return node;
        }
        if (payload.kind === "audio") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
            const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            return {
                id,
                type: CanvasNodeType.Audio,
                title: payload.title,
                position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: {
                    content: payload.url,
                    storageKey: payload.storageKey,
                    originalFileName: payload.originalFileName,
                    durationMs: payload.durationMs,
                    bytes: payload.bytes,
                    mimeType: payload.mimeType || "audio/mpeg",
                    assetId: payload.assetId,
                    status: NODE_STATUS_SUCCESS,
                },
            } satisfies CanvasNodeData;
        }
        if (payload.kind === "video") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const size = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            return {
                id,
                type: CanvasNodeType.Video,
                title: payload.title,
                position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: {
                    content: payload.url,
                    storageKey: payload.storageKey,
                    originalFileName: payload.originalFileName,
                    status: NODE_STATUS_SUCCESS,
                    naturalWidth: payload.width,
                    naturalHeight: payload.height,
                    durationMs: payload.durationMs,
                    hasAudio: payload.hasAudio,
                    bytes: payload.bytes,
                    mimeType: payload.mimeType || "video/mp4",
                    assetId: payload.assetId,
                },
            } satisfies CanvasNodeData;
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
        return {
            id,
            type: CanvasNodeType.Image,
            title: payload.title || "Generated Image",
            position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: { ...metadata, prompt: payload.title, assetId: payload.assetId, originalFileName: payload.originalFileName },
        } satisfies CanvasNodeData;
    }, []);

    const insertAssetPayloads = useCallback(
        async (payloads: InsertAssetPayload[], origin: Position, successMessage: string, failureMessage: string): Promise<CanvasNodeData[]> => {
            const session = uploadSessionRef.current;
            const scope = getActiveUserScope();
            try {
                const created = await Promise.all(
                    payloads.map((payload, index) =>
                        createAssetPayloadNode(payload, {
                            x: origin.x + (index % BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_COLUMN_GAP,
                            y: origin.y + Math.floor(index / BATCH_UPLOAD_COLUMNS) * BATCH_UPLOAD_ROW_GAP,
                        }),
                    ),
                );
                if (!session.active || scope !== getActiveUserScope()) return [];
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
        },
        [createAssetPayloadNode, message, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const handleAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[], position?: Position): Promise<CanvasNodeData[]> => {
            const origin = position || assetInsertPositionRef.current || getCanvasCenter();
            return insertAssetPayloads(payloads, origin, translate("canvasPage.upload.assetsInserted", { count: payloads.length }), translate("canvasPage.upload.assetsInsertFailed"));
        },
        [getCanvasCenter, insertAssetPayloads],
    );

    const handleProjectAssetsInsert = useCallback(
        async (payloads: InsertAssetPayload[], position?: Position): Promise<CanvasNodeData[]> => {
            const origin = position || getCanvasCenter();
            return insertAssetPayloads(payloads, origin, translate("canvasPage.upload.projectAssetsInserted", { count: payloads.length }), translate("canvasPage.upload.projectAssetsInsertFailed"));
        },
        [getCanvasCenter, insertAssetPayloads],
    );

    return {
        assetPickerOpen,
        closeAssetPicker,
        createFileNode,
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
        return typeof payload.id === "string" && typeof payload.projectId === "string" && typeof payload.title === "string" && validSource && typeof payload.position === "number" ? (payload as CanvasProjectChapterPayload) : null;
    } catch {
        return null;
    }
}

function htmlToPlainText(value: string) {
    if (!value) return "";
    const document = new DOMParser().parseFromString(value, "text/html");
    return document.body.textContent?.trim() || "";
}
