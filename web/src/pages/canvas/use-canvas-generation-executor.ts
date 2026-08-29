import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";

import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { buildGenerationConfig, isGenerationCanceled } from "@/lib/canvas/canvas-project-generation";
import { canvasGenerationRequestFingerprint, runCanvasGenerationSubmissionOnce } from "@/lib/canvas/canvas-generation-submission";
import { isGenerationTaskCapacityError } from "@/lib/canvas/canvas-generation-batch";
import { buildPortraitTexturePrompt } from "@/lib/canvas/canvas-portrait-texture";
import { resolveCanvasStyleExecution } from "@/lib/canvas/canvas-style-execution";
import { generationErrorMessage, generationFailureMetadata } from "@/lib/generation-error";
import { modelCompatibilityError, modelGroupReferenceLimits, modelRequestOptions, type ModelRequirements } from "@/lib/model-selection";
import { navigateToSettings } from "@/lib/settings-navigation";
import type { Skill } from "@/services/api/skills";
import { skillRuntime } from "@/services/skill-runtime";
import type { GenerationTask } from "@/services/api/task-center";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { Asset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

import { executeImageGeneration } from "./canvas-image-generation-executor";
import { executeAudioGeneration, executeVideoGeneration } from "./canvas-media-generation-executors";
import { executeTextGeneration } from "./canvas-text-generation-executor";

type UseCanvasGenerationExecutorOptions = {
    projectId: string;
    domainProjectId?: string;
    addedSkills: Skill[];
    assets: Asset[];
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
    applyGenerationTaskResult: (targetNodeId: string, task: GenerationTask) => Promise<void>;
};

const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_ERROR = "error" as const;

export type CanvasNodeGenerationOptions = {
    controller?: AbortController;
    waitForTaskCapacity?: boolean;
    context?: { conversationId?: string; messageId?: string };
    retryContext?: { retryOf: string; attemptGroupId: string; clientOperationId: string };
    onTaskUpdate?: (task: GenerationTask) => void;
    skipDuplicateConfirmation?: boolean;
};

export function useCanvasGenerationExecutor({
    projectId,
    domainProjectId,
    addedSkills,
    assets,
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
    applyGenerationTaskResult,
}: UseCanvasGenerationExecutorOptions) {
    const { message, modal } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const submissionLocksRef = useRef(new Map<string, Promise<unknown>>());
    const confirmDuplicateSubmission = useCallback(
        () =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: "再次生成相同内容？",
                    content: "当前节点已使用相同提示词、模型、参数和参考素材提交过任务。再次生成会新建任务，并可能再次消耗积分。",
                    okText: "仍然生成",
                    cancelText: "取消",
                    centered: true,
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),
        [modal],
    );

    return useCallback(
        (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, options?: CanvasNodeGenerationOptions) =>
            runCanvasGenerationSubmissionOnce(
                submissionLocksRef.current,
                nodeId,
                async () => {
                    const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
                    if (sourceNode?.type === CanvasNodeType.Video && sourceNode.metadata?.videoEditOperation === "concat") {
                        message.info("合并成片节点不直接重新生成，请重新选择源视频合并");
                        return;
                    }
                    let generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
                    const hasLiveBatchChildren =
                        sourceNode?.type === CanvasNodeType.Image && (sourceNode.metadata?.batchChildIds || []).some((childId) => nodesRef.current.some((node) => node.id === childId && node.metadata?.batchRootId === sourceNode.id));
                    const hasStaleImageBatchState =
                        mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content && Boolean(sourceNode.metadata?.isBatchRoot || sourceNode.metadata?.batchChildIds?.length) && !hasLiveBatchChildren;
                    if (hasStaleImageBatchState) {
                        setNodes((current) =>
                            current.map((node) => {
                                if (node.id !== sourceNode.id) return node;
                                const metadata = { ...node.metadata };
                                delete metadata.isBatchRoot;
                                delete metadata.batchChildIds;
                                delete metadata.primaryImageId;
                                delete metadata.imageBatchExpanded;
                                delete metadata.batchUsesReferenceImages;
                                return { ...node, metadata };
                            }),
                        );
                    }
                    if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                        navigateToSettings({ continueCreation: true });
                        return;
                    }

                    const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
                    const editingTextNode = mode === "text" && Boolean(sourceTextContent);
                    const generationPrompt = mode === "image" && sourceNode?.metadata?.portraitTexture ? buildPortraitTexturePrompt(prompt, sourceNode.metadata.portraitTexture) : prompt;
                    const isPreparingEmptyImage = mode === "image" && sourceNode?.type === CanvasNodeType.Image && !sourceNode.metadata?.content;

                    let rawGenerationContext: Awaited<ReturnType<typeof hydrateNodeGenerationContext>>;
                    // 视频文本只保留输入框内容；连接的媒体仍作为结构化参考传递。
                    const promptOnly = mode === "video";
                    const usesWorkflowProvider = Boolean(mode !== "text" && generationConfig.taskWorkflowProvider && generationConfig.taskWorkflowProvider !== "model");
                    try {
                        const baseContext = buildNodeGenerationContext(
                            nodeId,
                            nodesRef.current,
                            connectionsRef.current,
                            editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : generationPrompt,
                            assets,
                            promptOnly,
                        );
                        const requirements = generationModelRequirements(mode, baseContext, sourceNode, generationConfig, true);
                        generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, requirements);
                        const compatibilityError = usesWorkflowProvider ? "" : modelCompatibilityError(generationConfig, generationConfig.model, requirements);
                        if (compatibilityError) throw new Error(`当前模型无法支持这组输入和参数：${compatibilityError}`);
                        const referenceLimits = usesWorkflowProvider ? undefined : modelGroupReferenceLimits(effectiveConfig, generationConfig.model, mode, requirements);
                        rawGenerationContext = await hydrateNodeGenerationContext(baseContext, projectId, domainProjectId, mode, mode === "video" && Boolean(referenceLimits?.maxAudios), !promptOnly, referenceLimits);
                        const hydratedRequirements = generationModelRequirements(mode, rawGenerationContext, sourceNode, generationConfig);
                        generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode, hydratedRequirements);
                        const hydratedCompatibilityError = usesWorkflowProvider ? "" : modelCompatibilityError(generationConfig, generationConfig.model, hydratedRequirements);
                        if (hydratedCompatibilityError) throw new Error(`当前模型无法支持这组输入和参数：${hydratedCompatibilityError}`);
                    } catch (error) {
                        const errorDetails = generationErrorMessage(error);
                        message.error(errorDetails);
                        return;
                    }

                    let skillExecution: Awaited<ReturnType<typeof skillRuntime.prepare<"canvas">>>;
                    try {
                        skillExecution = await skillRuntime.prepare({ profile: "canvas", prompt: rawGenerationContext.prompt, skills: addedSkills });
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "技能上下文加载失败");
                        return;
                    }
                    let effectivePrompt = skillExecution.prompt.trim();
                    let styleMetadata = {};
                    if (mode === "image") {
                        try {
                            const styleRuntime = resolveCanvasStyleExecution(nodesRef.current, sourceNode, effectivePrompt, generationConfig, mode);
                            if (styleRuntime) {
                                effectivePrompt = styleRuntime.prompt;
                                styleMetadata = { styleProfileJson: styleRuntime.profileJson, styleExecutionPlan: styleRuntime.plan };
                            }
                        } catch (error) {
                            const errorDetails = generationErrorMessage(error);
                            message.error(errorDetails);
                            return;
                        }
                    }
                    const generationContext = { ...rawGenerationContext, prompt: effectivePrompt };
                    if (mode === "audio" && generationContext.characterReferences.length) {
                        if (generationContext.characterReferences.length !== 1) {
                            message.error("角色配音一次只能引用一个角色卡");
                            return;
                        }
                        const voice = generationContext.resolvedCharacterVoices[0];
                        if (!voice) {
                            message.error("角色尚未绑定可用声音，无法创建角色配音任务");
                            return;
                        }
                        generationConfig = { ...generationConfig, audioVoice: voice.voiceKey, audioInstructions: [voice.instructions, generationConfig.audioInstructions].filter(Boolean).join("；") };
                    }
                    if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                        return;
                    }

                    const requestFingerprint = canvasGenerationRequestFingerprint({
                        nodeId,
                        mode,
                        prompt: effectivePrompt,
                        model: generationConfig.model,
                        options: modelRequestOptions(generationConfig, mode),
                        workflow:
                            generationConfig.taskWorkflowProvider && generationConfig.taskWorkflowProvider !== "model"
                                ? {
                                      provider: generationConfig.taskWorkflowProvider,
                                      workflowId: generationConfig.taskWorkflowProvider === "runninghub" ? generationConfig.runningHub.workflowId : generationConfig.comfyBridge.workflowId,
                                      workflowKind: generationConfig.taskWorkflowProvider === "runninghub" ? generationConfig.runningHub.selectedKind : undefined,
                                      parameters: sourceNode?.metadata?.workflowParameters,
                                  }
                                : undefined,
                        operation: sourceNode?.metadata?.videoEditOperation,
                        audioInstructions: generationConfig.audioInstructions,
                        promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                        promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                        context: generationContext,
                    });
                    const duplicateConfirmationRequired = !options?.skipDuplicateConfirmation && !options?.retryContext && sourceNode?.metadata?.lastGenerationRequestFingerprint === requestFingerprint;
                    if (duplicateConfirmationRequired && !(await confirmDuplicateSubmission())) return;

                    setRunningNodeId(nodeId);
                    const controller = startGenerationRequest(nodeId, nodeId, nodeId, options?.controller);
                    if (controller.signal.aborted) {
                        finishGenerationRequest(nodeId, controller);
                        setRunningNodeId(null);
                        return;
                    }
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
                                              resourceReloadAvailable: undefined,
                                              failedPromptFingerprint: undefined,
                                          },
                                      }
                                    : node,
                            ),
                        );
                    }

                    // 已有内容节点只是本次生成的来源；任务状态归新目标所有，不能覆盖已成功结果。
                    const markSourceStatus = !sourceNode?.metadata?.content && !editingTextNode;
                    const statusPrompt = sourceNode?.type === CanvasNodeType.Config ? effectivePrompt : prompt;
                    if (markSourceStatus)
                        setNodes((current) =>
                            current.map((node) =>
                                node.id === nodeId
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, prompt: statusPrompt, status: NODE_STATUS_LOADING, errorDetails: undefined, generationErrorCode: undefined, resourceReloadAvailable: undefined, failedPromptFingerprint: undefined },
                                      }
                                    : node,
                            ),
                        );

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
                        skillMetadata: skillExecution.metadata,
                        taskContext: options?.context,
                        retryContext: options?.retryContext,
                        setNodes,
                        setConnections,
                        setSelectedNodeIds,
                        setSelectedConnectionId,
                        setDialogNodeId,
                        startGenerationRequest,
                        finishGenerationRequest,
                        bindGenerationTask: (targetNodeId: string, task: GenerationTask) => {
                            bindGenerationTask(targetNodeId, task);
                            setNodes((current) => {
                                const source = current.find((node) => node.id === nodeId);
                                if (!source || source.metadata?.lastGenerationRequestFingerprint === requestFingerprint) return current;
                                return current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, lastGenerationRequestFingerprint: requestFingerprint } } : node));
                            });
                            options?.onTaskUpdate?.(task);
                        },
                        applyGenerationTaskResult,
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
                            setNodes((current) =>
                                current.map((node) => {
                                    if (node.id !== nodeId && !pendingNodeIds.includes(node.id)) return node;
                                    const metadata = { ...(node.metadata || {}), status: NODE_STATUS_IDLE, errorDetails: undefined };
                                    delete metadata.taskId;
                                    delete metadata.taskStatus;
                                    delete metadata.taskProgress;
                                    delete metadata.taskStage;
                                    delete metadata.taskCreatedAt;
                                    delete metadata.taskUpdatedAt;
                                    delete metadata.taskStartedAt;
                                    delete metadata.taskCompletedAt;
                                    delete metadata.taskDurationMs;
                                    return { ...node, metadata };
                                }),
                            );
                            return;
                        }
                        message.error(failure.errorDetails);
                        setNodes((current) =>
                            current.map((node) => (node.id === nodeId || pendingNodeIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } }) : node)),
                        );
                    } finally {
                        finishGenerationRequest(nodeId, controller);
                        setRunningNodeId(null);
                    }
                },
                () => message.info({ key: `canvas-generation-submission-${nodeId}`, content: "该节点已有生成请求正在提交或执行，请勿重复点击" }),
            ),
        [
            addedSkills,
            applyGenerationTaskResult,
            bindGenerationTask,
            confirmDuplicateSubmission,
            domainProjectId,
            effectiveConfig,
            finishGenerationRequest,
            isAiConfigReady,
            message,
            nodesRef,
            connectionsRef,
            projectId,
            setConnections,
            setDialogNodeId,
            setNodes,
            setRunningNodeId,
            setSelectedConnectionId,
            setSelectedNodeIds,
            startGenerationRequest,
        ],
    );
}

function generationModelRequirements(
    mode: CanvasNodeGenerationMode,
    input: Pick<Awaited<ReturnType<typeof hydrateNodeGenerationContext>>, "textCount" | "imageCount" | "videoCount" | "audioCount" | "characterReferences">,
    sourceNode: CanvasNodeData | undefined,
    config: ReturnType<typeof useEffectiveConfig>,
    includeCharacterMinimum = false,
): ModelRequirements {
    return {
        capability: mode,
        input: {
            textCount: input.textCount,
            imageCount: input.imageCount,
            videoCount: input.videoCount,
            audioCount: input.audioCount,
            characterCount: includeCharacterMinimum ? input.characterReferences.length : 0,
        },
        videoOperation: sourceNode?.metadata?.videoEditOperation,
        videoSeconds: config.videoSeconds,
        options: config.taskWorkflowProvider === "model" ? modelRequestOptions(config, mode) : undefined,
    };
}
