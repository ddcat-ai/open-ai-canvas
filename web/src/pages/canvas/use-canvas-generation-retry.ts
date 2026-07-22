import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import {
    buildAudioGenerationMetadata,
    buildGenerationConfig,
    buildImageGenerationMetadata,
    buildVideoGenerationMetadata,
    findRetrySourceNode,
    generationReferenceUrls,
    isGenerationCanceled,
    resolveMetadataReferences,
    resolveStoredReferenceImages,
    runBackendCanvasGenerationTask,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-project-generation";
import { expandSkillMentions } from "@/lib/canvas/canvas-skill-mentions";
import { generationFailureMetadata, unchangedModeratedPrompt } from "@/lib/generation-error";
import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import type { UpdreamSkill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { uploadImage } from "@/services/image-storage";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type UseCanvasGenerationRetryOptions = {
    projectId: string;
    activatedSkills: UpdreamSkill[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

export function useCanvasGenerationRetry({ projectId, activatedSkills, nodesRef, connectionsRef, setNodes, setRunningNodeId, startGenerationRequest, finishGenerationRequest, bindGenerationTask }: UseCanvasGenerationRetryOptions) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    return useCallback(
        async (node: CanvasNodeData) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const retryMode: CanvasNodeGenerationMode = node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image";
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? { ...effectiveConfig, model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model, quality: savedImageMetadata.quality || effectiveConfig.quality, size: savedImageMetadata.size || effectiveConfig.size, count: "1" }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, retryMode), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const retryPromptSource = sourceNode.metadata?.composerContent || sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            if (unchangedModeratedPrompt(node.metadata, retryPromptSource)) {
                message.warning("该提示词未通过内容审核，请先修改提示词再重新生成");
                return;
            }
            const rawContext = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, retryPromptSource));
            const context = rawContext ? { ...rawContext, prompt: expandSkillMentions(rawContext.prompt, activatedSkills) } : null;
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages = hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                markMissingReferences(node.id, setNodes);
                message.error("参考图片已丢失，无法继续重试");
                return;
            }
            const retryImages = retryReferenceImages || [];
            const storedVideoImages = node.type === CanvasNodeType.Video && !context?.referenceImages.length ? await resolveStoredReferenceImages(node.metadata?.references) : [];
            if (storedVideoImages === null) {
                markMissingReferences(node.id, setNodes);
                message.error("参考图片已丢失，无法继续重试");
                return;
            }
            const videoReferenceImages = context?.referenceImages.length ? context.referenceImages : storedVideoImages;
            const videoContext = node.type === CanvasNodeType.Video ? { prompt, referenceImages: videoReferenceImages, referenceVideos: context?.referenceVideos || [], referenceAudios: context?.referenceAudios || [], textCount: context?.textCount || 0, imageCount: videoReferenceImages.length, videoCount: context?.referenceVideos.length || 0, audioCount: context?.referenceAudios.length || 0 } : undefined;

            setRunningNodeId(node.id);
            setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "text", prompt, config: generationConfig, referenceImages: context.referenceImages, signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.text) throw new Error("后端任务没有返回文本");
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: result.text, prompt, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const videoGenerationMetadata = buildVideoGenerationMetadata(node, videoContext);
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "video", prompt, config: generationConfig, referenceImages: videoContext?.referenceImages || [], referenceVideos: videoContext?.referenceVideos || [], referenceAudios: videoContext?.referenceAudios || [], signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id, ...videoGenerationMetadata }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                    const video = await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, ...videoGenerationMetadata, references: videoContext ? generationReferenceUrls(videoContext) : item.metadata?.references } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "audio", prompt, config: generationConfig, signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.audio?.dataUrl) throw new Error("后端任务没有返回音频");
                    const audio = await storeGeneratedAudio(await (await fetch(result.audio.dataUrl)).blob(), generationConfig.audioFormat);
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "image", prompt, config: generationConfig, referenceImages: useReferenceImages ? retryImages : [], signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Image, width: imageSize.width, height: imageSize.height, metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const failure = generationFailureMetadata(error, retryPromptSource);
                message.error(failure.errorDetails);
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, ...failure } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [activatedSkills, bindGenerationTask, connectionsRef, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, nodesRef, openConfigDialog, projectId, setNodes, setRunningNodeId, startGenerationRequest],
    );
}

function markMissingReferences(nodeId: string, setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>) {
    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
}
