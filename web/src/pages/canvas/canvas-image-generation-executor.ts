import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { canGenerateImageInPlace, findAvailableGenerationGroupPosition, imageGenerationChildPosition, imageGenerationGroupSize } from "@/lib/canvas/canvas-generation-layout";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { canvasImageReferenceLimitError, buildImageGenerationMetadata, getGenerationCount, isGenerationCanceled, runCanvasGenerationTaskToConsumer } from "@/lib/canvas/canvas-project-generation";
import { CONTENT_MODERATION_ERROR_CODE, generationFailureMetadata, type GenerationFailureMetadata } from "@/lib/generation-error";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { CanvasGenerationExecution } from "./canvas-generation-executor-types";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const NODE_STATUS_IDLE = "idle" as const;

export async function executeImageGeneration({
    nodeId,
    sourceNode,
    canvasNodes,
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
    applyGenerationTaskResult,
    styleMetadata,
    taskContext,
    retryContext,
    showError,
    registerPendingNodeIds,
}: CanvasGenerationExecution) {
    const referenceLimitError = canvasImageReferenceLimitError(generationConfig, generationContext.referenceImages);
    if (referenceLimitError) {
        showError(referenceLimitError);
        return;
    }
    const count = getGenerationCount(generationConfig.count);
    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
    const reuseSourceNode = canGenerateImageInPlace(sourceNode);
    const directCopiedBatch = count > 1 && isImageNode && Boolean(sourceNode?.metadata?.content) && (Boolean(sourceNode?.metadata?.copiedFromNodeId) || sourceNode?.title.endsWith(" Copy"));
    // 已有图片生成新结果并保留旧版本；参考图只来自入边，避免把旧结果误当成自身输入。
    const referenceImages = generationContext.referenceImages;
    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
    const imageDefaults = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    // 生成中占位框按设置比例显示，避免 16:9 任务显示成默认 340x240。
    const requestedImageSize = nodeSizeFromRatio(generationConfig.size || "auto", imageDefaults.width, imageDefaults.height);
    const imageConfig = requestedImageSize || imageDefaults;
    // auto 图生图沿用来源节点尺寸；用户明确选择比例时必须以目标比例创建节点。
    const referenceNode = referenceImages.length === 1 ? canvasNodes.find((node) => node.id === referenceImages[0].id && node.type === CanvasNodeType.Image) : undefined;
    const imageSizeSource = requestedImageSize ? undefined : isImageNode && sourceNode?.metadata?.content ? sourceNode : referenceNode;
    const outputNodeSize = imageSizeSource ? { width: imageSizeSource.width, height: imageSizeSource.height } : imageConfig;
    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
    const parentWidth = sourceNode?.width || parentConfig.width;
    const parentHeight = sourceNode?.height || parentConfig.height;
    const rootId = reuseSourceNode || directCopiedBatch ? nodeId : nanoid();
    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
    const targetIds = count > 1 ? childIds : [rootId];
    registerPendingNodeIds(reuseSourceNode || directCopiedBatch ? childIds : [rootId, ...childIds]);
    const rootWidth = outputNodeSize.width;
    const rootHeight = outputNodeSize.height;
    const preferredPosition = {
        x: parentPosition.x + parentWidth + 96,
        y: parentPosition.y + parentHeight / 2 - rootHeight / 2,
    };
    const rootPosition = reuseSourceNode ? parentPosition : findAvailableGenerationGroupPosition(canvasNodes, preferredPosition, imageGenerationGroupSize({ width: rootWidth, height: rootHeight }, outputNodeSize, childIds.length));

    const rootNode: CanvasNodeData = {
        id: rootId,
        type: CanvasNodeType.Image,
        title: effectivePrompt.slice(0, 32) || "Generated Image",
        position: rootPosition,
        width: rootWidth,
        height: rootHeight,
        metadata: {
            prompt: effectivePrompt,
            status: NODE_STATUS_LOADING,
            size: generationConfig.size,
            isBatchRoot: count > 1,
            batchChildIds: count > 1 ? childIds : undefined,
            batchFailedCount: count > 1 ? 0 : undefined,
            batchUsesReferenceImages: referenceImages.length > 0,
            primaryImageId: undefined,
            ...generationMetadata,
            ...styleMetadata,
            imageBatchExpanded: count > 1 ? true : undefined,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
        },
    };
    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
        id,
        type: CanvasNodeType.Image,
        title: effectivePrompt.slice(0, 32) || "Generated Image",
        position: imageGenerationChildPosition(rootNode.position, rootNode.width, outputNodeSize, index),
        width: outputNodeSize.width,
        height: outputNodeSize.height,
        metadata: {
            prompt: effectivePrompt,
            status: NODE_STATUS_LOADING,
            size: generationConfig.size,
            batchRootId: count > 1 && !directCopiedBatch ? rootId : undefined,
            ...generationMetadata,
            ...styleMetadata,
            generationErrorCode: undefined,
            resourceReloadAvailable: undefined,
            failedPromptFingerprint: undefined,
        },
    }));
    const batchConnections = directCopiedBatch
        ? childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))
        : [...(reuseSourceNode ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

    setNodes((current) => {
        return [
            ...current.map((node) => {
                if (node.id !== nodeId) return node;
                if (isConfigNode) return { ...node, metadata: { ...node.metadata, prompt: effectivePrompt, status: NODE_STATUS_LOADING, errorDetails: undefined } };
                if (reuseSourceNode) return { ...node, position: rootNode.position, width: rootNode.width, height: rootNode.height, title: rootNode.title, metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined } };
                if (isImageNode) return node;
                return {
                    ...node,
                    type: CanvasNodeType.Text,
                    title: prompt.slice(0, 32) || "Prompt",
                    width: parentConfig.width,
                    height: parentConfig.height,
                    metadata: { ...node.metadata, content: prompt, richText: undefined, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                };
            }),
            ...(reuseSourceNode || directCopiedBatch ? [] : [rootNode]),
            ...childNodes,
        ];
    });
    setConnections((current) => [...current, ...batchConnections]);
    setSelectedNodeIds(new Set([nodeId]));
    setSelectedConnectionId(null);
    setDialogNodeId(nodeId);

    targetIds.forEach((targetId) => startGenerationRequest(targetId, nodeId, nodeId, controller));
    if (count > 1 && !directCopiedBatch) startGenerationRequest(rootId, nodeId, nodeId, controller);
    let hasSuccess = false;
    let hasFailure = false;
    let failureCount = 0;
    let representativeFailure: GenerationFailureMetadata | undefined;
    await Promise.all(
        targetIds.map(async (targetId) => {
            try {
                await runCanvasGenerationTaskToConsumer(
                    {
                        projectId,
                        nodeId: targetId,
                        ...retryContext,
                        mode: "image",
                        prompt: effectivePrompt,
                        config: { ...generationConfig, count: "1" },
                        referenceImages,
                        signal: controller.signal,
                        metadata: {
                            sourceNodeId: nodeId,
                            ...taskContext,
                            resolvedCharacterVersions: generationContext.resolvedCharacterVersions,
                            promptTemplateOperation: sourceNode?.metadata?.promptTemplateOperation,
                            promptTemplateVariables: sourceNode?.metadata?.promptTemplateVariables,
                            ...styleMetadata,
                        },
                    },
                    {
                        bindTask: (task) => bindGenerationTask(targetId, task),
                        consumeTask: (task) => applyGenerationTaskResult(targetId, task),
                    },
                );
                if (targetId !== rootId && !directCopiedBatch) {
                    setNodes((current) => {
                        const child = current.find((node) => node.id === targetId);
                        const root = current.find((node) => node.id === rootId);
                        if (!child?.metadata?.content || !root || root.metadata?.primaryImageId) return current;
                        const center = { x: root.position.x + root.width / 2, y: root.position.y + root.height / 2 };
                        const geometry = root.metadata?.locked
                            ? {}
                            : {
                                  width: child.width,
                                  height: child.height,
                                  position: { x: center.x - child.width / 2, y: center.y - child.height / 2 },
                              };
                        return current.map((node) =>
                            node.id === rootId
                                ? {
                                      ...node,
                                      ...geometry,
                                      metadata: {
                                          ...node.metadata,
                                          content: child.metadata?.content,
                                          storageKey: child.metadata?.storageKey,
                                          mimeType: child.metadata?.mimeType,
                                          bytes: child.metadata?.bytes,
                                          naturalWidth: child.metadata?.naturalWidth,
                                          naturalHeight: child.metadata?.naturalHeight,
                                          assetId: child.metadata?.assetId,
                                          primaryImageId: targetId,
                                          status: NODE_STATUS_SUCCESS,
                                      },
                                  }
                                : node,
                        );
                    });
                }
                hasSuccess = true;
                if (isConfigNode) setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                return true;
            } catch (error) {
                if (isGenerationCanceled(error)) return false;
                const failure = generationFailureMetadata(error, prompt);
                if (!representativeFailure || failure.generationErrorCode === CONTENT_MODERATION_ERROR_CODE) representativeFailure = failure;
                hasFailure = true;
                failureCount += 1;
                setNodes((current) => current.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, ...failure } } : node)));
                return false;
            } finally {
                finishGenerationRequest(targetId, controller);
            }
        }),
    );
    if (count > 1 && !directCopiedBatch) finishGenerationRequest(rootId, controller);
    if (controller.signal.aborted) {
        setNodes((current) => current.map((node) => (node.id === nodeId && isConfigNode && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
        return;
    }
    if (hasFailure) showError(hasSuccess ? "部分图片生成失败" : "全部图片生成失败");
    setNodes((current) =>
        current.map((node) => {
            if (node.id === nodeId && isConfigNode) {
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                        ...(hasSuccess ? { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } : representativeFailure || { errorDetails: "全部图片生成失败" }),
                    },
                };
            }
            if (node.id === rootId && (reuseSourceNode || !directCopiedBatch)) {
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR,
                        batchFailedCount: count > 1 ? failureCount : undefined,
                        ...(hasSuccess ? { errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } : representativeFailure || { errorDetails: "全部图片生成失败" }),
                    },
                };
            }
            return node;
        }),
    );
}
