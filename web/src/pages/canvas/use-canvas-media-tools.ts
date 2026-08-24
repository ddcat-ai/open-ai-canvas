import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import type { CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import type { CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import type { CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import type { CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { CanvasImageEmotionPayload } from "@/components/canvas/canvas-node-emotion-panel";
import type { CanvasVideoSegmentParams } from "@/components/canvas/canvas-video-segment-dialog";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { buildAngleLabel, buildAnglePrompt, createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { validateVideoSegmentBatch } from "@/lib/canvas/canvas-video-regeneration";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import { buildGenerationConfig, buildImageGenerationMetadata, nodeReferenceImage, isGenerationCanceled, runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { fitNodeSize, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { compositeEmotionImage, emotionGenerationSize, emotionProviderMask, normalizeEmotionPromptForProvider, resolveEmotionEditPlan } from "@/lib/canvas/canvas-emotion";
import { DEFAULT_PORTRAIT_TEXTURE_SETTINGS, buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import { captureVideoLastFrame } from "@/lib/canvas/canvas-video-frame";
import { mergeVideos, type MergeVideoProgress } from "@/lib/canvas/canvas-video-merge";
import { extractVideoAudio, trimVideoSegment } from "@/lib/canvas/canvas-video-segment";
import { generationErrorMessage } from "@/lib/generation-error";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { navigateToSettings } from "@/lib/settings-navigation";
import { storeGeneratedVideo } from "@/services/api/video";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { ensureCanvasNodeAsset } from "@/services/project-asset-sync";
import type { GenerationTask } from "@/services/api/task-center";
import { defaultConfig, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ContextMenuState } from "@/types/canvas";
import type { StartCanvasUploadStatus } from "./use-canvas-upload";
import { IMAGE_PROMPT_REVERSE_PRESET, annotateNodeTitle, audioNodeTitle, extractedAudioPrompt, lastFrameNodeTitle, maskEditPrompt, regenerateNodeTitle, referencePromptComposerContent, segmentNodeTitle, segmentPrompt } from "./canvas-prompts";
import { useTranslation } from "react-i18next";

type UseCanvasMediaToolsOptions = {
    projectId: string;
    domainProjectId?: string;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    selectedNodeIdsRef: { current: Set<string> };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setHoveredNodeId: Dispatch<SetStateAction<string | null>>;
    setToolbarNodeId: Dispatch<SetStateAction<string | null>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startUploadStatus: StartCanvasUploadStatus;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
    /** 创建空视频节点后触发既有生成执行器（由页面层接线），用于“截取片段后调用视频模型重生成” */
    onGenerateVideoNode?: (nodeId: string, mode: "video", prompt: string) => Promise<void> | void;
};

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
export function useCanvasMediaTools({
    projectId,
    domainProjectId,
    nodesRef,
    connectionsRef,
    selectedNodeIdsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setContextMenu,
    setHoveredNodeId,
    setToolbarNodeId,
    setRunningNodeId,
    startUploadStatus,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    onGenerateVideoNode,
}: UseCanvasMediaToolsOptions) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const extractingVideoFrameNodeIdRef = useRef<string | null>(null);
    const mergeVideoRunningRef = useRef(false);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [annotationNodeId, setAnnotationNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [emotionNodeId, setEmotionNodeId] = useState<string | null>(null);
    const [extractingVideoFrameNodeId, setExtractingVideoFrameNodeId] = useState<string | null>(null);
    const [mergeVideoProgress, setMergeVideoProgress] = useState<MergeVideoProgress | null>(null);
    const [segmentDialogNodeId, setSegmentDialogNodeId] = useState<string | null>(null);
    const [segmentDialogMode, setSegmentDialogMode] = useState<"audio" | "video" | null>(null);
    const [segmentRunningMode, setSegmentRunningMode] = useState<"audio" | "video" | null>(null);
    const segmentRunningRef = useRef(false);

    const resolveImageEditStyle = useCallback(
        (node: CanvasNodeData, prompt: string, config: AiConfig) => {
            try {
                const runtime = resolveCanvasStyleExecution(nodesRef.current, node, prompt, config, "image");
                return {
                    prompt: runtime?.prompt || prompt,
                    metadata: runtime ? { styleProfileJson: runtime.profileJson, styleExecutionPlan: runtime.plan } : {},
                };
            } catch (error) {
                message.error(generationErrorMessage(error));
                return null;
            }
        },
        [message, nodesRef],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas:image-node-is-empty-cannot-reverse-engineer-prompt"));
                return;
            }
            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const resultSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: t("canvas:reverse-prompt"),
            };
            const resultNode = {
                ...createCanvasNode(
                    CanvasNodeType.Text,
                    { x: textNode.position.x + textNode.width + gap + resultSpec.width / 2, y: centerY },
                    {
                        content: "",
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: referencePromptComposerContent(node.id, textNode.id),
                    },
                ),
                title: t("canvas:reverse-prompt-result"),
            };
            setNodes((current) => [...current, textNode, resultNode]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: resultNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: resultNode.id }]);
            setSelectedNodeIds(new Set([resultNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(resultNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, setConnections, setContextMenu, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const generatePortraitTextureNode = useCallback(
        async (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas:image-node-is-empty-cannot-adjust-skin-texture"));
                return;
            }
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }
            const childId = nanoid();
            const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const composerContent = `@[node:${node.id}]`;
            const source = nodeReferenceImage(node);
            if (!source) return;
            const prompt = buildPortraitTexturePrompt(composerContent, { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, ...node.metadata?.portraitTexture });
            const styleExecution = resolveImageEditStyle(node, prompt, generationConfig);
            if (!styleExecution) return;
            const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            const portraitTextureSettings = { ...DEFAULT_PORTRAIT_TEXTURE_SETTINGS, ...node.metadata?.portraitTexture };
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setRunningNodeId(childId);
            setNodes((current) => [
                ...current,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: t("canvas:skin-texture-adjustment"),
                    position: { x: node.position.x + node.width + 96 + imageSpec.width / 2, y: node.position.y + node.height / 2 },
                    width: imageSpec.width,
                    height: imageSpec.height,
                    metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, composerContent, portraitTexture: portraitTextureSettings, ...generationMetadata, ...styleMetadata },
                },
            ]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const result = await runBackendCanvasGenerationTask({
                    projectId,
                    nodeId: childId,
                    mode: "image",
                    prompt: effectivePrompt,
                    config: generationConfig,
                    referenceImages: [source],
                    signal: controller.signal,
                    metadata: { sourceNodeId: node.id, edit: "portraitTexture", portraitTexture: portraitTextureSettings, ...styleMetadata },
                    onTaskCreated: (task) => bindGenerationTask(childId, task),
                });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error(t("canvas:backend-task-returned-no-images-4"));
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                setNodes((current) =>
                    current.map((item) =>
                        item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt: effectivePrompt, ...generationMetadata, portraitTexture: portraitTextureSettings } } : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const details = generationErrorMessage(error);
                message.error(details);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [
            bindGenerationTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            projectId,
            resolveImageEditStyle,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );

    const cropImageNode = useCallback(
        async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
            if (!node.metadata?.content) return;
            const cropped = await cropDataUrl(node.metadata.content, crop);
            const image = await uploadImage(cropped);
            const size = fitNodeSize(image.width, image.height, node.width, node.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: "Cropped Image",
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
            };
            setNodes((current) => [...current, child]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            setCropNodeId(null);
        },
        [setConnections, setDialogNodeId, setNodes, setSelectedNodeIds],
    );

    const saveAnnotatedImageNode = useCallback(
        async (node: CanvasNodeData, dataUrl: string) => {
            const image = await uploadImage(dataUrl);
            const size = fitNodeSize(image.width, image.height, node.width, node.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: annotateNodeTitle(node.title || t("canvas:images")),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
            };
            setNodes((current) => [...current, child]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            setAnnotationNodeId(null);
            message.success(t("canvas:annotated-image-saved-as-a-new-node"));
        },
        [message, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const extractVideoLastFrame = useCallback(
        async (node: CanvasNodeData) => {
            const content = node.metadata?.content;
            if (!content || extractingVideoFrameNodeIdRef.current) return;
            const progress = startUploadStatus(t("canvas:grab-last-video-frame"), t("canvas:reading-video-resource"));
            extractingVideoFrameNodeIdRef.current = node.id;
            setExtractingVideoFrameNodeId(node.id);
            try {
                const storedBlob = node.metadata?.storageKey ? await getMediaBlob(node.metadata.storageKey).catch(() => null) : null;
                progress.update(t("canvas:locating-and-drawing-the-last-frame"), 2);
                const frameBlob = await captureVideoLastFrame(storedBlob || content);
                progress.update(t("canvas:saving-last-frame-and-creating-node"), 3);
                const image = await uploadImage(frameBlob);
                const size = fitNodeSize(image.width, image.height, node.width, node.height);
                const childId = nanoid();
                const child: CanvasNodeData = {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: lastFrameNodeTitle(node.title || t("canvas:videos")),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: size.width,
                    height: size.height,
                    metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt, workflowKind: node.metadata?.workflowKind, workflowTitle: node.metadata?.workflowTitle, shotIndex: node.metadata?.shotIndex },
                };
                setNodes((current) => [...current, child]);
                setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
                setSelectedNodeIds(new Set([childId]));
                setSelectedConnectionId(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                progress.done(t("canvas:last-frame-image-created"));
            } catch (error) {
                const details = error instanceof Error ? error.message : t("canvas:failed-to-grab-last-frame");
                progress.fail(details);
                message.error(details);
            } finally {
                extractingVideoFrameNodeIdRef.current = null;
                setExtractingVideoFrameNodeId(null);
            }
        },
        [message, setConnections, setHoveredNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setToolbarNodeId, startUploadStatus],
    );

    const extractAudioFromVideo = useCallback(
        (node: CanvasNodeData) => {
            if (!node.metadata?.content) {
                message.warning(t("canvas:video-node-is-empty-cannot-extract-audio"));
                return;
            }
            if (segmentRunningRef.current) return;
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setSegmentDialogNodeId(node.id);
            setSegmentDialogMode("audio");
        },
        [message, setHoveredNodeId, setToolbarNodeId],
    );

    const trimVideoAndRegenerate = useCallback(
        (node: CanvasNodeData) => {
            if (!node.metadata?.content) {
                message.warning(t("canvas:video-node-is-empty-cannot-trim-segments"));
                return;
            }
            if (segmentRunningRef.current) return;
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setSegmentDialogNodeId(node.id);
            setSegmentDialogMode("video");
        },
        [message, setHoveredNodeId, setToolbarNodeId],
    );

    const closeSegmentDialog = useCallback(() => {
        if (segmentRunningRef.current) return;
        setSegmentDialogNodeId(null);
        setSegmentDialogMode(null);
    }, []);

    // 从视频片段提取声音：FFmpeg 提取 MP3 → 上传为音频资源 → 创建音频节点 → 写入素材库/项目资产。
    const runExtractVideoAudio = useCallback(
        async (node: CanvasNodeData, params: CanvasVideoSegmentParams) => {
            const progress = startUploadStatus(t("canvas:extract-audio"), t("canvas:loading-ffmpeg"), 4);
            try {
                const mp3 = await extractVideoAudio({ url: node.metadata?.content, storageKey: node.metadata?.storageKey }, { startMs: params.startMs, endMs: params.endMs }, node.metadata?.durationMs, (status) => {
                    progress.update(status.phase === "loading" ? t("canvas:loading-ffmpeg") : status.phase === "reading" ? t("canvas:reading-video-resource") : t("canvas:extracting-audio"), status.phase === "encoding" ? 3 : 2);
                });
                progress.update(t("canvas:uploading-audio-to-server"), 4);
                const uploaded = await uploadMediaFile(mp3, "audio");
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const audioNode = createCanvasNode(
                    CanvasNodeType.Audio,
                    { x: node.position.x + node.width + 96 + spec.width / 2, y: node.position.y + node.height / 2 },
                    { ...audioMetadata(uploaded), prompt: extractedAudioPrompt(node.title || t("canvas:videos")), status: NODE_STATUS_SUCCESS },
                );
                audioNode.title = audioNodeTitle(node.title || t("canvas:videos"));
                const audioNodeId = audioNode.id;
                setNodes((current) => [...current, audioNode]);
                setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: audioNodeId }]);
                setSelectedNodeIds(new Set([audioNodeId]));
                setSelectedConnectionId(null);
                try {
                    const result = await ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: audioNode, source: "canvas-manual" });
                    setNodes((current) => current.map((item) => (item.id === audioNodeId ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item)));
                    progress.done(result.linkedToProject ? t("canvas:audio-extracted-and-added-to-library-and-project-assets") : t("canvas:audio-extracted-and-added-to-library"));
                } catch (assetError) {
                    progress.done(t("canvas:audio-extracted-node-library-write-failed", { message: assetError instanceof Error ? assetError.message : t("canvas:unknown-error") }));
                }
            } catch (error) {
                const details = error instanceof Error ? error.message : t("canvas:audio-extraction-failed");
                progress.fail(details);
                message.error(details);
            }
        },
        [domainProjectId, message, projectId, setConnections, setSelectedConnectionId, setSelectedNodeIds, setNodes, startUploadStatus],
    );

    // 按段截取视频：FFmpeg 批量截取 → 每段创建片段节点与空结果节点 → 调用视频模型逐段重生成。
    const runTrimVideoAndRegenerate = useCallback(
        async (node: CanvasNodeData, params: CanvasVideoSegmentParams) => {
            const segments = params.segments || [];
            if (!segments.length) {
                message.warning(t("canvas:add-at-least-one-segment-to-trim"));
                return;
            }
            const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
            const selectedConfig = { ...generationConfig, model: params.model || generationConfig.model };
            const batchError = validateVideoSegmentBatch(selectedConfig, segments, params.operation);
            if (batchError) {
                message.warning(batchError);
                return;
            }
            const progress = startUploadStatus(t("canvas:trim-video-segments"), t("canvas:loading-ffmpeg"), segments.length * 4);
            try {
                const prepared: Array<{ segmentNode: CanvasNodeData; targetNode: CanvasNodeData }> = [];
                const failedSegments: string[] = [];
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const baseX = node.position.x + node.width + 96;
                const baseY = node.position.y;
                const effectivePrompt = (params.prompt || t("canvas:keep-the-subject-and-camera-regenerate-this-video-segment")).trim();
                for (let index = 0; index < segments.length; index += 1) {
                    const segment = segments[index];
                    try {
                        const sourceNode = segment.sourceNodeId ? nodesRef.current.find((item) => item.id === segment.sourceNodeId) : undefined;
                        const trimSource = sourceNode
                            ? { url: sourceNode.metadata?.content, storageKey: sourceNode.metadata?.storageKey }
                            : segment.sourceStorageKey || segment.sourceUrl
                              ? { url: segment.sourceUrl, storageKey: segment.sourceStorageKey }
                              : { url: node.metadata?.content, storageKey: node.metadata?.storageKey };
                        const trimDurationMs = sourceNode?.metadata?.durationMs || node.metadata?.durationMs;
                        progress.update(t("canvas:loading-ffmpeg-progress", { index: index + 1, total: segments.length }), index * 4 + 1);
                        const mp4 = await trimVideoSegment(trimSource, { startMs: segment.startMs, endMs: segment.endMs }, trimDurationMs, (status) => {
                            progress.update(
                                status.phase === "loading"
                                    ? t("canvas:loading-ffmpeg-progress", { index: index + 1, total: segments.length })
                                    : status.phase === "reading"
                                      ? t("canvas:reading-video-progress", { index: index + 1, total: segments.length })
                                      : t("canvas:trimming-progress", { index: index + 1, total: segments.length }),
                                status.phase === "encoding" ? index * 4 + 3 : index * 4 + 2,
                            );
                        });
                        progress.update(t("canvas:uploading-segment-progress", { index: index + 1, total: segments.length }), index * 4 + 3);
                        const uploaded = await uploadMediaFile(mp4, "video");
                        const size = fitNodeSize(uploaded.width || 1280, uploaded.height || 720, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
                        const segmentId = nanoid();
                        const segmentNode: CanvasNodeData = {
                            id: segmentId,
                            type: CanvasNodeType.Video,
                            title: segmentNodeTitle(index + 1, sourceNode?.title || node.title || t("canvas:videos")),
                            position: { x: baseX, y: baseY + index * (Math.max(size.height, spec.height) + 24) },
                            width: size.width,
                            height: size.height,
                            metadata: { ...videoMetadata(uploaded), prompt: segmentPrompt(index + 1, sourceNode?.title || node.title || t("canvas:videos")), status: NODE_STATUS_SUCCESS },
                        };
                        const targetId = nanoid();
                        const targetNode: CanvasNodeData = {
                            id: targetId,
                            type: CanvasNodeType.Video,
                            title: regenerateNodeTitle(index + 1, sourceNode?.title || node.title || t("canvas:videos")),
                            position: { x: segmentNode.position.x + size.width + 96, y: segmentNode.position.y + (size.height - spec.height) / 2 },
                            width: spec.width,
                            height: spec.height,
                            metadata: { prompt: effectivePrompt, status: "idle", generationMode: "video", model: selectedConfig.model, videoEditOperation: params.operation, seconds: generationConfig.videoSeconds, size: generationConfig.size },
                        };
                        prepared.push({ segmentNode, targetNode });
                    } catch (segmentError) {
                        failedSegments.push(segmentError instanceof Error ? segmentError.message : t("canvas:video-trimming-failed"));
                    }
                }
                if (!prepared.length) throw new Error(failedSegments[0] || t("canvas:video-trimming-failed"));
                const segmentNodes = prepared.map((item) => item.segmentNode);
                const targetNodes = prepared.map((item) => item.targetNode);
                // 先同步 ref 再 setState，保证生成执行器能立即读到新节点与连接。
                const nextNodes = [...nodesRef.current, ...segmentNodes, ...targetNodes];
                const nextConnections = [
                    ...connectionsRef.current,
                    ...prepared.flatMap((item) => [
                        { id: nanoid(), fromNodeId: node.id, toNodeId: item.segmentNode.id },
                        { id: nanoid(), fromNodeId: item.segmentNode.id, toNodeId: item.targetNode.id },
                    ]),
                ];
                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                setSelectedNodeIds(new Set(targetNodes.map((item) => item.id)));
                setSelectedConnectionId(null);
                progress.update(t("canvas:create-generation-tasks"), segments.length * 4);
                progress.done(t("canvas:trimmed-param-param-segments-calling-the-video-model-to-regenerate", { length: prepared.length, length_1: segments.length }));
                segmentNodes.forEach((segmentNode) => {
                    void ensureCanvasNodeAsset({ canvasId: projectId, domainProjectId, node: segmentNode, source: "canvas-manual" })
                        .then((result) => setNodes((current) => current.map((item) => (item.id === segmentNode.id ? { ...item, metadata: { ...item.metadata, assetId: result.assetId } } : item))))
                        .catch((assetError) => message.warning(t("canvas:segment-regenerated-library-write-failed", { message: assetError instanceof Error ? assetError.message : t("canvas:unknown-error") })));
                });
                // 任务提交瞬时打满后端会触发限流；先错峰提交，后续可替换为批次调度的容量控制。
                for (let index = 0; index < targetNodes.length; index += 1) {
                    const targetNode = targetNodes[index];
                    void onGenerateVideoNode?.(targetNode.id, "video", effectivePrompt);
                    if (index + 1 < targetNodes.length) await new Promise((resolve) => setTimeout(resolve, 300));
                }
                if (failedSegments.length) message.warning(t("canvas:param-segments-failed-generation-tasks-created-for-the-other-param", { length: failedSegments.length, length_1: prepared.length }));
            } catch (error) {
                const details = error instanceof Error ? error.message : t("canvas:video-trimming-failed");
                progress.fail(details);
                message.error(details);
            }
        },
        [connectionsRef, domainProjectId, effectiveConfig, message, nodesRef, onGenerateVideoNode, projectId, setConnections, setSelectedConnectionId, setSelectedNodeIds, setNodes, startUploadStatus],
    );

    const handleSegmentConfirm = useCallback(
        async (node: CanvasNodeData, params: CanvasVideoSegmentParams) => {
            if (segmentRunningRef.current || !node.metadata?.content) return;
            if (params.mode === "video") {
                const generationConfig = buildGenerationConfig(effectiveConfig, node, "video");
                const selectedConfig = { ...generationConfig, model: params.model || generationConfig.model };
                const batchError = validateVideoSegmentBatch(selectedConfig, params.segments || [], params.operation);
                if (batchError) {
                    message.warning(batchError);
                    return;
                }
            }
            segmentRunningRef.current = true;
            setSegmentRunningMode(params.mode);
            setSegmentDialogNodeId(null);
            setSegmentDialogMode(null);
            try {
                if (params.mode === "video") await runTrimVideoAndRegenerate(node, params);
                else await runExtractVideoAudio(node, params);
            } finally {
                segmentRunningRef.current = false;
                setSegmentRunningMode(null);
            }
        },
        [effectiveConfig, message, runExtractVideoAudio, runTrimVideoAndRegenerate],
    );

    const mergeVideosByIds = useCallback(
        async (videoNodeIds: string[]) => {
            if (mergeVideoRunningRef.current) return;
            const requestedIds = new Set(videoNodeIds);
            const videos = nodesRef.current
                .filter((node) => requestedIds.has(node.id) && node.type === CanvasNodeType.Video && Boolean(node.metadata?.content))
                .sort((left, right) => {
                    const leftShot = left.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
                    const rightShot = right.metadata?.shotIndex ?? Number.MAX_SAFE_INTEGER;
                    return leftShot - rightShot || left.position.y - right.position.y || left.position.x - right.position.x;
                });
            if (videos.length < 2) {
                message.warning(t("canvas:select-at-least-two-existing-videos"));
                return;
            }
            mergeVideoRunningRef.current = true;
            setMergeVideoProgress({ phase: "reading", progress: 0 });
            try {
                const blob = await mergeVideos(
                    videos.map((node) => ({ id: node.id, url: node.metadata?.content, storageKey: node.metadata?.storageKey })),
                    setMergeVideoProgress,
                );
                setMergeVideoProgress({ phase: "encoding", progress: 98 });
                const uploaded = await storeGeneratedVideo({ blob });
                const size = fitNodeSize(uploaded.width || 1280, uploaded.height || 720, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
                const left = Math.max(...videos.map((node) => node.position.x + node.width)) + 120;
                const top = Math.min(...videos.map((node) => node.position.y));
                const mergedNode = createCanvasNode(
                    CanvasNodeType.Video,
                    { x: left + size.width / 2, y: top + size.height / 2 },
                    {
                        ...videoMetadata(uploaded),
                        prompt: t("canvas:merge-param-videos-in-selection-order", { length: videos.length }),
                        workflowKind: "final",
                        workflowTitle: t("canvas:merge-videos-2"),
                        videoEditOperation: "concat",
                        status: NODE_STATUS_SUCCESS,
                    },
                );
                mergedNode.title = t("canvas:merged-video-param-segments", { length: videos.length });
                mergedNode.width = size.width;
                mergedNode.height = size.height;
                mergedNode.position = { x: left, y: top };
                const links = videos.map((node) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: mergedNode.id }));
                const nextNodes = [...nodesRef.current, mergedNode];
                const nextConnections = [...connectionsRef.current, ...links];
                nodesRef.current = nextNodes;
                connectionsRef.current = nextConnections;
                setNodes(nextNodes);
                setConnections(nextConnections);
                const selection = new Set([mergedNode.id]);
                selectedNodeIdsRef.current = selection;
                setSelectedNodeIds(selection);
                setSelectedConnectionId(null);
                setDialogNodeId(null);
                setMergeVideoProgress({ phase: "encoding", progress: 100 });
                message.success(t("canvas:merged-param-videos-merged-video-node-added", { length: videos.length }));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas:video-merge-failed"));
            } finally {
                mergeVideoRunningRef.current = false;
                window.setTimeout(() => setMergeVideoProgress(null), 700);
            }
        },
        [connectionsRef, message, nodesRef, selectedNodeIdsRef, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const mergeSelectedVideos = useCallback(() => mergeVideosByIds(Array.from(selectedNodeIdsRef.current)), [mergeVideosByIds, selectedNodeIdsRef]);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    return {
                        id: nanoid(),
                        type: CanvasNodeType.Image,
                        title: `${node.title || t("canvas:images")} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: node.position.y + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((current) => [...current, ...childNodes]);
            setConnections((current) => [...current, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(t("canvas:split-into-param-child-nodes", { length: childNodes.length }));
        },
        [message, setConnections, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = maskEditPrompt(userPrompt);
            const childId = nanoid();
            const source = nodeReferenceImage(node);
            if (!source) return;
            const styleExecution = resolveImageEditStyle(node, prompt, generationConfig);
            if (!styleExecution) return;
            const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((current) => [
                ...current,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || t("canvas:inpaint-result"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...generationMetadata, ...styleMetadata },
                },
            ]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const result = await runBackendCanvasGenerationTask({
                    projectId,
                    nodeId: childId,
                    mode: "image",
                    prompt: effectivePrompt,
                    config: generationConfig,
                    referenceImages: [source],
                    mask: { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl },
                    signal: controller.signal,
                    metadata: { sourceNodeId: node.id, edit: "mask", ...styleMetadata },
                    onTaskCreated: (task) => bindGenerationTask(childId, task),
                });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error(t("canvas:backend-task-returned-no-images-4"));
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt: effectivePrompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const details = generationErrorMessage(error);
                message.error(details);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [
            bindGenerationTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            projectId,
            resolveImageEditStyle,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );

    const upscaleImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
            if (!node.metadata?.content) return;
            setUpscaleNodeId(null);
            const upscaled = await upscaleDataUrl(node.metadata.content, params);
            const image = await uploadImage(upscaled);
            const size = fitNodeSize(image.width, image.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: "Upscaled Image",
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
            };
            setNodes((current) => [...current, child]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
        },
        [setConnections, setDialogNodeId, setNodes, setSelectedNodeIds],
    );

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }
            const childId = nanoid();
            const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const source = nodeReferenceImage(node);
            if (!source) return;
            const styleExecution = resolveImageEditStyle(node, prompt, generationConfig);
            if (!styleExecution) return;
            const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((current) => [
                ...current,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageSpec.width,
                    height: imageSpec.height,
                    metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...generationMetadata, ...styleMetadata },
                },
            ]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const result = await runBackendCanvasGenerationTask({
                    projectId,
                    nodeId: childId,
                    mode: "image",
                    prompt: effectivePrompt,
                    config: generationConfig,
                    referenceImages: [source],
                    signal: controller.signal,
                    metadata: { sourceNodeId: node.id, edit: "angle", ...styleMetadata },
                    onTaskCreated: (task) => bindGenerationTask(childId, task),
                });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error(t("canvas:backend-task-returned-no-images-4"));
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageSpec.width, imageSpec.height);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt: effectivePrompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const details = generationErrorMessage(error);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [bindGenerationTask, effectiveConfig, finishGenerationRequest, isAiConfigReady, projectId, resolveImageEditStyle, setConnections, setDialogNodeId, setNodes, setRunningNodeId, setSelectedNodeIds, startGenerationRequest],
    );

    const generateEmotionNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageEmotionPayload) => {
            if (!node.metadata?.content) return;
            const baseConfig = buildGenerationConfig(effectiveConfig, node, "image");
            const providerSize = emotionGenerationSize(payload.editRegion);
            const generationConfig = { ...baseConfig, count: "1", size: providerSize, quality: !baseConfig.quality || baseConfig.quality === "auto" ? "high" : baseConfig.quality };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }
            if (resolveModelRequestConfig(generationConfig, generationConfig.model).interfaceType !== "openai-image") {
                message.error(t("canvas:expression-editing-needs-an-openai-images-channel-with-multi-reference-e"));
                return;
            }
            const imageProfile = modelCapabilityConfigFor(generationConfig, generationConfig.model).image!;
            const editPlan = resolveEmotionEditPlan(imageProfile.references.maskSupported);
            const source = nodeReferenceImage(node);
            if (!source) return;
            const editReference = {
                id: `${node.id}-${payload.presetId}-edit-region`,
                name: "emotion-edit-region.png",
                type: "image/png",
                dataUrl: payload.sourceDataUrl,
            };
            const characterReference = {
                id: `${node.id}-${payload.presetId}-character`,
                name: `${payload.characterName}-face.jpg`,
                type: "image/jpeg",
                dataUrl: payload.characterDataUrl,
            };
            const childId = nanoid();
            const styleExecution = resolveImageEditStyle(node, payload.prompt, generationConfig);
            if (!styleExecution) return;
            const { prompt: effectivePrompt, metadata: styleMetadata } = styleExecution;
            const providerPrompt = normalizeEmotionPromptForProvider(effectivePrompt);
            const generationMetadata = { ...buildImageGenerationMetadata("edit", generationConfig, 1, [source]), size: `${payload.imageWidth}x${payload.imageHeight}` };
            const emotionEdit = {
                sourceNodeId: node.id,
                characterName: payload.characterName,
                presetId: payload.presetId,
                intimacy: payload.intimacy,
                arousal: payload.arousal,
                label: payload.label,
                faceBox: payload.faceBox,
                editRegion: payload.editRegion,
                sourceWidth: payload.imageWidth,
                sourceHeight: payload.imageHeight,
                providerSize,
                editMode: editPlan.mode,
            };
            if (editPlan.notice) message.info(editPlan.notice);
            setEmotionNodeId(null);
            setRunningNodeId(childId);
            setNodes((current) => [
                ...current,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: `${payload.characterName} · ${payload.label}`,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt: providerPrompt, status: NODE_STATUS_LOADING, ...generationMetadata, ...styleMetadata, emotionEdit },
                },
            ]);
            setConnections((current) => [...current, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const mask = emotionProviderMask(editPlan, { id: `${node.id}-emotion-mask`, name: "emotion-mask.png", type: "image/png", dataUrl: payload.maskDataUrl });
                const result = await runBackendCanvasGenerationTask({
                    projectId,
                    nodeId: childId,
                    mode: "image",
                    prompt: providerPrompt,
                    config: generationConfig,
                    referenceImages: [editReference, characterReference],
                    mask,
                    signal: controller.signal,
                    metadata: { sourceNodeId: node.id, edit: "emotion", emotionEditMode: editPlan.mode, emotion: emotionEdit, ...styleMetadata },
                    onTaskCreated: (task) => bindGenerationTask(childId, task),
                });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error(t("canvas:backend-task-returned-no-images-4"));
                const composited = await compositeEmotionImage(node.metadata.content, image.dataUrl, payload.editRegion, payload.faceBox);
                const uploaded = await uploadImage(composited);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((current) =>
                    current.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt: providerPrompt, ...generationMetadata, emotionEdit } } : item)),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const details = generationErrorMessage(error);
                message.error(details);
                setNodes((current) => current.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: details } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [
            bindGenerationTask,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            projectId,
            resolveImageEditStyle,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );

    return {
        angleNodeId,
        emotionNodeId,
        annotationNodeId,
        createImageReversePromptNodes,
        generatePortraitTextureNode,
        cropImageNode,
        cropNodeId,
        closeSegmentDialog,
        extractAudioFromVideo,
        extractVideoLastFrame,
        extractingVideoFrameNodeId,
        handleSegmentConfirm,
        generateAngleNode,
        maskEditImageNode,
        maskEditNodeId,
        mergeSelectedVideos,
        mergeVideosByIds,
        mergeVideoProgress,
        saveAnnotatedImageNode,
        segmentDialogMode,
        segmentDialogNodeId,
        segmentRunningMode,
        setSegmentDialogNodeId,
        setAngleNodeId,
        generateEmotionNode,
        setEmotionNodeId,
        setAnnotationNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setSplitNodeId,
        setUpscaleNodeId,
        splitImageNode,
        splitNodeId,
        trimVideoAndRegenerate,
        upscaleImageNode,
        upscaleNodeId,
    };
}
