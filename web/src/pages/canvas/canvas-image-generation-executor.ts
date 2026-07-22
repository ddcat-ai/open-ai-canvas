import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { prepareInPlaceMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { buildImageGenerationMetadata, getGenerationCount, isGenerationCanceled, runBackendCanvasGenerationTask } from "@/lib/canvas/canvas-project-generation";
import { CONTENT_MODERATION_ERROR_CODE, generationFailureMetadata, type GenerationFailureMetadata } from "@/lib/generation-error";
import { uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const NODE_STATUS_IDLE = "idle" as const;

export async function executeImageGeneration({
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
    setSelectedNodeIds,
    setSelectedConnectionId,
    setDialogNodeId,
    startGenerationRequest,
    finishGenerationRequest,
    bindGenerationTask,
    showError,
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    const count = getGenerationCount(generationConfig.count);
    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
    // 当前图片节点的直接生成是原位重生成；参考图只来自入边，避免把旧结果误当成自身输入。
    const referenceImages = generationContext.referenceImages;
    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
    const rootId = isImageNode ? nodeId : nanoid();
    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
    const targetIds = count > 1 ? childIds : [rootId];
    registerPendingNodeIds(isEmptyImageNode ? childIds : [rootId, ...childIds]);

    const rootNode: CanvasNodeData = {
        id: rootId,
        type: CanvasNodeType.Image,
        title: effectivePrompt.slice(0, 32) || "Generated Image",
        position: isImageNode
            ? parentPosition
            : {
                  x: parentPosition.x + parentConfig.width + 96,
                  y: parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
              },
        width: isImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width,
        height: isImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height,
        metadata: {
            prompt: effectivePrompt,
            status: NODE_STATUS_LOADING,
            isBatchRoot: count > 1,
            batchChildIds: count > 1 ? childIds : undefined,
            batchUsesReferenceImages: referenceImages.length > 0,
            primaryImageId: undefined,
            ...generationMetadata,
            imageBatchExpanded: count > 1 ? true : undefined,
            generationErrorCode: undefined,
            failedPromptFingerprint: undefined,
        },
    };
    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
        id,
        type: CanvasNodeType.Image,
        title: effectivePrompt.slice(0, 32) || "Generated Image",
        position: {
            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + 36),
        },
        width: imageConfig.width,
        height: imageConfig.height,
        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata, generationErrorCode: undefined, failedPromptFingerprint: undefined },
    }));
    const batchConnections = [...(isImageNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

    setNodes((current) => {
        const versioned = isImageNode && !isEmptyImageNode ? prepareInPlaceMediaVersion(current, nodeId) : current;
        return [
        ...versioned.map((node) => {
            if (node.id !== nodeId) return node;
            if (isConfigNode) return { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } };
            if (isEmptyImageNode) return { ...node, position: rootNode.position, width: rootNode.width, height: rootNode.height, title: rootNode.title, metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined } };
            if (isImageNode) return { ...node, title: rootNode.title, metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined } };
            return { ...node, type: CanvasNodeType.Text, title: prompt.slice(0, 32) || "Prompt", width: parentConfig.width, height: parentConfig.height, metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined } };
        }),
        ...(isImageNode ? [] : [rootNode]),
        ...childNodes,
    ];
    });
    setConnections((current) => [...current, ...batchConnections]);
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedConnectionId(null);
    setDialogNodeId(nodeId);

    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
    if (count > 1) startGenerationRequest(rootId, nodeId, nodeId, controller);
    let hasSuccess = false;
    let hasFailure = false;
    let representativeFailure: GenerationFailureMetadata | undefined;
    await Promise.all(
        targetIds.map(async (targetId) => {
            try {
                const result = await runBackendCanvasGenerationTask({ projectId, nodeId: targetId, mode: "image", prompt: effectivePrompt, config: { ...generationConfig, count: "1" }, referenceImages, signal: controller.signal, metadata: { sourceNodeId: nodeId }, onTaskCreated: (task) => bindGenerationTask(targetId, task) });
                const image = result.images?.[0];
                if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
                const uploaded = await uploadImage(image.dataUrl);
                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((current) => {
                    const root = current.find((node) => node.id === rootId);
                    return current.map((node) => {
                        if (node.id !== targetId && node.id !== rootId) return node;
                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                        const geometry = node.metadata?.locked ? {} : { position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 }, width: imageSize.width, height: imageSize.height };
                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId)) return { ...node, ...geometry, metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId } };
                        if (node.id === targetId) return { ...node, ...geometry, metadata: { ...node.metadata, ...imageMetadata(uploaded) } };
                        return node;
                    });
                });
                hasSuccess = true;
                if (isConfigNode) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                return true;
            } catch (error) {
                if (isGenerationCanceled(error)) return false;
                const failure = generationFailureMetadata(error, prompt);
                if (!representativeFailure || failure.generationErrorCode === CONTENT_MODERATION_ERROR_CODE) representativeFailure = failure;
                hasFailure = true;
                setNodes((current) => current.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } } : node)));
                return false;
            } finally {
                finishGenerationRequest(targetId, controller);
            }
        }),
    );
    if (count > 1) finishGenerationRequest(rootId, controller);
    if (controller.signal.aborted) {
        setNodes((current) => current.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
        return;
    }
    if (hasFailure) showError(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
    setNodes((current) =>
        current.map((node) =>
            node.id === nodeId && (isConfigNode || isEmptyImageNode)
                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, ...(hasSuccess ? { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } : representativeFailure || { errorDetails: "全部图片生成失败" }) } }
                : node.id === rootId && !hasSuccess
                  ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...(representativeFailure || { errorDetails: "全部图片生成失败" }) } }
                  : node,
        ),
    );
}
