import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { getGenerationCount, runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
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
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    let streamed = "";
    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
    const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
    const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
    const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
    registerPendingNodeIds(childIds);
    if (isConfigNode || editingTextNode) {
        const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
            id,
            type: CanvasNodeType.Text,
            title: effectivePrompt.slice(0, 32) || "Generated Text",
            position: {
                x: parentPosition.x + parentConfig.width + 96,
                y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
            },
            width: textConfig.width,
            height: textConfig.height,
            metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14 },
        }));
        setNodes((current) => [...current.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
        setConnections((current) => [...current, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
    }

    const textTargetIds = childIds.length ? childIds : [nodeId];
    textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
    const answers = await Promise.all(
        textTargetIds.map((targetNodeId) => {
            let localStreamed = "";
            return runBackendCanvasGenerationTask({ projectId, nodeId: targetNodeId, mode: "text", prompt: effectivePrompt, config: generationConfig, referenceImages: generationContext.referenceImages, signal: controller.signal, metadata: { sourceNodeId: nodeId }, onTaskCreated: (task) => bindGenerationTask(targetNodeId, task) })
                .then((result) => {
                    localStreamed = result.text || "";
                    streamed = localStreamed;
                    if (!isConfigNode) setNodes((current) => current.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: localStreamed, status: NODE_STATUS_LOADING } } : node)));
                    return { nodeId: targetNodeId, content: localStreamed };
                })
                .finally(() => finishGenerationRequest(targetNodeId, controller));
        }),
    );
    if (controller.signal.aborted) return;
    const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
    setNodes((current) =>
        current.map((node) =>
            childIds.includes(node.id)
                ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } }
                : node.id === nodeId && isConfigNode
                  ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } }
                  : node.id === nodeId && !editingTextNode
                    ? { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Generated Text", metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } }
                    : node,
        ),
    );
}
