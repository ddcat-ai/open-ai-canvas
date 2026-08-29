import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getGenerationCount, runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;

export async function executeTextGeneration({
    nodeId,
    sourceNode,
    prompt,
    effectivePrompt,
    generationConfig,
    generationContext,
    controller,
    editingTextNode,
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
    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
    const isDirectTextTarget = sourceNode?.type === CanvasNodeType.Text && !sourceNode.metadata?.content?.trim() && !editingTextNode;
    // 独立文本份数（textCount），默认 1，不再复用餐图片数量 count（对齐上游 v0.16 语义）
    const textCount = getGenerationCount(String(sourceNode?.metadata?.textCount ?? 1));
    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
    const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
    const generateInPlace = !isConfigNode && !editingTextNode;
    const childIds = Array.from({ length: generateInPlace ? Math.max(0, textCount - 1) : textCount }, () => nanoid());
    registerPendingNodeIds(childIds);
    if (childIds.length) {
        const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
            id,
            type: CanvasNodeType.Text,
            title: effectivePrompt.slice(0, 32) || "Generated Text",
            position: {
                x: parentPosition.x + parentConfig.width + 96,
                y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (childIds.length - 1) / 2) * (textConfig.height + 36),
            },
            width: textConfig.width,
            height: textConfig.height,
            metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, ...skillMetadata },
        }));
        setNodes((current) => [...current.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
        setConnections((current) => [...current, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
    }

    const textTargetIds = generateInPlace ? [nodeId, ...childIds] : childIds;
    textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
    const answers = await Promise.all(
        textTargetIds.map((targetNodeId) =>
            runCanvasGenerationTaskToConsumer(
                {
                    projectId,
                    nodeId: targetNodeId,
                    ...retryContext,
                    mode: "text",
                    prompt: effectivePrompt,
                    config: generationConfig,
                    referenceImages: generationContext.referenceImages,
                    referenceVideos: generationContext.referenceVideos,
                    signal: controller.signal,
                    metadata: { sourceNodeId: nodeId, ...taskContext, resolvedCharacterVersions: generationContext.resolvedCharacterVersions, ...skillMetadata },
                },
                {
                    bindTask: (task) => bindGenerationTask(targetNodeId, task),
                    consumeTask: (task) => applyGenerationTaskResult(targetNodeId, task),
                },
            )
                .then(() => ({ nodeId: targetNodeId }))
                .finally(() => finishGenerationRequest(targetNodeId, controller)),
        ),
    );
    if (controller.signal.aborted) return;
    void answers;
    if (isConfigNode) {
        setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, resourceReloadAvailable: undefined, failedPromptFingerprint: undefined } } : node)));
    }
}
