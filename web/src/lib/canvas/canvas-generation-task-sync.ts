import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize, nodeSizeFromRatio, VIDEO_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import { compositeEmotionImage } from "@/lib/canvas/canvas-emotion";
import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask, GenerationTaskOutput } from "@/services/api/task-center";
import { resolveMediaUrl, type UploadedFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { applyGenerationConsumerEffect, generationEffectApplied } from "@/services/generation-consumer-dedupe";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export function generationTaskInput(task: GenerationTask) {
    if (!task.inputJson) return null;
    try {
        return JSON.parse(task.inputJson) as { mode?: CanvasGenerationMode; metadata?: { nodeId?: string; sourceNodeId?: string }; prompt?: string };
    } catch {
        return null;
    }
}

export function generationTaskNodeId(task: GenerationTask) {
    return generationTaskInput(task)?.metadata?.nodeId || "";
}

export function generationTaskMode(task: GenerationTask, fallback?: CanvasGenerationMode): CanvasGenerationMode {
    const inputMode = generationTaskInput(task)?.mode;
    if (inputMode === "text" || inputMode === "image" || inputMode === "video" || inputMode === "audio") return inputMode;
    if (task.type === "canvas_text") return "text";
    if (task.type === "canvas_video") return "video";
    if (task.type === "canvas_audio") return "audio";
    if (task.type === "canvas_image") return "image";
    return fallback || "image";
}

export function generationTaskCanReloadResource(task: GenerationTask) {
    const mode = generationTaskMode(task);
    return task.status === "succeeded" && (mode === "image" || mode === "video" || mode === "audio") && (Boolean(task.resultJson) || Boolean(task.outputs?.length));
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return {
        content: image.url,
        storageKey: image.storageKey,
        status: "success",
        naturalWidth: image.width,
        naturalHeight: image.height,
        bytes: image.bytes,
        mimeType: image.mimeType,
        errorDetails: undefined,
        generationErrorCode: undefined,
        resourceReloadAvailable: undefined,
        failedPromptFingerprint: undefined,
    };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return {
        content: video.url,
        storageKey: video.storageKey,
        status: "success",
        naturalWidth: video.width,
        naturalHeight: video.height,
        bytes: video.bytes,
        mimeType: video.mimeType || "video/mp4",
        durationMs: video.durationMs,
        errorDetails: undefined,
        generationErrorCode: undefined,
        resourceReloadAvailable: undefined,
        failedPromptFingerprint: undefined,
    };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return {
        content: audio.url,
        storageKey: audio.storageKey,
        status: "success",
        bytes: audio.bytes,
        mimeType: audio.mimeType || "audio/mpeg",
        durationMs: audio.durationMs,
        errorDetails: undefined,
        generationErrorCode: undefined,
        resourceReloadAvailable: undefined,
        failedPromptFingerprint: undefined,
    };
}

function workflowMetadataForResultNode(): Partial<CanvasNodeMetadata> {
    return {
        workflowProvider: undefined,
        runningHubWorkflowId: undefined,
        runningHubWorkflowKind: undefined,
        comfyBridgeWorkflowId: undefined,
        workflowParameters: undefined,
    };
}

export async function buildGenerationTaskNodeResult(node: CanvasNodeData, task: GenerationTask, nodes: CanvasNodeData[] = [node]): Promise<CanvasNodeData> {
    const mode = generationTaskMode(task, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image");
    const prompt = node.metadata?.prompt || task.prompt;
    const result = parseBackendGenerationResult(task);

    if (mode === "image") {
        const image = result.images?.[0];
        if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
        let resultDataUrl = image.dataUrl;
        const emotionEdit = node.metadata?.emotionEdit;
        if (emotionEdit) {
            if (!emotionEdit.editRegion) throw new Error("情绪编辑任务缺少局部合成区域，已拒绝使用整图重绘结果");
            const sourceNode = nodes.find((item) => item.id === emotionEdit.sourceNodeId);
            if (!sourceNode?.metadata?.content) throw new Error("情绪编辑源图片已删除，无法恢复局部合成结果");
            const sourceDataUrl = await resolveImageUrl(sourceNode.metadata.storageKey, sourceNode.metadata.content);
            if (!sourceDataUrl) throw new Error("无法读取情绪编辑源图片，未使用整图重绘结果");
            resultDataUrl = await compositeEmotionImage(sourceDataUrl, image.dataUrl, emotionEdit.editRegion, emotionEdit.faceBox);
        }
        const uploaded =
            image.storageKey && !emotionEdit
                ? { url: await resolveImageUrl(image.storageKey, image.dataUrl), storageKey: image.storageKey, width: image.width || 1024, height: image.height || 1024, bytes: image.bytes || 0, mimeType: image.mimeType || "image/png" }
                : await uploadImage(resultDataUrl);
        const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const requestedImageSize = nodeSizeFromRatio(node.metadata?.size || "auto", imageConfig.width, imageConfig.height);
        const imageSizeBounds = requestedImageSize || { width: node.width || imageConfig.width, height: node.height || imageConfig.height };
        const hasReportedImageSize = Boolean(image.width && image.width > 0 && image.height && image.height > 0);
        const resultWidth = image.storageKey && !hasReportedImageSize && requestedImageSize ? requestedImageSize.width : uploaded.width;
        const resultHeight = image.storageKey && !hasReportedImageSize && requestedImageSize ? requestedImageSize.height : uploaded.height;
        const normalizedImage = resultWidth === uploaded.width && resultHeight === uploaded.height ? uploaded : { ...uploaded, width: resultWidth, height: resultHeight };
        const imageSize =
            node.metadata?.generationType === "edit" && !requestedImageSize ? { width: node.width || imageConfig.width, height: node.height || imageConfig.height } : fitNodeSize(resultWidth, resultHeight, imageSizeBounds.width, imageSizeBounds.height);
        return {
            ...node,
            type: CanvasNodeType.Image,
            width: imageSize.width,
            height: imageSize.height,
            position: { x: node.position.x + node.width / 2 - imageSize.width / 2, y: node.position.y + node.height / 2 - imageSize.height / 2 },
            metadata: { ...node.metadata, ...workflowMetadataForResultNode(), ...imageMetadata(normalizedImage), prompt, ...completedTaskMetadata(task), errorDetails: undefined },
        };
    }

    if (mode === "video") {
        if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
        const video = result.video.storageKey
            ? {
                  url: await resolveMediaUrl(result.video.storageKey, result.video.dataUrl),
                  storageKey: result.video.storageKey,
                  width: result.video.width,
                  height: result.video.height,
                  durationMs: result.video.durationMs,
                  bytes: result.video.bytes || 0,
                  mimeType: result.video.mimeType || "video/mp4",
              }
            : await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
        const videoSize = fitNodeSize(video.width || node.width || VIDEO_NODE_MAX_SIZE.width, video.height || node.height || VIDEO_NODE_MAX_SIZE.height, VIDEO_NODE_MAX_SIZE.width, VIDEO_NODE_MAX_SIZE.height);
        const geometry = node.metadata?.locked
            ? {}
            : {
                  width: videoSize.width,
                  height: videoSize.height,
                  position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
              };
        return {
            ...node,
            type: CanvasNodeType.Video,
            ...geometry,
            metadata: { ...node.metadata, ...workflowMetadataForResultNode(), ...videoMetadata(video), prompt, ...completedTaskMetadata(task), errorDetails: undefined },
        };
    }

    if (mode === "audio") {
        if (!result.audio?.dataUrl) throw new Error("后端任务没有返回音频");
        const audio = result.audio.storageKey
            ? { url: await resolveMediaUrl(result.audio.storageKey, result.audio.dataUrl), storageKey: result.audio.storageKey, durationMs: result.audio.durationMs, bytes: result.audio.bytes || 0, mimeType: result.audio.mimeType || "audio/mpeg" }
            : await storeGeneratedAudio(await (await fetch(result.audio.dataUrl)).blob(), result.audio.format || "mp3");
        return { ...node, type: CanvasNodeType.Audio, metadata: { ...node.metadata, ...workflowMetadataForResultNode(), ...audioMetadata(audio), prompt, ...completedTaskMetadata(task), errorDetails: undefined } };
    }

    if (!result.text) throw new Error("后端任务没有返回文本");
    return {
        ...node,
        type: CanvasNodeType.Text,
        metadata: { ...node.metadata, content: result.text, richText: undefined, prompt, ...completedTaskMetadata(task), status: "success", errorDetails: undefined, generationErrorCode: undefined, resourceReloadAvailable: undefined, failedPromptFingerprint: undefined },
    };
}

export async function applyGenerationTaskResultToNodes(nodes: CanvasNodeData[], task: GenerationTask, targetNodeId?: string) {
    const node = findGenerationTaskNode(nodes, task, targetNodeId);
    if (!node) return { nodes, updated: false, nodeId: "", node: null };
    const updatedNode = await buildGenerationTaskNodeResult(node, task, nodes);
    return {
        nodes: applySuccessfulVersionSelection(nodes, updatedNode),
        updated: true,
        nodeId: node.id,
        node: updatedNode,
    };
}

export async function applyMaterializedGenerationTaskResultToNodes(nodes: CanvasNodeData[], task: GenerationTask, output: GenerationTaskOutput, effectKey: string, targetNodeId?: string) {
    const node = findGenerationTaskNode(nodes, task, targetNodeId);
    if (!node) return { nodes, updated: false, nodeId: "", node: null };
    if (generationEffectApplied(node.metadata || {}, effectKey)) {
        return { nodes, updated: true, nodeId: node.id, node };
    }
    const asset = useAssetStore.getState().assets.find((candidate) => candidate.id === output.materializedAssetId);
    if (!asset) throw new Error("生成任务输出素材不存在");
    const result = parseBackendGenerationResult(task);
    if (asset.kind === "image") {
        const images = [...(result.images || [])];
        images[output.outputIndex] = {
            dataUrl: asset.data.dataUrl || asset.coverUrl,
            storageKey: asset.data.storageKey,
            width: asset.data.width,
            height: asset.data.height,
            bytes: asset.data.bytes,
            mimeType: asset.data.mimeType,
        };
        result.images = images;
    } else if (asset.kind === "video") {
        result.video = { dataUrl: asset.data.url, ...asset.data };
    } else if (asset.kind === "audio") {
        result.audio = { dataUrl: asset.data.url, ...asset.data };
    } else {
        throw new Error("生成任务输出素材类型不支持画布节点");
    }
    const updatedNode = await buildGenerationTaskNodeResult(node, { ...task, resultJson: JSON.stringify(result) }, nodes);
    const durableNode = {
        ...updatedNode,
        metadata: applyGenerationConsumerEffect({ ...updatedNode.metadata, assetId: asset.id }, effectKey, (metadata) => metadata).value,
    };
    return {
        nodes: applySuccessfulVersionSelection(nodes, durableNode),
        updated: true,
        nodeId: node.id,
        node: durableNode,
    };
}

function applySuccessfulVersionSelection(nodes: CanvasNodeData[], updatedNode: CanvasNodeData) {
    const versionRootId = updatedNode.metadata?.versionOfNodeId;
    return nodes.map((item) => {
        if (item.id === updatedNode.id) {
            return versionRootId ? { ...updatedNode, metadata: { ...updatedNode.metadata, versionPrimary: true } } : updatedNode;
        }
        if (!versionRootId || (item.metadata?.versionOfNodeId || item.id) !== versionRootId) return item;
        return { ...item, metadata: { ...item.metadata, versionPrimary: false } };
    });
}

export async function syncGenerationTaskToCanvasStore(task: GenerationTask) {
    if (task.status !== "succeeded" || !task.projectId) return false;
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === task.projectId);
    if (!project) return false;
    const node = findGenerationTaskNode(project.nodes, task);
    if (!node) return false;
    if (node.metadata?.taskId === task.id && node.metadata.status === "success" && node.metadata.content) return false;
    const updatedNode = await buildGenerationTaskNodeResult(node, task, project.nodes);
    const latest = useCanvasStore.getState().projects.find((item) => item.id === project.id);
    if (!latest?.nodes.some((item) => item.id === node.id)) return false;
    useCanvasStore.getState().updateProject(project.id, { nodes: latest.nodes.map((item) => (item.id === node.id ? updatedNode : item)) });
    return true;
}

function findGenerationTaskNode(nodes: CanvasNodeData[], task: GenerationTask, targetNodeId?: string) {
    const nodeId = targetNodeId || generationTaskNodeId(task);
    return nodes.find((node) => node.id === nodeId || node.metadata?.taskId === task.id);
}

function completedTaskMetadata(task: GenerationTask): CanvasNodeMetadata {
    return {
        taskId: task.id,
        taskStatus: task.status,
        taskProgress: typeof task.progress === "number" && Number.isFinite(task.progress) ? Math.max(0, Math.min(100, Math.round(task.progress))) : 100,
        taskStage: task.stage,
        taskStartedAt: task.startedAt,
        taskCompletedAt: task.completedAt,
        taskDurationMs: task.startedAt && task.completedAt ? Math.max(0, Date.parse(task.completedAt) - Date.parse(task.startedAt)) : undefined,
        taskCreatedAt: task.createdAt || task.created_at,
        taskUpdatedAt: task.updatedAt || task.updated_at,
        errorDetails: undefined,
        generationErrorCode: undefined,
        failedPromptFingerprint: undefined,
    };
}
