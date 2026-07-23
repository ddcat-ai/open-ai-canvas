import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type SetStateAction } from "react";
import { App } from "antd";

import { CANVAS_IMAGE_ASSET_DND_TYPE } from "@/components/canvas/canvas-asset-tray";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { isAudioFile } from "@/lib/canvas/canvas-project-generation";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadMediaFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData, type ContextMenuState, type Position } from "@/types/canvas";
import type { CanvasUploadStatus } from "./canvas-project-feedback";

type UseCanvasUploadOptions = {
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

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const NODE_STATUS_SUCCESS = "success" as const;

export function useCanvasUpload({
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
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const assetInsertPositionRef = useRef<Position | null>(null);
    const uploadStatusIdRef = useRef(0);
    const statusTimersRef = useRef<Set<number>>(new Set());
    const fileDragDepthRef = useRef(0);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
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

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const progress = startUploadStatus("上传图片", "读取图片文件");
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
            progress.done("图片已添加到画布");
            return true;
        } catch (error) {
            const details = error instanceof Error ? error.message : "图片上传失败";
            progress.fail(details);
            message.error(details);
            return false;
        }
    }, [message, selectInsertedNode, setNodes, startUploadStatus]);

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
        const progress = startUploadStatus("上传视频", "读取视频文件");
        try {
            progress.update("上传到服务器并同步资源", 2);
            const video = await uploadMediaFile(file, "video");
            progress.update("更新画布节点", 3);
            const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setNodes((current) => [...current, { id, type: CanvasNodeType.Video, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, metadata: videoMetadata(video) }]);
            selectInsertedNode(id, "open");
            progress.done("视频已添加到画布");
        } catch (error) {
            const details = error instanceof Error ? error.message : "视频上传失败";
            progress.fail(details);
            message.error(details);
        }
    }, [message, selectInsertedNode, setNodes, startUploadStatus]);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const progress = startUploadStatus("上传音频", "读取音频文件");
        try {
            progress.update("上传到服务器并同步资源", 2);
            const audio = await uploadMediaFile(file, "audio");
            progress.update("更新画布节点", 3);
            const size = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
            const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setNodes((current) => [...current, { id, type: CanvasNodeType.Audio, title: file.name, position: { x: position.x - size.width / 2, y: position.y - size.height / 2 }, width: size.width, height: size.height, metadata: audioMetadata(audio) }]);
            selectInsertedNode(id, "preserve");
            progress.done("音频已添加到画布");
        } catch (error) {
            const details = error instanceof Error ? error.message : "音频上传失败";
            progress.fail(details);
            message.error(details);
        }
    }, [message, selectInsertedNode, setNodes, startUploadStatus]);

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

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
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

    const replaceNodeMedia = useCallback(async (nodeId: string, file: File) => {
        if (isAudioFile(file)) {
            const progress = startUploadStatus("替换音频", "读取音频文件");
            try {
                progress.update("上传到服务器并同步资源", 2);
                const audio = await uploadMediaFile(file, "audio");
                progress.update("更新画布节点", 3);
                setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, type: CanvasNodeType.Audio, title: file.name, metadata: { ...node.metadata, ...audioMetadata(audio), errorDetails: undefined } } : node));
                selectInsertedNode(nodeId, "preserve");
                progress.done("音频已替换，可撤销恢复");
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
                setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, type: CanvasNodeType.Video, title: file.name, metadata: { ...node.metadata, ...videoMetadata(video), errorDetails: undefined } } : node));
                selectInsertedNode(nodeId, "open");
                progress.done("视频已替换，可撤销恢复");
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
            setNodes((current) => current.map((node) => node.id === nodeId ? {
                ...node,
                type: CanvasNodeType.Image,
                title: file.name,
                metadata: {
                    ...node.metadata,
                    ...imageMetadata(image),
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
            } : node));
            selectInsertedNode(nodeId, "open");
            progress.done("图片已替换，可撤销恢复");
            return true;
        } catch (error) {
            const details = error instanceof Error ? error.message : "图片替换失败";
            progress.fail(details);
            message.error(details);
            return false;
        }
    }, [message, selectInsertedNode, setNodes, startUploadStatus]);

    const pasteSystemClipboard = useCallback(async (position?: Position) => {
        if (!navigator.clipboard) return;
        if (navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
            if (imageItem) {
                const imageType = imageItem.types.find((type) => type.startsWith("image/"));
                if (!imageType) return;
                const blob = await imageItem.getType(imageType);
                const file = new File([blob], "clipboard-image.png", { type: imageType });
                const selected = nodesRef.current.filter((node) => selectedNodeIdsRef.current.has(node.id));
                if (selected.length === 1 && selected[0].type === CanvasNodeType.Image) {
                    if (await replaceNodeMedia(selected[0].id, file)) message.success("已用剪切板图片替换，可撤销恢复");
                    return;
                }
                const inserted = await createImageFileNode(file, position || getCanvasCenter());
                if (inserted) message.success("已从剪切板添加图片");
                return;
            }
        }
        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text, position)) message.success("已从剪切板添加文本");
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
    }, [createAudioFileNode, createImageAssetNode, createImageFileNode, createVideoFileNode, message, nodesRef, replaceNodeMedia, screenToCanvas]);

    const handleFileDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        fileDragDepthRef.current += 1;
        setFileDropActive(true);
    }, []);

    const handleFileDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
        if (!hasDraggedFiles(event)) return;
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

    const handleAssetInsert = useCallback(async (payload: InsertAssetPayload) => {
        const center = assetInsertPositionRef.current || getCanvasCenter();
        if (payload.kind === "text") {
            const node = { ...createCanvasNode(CanvasNodeType.Text, center, { content: payload.content, status: NODE_STATUS_SUCCESS }), title: payload.content.slice(0, 32) || "Assistant Text" };
            setNodes((current) => [...current, node]);
            selectInsertedNode(node.id, "preserve");
        } else if (payload.kind === "video") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
            const size = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
            const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setNodes((current) => [...current, { id, type: CanvasNodeType.Video, title: payload.title, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height } }]);
            selectInsertedNode(id, "preserve");
        } else {
            try {
                const storedImage = payload.storageKey ? { url: payload.dataUrl, storageKey: payload.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(payload.dataUrl);
                const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
                const size = fitNodeSize(meta.width, meta.height);
                const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setNodes((current) => [...current, { id, type: CanvasNodeType.Image, title: payload.title.slice(0, 32) || "Generated Image", position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: payload.title } }]);
                selectInsertedNode(id, "open");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "素材图片插入失败");
                return;
            }
        }
        closeAssetPicker();
    }, [closeAssetPicker, getCanvasCenter, message, selectInsertedNode, setNodes]);

    return {
        assetPickerOpen,
        closeAssetPicker,
        createImageAssetNode,
        fileDropActive,
        handleAssetInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleUploadRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        startUploadStatus,
        uploadStatus,
    };
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
}
