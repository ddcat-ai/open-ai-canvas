import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { isResourceUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export type BackendGenerationMode = "text" | "image" | "video" | "audio";

export type BackendGenerationResult = {
    mode?: BackendGenerationMode;
    images?: Array<{ dataUrl: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string }>;
    video?: { dataUrl: string; storageKey?: string; width?: number; height?: number; durationMs?: number; bytes?: number; mimeType?: string };
    audio?: { dataUrl: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; format?: string };
    text?: string;
};

type BackendGenerationTaskOptions = {
    projectId?: string;
    mode: BackendGenerationMode;
    prompt: string;
    config: AiConfig;
    referenceImages?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
    mask?: ReferenceImage;
    signal?: AbortSignal;
    metadata?: Record<string, unknown>;
    onTaskUpdate?: (task: GenerationTask) => void;
};

type PreparedGenerationReferences = {
    referenceImages: Awaited<ReturnType<typeof prepareBackendImageReference>>[];
    referenceVideos: Awaited<ReturnType<typeof prepareBackendMediaReference>>[];
    referenceAudios: Awaited<ReturnType<typeof prepareBackendMediaReference>>[];
    mask?: Awaited<ReturnType<typeof prepareBackendImageReference>>;
};

// 生成、计费、取消和任务记录必须共用后端任务生命周期，页面层不能再直连供应商。
export async function runBackendGenerationTask({
    projectId,
    mode,
    prompt,
    config,
    referenceImages = [],
    referenceVideos = [],
    referenceAudios = [],
    mask,
    signal,
    metadata,
    onTaskUpdate,
}: BackendGenerationTaskOptions) {
    throwIfAborted(signal);
    const prepared = await prepareGenerationReferences({ referenceImages, referenceVideos, referenceAudios, mask });
    throwIfAborted(signal);
    return createAndWaitGenerationTask({ projectId, mode, prompt, config, referenceImages, referenceVideos, signal, metadata, onTaskUpdate }, prepared);
}

export async function runBackendGenerationTaskBatch(options: BackendGenerationTaskOptions & { count: number }) {
    const count = Math.max(1, Math.min(15, Math.floor(Number(options.count)) || 1));
    throwIfAborted(options.signal);
    const prepared = await prepareGenerationReferences(options);
    throwIfAborted(options.signal);
    return Promise.allSettled(Array.from({ length: count }, (_, batchIndex) => createAndWaitGenerationTask({
        ...options,
        metadata: { ...options.metadata, batchIndex, batchCount: count },
    }, prepared)));
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function prepareGenerationReferences({ referenceImages = [], referenceVideos = [], referenceAudios = [], mask }: Pick<BackendGenerationTaskOptions, "referenceImages" | "referenceVideos" | "referenceAudios" | "mask">): Promise<PreparedGenerationReferences> {
    const preparedImages = await Promise.all(referenceImages.map(prepareBackendImageReference));
    const preparedVideos = await Promise.all(referenceVideos.map(prepareBackendMediaReference));
    const preparedAudios = await Promise.all(referenceAudios.map(prepareBackendMediaReference));
    const preparedMask = mask ? await prepareBackendImageReference(mask) : undefined;
    return { referenceImages: preparedImages, referenceVideos: preparedVideos, referenceAudios: preparedAudios, mask: preparedMask };
}

async function createAndWaitGenerationTask({ projectId, mode, prompt, config, referenceImages = [], signal, metadata, onTaskUpdate }: BackendGenerationTaskOptions, prepared: PreparedGenerationReferences) {
    const videoOperation = String(metadata?.videoEditOperation || (referenceImages.length ? "image_to_video" : "text_to_video"));
    const task = await createGenerationTask({
        ...(projectId ? { projectId } : {}),
        type: `canvas_${mode}`,
        operation: mode === "video" ? videoOperation : mode,
        prompt,
        model: config.model,
        input: {
            mode,
            prompt,
            config: backendProviderConfig(config),
            referenceImages: prepared.referenceImages,
            referenceVideos: prepared.referenceVideos,
            referenceAudios: prepared.referenceAudios,
            mask: prepared.mask,
            metadata,
        },
    });
    onTaskUpdate?.(task);
    const completed = await waitForGenerationTask(task.id, { signal, initialTask: task, onTaskUpdate });
    return parseBackendGenerationResult(completed);
}

/** 从 url / storageKey 恢复 resource id（兼容 /api/resources/{id}/file 相对路径）。 */
function resourceIdFromMediaRef(media: { storageKey?: string; url?: string }) {
    const fromKey = resourceIdFromStorageKey(media.storageKey);
    if (fromKey) return fromKey;
    const url = String(media.url || "").trim();
    if (!url) return "";
    const match = url.match(/\/resources\/([^/?#]+)\/file/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function mediaKindLabel(media: ReferenceVideo | ReferenceAudio) {
    if (media.type?.startsWith("video/") || ("width" in media && "height" in media)) return "参考视频";
    if (media.type?.startsWith("audio/")) return "参考音频";
    return "参考媒体";
}

async function prepareBackendMediaReference(media: ReferenceVideo | ReferenceAudio) {
    // 1) 已是后端资源：只传 storageKey，由服务端 hydrate（local-h3 会读成 data URL 再 multipart）
    const resourceId = resourceIdFromMediaRef(media);
    if (resourceId) {
        return backendMediaReference(media, { storageKey: resourceStorageKey(resourceId) });
    }

    const url = String(media.url || "").trim();
    // 2) 公网 http(s)（排除本站 resource 代理，已在上面处理）
    if (/^https?:\/\//i.test(url) && !isResourceUrl(url) && !url.includes("/resources/")) {
        return backendMediaReference(media, { url });
    }

    // 3) 本地 blob / data / localforage key → 读出后上传为 resource
    let blob: Blob | null = null;
    if (media.storageKey) {
        blob = await getMediaBlob(media.storageKey);
    }
    if (!blob && (url.startsWith("blob:") || url.startsWith("data:"))) {
        try {
            blob = await (await fetch(url)).blob();
        } catch {
            blob = null;
        }
    }
    // local key 可能只在 resolveMediaUrl 里能重建 object URL
    if (!blob && media.storageKey) {
        const resolved = await resolveMediaUrl(media.storageKey, "");
        if (resolved) {
            try {
                blob = await (await fetch(resolved)).blob();
            } catch {
                blob = null;
            }
        }
    }
    if (!blob) {
        throw new Error(`${mediaKindLabel(media)}尚未保存，请重新上传后再生成`);
    }
    try {
        const kind: "video" | "audio" | "file" = blob.type.startsWith("video/") || media.type?.startsWith("video/")
            ? "video"
            : blob.type.startsWith("audio/") || media.type?.startsWith("audio/")
              ? "audio"
              : "file";
        const resource = await uploadResourceFile(blob, kind, {
            fileName: media.name,
            width: "width" in media ? media.width : undefined,
            height: "height" in media ? media.height : undefined,
            durationMs: media.durationMs,
        });
        return backendMediaReference(media, {
            storageKey: resourceStorageKey(resource.id),
            type: resource.mimeType || media.type || blob.type,
        });
    } catch (error) {
        throw new Error(error instanceof Error ? `${mediaKindLabel(media)}上传失败：${error.message}` : `${mediaKindLabel(media)}上传失败`);
    }
}

async function prepareBackendImageReference(image: ReferenceImage) {
    if (resourceIdFromStorageKey(image.storageKey)) return backendImageReference(image, { storageKey: image.storageKey });
    const sourceUrl = image.url || image.dataUrl;
    if (/^https?:\/\//i.test(sourceUrl)) return backendImageReference(image, { url: sourceUrl });
    const blob = image.storageKey ? await getImageBlob(image.storageKey) : sourceUrl ? await (await fetch(sourceUrl)).blob() : null;
    if (!blob) throw new Error("参考图片尚未保存，请重新上传后再生成");
    try {
        const resource = await uploadResourceFile(blob, "image", { fileName: image.name });
        return backendImageReference(image, { storageKey: resourceStorageKey(resource.id), type: resource.mimeType || image.type || blob.type });
    } catch (error) {
        throw new Error(error instanceof Error ? `参考图片上传失败：${error.message}` : "参考图片上传失败");
    }
}

// 任务输入只允许后端协议字段，避免把 previewUrl 等页面态 Data URL 带入强校验写路径。
function backendImageReference(image: ReferenceImage, override: Partial<ReferenceImage>): ReferenceImage {
    return {
        id: image.id,
        name: image.name,
        type: override.type || image.type,
        dataUrl: "",
        url: override.url,
        storageKey: override.storageKey,
    };
}

function backendMediaReference<T extends ReferenceVideo | ReferenceAudio>(media: T, override: Partial<T>): T {
    return {
        id: media.id,
        name: media.name,
        type: override.type || media.type,
        url: override.url || "",
        storageKey: override.storageKey,
        ...("bytes" in media && media.bytes ? { bytes: media.bytes } : {}),
        ...("width" in media && media.width ? { width: media.width } : {}),
        ...("height" in media && media.height ? { height: media.height } : {}),
        ...(media.durationMs ? { durationMs: media.durationMs } : {}),
    } as T;
}

export function backendProviderConfig(config: AiConfig) {
    const requestConfig = resolveModelRequestConfig(config, config.model);
    return {
        channelId: requestConfig.channelId,
        apiFormat: requestConfig.apiFormat,
        interfaceType: requestConfig.interfaceType,
        baseUrl: requestConfig.baseUrl,
        apiKey: requestConfig.apiKey,
        secretKey: requestConfig.secretKey,
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
        systemPrompt: "",
    };
}

export function parseBackendGenerationResult(task: GenerationTask): BackendGenerationResult {
    if (!task.resultJson) throw new Error("后端任务没有返回结果");
    const result = JSON.parse(task.resultJson) as BackendGenerationResult;
    if (!result || typeof result !== "object") throw new Error("后端任务结果格式错误");
    return result;
}
