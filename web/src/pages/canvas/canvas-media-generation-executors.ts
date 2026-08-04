import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata, videoMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize, nodeSizeFromRatio, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { nextCanvasVersionLabel } from "@/lib/canvas/canvas-layout";
import { buildAudioGenerationMetadata, buildVideoGenerationMetadata, generationReferenceUrls, runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;

export async function executeVideoGeneration({
    nodeId,
    sourceNode,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    projectId,
    canvasConnections,
    setNodes,
    setConnections,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
    const isExistingVideoNode = sourceNode?.type === CanvasNodeType.Video && Boolean(sourceNode.metadata?.content);
    const videoId = isEmptyVideoNode ? nodeId : nanoid();
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const videoGenerationMetadata = buildVideoGenerationMetadata(sourceNode, generationContext);
    const videoNode: CanvasNodeData = {
        id: videoId,
        type: CanvasNodeType.Video,
        title: effectivePrompt.slice(0, 32) || "Generated Video",
        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
        width: isEmptyVideoNode ? sourceNode.width : spec.width,
        height: isEmptyVideoNode ? sourceNode.height : spec.height,
        metadata: {
            ...(isEmptyVideoNode ? sourceNode.metadata || {} : {}),
            prompt: effectivePrompt,
            status: NODE_STATUS_LOADING,
            errorDetails: undefined,
            generationErrorCode: undefined,
            failedPromptFingerprint: undefined,
            model: generationConfig.model,
            size: generationConfig.size,
            seconds: generationConfig.videoSeconds,
            vquality: generationConfig.vquality,
            generateAudio: generationConfig.videoGenerateAudio,
            watermark: generationConfig.videoWatermark,
            references: generationReferenceUrls(generationContext),
            ...videoGenerationMetadata,
        },
    };
    registerPendingNodeIds([videoId]);
    setNodes((current) => {
        if (isEmptyVideoNode) return current.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node));
        if (!isExistingVideoNode || !sourceNode) return [...current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode];
        const rootId = sourceNode.metadata?.versionOfNodeId || sourceNode.id;
        const nextLabel = nextCanvasVersionLabel(rootId, current);
        return [
            ...current.map((node) => {
                if ((node.metadata?.versionOfNodeId || node.id) !== rootId) return node;
                return { ...node, metadata: { ...node.metadata, versionOfNodeId: rootId, versionLabel: node.metadata?.versionLabel || "A", versionPrimary: false, status: node.id === nodeId ? NODE_STATUS_SUCCESS : node.metadata?.status } };
            }),
            { ...videoNode, metadata: { ...videoNode.metadata, versionOfNodeId: rootId, versionLabel: nextLabel, versionPrimary: true } },
        ];
    });
    // 重新生成已有视频时，新节点继承源视频的上游连接，与源视频保持并行关系，而不是作为其下游子节点。
    if (!isEmptyVideoNode) {
        setConnections((current) => {
            if (!isExistingVideoNode) return [...current, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }];
            return [...current, ...canvasConnections.filter((connection) => connection.toNodeId === nodeId).map((connection) => ({ ...connection, id: nanoid(), toNodeId: videoId }))];
        });
    }

    startGenerationRequest(videoId, nodeId, nodeId, controller);
    try {
        const result = await runBackendCanvasGenerationTask({ projectId, nodeId: videoId, mode: "video", prompt: effectivePrompt, config: generationConfig, referenceImages: generationContext.referenceImages, referenceVideos: generationContext.referenceVideos, referenceAudios: generationContext.referenceAudios, signal: controller.signal, metadata: { sourceNodeId: nodeId, resolvedCharacterVersions: generationContext.resolvedCharacterVersions, resolvedCharacterVoices: generationContext.resolvedCharacterVoices, promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation, promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables, ...videoGenerationMetadata }, onTaskCreated: (task) => bindGenerationTask(videoId, task) });
        if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
        const video = await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
        setNodes((current) => current.map((node) => {
            if (node.id !== videoId) return node;
            const geometry = node.metadata?.locked ? {} : { width: videoSize.width, height: videoSize.height, position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 } };
            return { ...node, ...geometry, metadata: { ...node.metadata, ...videoMetadata(video), prompt: effectivePrompt, model: generationConfig.model, size: generationConfig.size, seconds: generationConfig.videoSeconds, vquality: generationConfig.vquality, generateAudio: generationConfig.videoGenerateAudio, watermark: generationConfig.videoWatermark, references: generationReferenceUrls(generationContext), ...videoGenerationMetadata } };
        }));
    } finally {
        finishGenerationRequest(videoId, controller);
    }
}

export async function executeAudioGeneration({
    nodeId,
    sourceNode,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    projectId,
    setNodes,
    setConnections,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
    const audioId = isEmptyAudioNode ? nodeId : nanoid();
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const audioNode: CanvasNodeData = {
        id: audioId,
        type: CanvasNodeType.Audio,
        title: effectivePrompt.slice(0, 32) || "Generated Audio",
        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
        width: isEmptyAudioNode ? sourceNode.width : spec.width,
        height: isEmptyAudioNode ? sourceNode.height : spec.height,
        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
    };
    registerPendingNodeIds([audioId]);
    setNodes((current) => (isEmptyAudioNode ? current.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode]));
    if (!isEmptyAudioNode) setConnections((current) => [...current, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);

    startGenerationRequest(audioId, nodeId, nodeId, controller);
    try {
        const result = await runBackendCanvasGenerationTask({ projectId, nodeId: audioId, mode: "audio", prompt: effectivePrompt, config: generationConfig, signal: controller.signal, metadata: { sourceNodeId: nodeId, resolvedCharacterVersions: generationContext.resolvedCharacterVersions, resolvedCharacterVoiceKey: generationContext.resolvedCharacterVoices[0]?.voiceKey }, onTaskCreated: (task) => bindGenerationTask(audioId, task) });
        if (!result.audio?.dataUrl) throw new Error("后端任务没有返回音频");
        const audio = await storeGeneratedAudio(await (await fetch(result.audio.dataUrl)).blob(), generationConfig.audioFormat);
        setNodes((current) => current.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } } : node)));
    } finally {
        finishGenerationRequest(audioId, controller);
    }
}
