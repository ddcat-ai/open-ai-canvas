import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { canGenerateMediaInPlace } from "@/lib/canvas/canvas-generation-layout";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { nextCanvasVersionLabel } from "@/lib/canvas/canvas-layout";
import { buildAudioGenerationMetadata, buildVideoGenerationMetadata, generationReferenceUrls, runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { canvasGenerationPromptMetadata } from "@/lib/canvas/canvas-generation-submission";
import { producedModelCandidateForGeneration } from "@/lib/canvas/produced-model";
import { isDoubaoAudioConfig } from "@/lib/audio-generation";
import { generationProtocolNamespace } from "@/services/api/generation-task";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;

export async function executeVideoGeneration({
    nodeId,
    sourceNode,
    prompt,
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
    applyGenerationTaskResult,
    registerPendingNodeIds,
    styleMetadata,
    skillMetadata,
    taskContext,
    retryContext,
}: CanvasGenerationExecution) {
    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
    const reuseSourceNode = canGenerateMediaInPlace(sourceNode, CanvasNodeType.Video);
    const isExistingVideoNode = sourceNode?.type === CanvasNodeType.Video && Boolean(sourceNode.metadata?.content) && !reuseSourceNode;
    const videoId = reuseSourceNode ? nodeId : nanoid();
    const versionRootId = isExistingVideoNode && sourceNode ? sourceNode.metadata?.versionOfNodeId || sourceNode.id : undefined;
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const videoGenerationMetadata = buildVideoGenerationMetadata(sourceNode, generationContext, generationConfig);
    const videoNode: CanvasNodeData = {
        id: videoId,
        type: CanvasNodeType.Video,
        title: effectivePrompt.slice(0, 32) || "Generated Video",
        position: reuseSourceNode ? sourceNode!.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
        width: reuseSourceNode ? sourceNode!.width : spec.width,
        height: reuseSourceNode ? sourceNode!.height : spec.height,
        metadata: {
            ...(reuseSourceNode ? sourceNode?.metadata || {} : {}),
            ...canvasGenerationPromptMetadata(prompt, effectivePrompt),
            status: NODE_STATUS_LOADING,
            errorDetails: undefined,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
            model: generationConfig.model,
            producedModelCandidate: producedModelCandidateForGeneration(generationConfig),
            size: generationConfig.size,
            seconds: generationConfig.videoSeconds,
            vquality: generationConfig.videoDraft === "true" ? "480p" : generationConfig.vquality,
            generateAudio: generationConfig.videoGenerateAudio,
            watermark: generationConfig.videoWatermark,
            videoDraft: generationConfig.videoDraft,
            references: generationReferenceUrls(generationContext),
            ...videoGenerationMetadata,
            ...styleMetadata,
            ...skillMetadata,
        },
    };
    registerPendingNodeIds([videoId]);
    // 待生成版本先加入版本族，但只有成功结果才能替换当前主版本。
    setNodes((current) => {
        if (reuseSourceNode) return current.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node));
        if (!isExistingVideoNode || !sourceNode) return [...current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode];
        const rootId = versionRootId!;
        const nextLabel = nextCanvasVersionLabel(rootId, current);
        const hasPrimaryVersion = current.some((node) => (node.metadata?.versionOfNodeId || node.id) === rootId && node.metadata?.versionPrimary);
        return [
            ...current.map((node) => {
                if ((node.metadata?.versionOfNodeId || node.id) !== rootId) return node;
                return { ...node, metadata: { ...node.metadata, versionOfNodeId: rootId, versionLabel: node.metadata?.versionLabel || "A", versionPrimary: node.metadata?.versionPrimary || (!hasPrimaryVersion && node.id === sourceNode.id), status: node.id === nodeId ? NODE_STATUS_SUCCESS : node.metadata?.status } };
            }),
            { ...videoNode, metadata: { ...videoNode.metadata, versionOfNodeId: rootId, versionLabel: nextLabel, versionPrimary: false } },
        ];
    });
    // 重新生成已有视频时，新节点继承源视频的上游连接，与源视频保持并行关系，而不是作为其下游子节点。
    if (!reuseSourceNode) {
        setConnections((current) => {
            if (!isExistingVideoNode) return [...current, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }];
            return [...current, ...canvasConnections.filter((connection) => connection.toNodeId === nodeId).map((connection) => ({ ...connection, id: nanoid(), toNodeId: videoId }))];
        });
    }

    startGenerationRequest(videoId, nodeId, nodeId, controller);
    try {
        await runCanvasGenerationTaskToConsumer(
            {
                projectId,
                nodeId: videoId,
                ...retryContext,
                mode: "video",
                prompt: effectivePrompt,
                config: generationConfig,
                referenceImages: generationContext.referenceImages,
                referenceVideos: generationContext.referenceVideos,
                referenceAudios: generationContext.referenceAudios,
                signal: controller.signal,
                metadata: {
                    sourceNodeId: nodeId,
                    ...taskContext,
                    resolvedCharacterVersions: generationContext.resolvedCharacterVersions,
                    resolvedCharacterVoices: generationContext.resolvedCharacterVoices,
                    promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                    promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                    ...videoGenerationMetadata,
                    ...styleMetadata,
                    ...skillMetadata,
                },
            },
            {
                bindTask: (task) => bindGenerationTask(videoId, task),
                consumeTask: (task) => applyGenerationTaskResult(videoId, task),
            },
        );
    } finally {
        finishGenerationRequest(videoId, controller);
    }
}

export async function executeAudioGeneration({
    nodeId,
    sourceNode,
    prompt,
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
    applyGenerationTaskResult,
    registerPendingNodeIds,
    taskContext,
    skillMetadata,
    retryContext,
}: CanvasGenerationExecution) {
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
    const isExistingAudioNode = sourceNode?.type === CanvasNodeType.Audio && Boolean(sourceNode.metadata?.content);
    const audioId = isEmptyAudioNode ? nodeId : nanoid();
    const parent = sourceNode?.position || { x: 0, y: 0 };
    const audioNode: CanvasNodeData = {
        id: audioId,
        type: CanvasNodeType.Audio,
        title: effectivePrompt.slice(0, 32) || "Generated Audio",
        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
        width: isEmptyAudioNode ? sourceNode.width : spec.width,
        height: isEmptyAudioNode ? sourceNode.height : spec.height,
        metadata: { ...canvasGenerationPromptMetadata(prompt, effectivePrompt), status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig), ...skillMetadata },
    };
    registerPendingNodeIds([audioId]);
    setNodes((current) =>
        isEmptyAudioNode ? current.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node)) : [...current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
    );
    if (!isEmptyAudioNode && !isExistingAudioNode) setConnections((current) => [...current, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);

    startGenerationRequest(audioId, nodeId, nodeId, controller);
    try {
        await runCanvasGenerationTaskToConsumer(
            {
                projectId,
                nodeId: audioId,
                ...retryContext,
                mode: "audio",
                prompt: doubaoAudioPrompt(generationConfig, effectivePrompt, generationContext.referenceAudios.length, generationContext.referenceImages.length),
                config: generationConfig,
                referenceImages: generationContext.referenceImages,
                referenceAudios: generationContext.referenceAudios,
                signal: controller.signal,
                metadata: { sourceNodeId: nodeId, ...taskContext, resolvedCharacterVersions: generationContext.resolvedCharacterVersions, resolvedCharacterVoiceKey: generationContext.resolvedCharacterVoices[0]?.voiceKey, ...skillMetadata },
            },
            {
                bindTask: (task) => bindGenerationTask(audioId, task),
                consumeTask: (task) => applyGenerationTaskResult(audioId, task),
            },
        );
    } finally {
        finishGenerationRequest(audioId, controller);
    }
}

function doubaoAudioPrompt(config: CanvasGenerationExecution["generationConfig"], prompt: string, audioCount: number, imageCount: number) {
    if (!isDoubaoAudioConfig(config)) return prompt;
    // 参考图片模式的 text_prompt 只保留要合成的文本，图片走 references。
    if (imageCount > 0) return prompt.replace(/@(图片|音频|视频|绘图|角色|文本)\d+/g, " ").replace(/[ \t]{2,}/g, " ").trim();
    if (audioCount <= 0) return prompt;
    // 官方参考音频用 @Audio1、@Audio2，和 references 的顺序一致。画布里的 @音频N 只是编辑器槽位。
    const next = prompt.replace(/@音频(\d+)/g, "@Audio$1");
    const missing = Array.from({ length: audioCount }, (_, index) => `@Audio${index + 1}`).filter((marker) => !next.includes(marker));
    return missing.length ? `${missing.join(" ")} ${next}` : next;
}

export type DraftFinalVideoExecution = {
    projectId: string;
    draftNode: CanvasNodeData;
    controller: AbortController;
    config: CanvasGenerationExecution["generationConfig"];
} & Pick<CanvasGenerationExecution, "setNodes" | "setConnections" | "startGenerationRequest" | "finishGenerationRequest" | "bindGenerationTask" | "applyGenerationTaskResult">;

/**
 * 基于样片生成 1080p 正式视频（Step2）。上游通过 content.draft_task 复用样片任务的
 * 提示词、素材、时长与比例，因此这里不重交参考素材；价格档按 1080p 与样片任务的
 * 生成模式选择，两步独立计费。
 */
export async function executeDraftFinalVideoGeneration({ projectId, draftNode, controller, config, setNodes, setConnections, startGenerationRequest, finishGenerationRequest, bindGenerationTask, applyGenerationTaskResult }: DraftFinalVideoExecution) {
    const draftTaskId = String(draftNode.metadata?.videoDraftTaskId || "").trim();
    if (!draftTaskId) throw new Error("样片节点缺少上游任务 ID，无法生成正式视频");
    const draftModel = String(draftNode.metadata?.model || config.model);
    const prompt = String(draftNode.metadata?.prompt || "").trim() || "基于样片生成正式视频";
    const generationConfig: CanvasGenerationExecution["generationConfig"] = {
        ...config,
        model: draftModel,
        vquality: "1080p",
        videoDraft: "false",
        size: draftNode.metadata?.size || config.size,
        videoSeconds: draftNode.metadata?.seconds || config.videoSeconds,
        videoGenerateAudio: draftNode.metadata?.generateAudio || config.videoGenerateAudio,
        videoWatermark: draftNode.metadata?.watermark || config.videoWatermark,
    };
    const protocol = generationProtocolNamespace(generationConfig);
    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
    const finalId = nanoid();
    const finalNode: CanvasNodeData = {
        id: finalId,
        type: CanvasNodeType.Video,
        title: `${draftNode.title || "正式视频"} · 正式`.slice(0, 40),
        position: { x: draftNode.position.x + (draftNode.width || spec.width) + 96, y: draftNode.position.y },
        width: spec.width,
        height: spec.height,
        metadata: {
            status: NODE_STATUS_LOADING,
            prompt,
            model: generationConfig.model,
            producedModelCandidate: producedModelCandidateForGeneration(generationConfig),
            size: generationConfig.size,
            seconds: generationConfig.videoSeconds,
            vquality: "1080p",
            generateAudio: generationConfig.videoGenerateAudio,
            watermark: generationConfig.videoWatermark,
            videoDraft: "false",
            videoFinalOfDraftTaskId: draftTaskId,
        },
    };
    setNodes((current) => [...current, finalNode]);
    setConnections((current) => [...current, { id: nanoid(), fromNodeId: draftNode.id, toNodeId: finalId }]);
    startGenerationRequest(finalId, draftNode.id, draftNode.id, controller);
    try {
        await runCanvasGenerationTaskToConsumer(
            {
                projectId,
                nodeId: finalId,
                mode: "video",
                prompt,
                config: generationConfig,
                signal: controller.signal,
                metadata: {
                    sourceNodeId: draftNode.id,
                    videoEditOperation: draftNode.metadata?.videoEditOperation as string | undefined,
                    // Step2 唯一需要的新参数：样片任务 ID 走 providerOptions 协议命名空间。
                    ...(protocol ? { providerOptions: { [protocol]: { draftTaskId } } } : {}),
                },
            },
            {
                bindTask: (task) => bindGenerationTask(finalId, task),
                consumeTask: (task) => applyGenerationTaskResult(finalId, task),
            },
        );
    } finally {
        finishGenerationRequest(finalId, controller);
    }
}
