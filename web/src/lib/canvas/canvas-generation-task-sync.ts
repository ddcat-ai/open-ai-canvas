import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { storeGeneratedAudio } from "@/services/api/audio";
import { storeGeneratedVideo } from "@/services/api/video";
import type { GenerationTask } from "@/services/api/task-center";
import { resolveMediaUrl, type UploadedFile } from "@/services/file-storage";
import { resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

type BackendGenerationResult = {
    mode?: CanvasGenerationMode;
    images?: Array<{ dataUrl: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string }>;
    video?: { dataUrl: string; storageKey?: string; width?: number; height?: number; durationMs?: number; bytes?: number; mimeType?: string };
    audio?: { dataUrl: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; format?: string };
    text?: string;
};

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;

export function parseBackendGenerationResult(task: GenerationTask): BackendGenerationResult {
    if (!task.resultJson) throw new Error("后端任务没有返回结果");
    const result = JSON.parse(task.resultJson) as BackendGenerationResult;
    if (!result || typeof result !== "object") throw new Error("后端任务结果格式错误");
    return result;
}

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

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs, errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined };
}

export async function buildGenerationTaskNodeResult(node: CanvasNodeData, task: GenerationTask): Promise<CanvasNodeData> {
    const mode = generationTaskMode(task, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image");
    const prompt = node.metadata?.prompt || task.prompt;
    const result = parseBackendGenerationResult(task);

    if (mode === "image") {
        const image = result.images?.[0];
        if (!image?.dataUrl) throw new Error("后端任务没有返回图片");
        const uploaded = image.storageKey
            ? { url: await resolveImageUrl(image.storageKey, image.dataUrl), storageKey: image.storageKey, width: image.width || 1024, height: image.height || 1024, bytes: image.bytes || 0, mimeType: image.mimeType || "image/png" }
            : await uploadImage(image.dataUrl);
        const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const imageSize = fitNodeSize(uploaded.width, uploaded.height, node.width || imageConfig.width, node.height || imageConfig.height);
        return {
            ...node,
            type: CanvasNodeType.Image,
            width: imageSize.width,
            height: imageSize.height,
            position: { x: node.position.x + node.width / 2 - imageSize.width / 2, y: node.position.y + node.height / 2 - imageSize.height / 2 },
            metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt, ...completedTaskMetadata(task), errorDetails: undefined },
        };
    }

    if (mode === "video") {
        if (!result.video?.dataUrl) throw new Error("后端任务没有返回视频");
        const video = result.video.storageKey
            ? { url: await resolveMediaUrl(result.video.storageKey, result.video.dataUrl), storageKey: result.video.storageKey, width: result.video.width, height: result.video.height, durationMs: result.video.durationMs, bytes: result.video.bytes || 0, mimeType: result.video.mimeType || "video/mp4" }
            : await storeGeneratedVideo({ url: result.video.dataUrl, mimeType: result.video.mimeType || "video/mp4" });
        const videoSize = fitNodeSize(video.width || node.width || VIDEO_NODE_MAX_WIDTH, video.height || node.height || VIDEO_NODE_MAX_HEIGHT, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        return {
            ...node,
            type: CanvasNodeType.Video,
            width: videoSize.width,
            height: videoSize.height,
            position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
            metadata: { ...node.metadata, ...videoMetadata(video), prompt, ...completedTaskMetadata(task), errorDetails: undefined },
        };
    }

    if (mode === "audio") {
        if (!result.audio?.dataUrl) throw new Error("后端任务没有返回音频");
        const audio = result.audio.storageKey
            ? { url: await resolveMediaUrl(result.audio.storageKey, result.audio.dataUrl), storageKey: result.audio.storageKey, durationMs: result.audio.durationMs, bytes: result.audio.bytes || 0, mimeType: result.audio.mimeType || "audio/mpeg" }
            : await storeGeneratedAudio(await (await fetch(result.audio.dataUrl)).blob(), result.audio.format || "mp3");
        return { ...node, type: CanvasNodeType.Audio, metadata: { ...node.metadata, ...audioMetadata(audio), prompt, ...completedTaskMetadata(task), errorDetails: undefined } };
    }

    if (!result.text) throw new Error("后端任务没有返回文本");
    return { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: result.text, prompt, ...completedTaskMetadata(task), status: "success", errorDetails: undefined, generationErrorCode: undefined, failedPromptFingerprint: undefined } };
}

export async function applyGenerationTaskResultToNodes(nodes: CanvasNodeData[], task: GenerationTask, targetNodeId?: string) {
    const node = findGenerationTaskNode(nodes, task, targetNodeId);
    if (!node) return { nodes, updated: false, nodeId: "", node: null };
    const updatedNode = await buildGenerationTaskNodeResult(node, task);
    return {
        nodes: nodes.map((item) => (item.id === node.id ? updatedNode : item)),
        updated: true,
        nodeId: node.id,
        node: updatedNode,
    };
}

export async function syncGenerationTaskToCanvasStore(task: GenerationTask) {
    if (task.status !== "succeeded" || !task.projectId) return false;
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === task.projectId);
    if (!project) return false;
    const node = findGenerationTaskNode(project.nodes, task);
    if (!node) return false;
    if (node.metadata?.taskId === task.id && node.metadata.status === "success" && node.metadata.content) return false;
    const updatedNode = await buildGenerationTaskNodeResult(node, task);
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
        taskCreatedAt: task.createdAt || task.created_at,
        taskUpdatedAt: task.updatedAt || task.updated_at,
        errorDetails: undefined,
        generationErrorCode: undefined,
        failedPromptFingerprint: undefined,
    };
}
