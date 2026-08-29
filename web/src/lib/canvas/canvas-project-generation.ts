import { type GenerationTask } from "@/services/api/task-center";
import { backendProviderConfig, logicalModelIDForConfig, runBackendGenerationTask, type GenerationTaskDependencies } from "@/services/api/generation-task";
import { configuredModelMatchesCapability, defaultConfig, normalizeModelOptionValue, normalizeRunningHubCapability, resolveModelRequestConfig, type AiConfig, type WorkflowFieldMapping } from "@/stores/use-config-store";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { normalizeVideoDuration, normalizeVideoResolution } from "@/lib/video-generation-options";
import { isSeedanceVideoConfig } from "@/lib/seedance-video";
import { modelCapabilityConfigFor, workflowFieldCurrentValue, workflowFieldHasStoredValue, workflowFieldKey, workflowFieldRandomKey, workflowFieldSubmissionValue, workflowOutputSizeValue, workflowVideoFieldsFromJson } from "@/lib/model-capabilities";
import { modelRequestOptions, resolveCompatibleModel, resolveModelGenerationDefaults, resolveVideoOperation, type ModelGenerationDefaults, type ModelRequirements } from "@/lib/model-selection";
import { imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { ensureMediaNodeMinimumSize } from "@/lib/canvas/canvas-node-size";
import { isCanvasWorkflowProvider, resolveCanvasWorkflowProvider } from "@/lib/canvas/canvas-workflow";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoEditOperation } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

export async function runBackendCanvasGenerationTask(
    {
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
        clientOperationId,
        retryOf,
        attemptGroupId,
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
        clientOperationId?: string;
        retryOf?: string;
        attemptGroupId?: string;
    },
    dependencies?: GenerationTaskDependencies,
) {
    if (mode === "image") assertCanvasImageReferenceLimit(config, referenceImages);
    return runBackendGenerationTask(
        {
            projectId,
            mode,
            prompt,
            config,
            referenceImages,
            referenceVideos,
            referenceAudios,
            mask,
            signal,
            metadata: { nodeId, ...(mode === "video" && !metadata?.videoEditOperation ? { videoEditOperation: "image_to_video" } : {}), ...metadata },
            onTaskUpdate: onTaskCreated,
            clientOperationId,
            retryOf,
            attemptGroupId,
        },
        dependencies,
    );
}

export function canvasImageReferenceLimitError(config: AiConfig, referenceImages: ReferenceImage[]) {
    // 工作流的参考素材上限由字段映射槽位决定，不能再套用当前普通图片模型的能力表。
    if ((config.taskWorkflowProvider || "model") !== "model") return "";
    const maxImages = modelCapabilityConfigFor(config, config.model).image?.references.maxImages;
    if (maxImages === undefined || referenceImages.length <= maxImages) return "";
    return `当前图片模型最多支持 ${maxImages} 张参考图，当前已连接 ${referenceImages.length} 张。请移除多余连线后重试`;
}

export function assertCanvasImageReferenceLimit(config: AiConfig, referenceImages: ReferenceImage[]) {
    const error = canvasImageReferenceLimitError(config, referenceImages);
    if (error) throw new Error(error);
}

export { backendProviderConfig };
// 兼容故事板执行器的旧导入路径。
export { logicalModelIDForConfig };

const generationOperationLocks = new Map<string, Promise<unknown>>();

export function runGenerationOperationOnce<T>(clientOperationId: string | undefined, operation: () => Promise<T>): Promise<T> {
    if (!clientOperationId) return operation();
    const existing = generationOperationLocks.get(clientOperationId) as Promise<T> | undefined;
    if (existing) return existing;
    const running = operation().finally(() => {
        if (generationOperationLocks.get(clientOperationId) === running) generationOperationLocks.delete(clientOperationId);
    });
    generationOperationLocks.set(clientOperationId, running);
    return running;
}

export async function runCanvasGenerationTaskToConsumer(
    input: Parameters<typeof runBackendCanvasGenerationTask>[0],
    dependencies: {
        bindTask(task: GenerationTask): void;
        consumeTask(task: GenerationTask): Promise<void>;
        runTask?: (options: Parameters<typeof runBackendCanvasGenerationTask>[0]) => ReturnType<typeof runBackendCanvasGenerationTask>;
    },
) {
    return runGenerationOperationOnce(input.clientOperationId, async () => {
        let completedTask: GenerationTask | undefined;
        const result = await (dependencies.runTask ?? runBackendCanvasGenerationTask)({
            ...input,
            onTaskCreated: (task) => {
                input.onTaskCreated?.(task);
                dependencies.bindTask(task);
                if (task.status === "succeeded") completedTask = task;
            },
        });
        if (!completedTask) throw new Error("生成任务缺少成功终态");
        await dependencies.consumeTask(completedTask);
        return result;
    });
}

export type GenerationRetryContext = {
    retryOf: string;
    attemptGroupId: string;
    clientOperationId: string;
};

export async function createGenerationRetryContext(retryOf: string, attemptGroupId = retryOf): Promise<GenerationRetryContext> {
    const bytes = new TextEncoder().encode(`generation-retry\0${attemptGroupId}\0${retryOf}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { retryOf, attemptGroupId, clientOperationId: `retry:${hex}` };
}

export function createGenerationBatchRetryContexts(taskIds: readonly string[], attemptGroupId: string) {
    return Promise.all(taskIds.map((taskId) => createGenerationRetryContext(taskId, attemptGroupId)));
}

export function generationTaskMetadata(task: GenerationTask): CanvasNodeMetadata {
    const progress = normalizeTaskProgress(task.progress, task.status);
    return {
        taskId: task.id,
        taskClientOperationId: task.clientOperationId,
        retryOf: task.retryOf,
        attemptGroupId: task.attemptGroupId,
        taskStatus: task.status,
        taskProgress: progress,
        taskStage: task.stage,
        taskProvider: task.provider,
        taskStartedAt: task.startedAt,
        taskCompletedAt: task.completedAt,
        taskDurationMs: task.startedAt && task.completedAt ? Math.max(0, Date.parse(task.completedAt) - Date.parse(task.startedAt)) : undefined,
        taskErrorCode: task.errorCode,
        taskOfficialStatus: task.officialStatus,
        taskReceiptRecorded: task.receiptRecorded,
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
        resourceReloadAvailable: undefined,
        failedPromptFingerprint: undefined,
    };
    delete next.taskId;
    delete next.taskClientOperationId;
    delete next.retryOf;
    delete next.attemptGroupId;
    delete next.taskStatus;
    delete next.taskProgress;
    delete next.taskStage;
    delete next.taskProvider;
    delete next.taskStartedAt;
    delete next.taskCompletedAt;
    delete next.taskDurationMs;
    delete next.taskErrorCode;
    delete next.taskOfficialStatus;
    delete next.taskReceiptRecorded;
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
        ...generationWorkflowMetadata(config),
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
    if (node.type !== CanvasNodeType.Image || (!node.metadata?.content && !node.metadata?.storageKey)) return null;
    return {
        id: node.id,
        name: `reference-${node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content || "",
        storageKey: node.metadata.storageKey,
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        ...generationWorkflowMetadata(config),
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
    const input = {
        textCount: 0,
        imageCount: context?.referenceImages.length || 0,
        videoCount: context?.referenceVideos.length || 0,
        audioCount: context?.referenceAudios.length || 0,
        characterCount: 0,
    };
    return resolveVideoOperation(input, storedOperation) as CanvasVideoEditOperation;
}

export function buildVideoGenerationMetadata(
    node: CanvasNodeData | undefined,
    context?: {
        referenceImages: ReferenceImage[];
        referenceVideos: ReferenceVideo[];
        referenceAudios: ReferenceAudio[];
    },
    config?: AiConfig,
): CanvasNodeMetadata {
    const metadata = node?.metadata;
    const referenceImageIds = new Set((context?.referenceImages || []).map((image) => image.id));
    // 工作流视频把已连接媒体交给字段映射处理，不再把历史首尾帧选择当成硬约束。
    // 这样旧节点切换到 RunningHub/ComfyUI 后，不会因为残留的首尾帧 ID 阻断生成。
    const workflowVideo = node?.type === CanvasNodeType.Config && ((config?.taskWorkflowProvider === "runninghub" || config?.taskWorkflowProvider === "comfyui") || isCanvasWorkflowProvider(metadata));
    const startFrame = workflowVideo ? undefined : requireConnectedVideoFrame(metadata?.videoStartFrameNodeId, "首帧", referenceImageIds);
    const endFrame = workflowVideo ? undefined : requireConnectedVideoFrame(metadata?.videoEndFrameNodeId, "尾帧", referenceImageIds);
    return {
        ...(config ? generationWorkflowMetadata(config) : {}),
        videoEditOperation: resolveVideoEditOperation(node, context),
        videoCameraMoveId: metadata?.videoCameraMoveId,
        videoCameraMovePrompt: metadata?.videoCameraMovePrompt,
        videoStartFrameNodeId: startFrame,
        videoEndFrameNodeId: endFrame,
    };
}

function requireConnectedVideoFrame(frameNodeId: string | undefined, label: string, referenceImageIds: Set<string>) {
    if (!frameNodeId) return undefined;
    if (referenceImageIds.has(frameNodeId)) return frameNodeId;
    throw new Error(`已配置的${label}参考图未连接或不可用，请重新选择后再生成`);
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
            if (node.type === CanvasNodeType.Image && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content, { cacheMiss: true }) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
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

export function generationWorkflowMetadata(config: AiConfig): Pick<CanvasNodeMetadata, "workflowProvider" | "runningHubWorkflowId" | "runningHubWorkflowKind" | "comfyBridgeWorkflowId"> {
    const provider = config.taskWorkflowProvider || "model";
    return {
        workflowProvider: provider,
        runningHubWorkflowId: provider === "runninghub" ? config.runningHub.workflowId : undefined,
        runningHubWorkflowKind: provider === "runninghub" ? config.runningHub.selectedKind : undefined,
        comfyBridgeWorkflowId: provider === "comfyui" ? config.comfyBridge.workflowId : undefined,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode, requirements?: ModelRequirements): AiConfig {
    // 只有独立 Config 节点读取工作流元数据；普通图片/视频/音频节点始终按基础模型生成。
    const workflowProvider = mode !== "text" && node?.type === CanvasNodeType.Config
        ? resolveCanvasWorkflowProvider(node.metadata) === "comfyui" ? "comfyui" : "runninghub"
        : "model";
    const defaultModel = mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = mode === "image" ? defaultConfig.imageModel : mode === "video" ? defaultConfig.videoModel : mode === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    const storedModel = resolveCanvasGenerationModel(config, node?.metadata?.model, mode);
    const preferredModel = storedModel || resolveCanvasGenerationModel(config, defaultModel, mode) || fallbackModel;
    // 先合并节点上的实时选择，再做兼容性匹配。否则路由只看到全局默认值，节点改过的时长、分辨率或布尔能力无法参与分流。
    const workflowParameters = node?.metadata?.workflowParameters || {};
    const runningHubWorkflowId = node?.metadata?.runningHubWorkflowId?.trim() || config.runningHub.workflowId.trim();
    const selectedRunningHubWorkflow = workflowProvider === "runninghub"
        ? config.runningHub.workflows.find((item) => item.workflowId.trim() === runningHubWorkflowId && (!node?.metadata?.runningHubWorkflowKind || (item.kind === "app" ? "app" : "workflow") === node.metadata.runningHubWorkflowKind))
        : undefined;
    const comfyBridgeWorkflowId = node?.metadata?.comfyBridgeWorkflowId?.trim() || config.comfyBridge.workflowId.trim();
    const selectedComfyBridgeWorkflow = workflowProvider === "comfyui"
        ? config.comfyBridge.workflows.find((item) => item.workflowId.trim() === comfyBridgeWorkflowId)
        : undefined;
    const selectedWorkflowFields = workflowProvider === "runninghub"
        ? selectedRunningHubWorkflow?.fields?.length ? selectedRunningHubWorkflow.fields : workflowVideoFieldsFromJson(selectedRunningHubWorkflow?.workflowJson)
        : workflowProvider === "comfyui"
            ? selectedComfyBridgeWorkflow?.fields?.length ? selectedComfyBridgeWorkflow.fields : workflowVideoFieldsFromJson(selectedComfyBridgeWorkflow?.workflowJson)
            : [];
    const workflowOutputSize = workflowProvider === "model" ? "" : workflowOutputSizeValue(selectedWorkflowFields, workflowParameters);
    const workflowParameterValue = (source: string) => {
        const value = workflowParameters[`source:${source}`];
        return value === undefined || value === null ? undefined : String(value);
    };
    const requestedConfig: AiConfig = {
        ...config,
        quality: node?.metadata?.quality ?? workflowParameterValue("quality") ?? config.quality ?? defaultConfig.quality,
        size: workflowProvider === "model"
            ? node?.metadata?.size ?? config.size ?? defaultConfig.size
            : workflowOutputSize || node?.metadata?.size || config.size || defaultConfig.size,
        transparentBackground: node?.metadata?.transparentBackground ?? config.transparentBackground ?? defaultConfig.transparentBackground,
        videoSeconds: workflowProvider === "model" ? normalizeVideoDuration(node?.metadata?.seconds ?? workflowParameterValue("videoSeconds") ?? config.videoSeconds ?? defaultConfig.videoSeconds) : String(node?.metadata?.seconds ?? workflowParameterValue("videoSeconds") ?? config.videoSeconds ?? defaultConfig.videoSeconds),
        vquality: workflowProvider === "model" ? normalizeVideoResolution(node?.metadata?.vquality ?? workflowParameterValue("vquality") ?? config.vquality ?? defaultConfig.vquality) : String(node?.metadata?.vquality ?? workflowParameterValue("vquality") ?? config.vquality ?? defaultConfig.vquality),
        videoGenerateAudio: node?.metadata?.generateAudio ?? config.videoGenerateAudio ?? defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark ?? config.videoWatermark ?? defaultConfig.videoWatermark,
        videoArkPrivateAssetUpload: node?.metadata?.arkPrivateAssetUpload ?? config.videoArkPrivateAssetUpload ?? defaultConfig.videoArkPrivateAssetUpload,
        audioVoice: node?.metadata?.audioVoice ?? config.audioVoice ?? defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat ?? config.audioFormat ?? defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed ?? config.audioSpeed ?? defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions ?? config.audioInstructions ?? defaultConfig.audioInstructions,
        count: String(node?.metadata?.count ?? (mode === "image" ? config.canvasImageCount || config.count || defaultConfig.count : config.count || defaultConfig.count)),
    };
    const imageSize = mode === "image" ? requestedConfig.size : undefined;
    // 无 requirements 的调用（重试、媒体工具等）也按当前能力与尺寸路由到组内最低价兼容模型，
    // 避免旧 metadata.model 不支持当前尺寸导致生成时被 normalize 回退。
    const liveOptions = modelRequestOptions(requestedConfig, mode);
    const baseRequirements = requirements?.capability
        ? { ...requirements, options: { ...liveOptions, ...(requirements.options || {}) } }
        : { capability: mode, options: liveOptions };
    const model = workflowProvider === "model"
        ? resolveCompatibleModel(config, preferredModel, imageSize ? { ...baseRequirements, imageSize } : baseRequirements) || preferredModel
        : preferredModel;
    const generationDefaults: Partial<ModelGenerationDefaults> = workflowProvider === "model"
        ? resolveModelGenerationDefaults(
              config,
              model,
              mode === "image" ? "image" : mode === "video" ? "video" : undefined,
              mode === "image"
                  ? {
                        size: node?.metadata?.size,
                        quality: node?.metadata?.quality,
                        transparentBackground: node?.metadata?.transparentBackground,
                        count: requestedConfig.count,
                    }
                  : {
                        size: node?.metadata?.size,
                        videoSeconds: node?.metadata?.seconds,
                        vquality: node?.metadata?.vquality,
                        videoGenerateAudio: node?.metadata?.generateAudio,
                        videoWatermark: node?.metadata?.watermark,
                    },
              {
                  size: requestedConfig.size,
                  quality: requestedConfig.quality,
                  transparentBackground: requestedConfig.transparentBackground,
                  count: requestedConfig.count,
                  videoSeconds: requestedConfig.videoSeconds,
                  vquality: requestedConfig.vquality,
                  videoGenerateAudio: requestedConfig.videoGenerateAudio,
                  videoWatermark: requestedConfig.videoWatermark,
              },
          )
        : {};
    const modeCapability = mode === "video" || mode === "audio" ? mode : "image";
    const runningHubCapability = normalizeRunningHubCapability(selectedRunningHubWorkflow?.capability, normalizeRunningHubCapability(config.runningHub.capability));
    const runningHub = { ...config.runningHub, enabled: workflowProvider === "runninghub" && config.runningHub.enabled, selectedKind: selectedRunningHubWorkflow?.kind === "app" ? "app" as const : "workflow" as const, workflowId: runningHubWorkflowId, capability: runningHubCapability, workflows: workflowProvider === "runninghub" ? config.runningHub.workflows.map((item) => item.workflowId.trim() === runningHubWorkflowId && (!node?.metadata?.runningHubWorkflowKind || (item.kind === "app" ? "app" : "workflow") === node.metadata.runningHubWorkflowKind) ? { ...item, fields: applyWorkflowParameterValues(item.fields?.length ? item.fields : workflowVideoFieldsFromJson(item.workflowJson) as WorkflowFieldMapping[], workflowParameters) } : item) : config.runningHub.workflows };
    const comfyBridge = { ...config.comfyBridge, enabled: workflowProvider === "comfyui" && config.comfyBridge.enabled, workflowId: comfyBridgeWorkflowId, capability: selectedComfyBridgeWorkflow?.capability || modeCapability, workflows: workflowProvider === "comfyui" ? config.comfyBridge.workflows.map((item) => item.workflowId.trim() === comfyBridgeWorkflowId ? { ...item, fields: applyWorkflowParameterValues(item.fields?.length ? item.fields : workflowVideoFieldsFromJson(item.workflowJson) as WorkflowFieldMapping[], workflowParameters) } : item) : config.comfyBridge.workflows };
    return {
        ...requestedConfig,
        taskWorkflowProvider: workflowProvider,
        runningHub,
        comfyBridge,
        model,
        quality: generationDefaults.quality || requestedConfig.quality,
        size: generationDefaults.size ?? requestedConfig.size,
        transparentBackground: generationDefaults.transparentBackground || (requestedConfig.transparentBackground === "true" ? "true" : "false"),
        videoSeconds: generationDefaults.videoSeconds || requestedConfig.videoSeconds,
        vquality: generationDefaults.vquality ?? requestedConfig.vquality,
        videoGenerateAudio: generationDefaults.videoGenerateAudio || requestedConfig.videoGenerateAudio,
        videoWatermark: generationDefaults.videoWatermark || requestedConfig.videoWatermark,
        videoArkPrivateAssetUpload: requestedConfig.videoArkPrivateAssetUpload,
        count: generationDefaults.count || requestedConfig.count,
    };
}

export function resolveCanvasGenerationModel(config: AiConfig, model: string | undefined, mode: CanvasNodeGenerationMode): string {
    if (!model) return "";
    const normalized = normalizeModelOptionValue(model, config.channels);
    if (!normalized) return "";
    return configuredModelMatchesCapability(config, normalized, mode) ? normalized : "";
}

function applyWorkflowParameterValues(fields: WorkflowFieldMapping[] | undefined, values: Record<string, unknown>) {
    if (!fields?.length || !Object.keys(values).length) return fields;
    return fields.map((field) => {
        const key = workflowFieldKey(field);
        const randomKey = workflowFieldRandomKey(field);
        const hasValue = workflowFieldHasStoredValue(field, values);
        const hasRandom = Object.prototype.hasOwnProperty.call(values, randomKey);
        if (!hasValue && !hasRandom) return field;
        const value = workflowFieldSubmissionValue(field, workflowFieldCurrentValue(field, values));
        // 画布动态参数按具体字段覆盖，不能继续走 aspectRatio/quality 等全局来源，
        // 否则同一工作流中的两个同类参数会被折叠成同一个值。
        return {
            ...field,
            ...(hasValue ? { fieldValue: value, value } : {}),
            source: "",
            sourceAutomatic: false,
            sourceFromUpstream: false,
            randomEnabled: hasRandom ? values[randomKey] === true : hasValue ? false : field.randomEnabled,
        };
    });
}

export function supportsVideoReferenceAudio(config: AiConfig) {
    const interfaceType = resolveModelRequestConfig(config, config.model).interfaceType;
    return interfaceType === "newapi-channel-1" || interfaceType === "newapi-channel-2" || isSeedanceVideoConfig(config);
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    const configWidth = NODE_DEFAULT_SIZE[CanvasNodeType.Config].width;
    const configHeight = NODE_DEFAULT_SIZE[CanvasNodeType.Config].height;
    return nodes.map((node) => {
        const mediaNode = ensureMediaNodeMinimumSize(node);
        const resizedNode =
            mediaNode.type === CanvasNodeType.Config && (mediaNode.width < configWidth || mediaNode.height < configHeight)
                ? { ...mediaNode, width: Math.max(mediaNode.width, configWidth), height: Math.max(mediaNode.height, configHeight) }
                : mediaNode.type === CanvasNodeType.Script && mediaNode.height < NODE_DEFAULT_SIZE[CanvasNodeType.Script].height
                  ? { ...mediaNode, height: NODE_DEFAULT_SIZE[CanvasNodeType.Script].height }
                  : mediaNode;
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
