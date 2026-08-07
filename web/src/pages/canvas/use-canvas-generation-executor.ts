import { useCallback, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig, isGenerationCanceled, supportsVideoReferenceAudio } from "@/lib/canvas/canvas-project-generation";
import { isGenerationTaskCapacityError } from "@/lib/canvas/canvas-generation-batch";
import { buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import { expandSkillMentions } from "@/lib/canvas/canvas-skill-mentions";
import { generationErrorMessage, generationFailureMetadata } from "@/lib/generation-error";
import { navigateToSettings } from "@/lib/settings-navigation";
import type { Skill } from "@/services/api/skills";
import type { GenerationTask } from "@/services/api/task-center";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import { executeImageGeneration } from "./canvas-image-generation-executor";
import { executeAudioGeneration, executeVideoGeneration } from "./canvas-media-generation-executors";
import { executeTextGeneration } from "./canvas-text-generation-executor";

type UseCanvasGenerationExecutorOptions = {
    projectId: string;
    domainProjectId?: string;
    addedSkills: Skill[];
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    setRunningNodeId: Dispatch<SetStateAction<string | null>>;
    startGenerationRequest: (targetNodeId: string, originNodeId: string, runningId?: string, controller?: AbortController) => AbortController;
    finishGenerationRequest: (targetNodeId: string, controller: AbortController) => void;
    bindGenerationTask: (targetNodeId: string, task: GenerationTask) => void;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_ERROR = "error" as const;

export type CanvasNodeGenerationOptions = {
    controller?: AbortController;
    waitForTaskCapacity?: boolean;
};

export function useCanvasGenerationExecutor({
    projectId,
    domainProjectId,
    addedSkills,
    nodesRef,
    connectionsRef,
    setNodes,
    setConnections,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    setRunningNodeId,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
}: UseCanvasGenerationExecutorOptions) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    return useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (sourceNode?.type === CanvasNodeType.Video && sourceNode.metadata?.videoEditOperation === "concat") {
                message.info("合并成片节点不直接重新生成，请重新选择源视频合并");
                return;
            }
            let generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            const hasLiveBatchChildren = sourceNode?.type === CanvasNodeType.Image && (sourceNode.metadata?.batchChildIds || []).some((childId) => nodesRef.current.some((node) => node.id === childId && node.metadata?.batchRootId === sourceNode.id));
            const hasStaleImageBatchState = mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content && Boolean(sourceNode.metadata?.isBatchRoot || sourceNode.metadata?.batchChildIds?.length) && !hasLiveBatchChildren;
            if (hasStaleImageBatchState) {
                setNodes((current) => current.map((node) => {
                    if (node.id !== sourceNode.id) return node;
                    const metadata = { ...node.metadata };
                    delete metadata.isBatchRoot;
                    delete metadata.batchChildIds;
                    delete metadata.primaryImageId;
                    delete metadata.imageBatchExpanded;
                    delete metadata.batchUsesReferenceImages;
                    return { ...node, metadata };
                }));
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                navigateToSettings({ continueCreation: true });
                return;
            }

            setRunningNodeId(nodeId);
            const controller = startGenerationRequest(nodeId, nodeId, nodeId, options?.controller);
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const generationPrompt = mode === "image" && sourceNode?.metadata?.portraitTexture
                ? buildPortraitTexturePrompt(prompt, sourceNode.metadata.portraitTexture)
                : prompt;
            const isPreparingEmptyImage = mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content;
            if (isPreparingEmptyImage) {
                setNodes((current) =>
                    current.map((node) =>
                        node.id === nodeId
                            ? {
                                  ...node,
                                  metadata: {
                                      ...node.metadata,
                                      prompt,
                                      status: NODE_STATUS_LOADING,
                                      taskStage: "正在准备生成任务",
                                      taskProgress: 0,
                                      taskCreatedAt: new Date().toISOString(),
                                      errorDetails: undefined,
                                      generationErrorCode: undefined,
                                      failedPromptFingerprint: undefined,
                                  },
                              }
                            : node,
                    ),
                );
            }

            let rawGenerationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
            try {
                rawGenerationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : generationPrompt),
                    projectId,
                    domainProjectId,
                    mode,
                    mode === "video" && supportsVideoReferenceAudio(generationConfig),
                );
            } catch (error) {
                const errorDetails = generationErrorMessage(error);
                if (isPreparingEmptyImage) {
                    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: controller.signal.aborted ? NODE_STATUS_IDLE : NODE_STATUS_ERROR, taskStage: undefined, taskProgress: undefined, taskCreatedAt: undefined, errorDetails: controller.signal.aborted ? undefined : errorDetails } } : node)));
                }
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
                if (!controller.signal.aborted) message.error(errorDetails);
                return;
            }

            const expandedPrompt = expandSkillMentions(rawGenerationContext.prompt, addedSkills);
            let effectivePrompt = expandedPrompt.trim();
            let styleMetadata = {};
            if (mode === "image" || mode === "video") {
                try {
                    const styleRuntime = resolveCanvasStyleExecution(nodesRef.current, sourceNode, effectivePrompt, generationConfig, mode);
                    if (styleRuntime) {
                        effectivePrompt = styleRuntime.prompt;
                        styleMetadata = { styleProfileJson: styleRuntime.profileJson, styleExecutionPlan: styleRuntime.plan };
                    }
                } catch (error) {
                    const errorDetails = generationErrorMessage(error);
                    if (isPreparingEmptyImage) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, taskStage: undefined, taskProgress: undefined, taskCreatedAt: undefined, errorDetails } } : node)));
                    finishGenerationRequest(nodeId, controller);
                    setRunningNodeId(null);
                    message.error(errorDetails);
                    return;
                }
            }
            const generationContext = { ...rawGenerationContext, prompt: effectivePrompt };
            if (mode === "audio" && generationContext.characterReferences.length) {
                if (generationContext.characterReferences.length !== 1) {
                    finishGenerationRequest(nodeId, controller);
                    setRunningNodeId(null);
                    message.error("角色配音一次只能引用一个角色卡");
                    return;
                }
                const voice = generationContext.resolvedCharacterVoices[0];
                if (!voice) {
                    finishGenerationRequest(nodeId, controller);
                    setRunningNodeId(null);
                    message.error("角色尚未绑定可用声音，无法创建角色配音任务");
                    return;
                }
                generationConfig = { ...generationConfig, audioVoice: voice.voiceKey, audioInstructions: [voice.instructions, generationConfig.audioInstructions].filter(Boolean).join("；") };
            }
            if (controller.signal.aborted) {
                if (isPreparingEmptyImage) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, taskStage: undefined, taskProgress: undefined, taskCreatedAt: undefined } } : node)));
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
                return;
            }

            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
                return;
            }
            if (markSourceStatus) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } } : node)));

            let pendingNodeIds: string[] = [];
            const execution = {
                projectId,
                nodeId,
                sourceNode,
                canvasNodes: nodesRef.current,
                canvasConnections: connectionsRef.current,
                prompt,
                effectivePrompt,
                generationConfig,
                generationContext,
                controller,
                editingTextNode,
                styleMetadata,
                setNodes,
                setConnections,
                setSelectedNodeIds,
                setSelectedConnectionId,
                setDialogNodeId,
                startGenerationRequest,
                finishGenerationRequest,
                bindGenerationTask,
                showError: (content: string) => message.error(content),
                registerPendingNodeIds: (nodeIds: string[]) => {
                    pendingNodeIds = nodeIds;
                },
            };

            try {
                if (mode === "image") await executeImageGeneration(execution);
                else if (mode === "video") await executeVideoGeneration(execution);
                else if (mode === "audio") await executeAudioGeneration(execution);
                else await executeTextGeneration(execution);
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const failure = generationFailureMetadata(error, prompt);
                if (options?.waitForTaskCapacity && isGenerationTaskCapacityError(error)) {
                    setNodes((current) => current.map((node) => {
                        if (node.id !== nodeId && !pendingNodeIds.includes(node.id)) return node;
                        const metadata = { ...(node.metadata || {}), status: NODE_STATUS_IDLE, errorDetails: undefined };
                        delete metadata.taskId;
                        delete metadata.taskStatus;
                        delete metadata.taskProgress;
                        delete metadata.taskStage;
                        delete metadata.taskCreatedAt;
                        delete metadata.taskUpdatedAt;
                        return { ...node, metadata };
                    }));
                    return;
                }
                message.error(failure.errorDetails);
                setNodes((current) => current.map((node) => (node.id === nodeId || pendingNodeIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } }) : node)));
            } finally {
                finishGenerationRequest(nodeId, controller);
                setRunningNodeId(null);
            }
        },
        [addedSkills, bindGenerationTask, domainProjectId, effectiveConfig, finishGenerationRequest, isAiConfigReady, message, nodesRef, connectionsRef, projectId, setConnections, setDialogNodeId, setNodes, setRunningNodeId, setSelectedConnectionId, setSelectedNodeIds, startGenerationRequest],
    );
}
