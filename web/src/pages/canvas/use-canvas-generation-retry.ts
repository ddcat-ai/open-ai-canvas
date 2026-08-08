import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize, nodeSizeFromRatio, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { buildEmotionImageArtifacts, compositeEmotionImage, emotionGenerationSize } from "@/lib/canvas/canvas-emotion";
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
    supportsVideoReferenceAudio,
} from "@/lib/canvas/canvas-project-generation";
import { expandSkillMentions } from "@/lib/canvas/canvas-skill-mentions";
import { buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import { generationFailureMetadata, unchangedModeratedPrompt } from "@/lib/generation-error";
import { navigateToSettings } from "@/lib/settings-navigation";
import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type UseCanvasGenerationRetryOptions = {
    projectId: string;
    domainProjectId?: string;
    addedSkills: Skill[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
};

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

export function useCanvasGenerationRetry({ projectId, domainProjectId, addedSkills, nodesRef, connectionsRef, setNodes, setRunningNodeId, startGenerationRequest, finishGenerationRequest, bindGenerationTask }: UseCanvasGenerationRetryOptions) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    return useCallback(
        async (node: CanvasNodeData) => {
            const retryMode = retryModeForNode(node.type);
            if (!retryMode) {
                message.warning("当前节点不能使用通用生成重试");
                return;
            }
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            let generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? { ...effectiveConfig, model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model, quality: savedImageMetadata.quality || effectiveConfig.quality, size: savedImageMetadata.size || effectiveConfig.size, transparentBackground: (savedImageMetadata.transparentBackground || effectiveConfig.transparentBackground) === "true" ? "true" : "false", count: "1" }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, retryMode), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }

            const retryPromptSource = sourceNode.metadata?.composerContent || sourceNode.metadata?.prompt || node.metadata?.prompt || "";
            const retryContextPrompt = retryMode === "image" && sourceNode.metadata?.portraitTexture
                ? buildPortraitTexturePrompt(retryPromptSource, sourceNode.metadata.portraitTexture)
                : retryPromptSource;
            if (unchangedModeratedPrompt(node.metadata, retryPromptSource)) {
                message.warning("该提示词未通过内容审核，请先修改提示词再重新生成");
                return;
            }
            let rawContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>> | null;
            try {
                const promptOnly = retryMode === "video";
                const baseContext = buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, retryContextPrompt, promptOnly);
                rawContext = hasSavedImageMetadata && !baseContext.characterReferences.length ? null : await hydrateNodeGenerationContext(baseContext, projectId, domainProjectId, retryMode, retryMode === "video" && supportsVideoReferenceAudio(generationConfig), !promptOnly);
            } catch (error) {
                const failure = generationFailureMetadata(error, retryPromptSource);
                message.error(failure.errorDetails);
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, ...failure } } : item)));
                return;
            }
            const context = rawContext ? { ...rawContext, prompt: retryMode === "video" ? rawContext.prompt : expandSkillMentions(rawContext.prompt, addedSkills) } : null;
            const prompt = (context?.characterReferences.length ? context.prompt : savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            let mediaPrompt = prompt;
            let styleMetadata = {};
            if (node.type === CanvasNodeType.Image) {
                try {
                    const runtime = resolveCanvasStyleExecution(nodesRef.current, sourceNode, prompt, generationConfig, "image");
                    if (runtime) {
                        mediaPrompt = runtime.prompt;
                        styleMetadata = { styleProfileJson: runtime.profileJson, styleExecutionPlan: runtime.plan };
                    }
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "项目画风与当前模型不兼容");
                    return;
                }
            }
            if (retryMode === "audio" && context?.characterReferences.length) {
                if (context.characterReferences.length !== 1) {
                    message.error("角色配音一次只能引用一个角色卡");
                    return;
                }
                const voice = context.resolvedCharacterVoices[0];
                if (!voice) {
                    message.error("角色尚未绑定可用声音，无法重试角色配音任务");
                    return;
                }
                generationConfig = { ...generationConfig, audioVoice: voice.voiceKey, audioInstructions: [voice.instructions, generationConfig.audioInstructions].filter(Boolean).join("；") };
            }
            const generationType = savedImageMetadata?.generationType;
            const isEmotionRetry = Boolean(node.metadata?.emotionEdit);
            if (isEmotionRetry && resolveModelRequestConfig(generationConfig, generationConfig.model).interfaceType !== "openai-image") {
                message.error("表情编辑需要支持蒙版的 OpenAI Images 渠道，当前渠道已拒绝整图重绘");
                return;
            }
            const useReferenceImages = isEmotionRetry ? false : context?.characterReferences.length ? true : generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages = isEmotionRetry ? [] : hasSavedImageMetadata && savedImageMetadata && !context?.characterReferences.length ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
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
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "text", prompt, config: generationConfig, referenceImages: context.referenceImages, referenceVideos: context.referenceVideos, signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id, resolvedCharacterVersions: context.resolvedCharacterVersions }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.text) throw new Error("后端任务没有返回文本");
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: result.text, richText: undefined, prompt, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const videoGenerationMetadata = buildVideoGenerationMetadata(node, videoContext);
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "video", prompt: mediaPrompt, config: generationConfig, referenceImages: videoContext?.referenceImages || [], referenceVideos: videoContext?.referenceVideos || [], referenceAudios: videoContext?.referenceAudios || [], signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id, resolvedCharacterVersions: context?.resolvedCharacterVersions || [], resolvedCharacterVoices: context?.resolvedCharacterVoices || [], promptTemplateOperation: node.metadata?.promptTemplateOperation, promptTemplateVariables: node.metadata?.promptTemplateVariables, ...videoGenerationMetadata, ...styleMetadata }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
                    const video = await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, width: videoSize.width, height: videoSize.height, position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 }, metadata: { ...item.metadata, ...videoMetadata(video), prompt: mediaPrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, ...videoGenerationMetadata, ...styleMetadata, references: videoContext ? generationReferenceUrls(videoContext) : item.metadata?.references } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "audio", prompt, config: generationConfig, signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id, resolvedCharacterVersions: context?.resolvedCharacterVersions || [], resolvedCharacterVoiceKey: context?.resolvedCharacterVoices[0]?.voiceKey }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    if (!result.audio?.dataUrl) throw new Error("后端任务没有返回音频");
                    const audio = await storeGeneratedAudio(await (await fetch(result.audio.dataUrl)).blob(), generationConfig.audioFormat);
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const emotionEdit = node.metadata?.emotionEdit;
                if (emotionEdit) {
                    const emotionSource = nodesRef.current.find((item) => item.id === emotionEdit.sourceNodeId);
                    if (!emotionSource?.metadata?.content) throw new Error("情绪编辑源图片已删除，无法重试");
                    const sourceDataUrl = await resolveImageUrl(emotionSource.metadata.storageKey, emotionSource.metadata.content, { cacheMiss: true });
                    if (!sourceDataUrl) throw new Error("无法读取情绪编辑源图片");
                    const artifacts = await buildEmotionImageArtifacts(sourceDataUrl, emotionEdit.faceBox, emotionSource.metadata.naturalWidth || 0, emotionSource.metadata.naturalHeight || 0);
                    const emotionConfig = { ...generationConfig, size: emotionGenerationSize(artifacts.editRegion), quality: !generationConfig.quality || generationConfig.quality === "auto" ? "high" : generationConfig.quality };
                    const sourceReference = sourceNodeReferenceImages(emotionSource)[0];
                    if (!sourceReference) throw new Error("情绪编辑源图片不可用");
                    const editReference = { id: `${emotionSource.id}-${emotionEdit.presetId}-edit-region`, name: "emotion-edit-region.png", type: "image/png", dataUrl: artifacts.sourceDataUrl };
                    const characterReference = { id: `${emotionSource.id}-${emotionEdit.presetId}-character`, name: `${emotionEdit.characterName}-face.jpg`, type: "image/jpeg", dataUrl: artifacts.characterDataUrl };
                    const nextEmotionEdit = { ...emotionEdit, editRegion: artifacts.editRegion, sourceWidth: artifacts.imageWidth, sourceHeight: artifacts.imageHeight, providerSize: emotionConfig.size };
                    const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "image", prompt: mediaPrompt, config: emotionConfig, referenceImages: [editReference, characterReference], mask: { id: `${emotionSource.id}-emotion-mask`, name: "emotion-mask.png", type: "image/png", dataUrl: artifacts.maskDataUrl }, signal: controller.signal, metadata: { retry: true, sourceNodeId: emotionSource.id, edit: "emotion", emotion: nextEmotionEdit, resolvedCharacterVersions: context?.resolvedCharacterVersions || [], ...styleMetadata }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                    const image = result.images?.[0];
                    if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
                    const composited = await compositeEmotionImage(sourceDataUrl, image.dataUrl, artifacts.editRegion, emotionEdit.faceBox);
                    const uploadedImage = await uploadImage(composited);
                    const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, node.width, node.height);
                    const generationMetadata = { ...buildImageGenerationMetadata("edit", emotionConfig, 1, [sourceReference]), size: `${artifacts.imageWidth}x${artifacts.imageHeight}` };
                    setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Image, width: imageSize.width, height: imageSize.height, metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt: mediaPrompt, ...generationMetadata, ...styleMetadata, emotionEdit: nextEmotionEdit } } : item)));
                    return;
                }

                const result = await runBackendCanvasGenerationTask({ projectId, nodeId: node.id, mode: "image", prompt: mediaPrompt, config: generationConfig, referenceImages: useReferenceImages ? retryImages : [], signal: controller.signal, metadata: { retry: true, sourceNodeId: sourceNode.id, resolvedCharacterVersions: context?.resolvedCharacterVersions || [], promptTemplateOperation: node.metadata?.promptTemplateOperation, promptTemplateVariables: node.metadata?.promptTemplateVariables, ...styleMetadata }, onTaskCreated: (task) => bindGenerationTask(node.id, task) });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const requestedImageSize = nodeSizeFromRatio(generationConfig.size || "auto", imageConfig.width, imageConfig.height);
                const imageSize = useReferenceImages && !requestedImageSize
                    ? { width: node.width, height: node.height }
                    : fitNodeSize(uploadedImage.width, uploadedImage.height, requestedImageSize?.width || imageConfig.width, requestedImageSize?.height || imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? { generationType: savedImageMetadata.generationType, model: generationConfig.model, size: generationConfig.size, quality: generationConfig.quality, transparentBackground: generationConfig.transparentBackground, count: savedImageMetadata.count || 1, references: savedImageMetadata.references }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((current) => current.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Image, position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height, metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt: mediaPrompt, ...generationMetadata, ...styleMetadata } } : item)));
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
        [addedSkills, bindGenerationTask, connectionsRef, domainProjectId, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, nodesRef, projectId, setNodes, setRunningNodeId, startGenerationRequest],
    );
}

// 生成类型必须由明确的节点契约决定，未知节点不能降级成图片任务。
function retryModeForNode(type: CanvasNodeType): CanvasNodeGenerationMode | null {
    if (type === CanvasNodeType.Text) return "text";
    if (type === CanvasNodeType.Image) return "image";
    if (type === CanvasNodeType.Video) return "video";
    if (type === CanvasNodeType.Audio) return "audio";
    return null;
}

function markMissingReferences(nodeId: string, setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>) {
    setNodes((current) => current.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
}
