import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob } from "@/services/image-storage";
import { resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { createGenerationTask, waitForGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { LOCAL_DREAMINA_WAIT_STOPPED_CODE, LocalDreaminaGenerationClientError, runLocalDreaminaGenerationTask, type LocalDreaminaGenerationInput, type LocalDreaminaGenerationTask } from "@/services/local-dreamina-generation";
import { isLocalDreaminaBackgroundTask, localDreaminaTaskId, projectLocalDreaminaTask, stripLocalDreaminaTaskPrefix } from "@/services/local-dreamina-task-projection";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";
import { grokImagePromptLimitError } from "@/lib/grok-image-prompt-limit";
import { resolveVideoOperation } from "@/lib/model-selection";
import { logicalModelIDForConfig, modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { useLocalDreaminaModelStore } from "@/stores/use-local-dreamina-model-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { buildBackendToolRequests, type ResponseFunctionTool, type ResponseInputMessage, type ToolChoice, type ToolResponseResult } from "@/services/api/image";

export { logicalModelIDForConfig };

// 只要模型明确选择了请求协议，就统一交给后端协议运行时执行：逻辑模型
// 由逻辑模型路由解析协议，系统渠道由 channelId 解析真实渠道模型，用户
// 自建渠道则由所选协议插件负责第三方字段映射和结果解析。没有显式协议
// 的旧配置继续保留前端直连兼容路径。
export function backendModelRuntimeRequired(config: AiConfig) {
    if (logicalModelIDForConfig(config)) return true;
    const requestConfig = resolveModelRequestConfig(config, config.model);
    return Boolean(requestConfig.channelId || requestConfig.interfaceType);
}

export type BackendGenerationMode = "text" | "image" | "video" | "audio";

export type BackendGenerationResult = {
    mode?: BackendGenerationMode;
    images?: Array<{ dataUrl: string; storageKey?: string; width?: number; height?: number; bytes?: number; mimeType?: string }>;
    video?: { dataUrl: string; storageKey?: string; width?: number; height?: number; durationMs?: number; bytes?: number; mimeType?: string };
    audio?: { dataUrl: string; storageKey?: string; durationMs?: number; bytes?: number; mimeType?: string; format?: string };
    text?: string;
    toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string }; thoughtSignature?: string }>;
    reasoning?: string;
};

type BackendGenerationTaskOptions = {
    projectId?: string;
    mode: BackendGenerationMode;
    prompt: string;
    config: AiConfig;
    referenceImages?: ReferenceImage[];
    referenceVideos?: ReferenceVideo[];
    referenceAudios?: ReferenceAudio[];
    textHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    mask?: ReferenceImage;
    signal?: AbortSignal;
    metadata?: Record<string, unknown>;
    onTaskUpdate?: (task: GenerationTask) => void;
    localIdempotencyKey?: string;
    localResumeOnly?: boolean;
    clientOperationId?: string;
    retryOf?: string;
    retryContextsByBatchIndex?: Array<{ retryOf: string; attemptGroupId: string; clientOperationId: string }>;
    attemptGroupId?: string;
};

export type GenerationTaskDependencies = {
    createTask: typeof createGenerationTask;
    waitTask: typeof waitForGenerationTask;
    runLocal: (input: LocalDreaminaGenerationInput, signal?: AbortSignal, onTaskUpdate?: (task: LocalDreaminaGenerationTask) => void) => ReturnType<typeof runLocalDreaminaGenerationTask>;
    createId: () => string;
    now: () => string;
    ensureLocalDreaminaReady?: (signal?: AbortSignal) => Promise<unknown>;
};

const defaultDependencies: GenerationTaskDependencies = {
    createTask: createGenerationTask,
    waitTask: waitForGenerationTask,
    runLocal: (input, signal, onTaskUpdate) => runLocalDreaminaGenerationTask(input, { onTaskUpdate }, signal),
    createId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    ensureLocalDreaminaReady: (signal) => useLocalDreaminaModelStore.getState().ensureReady(signal),
};

type PreparedGenerationReferences = {
    referenceImages: Awaited<ReturnType<typeof prepareBackendImageReference>>[];
    referenceVideos: Awaited<ReturnType<typeof prepareBackendMediaReference>>[];
    referenceAudios: Awaited<ReturnType<typeof prepareBackendMediaReference>>[];
    mask?: Awaited<ReturnType<typeof prepareBackendImageReference>>;
};

// 生成、计费、取消和任务记录必须共用后端任务生命周期，页面层不能再直连供应商。
export async function runBackendGenerationTask(
    {
        projectId,
        mode,
        prompt,
        config,
        referenceImages = [],
        referenceVideos = [],
        referenceAudios = [],
        textHistory = [],
        mask,
        signal,
        metadata,
        onTaskUpdate,
        localIdempotencyKey,
        localResumeOnly,
        clientOperationId,
        retryOf,
        attemptGroupId,
    }: BackendGenerationTaskOptions,
    dependencies: GenerationTaskDependencies = defaultDependencies,
) {
    throwIfAborted(signal);
    assertClientPromptLimit(mode, prompt, config, metadata);
    if (isLocalDreaminaModel(config.model)) {
        await dependencies.ensureLocalDreaminaReady?.(signal);
        throwIfAborted(signal);
        return await runLocalDreaminaGeneration(
            { projectId, mode, prompt, config, referenceImages, referenceVideos, referenceAudios, textHistory, mask, signal, metadata, onTaskUpdate, localIdempotencyKey, localResumeOnly, clientOperationId, retryOf, attemptGroupId },
            dependencies,
        );
    }
    const prepared = await prepareGenerationReferences({ referenceImages, referenceVideos, referenceAudios, mask });
    throwIfAborted(signal);
    return createAndWaitGenerationTask({ projectId, mode, prompt, config, referenceImages, referenceVideos, referenceAudios, textHistory, signal, metadata, onTaskUpdate }, prepared, dependencies);
}

export async function runBackendToolGenerationTask(options: {
    prompt: string;
    config: AiConfig;
    messages: ResponseInputMessage[];
    tools: ResponseFunctionTool[];
    toolChoice: ToolChoice;
    signal?: AbortSignal;
}): Promise<ToolResponseResult> {
    throwIfAborted(options.signal);
    const logicalModelId = logicalModelIDForConfig(options.config);
    const requestConfig = resolveModelRequestConfig(options.config, options.config.model);
    if (!logicalModelId && !requestConfig.channelId && !requestConfig.interfaceType) throw new Error("当前模型未选择可用请求协议");
    const task = await createGenerationTask({
        type: "canvas_text",
        operation: "text",
        prompt: options.prompt,
        model: options.config.model,
        ...(logicalModelId ? { logicalModelId } : {}),
        input: {
            mode: "text",
            prompt: options.prompt,
            config: backendProviderConfig(options.config),
            agentRequests: buildBackendToolRequests(options.messages, options.tools, options.toolChoice),
            metadata: { source: "canvas-online-agent" },
        },
    });
    const completed = await waitForGenerationTask(task.id, { signal: options.signal, initialTask: task });
    const result = parseBackendGenerationResult(completed);
    return {
        content: result.text || "",
        toolCalls: result.toolCalls || [],
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    };
}

export async function runBackendGenerationTaskBatch(options: BackendGenerationTaskOptions & { count: number }, dependencies: GenerationTaskDependencies = defaultDependencies) {
    const count = Math.max(1, Math.min(15, Math.floor(Number(options.count)) || 1));
    throwIfAborted(options.signal);
    assertClientPromptLimit(options.mode, options.prompt, options.config, options.metadata);
    if (options.retryContextsByBatchIndex && options.retryContextsByBatchIndex.length !== count) throw new Error("生成重试批次任务数量不匹配");
    if (isLocalDreaminaModel(options.config.model)) {
        await dependencies.ensureLocalDreaminaReady?.(options.signal);
        throwIfAborted(options.signal);
        return Promise.allSettled(
            Array.from({ length: count }, (_, batchIndex) => {
                const retryContext = options.retryContextsByBatchIndex?.[batchIndex];
                return runLocalDreaminaGeneration(
                    {
                        ...options,
                        config: { ...options.config, count: "1" },
                        metadata: { ...options.metadata, batchIndex, batchCount: count },
                        localIdempotencyKey: options.localIdempotencyKey ? `${options.localIdempotencyKey}:${batchIndex + 1}` : undefined,
                        clientOperationId: retryContext?.clientOperationId ?? (options.clientOperationId ? `${options.clientOperationId}:${batchIndex + 1}` : undefined),
                        retryOf: retryContext?.retryOf ?? options.retryOf,
                        attemptGroupId: retryContext?.attemptGroupId ?? options.attemptGroupId,
                    },
                    dependencies,
                );
            }),
        );
    }
    const prepared = await prepareGenerationReferences(options);
    throwIfAborted(options.signal);
    return Promise.allSettled(
        Array.from({ length: count }, (_, batchIndex) =>
            createAndWaitGenerationTask(
                {
                    ...options,
                    metadata: { ...options.metadata, batchIndex, batchCount: count },
                },
                prepared,
                dependencies,
            ),
        ),
    );
}

async function runLocalDreaminaGeneration(options: BackendGenerationTaskOptions, dependencies: GenerationTaskDependencies): Promise<BackendGenerationResult> {
    if (options.mode !== "image" && options.mode !== "video") throw new Error("即梦 CLI 仅支持图片或视频生成");
    const runtimeId = stripLocalDreaminaTaskPrefix(options.localIdempotencyKey || options.clientOperationId || dependencies.createId());
    const clientOperationId = options.clientOperationId ?? runtimeId;
    const context = localTaskContext(options);
    const timestamp = dependencies.now();
    const task: GenerationTask = {
        id: localDreaminaTaskId(runtimeId),
        clientOperationId,
        ...(options.projectId ? { projectId: options.projectId } : {}),
        type: `canvas_${options.mode}`,
        status: "running",
        stage: "submitting",
        prompt: options.prompt,
        operation: generationOperation(options),
        provider: "dreamina-cli",
        model: options.config.model,
        attempts: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        clientContext: generationClientContext(context),
        ...(context.retryOf ? { retryOf: context.retryOf } : {}),
        ...(context.attemptGroupId ? { attemptGroupId: context.attemptGroupId } : {}),
    };
    let latestPublicTask = task;
    options.onTaskUpdate?.(task);
    try {
        const references = await localGenerationReferences([...(options.referenceImages ?? []), ...(options.mask ? [options.mask] : [])], options.referenceVideos ?? [], options.referenceAudios ?? []);
        const resolution = options.mode === "video" ? options.config.vquality : options.config.quality;
        const result = await dependencies.runLocal(
            {
                model: options.config.model as `local:dreamina-cli:${string}`,
                mode: options.mode,
                prompt: options.prompt,
                settings: {
                    aspect: options.config.size,
                    resolution,
                    ...(options.mode === "video" ? { duration: Number(options.config.videoSeconds) } : { count: Number(options.config.count) }),
                },
                references,
                resumeOnly: options.localResumeOnly,
                idempotencyKey: runtimeId,
                clientOperationId,
                context,
            },
            options.signal,
            (runtimeTask) => {
                latestPublicTask = projectLocalDreaminaTask(runtimeTask, task);
                options.onTaskUpdate?.(latestPublicTask);
            },
        );
        const completedAt = dependencies.now();
        latestPublicTask = { ...latestPublicTask, status: "succeeded", progress: 100, stage: "local_cli_succeeded", resultJson: JSON.stringify(result), completedAt, updatedAt: completedAt };
        options.onTaskUpdate?.(latestPublicTask);
        return result;
    } catch (error) {
        const completedAt = dependencies.now();
        const cancelled = isGenerationTaskCancelled(error, options.signal);
        const localWaitStopped = error instanceof LocalDreaminaGenerationClientError && error.code === LOCAL_DREAMINA_WAIT_STOPPED_CODE;
        const localErrorCode = error instanceof LocalDreaminaGenerationClientError ? error.code : undefined;
        if (!(cancelled && isLocalDreaminaBackgroundTask(latestPublicTask))) {
            options.onTaskUpdate?.({
                ...latestPublicTask,
                status: cancelled ? "cancelled" : "failed",
                stage: cancelled ? "local_cli_cancelled" : "local_cli_failed",
                completedAt,
                updatedAt: completedAt,
                ...(localWaitStopped
                    ? { errorCode: error.code, error: error.message }
                    : !cancelled
                      ? {
                            ...(localErrorCode ? { errorCode: localErrorCode } : {}),
                            error: error instanceof Error ? error.message : "即梦本机生成失败",
                        }
                      : {}),
            });
        }
        throw error;
    }
}

function generationOperation(options: BackendGenerationTaskOptions) {
    if (options.mode !== "video") return options.mode;
    return resolveVideoOperation({
        textCount: 0,
        imageCount: options.referenceImages?.length ?? 0,
        videoCount: options.referenceVideos?.length ?? 0,
        audioCount: options.referenceAudios?.length ?? 0,
        characterCount: 0,
    }, options.metadata?.videoEditOperation as string | undefined);
}

export function isGenerationTaskCancelled(error: unknown, signal?: AbortSignal) {
    if (error instanceof LocalDreaminaGenerationClientError && error.code === "dreamina_submission_unknown") return false;
    return signal?.aborted === true || (error instanceof Error && error.name === "AbortError") || (error instanceof LocalDreaminaGenerationClientError && error.code === LOCAL_DREAMINA_WAIT_STOPPED_CODE);
}

async function localGenerationReferences(images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]): Promise<LocalDreaminaGenerationInput["references"]> {
    const imageReferences = await Promise.all(
        images.map(async (image) => {
            const source = image.dataUrl || image.url;
            if (!source && !image.storageKey) throw new LocalDreaminaGenerationClientError("dreamina_reference_invalid", "即梦图片参考素材不可用", 400);
            const blob = image.storageKey ? await getImageBlob(image.storageKey) : await (await fetch(source!)).blob();
            if (!blob || !["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw invalidLocalReference();
            return {
                kind: "image" as const,
                mimeType: blob.type as "image/png" | "image/jpeg" | "image/webp",
                bytes: new Uint8Array(await blob.arrayBuffer()),
                metadata: compactReferenceMetadata({ name: image.name, width: image.width, height: image.height }),
            };
        }),
    );
    const mediaReferences = async (items: Array<ReferenceVideo | ReferenceAudio>, kind: "video" | "audio") =>
        Promise.all(
            items.map(async (media) => {
                const source = media.url || "";
                const blob = media.storageKey ? await getMediaBlob(media.storageKey) : source ? await (await fetch(source)).blob() : null;
                const allowed = kind === "video" ? ["video/mp4", "video/quicktime", "video/webm"] : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/flac"];
                if (!blob || !allowed.includes(blob.type)) throw invalidLocalReference();
                return {
                    kind,
                    mimeType: blob.type,
                    bytes: new Uint8Array(await blob.arrayBuffer()),
                    metadata: compactReferenceMetadata({
                        name: media.name,
                        ...("width" in media ? { width: media.width, height: media.height } : {}),
                        durationMs: media.durationMs,
                    }),
                };
            }),
        );
    const references = [...imageReferences, ...(await mediaReferences(videos, "video")), ...(await mediaReferences(audios, "audio"))] as LocalDreaminaGenerationInput["references"];
    if (references.reduce((total, reference) => total + reference.bytes.byteLength, 0) > 20 * 1024 * 1024) throw invalidLocalReference();
    return references;
}

function invalidLocalReference() {
    return new LocalDreaminaGenerationClientError("dreamina_reference_invalid", "即梦参考素材无效", 400);
}

function compactReferenceMetadata(metadata: Record<string, string | number | undefined>) {
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

function localTaskContext(options: BackendGenerationTaskOptions): Extract<LocalDreaminaGenerationInput["context"], { scope: "scoped" }> {
    const metadata = options.metadata ?? {};
    return {
        scope: "scoped",
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(typeof metadata.nodeId === "string" ? { nodeId: metadata.nodeId } : {}),
        ...(typeof metadata.conversationId === "string" ? { conversationId: metadata.conversationId } : {}),
        ...(typeof metadata.messageId === "string" ? { messageId: metadata.messageId } : {}),
        ...(typeof metadata.batchIndex === "number" ? { batchIndex: metadata.batchIndex } : {}),
        ...(typeof metadata.batchCount === "number" ? { batchCount: metadata.batchCount } : {}),
        ...(options.retryOf ? { retryOf: options.retryOf } : {}),
        ...(options.attemptGroupId ? { attemptGroupId: options.attemptGroupId } : {}),
    };
}

function generationClientContext(context: Extract<LocalDreaminaGenerationInput["context"], { scope: "scoped" }>) {
    const { conversationId, messageId, nodeId, batchIndex, batchCount } = context;
    if (!conversationId && !messageId && !nodeId && batchIndex === undefined && batchCount === undefined) return undefined;
    return { ...(conversationId ? { conversationId } : {}), ...(messageId ? { messageId } : {}), ...(nodeId ? { nodeId } : {}), ...(batchIndex !== undefined ? { batchIndex } : {}), ...(batchCount !== undefined ? { batchCount } : {}) };
}

function isLocalDreaminaModel(model: string) {
    return /^local:dreamina-cli:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model.trim());
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function assertClientPromptLimit(mode: BackendGenerationMode, prompt: string, config: AiConfig, metadata?: Record<string, unknown>) {
    if (mode !== "image" || metadata?.promptTemplateOperation) return;
    const requestConfig = resolveModelRequestConfig(config, config.model);
    const promptLimitError = grokImagePromptLimitError(prompt, requestConfig.interfaceType, requestConfig.model);
    if (promptLimitError) throw new Error(promptLimitError);
}

async function prepareGenerationReferences({
    referenceImages = [],
    referenceVideos = [],
    referenceAudios = [],
    mask,
}: Pick<BackendGenerationTaskOptions, "referenceImages" | "referenceVideos" | "referenceAudios" | "mask">): Promise<PreparedGenerationReferences> {
    const preparedImages = await Promise.all(referenceImages.map(prepareBackendImageReference));
    const preparedVideos = await Promise.all(referenceVideos.map(prepareBackendMediaReference));
    const preparedAudios = await Promise.all(referenceAudios.map(prepareBackendMediaReference));
    const preparedMask = mask ? await prepareBackendImageReference(mask) : undefined;
    return { referenceImages: preparedImages, referenceVideos: preparedVideos, referenceAudios: preparedAudios, mask: preparedMask };
}

async function createAndWaitGenerationTask(options: BackendGenerationTaskOptions, prepared: PreparedGenerationReferences, dependencies: GenerationTaskDependencies) {
    const { projectId, mode, prompt, config, signal, metadata, onTaskUpdate } = options;
    const videoOperation = generationOperation(options);
    const logicalModelId = logicalModelIDForConfig(config);
    const task = await dependencies.createTask({
        ...(projectId ? { projectId } : {}),
        type: `canvas_${mode}`,
        operation: mode === "video" ? videoOperation : mode,
        prompt,
        model: config.model,
        ...(logicalModelId ? { logicalModelId } : {}),
        input: {
            mode,
            prompt,
            config: backendProviderConfig(config),
            capabilityOptions: logicalModelId ? logicalCapabilityOptions(config, mode) : undefined,
            textHistory: options.textHistory,
            referenceImages: prepared.referenceImages,
            referenceVideos: prepared.referenceVideos,
            referenceAudios: prepared.referenceAudios,
            mask: prepared.mask,
            metadata,
        },
    });
    onTaskUpdate?.(task);
    const completed = await dependencies.waitTask(task.id, { signal, initialTask: task, onTaskUpdate });
    return parseBackendGenerationResult(completed);
}

async function prepareBackendMediaReference(media: ReferenceVideo | ReferenceAudio) {
    if (resourceIdFromStorageKey(media.storageKey)) return backendMediaReference(media, { storageKey: media.storageKey });
    const url = media.url || "";
    if (/^https?:\/\//i.test(url)) return backendMediaReference(media, { url });
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && (url.startsWith("blob:") || url.startsWith("data:"))) blob = await (await fetch(url)).blob();
    if (!blob) throw new Error("参考媒体尚未保存，请重新上传后再生成");
    try {
        const kind: "video" | "audio" | "file" = blob.type.startsWith("video/") ? "video" : blob.type.startsWith("audio/") ? "audio" : "file";
        const resource = await uploadResourceFile(blob, kind, { fileName: media.name, width: "width" in media ? media.width : undefined, height: "height" in media ? media.height : undefined, durationMs: media.durationMs });
        return backendMediaReference(media, { storageKey: resourceStorageKey(resource.id), type: resource.mimeType || media.type || blob.type });
    } catch (error) {
        throw new Error(error instanceof Error ? `参考媒体上传失败：${error.message}` : "参考媒体上传失败");
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
        ...(image.bytes ? { bytes: image.bytes } : {}),
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
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
    const generationOptions = {
        size: config.size,
        quality: config.quality,
        transparentBackground: config.transparentBackground,
        count: config.count,
        videoSeconds: config.videoSeconds,
        vquality: config.vquality,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        videoArkPrivateAssetUpload: config.videoArkPrivateAssetUpload,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
    if (logicalModelIDForConfig(config)) return generationOptions;
    return {
        channelId: requestConfig.channelId,
        apiFormat: requestConfig.apiFormat,
        interfaceType: requestConfig.interfaceType,
        baseUrl: requestConfig.baseUrl,
        allowLocalChannel: requestConfig.allowLocalChannel === true,
        apiKey: requestConfig.apiKey,
        secretKey: requestConfig.secretKey,
        model: requestConfig.model,
        ...generationOptions,
        capabilityConfig: modelCapabilityConfigFor(config, requestConfig.model),
        systemPrompt: "",
    };
}

function logicalCapabilityOptions(config: AiConfig, mode: BackendGenerationMode) {
    const channel = resolveModelChannel(config, config.model);
    const spec = channel.modelCosts?.find((item) => item.model === modelOptionName(config.model))?.logicalCapabilitySpec;
    const candidates: Record<string, unknown> = mode === "image"
        ? { size: config.size, quality: config.quality, transparentBackground: config.transparentBackground === "true", count: Number(config.count) }
        : mode === "video"
            ? { size: config.size, videoSeconds: Number(config.videoSeconds), vquality: config.vquality, videoGenerateAudio: config.videoGenerateAudio === "true", videoWatermark: config.videoWatermark === "true" }
            : mode === "audio"
                ? { audioVoice: config.audioVoice, audioFormat: config.audioFormat, audioSpeed: Number(config.audioSpeed) }
                : {};
    return Object.fromEntries(Object.entries(candidates).filter(([key]) => Boolean(spec?.options?.[key])));
}

export function parseBackendGenerationResult(task: GenerationTask): BackendGenerationResult {
    if (!task.resultJson) throw new Error("后端任务没有返回结果");
    const result = JSON.parse(task.resultJson) as BackendGenerationResult;
    if (!result || typeof result !== "object") throw new Error("后端任务结果格式错误");
    return result;
}
