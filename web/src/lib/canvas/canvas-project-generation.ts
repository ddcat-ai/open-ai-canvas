import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { configuredModelMatchesCapability, defaultConfig, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { getImageBlob, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { imageMetadata, parseBackendGenerationResult } from "@/lib/canvas/canvas-generation-task-sync";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoEditOperation } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export async function runBackendCanvasGenerationTask({
    projectId,
    nodeId,
    mode,
    prompt,
    config,
    referenceImages = [],
    referenceVideos = [],
    referenceAudios = [],
    mask,
    signal,
    metadata,
    onTaskCreated,
}: {
    projectId: string;
    nodeId: string;
    mode: CanvasNodeGenerationMode;
    prompt: string;
    config: AiConfig;
    referenceImages?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
    mask?: ReferenceImage;
    signal?: AbortSignal;
    metadata?: Record<string, unknown>;
    onTaskCreated?: (task: GenerationTask) => void;
}) {
    const taskReferenceImages = await Promise.all(referenceImages.map(prepareBackendImageReference));
    const taskReferenceVideos = await Promise.all(referenceVideos.map((video) => mediaToBackendReference(video)));
    const taskReferenceAudios = await Promise.all(referenceAudios.map((audio) => mediaToBackendReference(audio)));
    const taskMask = mask ? await prepareBackendImageReference(mask) : undefined;
    const task = await createGenerationTask({
        projectId,
        type: `canvas_${mode}`,
        operation: mode === "video" ? String(metadata?.videoEditOperation || "image_to_video") : mode,
        prompt,
        model: config.model,
        input: {
            mode,
            prompt,
            config: backendProviderConfig(config),
            referenceImages: taskReferenceImages,
            referenceVideos: taskReferenceVideos,
            referenceAudios: taskReferenceAudios,
            mask: taskMask,
            metadata: { nodeId, ...metadata },
        },
    });
    onTaskCreated?.(task);
    const completed = await waitForGenerationTask(task.id, { signal, initialTask: task, onTaskUpdate: onTaskCreated });
    return parseBackendGenerationResult(completed);
}

async function mediaToBackendReference(media: ReferenceVideo | ReferenceAudio) {
    if (resourceIdFromStorageKey(media.storageKey)) return { ...media, dataUrl: "" };
    const url = media.url || "";
    if (/^https?:\/\//i.test(url)) return media;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && (url.startsWith("blob:") || url.startsWith("data:"))) blob = await (await fetch(url)).blob();
    if (!blob) throw new Error("参考媒体尚未保存，请重新上传后再生成");
    try {
        const kind: "video" | "audio" | "file" = blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
        const resource = await uploadResourceFile(blob, kind, { fileName: media.name, width: "width" in media ? media.width : undefined, height: "height" in media ? media.height : undefined, durationMs: media.durationMs });
        return { ...media, url: resource.publicUrl || `/api/resources/${resource.id}/file`, storageKey: resourceStorageKey(resource.id), dataUrl: "", type: resource.mimeType || media.type || blob.type };
    } catch (error) {
        throw new Error(error instanceof Error ? `参考媒体上传失败：${error.message}` : "参考媒体上传失败");
    }
}

async function prepareBackendImageReference(image: ReferenceImage) {
    if (resourceIdFromStorageKey(image.storageKey)) return { ...image, dataUrl: "" };
    if (/^https?:\/\//i.test(image.dataUrl)) return { ...image, url: image.url || image.dataUrl, dataUrl: "" };
    const blob = image.storageKey ? await getImageBlob(image.storageKey) : image.dataUrl ? await (await fetch(image.dataUrl)).blob() : null;
    if (blob) {
        try {
            const resource = await uploadResourceFile(blob, "image", { fileName: image.name });
            return { ...image, dataUrl: "", url: resource.publicUrl || `/api/resources/${resource.id}/file`, storageKey: resourceStorageKey(resource.id), type: resource.mimeType || image.type || blob.type };
        } catch (error) {
            throw new Error(error instanceof Error ? `参考图片上传失败：${error.message}` : "参考图片上传失败");
        }
    }
    throw new Error("参考图片尚未保存，请重新上传后再生成");
}

export function backendProviderConfig(config: AiConfig) {
    const requestConfig = resolveModelRequestConfig(config, config.model);
    return {
        channelId: requestConfig.channelId,
        apiFormat: requestConfig.apiFormat,
        interfaceType: requestConfig.interfaceType,
        baseUrl: requestConfig.baseUrl,
        apiKey: requestConfig.apiKey,
        model: requestConfig.model,
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count: config.count,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
        systemPrompt: config.systemPrompt,
    };
}

export function generationTaskMetadata(task: GenerationTask): CanvasNodeMetadata {
    const progress = normalizeTaskProgress(task.progress, task.status);
    return {
        taskId: task.id,
        taskStatus: task.status,
        taskProgress: progress,
        taskStage: task.stage,
        taskCreatedAt: task.createdAt || task.created_at,
        taskUpdatedAt: task.updatedAt || task.updated_at,
    };
}

// 失败节点再次提交前必须移除旧任务绑定，否则批次调度会把它误判为仍在处理。
export function resetGenerationTaskMetadata(metadata: CanvasNodeMetadata | undefined, status: CanvasNodeMetadata["status"] = "idle"): CanvasNodeMetadata {
    const next = {
        ...(metadata || {}),
        status,
        errorDetails: undefined,
        generationErrorCode: undefined,
        failedPromptFingerprint: undefined,
    };
    delete next.taskId;
    delete next.taskStatus;
    delete next.taskProgress;
    delete next.taskStage;
    delete next.taskCreatedAt;
    delete next.taskUpdatedAt;
    return next;
}

function normalizeTaskProgress(progress: number | undefined, status: GenerationTask["status"]) {
    if (typeof progress === "number" && Number.isFinite(progress)) return Math.max(0, Math.min(100, Math.round(progress)));
    if (status === "queued") return 0;
    if (status === "succeeded") return 100;
    return undefined;
}


export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function nodeReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `reference-${node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export async function resolveStoredReferenceImages(references?: string[]) {
    if (!references?.length) return [];
    const imageReferences = references.filter(isStoredImageReference);
    const images = await Promise.all(
        imageReferences.map(async (url, index) => {
            const storageKey = url.startsWith("image:") || resourceIdFromStorageKey(url) ? url : undefined;
            const dataUrl = storageKey ? await resolveImageUrl(storageKey, "") : url;
            if (!dataUrl) return null;
            return {
                id: `${index}`,
                name: `reference-${index + 1}.png`,
                type: imageMimeType(dataUrl),
                dataUrl,
                url: /^https?:\/\//i.test(dataUrl) ? dataUrl : undefined,
                storageKey,
            };
        }),
    );
    return images.every(Boolean) ? (images as ReferenceImage[]) : null;
}

function isStoredImageReference(url: string) {
    return resourceIdFromStorageKey(url) || url.startsWith("image:") || url.startsWith("data:image/") || /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(url);
}

function imageMimeType(url: string) {
    return url.match(/^data:(image\/[^;,]+)/)?.[1] || "image/png";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

function resolveVideoEditOperation(
    node: CanvasNodeData | undefined,
    context?: {
        referenceImages: ReferenceImage[];
        referenceVideos: ReferenceVideo[];
        referenceAudios: ReferenceAudio[];
    },
): CanvasVideoEditOperation {
    const storedOperation = node?.metadata?.videoEditOperation;
    // 连接关系是生成时的真实输入，不能让分镜节点残留的文生视频模式丢弃后来连接的参考图。
    if (storedOperation === "text_to_video" && context?.referenceImages.length) return "image_to_video";
    if (storedOperation) return storedOperation;
    if (context?.referenceAudios.length && !context.referenceImages.length && !context.referenceVideos.length) return "audio_to_video";
    if (context?.referenceVideos.length) return "extend";
    if (context?.referenceImages.length) return "image_to_video";
    return "image_to_video";
}

export function buildVideoGenerationMetadata(
    node: CanvasNodeData | undefined,
    context?: {
        referenceImages: ReferenceImage[];
        referenceVideos: ReferenceVideo[];
        referenceAudios: ReferenceAudio[];
    },
): CanvasNodeMetadata {
    const metadata = node?.metadata;
    const startFrame = metadata?.videoStartFrameNodeId && context?.referenceImages.some((image) => image.id === metadata.videoStartFrameNodeId) ? metadata.videoStartFrameNodeId : undefined;
    const endFrame = metadata?.videoEndFrameNodeId && context?.referenceImages.some((image) => image.id === metadata.videoEndFrameNodeId) ? metadata.videoEndFrameNodeId : undefined;
    return {
        videoEditOperation: resolveVideoEditOperation(node, context),
        videoCameraMoveId: metadata?.videoCameraMoveId,
        videoCameraMovePrompt: metadata?.videoCameraMovePrompt,
        videoStartFrameNodeId: startFrame,
        videoEndFrameNodeId: endFrame,
    };
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    return resolveStoredReferenceImages(metadata.references);
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (node) => {
            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content, { cacheMiss: true }) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}


export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const storedModel = node?.metadata?.model;
    const model = storedModel && configuredModelMatchesCapability(config, storedModel, mode) ? storedModel : defaultModel && configuredModelMatchesCapability(config, defaultModel, mode) ? defaultModel : fallbackModel;
    return {
        ...config,
        model,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        transparentBackground: (node?.metadata?.transparentBackground || config.transparentBackground) === "true" ? "true" : "false",
        videoSeconds: normalizeVideoDuration(node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds),
        vquality: normalizeVideoResolution(node?.metadata?.vquality || config.vquality || defaultConfig.vquality),
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    const configHeight = NODE_DEFAULT_SIZE[CanvasNodeType.Config].height;
    return nodes.map((node) => {
        const resizedNode = node.type === CanvasNodeType.Config && node.height < configHeight ? { ...node, height: configHeight } : node.type === CanvasNodeType.Script && node.height < NODE_DEFAULT_SIZE[CanvasNodeType.Script].height ? { ...node, height: NODE_DEFAULT_SIZE[CanvasNodeType.Script].height } : node;
        return resizedNode.metadata?.status === "loading" ? { ...resizedNode, metadata: { ...resizedNode.metadata, errorDetails: "正在从任务中心恢复生成状态..." } } : resizedNode;
    });
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    const reference = node ? nodeReferenceImage(node) : null;
    return reference ? [reference] : [];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}
