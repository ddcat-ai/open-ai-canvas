import { canvasNodeToAsset, declaredCanvasNodeAssetCategory, findCanvasNodeAsset, type CanvasAssetSource } from "@/lib/canvas/canvas-node-asset";
import { readImageMeta } from "@/lib/image-utils";
import { parseBackendGenerationResult, type BackendGenerationResult } from "@/services/api/generation-task";
import { linkProjectAsset, moveProjectAsset, updateProjectAssetCategory } from "@/services/api/projects";
import type { GenerationTask, GenerationTaskOutput } from "@/services/api/task-center";
import { getMediaBlob, resolveMediaUrl, setMediaBlob } from "@/services/file-storage";
import { createGenerationTaskMaterializer, createIdempotentMaterializeOutput, type MaterializeGenerationTaskOutput } from "@/services/generation-task-materializer";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import { uploadGeneratedAssetToConfiguredSources } from "@/services/external-asset-sources";
import { getImageBlob, resolveImageUrl, setImageBlob } from "@/services/image-storage";
import { generationArtifactStorageKey, loadOrStoreGenerationArtifact } from "@/services/generation-artifact-sink";
import { createLocalDreaminaTaskEffectStore } from "@/services/local-dreamina-generation";
import { createProviderNeutralGenerationTaskEffectStore } from "@/services/provider-neutral-generation-effects";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";
import { getActiveUserScope } from "@/lib/user-scope";
import { runGenerationConsumer } from "@/services/generation-consumer-lifecycle";
import { useAssetStore, type AssetCategory, type AssetStatus, type NewAsset } from "@/stores/use-asset-store";
import type { CanvasNodeData } from "@/types/canvas";

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}

type EnsureCanvasNodeAssetOptions = {
    canvasId: string;
    domainProjectId?: string;
    node: CanvasNodeData;
    source: CanvasAssetSource;
    taskId?: string;
    category?: AssetCategory;
    folderId?: string;
    signal?: AbortSignal;
};

export type CanvasNodeAssetResult = {
    assetId: string;
    created: boolean;
    linkedToProject: boolean;
};

const pendingAssetSyncs = new Map<string, Promise<CanvasNodeAssetResult>>();

export function ensureCanvasNodeAsset(options: EnsureCanvasNodeAssetOptions) {
    const scope = getActiveUserScope();
    const identity = options.taskId || options.node.metadata?.taskId || options.node.metadata?.storageKey || options.node.id;
    const key = [scope, options.domainProjectId || "personal", options.canvasId, options.node.id, identity].join(":");
    const pending = pendingAssetSyncs.get(key);
    if (pending) return pending;
    const request = runGenerationConsumer(options.signal, (signal) => persistCanvasNodeAsset({ ...options, signal })).finally(() => pendingAssetSyncs.delete(key));
    pendingAssetSyncs.set(key, request);
    return request;
}

async function persistCanvasNodeAsset(options: EnsureCanvasNodeAssetOptions): Promise<CanvasNodeAssetResult> {
    throwIfAborted(options.signal);
    const store = useAssetStore.getState();
    let asset = findCanvasNodeAsset(store.assets, options.node, options.canvasId, options.taskId);
    const declaredCategory = options.category || declaredCanvasNodeAssetCategory(options.node);
    let created = false;
    if (!asset) {
        const input = canvasNodeToAsset(options.node, { canvasId: options.canvasId, source: options.source, taskId: options.taskId });
        if (!input) throw new Error("当前节点没有可保存的素材内容");
        const assetId = store.addAsset(options.category ? { ...input, category: options.category } : input);
        asset = useAssetStore.getState().assets.find((item) => item.id === assetId);
        created = true;
    }
    if (!asset) throw new Error("素材写入本地失败");
    if (declaredCategory && asset.category !== declaredCategory) {
        store.updateAsset(asset.id, { category: declaredCategory });
        asset = useAssetStore.getState().assets.find((item) => item.id === asset?.id) || asset;
    }
    if (!options.domainProjectId) return { assetId: asset.id, created, linkedToProject: false };
    await syncAssetToProject(asset.id, options.domainProjectId, declaredCategory, options.folderId, options.signal);
    return { assetId: asset.id, created, linkedToProject: true };
}

async function syncAssetToProject(assetId: string, domainProjectId: string, category?: AssetCategory, folderId?: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const asset = useAssetStore.getState().assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new Error("素材写入本地失败");
    const linkedProjectIds = Array.isArray(asset.metadata?.projectIds) ? asset.metadata.projectIds.filter((id): id is string => typeof id === "string") : [];
    if (linkedProjectIds.includes(domainProjectId)) {
        if (folderId !== undefined) await moveProjectAsset(domainProjectId, asset.id, folderId, signal);
        return;
    }

    // 项目关联依赖后端 assets 记录，先强制完成素材同步，不能依赖延迟自动同步的时序。
    await saveRemoteUserDataNow();
    throwIfAborted(signal);
    const { asset: linkedAsset } = await linkProjectAsset(
        domainProjectId,
        {
            assetId: asset.id,
            category: category || asset.category || "other",
            folderId,
        },
        signal,
    );
    throwIfAborted(signal);
    let linked = category && linkedAsset.category !== category ? (await updateProjectAssetCategory(domainProjectId, asset.id, category, signal)).asset : linkedAsset;
    if (folderId !== undefined && (linked.folderId || "") !== folderId) linked = (await moveProjectAsset(domainProjectId, asset.id, folderId, signal)).asset;
    throwIfAborted(signal);
    useAssetStore.getState().updateAsset(asset.id, {
        category: linked.category as AssetCategory,
        status: linked.status as AssetStatus,
        primaryVersionId: linked.primaryVersionId,
        metadata: { ...asset.metadata, projectIds: [...new Set([...linkedProjectIds, domainProjectId])] },
    });
    await saveRemoteUserDataNow();
    throwIfAborted(signal);
}

function generationTaskResult(task: GenerationTask): BackendGenerationResult {
    if (task.resultJson) return parseBackendGenerationResult(task);
    if (!task.previewUrl) return {};
    return task.previewKind === "video" ? { mode: "video", video: { dataUrl: task.previewUrl } } : { mode: "image", images: [{ dataUrl: task.previewUrl }] };
}

export function projectGenerationTaskResult(task: GenerationTask, result?: BackendGenerationResult): GenerationTask {
    const projectedResult = result ?? generationTaskResult(task);
    const outputs: GenerationTaskOutput[] = projectedResult.images?.length
        ? projectedResult.images.map((image, outputIndex) => ({
              outputIndex,
              mediaType: "image" as const,
              ...(image.storageKey ? { providerArtifactRef: image.storageKey } : {}),
          }))
        : projectedResult.video
          ? [
                {
                    outputIndex: 0,
                    mediaType: "video" as const,
                    ...(projectedResult.video.storageKey ? { providerArtifactRef: projectedResult.video.storageKey } : {}),
                },
            ]
          : projectedResult.audio
            ? [
                  {
                      outputIndex: 0,
                      mediaType: "audio" as const,
                      ...(projectedResult.audio.storageKey ? { providerArtifactRef: projectedResult.audio.storageKey } : {}),
                  },
              ]
            : (task.outputs?.map((output) => ({ ...output })) ?? []);

    return {
        ...task,
        ...(result ? { resultJson: JSON.stringify(result) } : {}),
        outputs,
        ...(task.status === "succeeded" && outputs.length && !outputs.every((output) => output.materializedAssetId) ? { resultState: "PENDING_MATERIALIZATION" as const } : {}),
    };
}

async function storedGenerationImage(result: NonNullable<BackendGenerationResult["images"]>[number], effectKey: string, scope: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    if (result.storageKey) {
        const url = await resolveImageUrl(result.storageKey, result.dataUrl);
        if (!url) throw new Error("图片结果资源不可用");
        const meta = result.width && result.height ? undefined : await readImageMeta(url, signal);
        throwIfAborted(signal);
        return {
            url,
            storageKey: result.storageKey,
            width: result.width || meta?.width || 1024,
            height: result.height || meta?.height || 1024,
            bytes: result.bytes || 0,
            mimeType: result.mimeType || "image/png",
        };
    }
    const storageKey = generationArtifactStorageKey(effectKey, "image", scope);
    const blob = await loadOrStoreGenerationArtifact({
        effectKey: storageKey,
        read: (key) => getImageBlob(key),
        materialize: async () => (await fetch(result.dataUrl, { signal })).blob(),
        write: async (key, artifact) => {
            await setImageBlob(key, artifact);
        },
    });
    throwIfAborted(signal);
    const url = await resolveImageUrl(storageKey);
    throwIfAborted(signal);
    if (!url) throw new Error("图片结果资源不可用");
    const meta = result.width && result.height ? undefined : await readImageMeta(url, signal);
    throwIfAborted(signal);
    return {
        url,
        storageKey,
        width: result.width || meta?.width || 1024,
        height: result.height || meta?.height || 1024,
        bytes: result.bytes || blob.size,
        mimeType: result.mimeType || blob.type || "image/png",
    };
}

async function storedGenerationMedia(dataUrl: string, effectKey: string, mediaType: "video" | "audio", metadata: { width?: number; height?: number; durationMs?: number; bytes?: number; mimeType: string }, scope: string, signal?: AbortSignal) {
    throwIfAborted(signal);
    const storageKey = generationArtifactStorageKey(effectKey, mediaType, scope);
    const blob = await loadOrStoreGenerationArtifact({
        effectKey: storageKey,
        read: (key) => getMediaBlob(key),
        materialize: async () => (await fetch(dataUrl, { signal })).blob(),
        write: async (key, artifact) => {
            await setMediaBlob(key, artifact);
        },
    });
    throwIfAborted(signal);
    const url = await resolveMediaUrl(storageKey);
    throwIfAborted(signal);
    if (!url) throw new Error(`${mediaType === "video" ? "视频" : "音频"}结果资源不可用`);
    return {
        url,
        storageKey,
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        bytes: metadata.bytes || blob.size,
        mimeType: metadata.mimeType || blob.type,
    };
}

async function generationOutputAsset(input: Parameters<MaterializeGenerationTaskOutput>[0], scope: string): Promise<NewAsset> {
    throwIfAborted(input.signal);
    const result = generationTaskResult(input.task);
    const metadata = {
        source: "generation-task",
        generationEffectKey: input.effectKey,
        taskId: input.task.id,
        outputIndex: input.output.outputIndex,
        conversationId: input.task.clientContext?.conversationId,
        messageId: input.task.clientContext?.messageId,
        batchIndex: input.task.clientContext?.batchIndex,
    };

    if (input.output.mediaType === "image") {
        const image = result.images?.[input.output.outputIndex];
        if (!image) throw new Error("生成任务缺少图片输出");
        const stored = await storedGenerationImage(image, input.effectKey, scope, input.signal);
        return {
            kind: "image",
            title: "生成图片",
            coverUrl: stored.url,
            tags: ["生成"],
            status: "confirmed",
            source: "生成任务",
            metadata,
            data: {
                dataUrl: stored.url,
                storageKey: stored.storageKey,
                width: stored.width,
                height: stored.height,
                bytes: stored.bytes,
                mimeType: stored.mimeType,
            },
        };
    }

    if (input.output.mediaType === "video") {
        const video = result.video;
        if (!video) throw new Error("生成任务缺少视频输出");
        const stored = video.storageKey
            ? {
                  url: await resolveMediaUrl(video.storageKey, video.dataUrl),
                  storageKey: video.storageKey,
                  width: video.width || 0,
                  height: video.height || 0,
                  durationMs: video.durationMs,
                  bytes: video.bytes || 0,
                  mimeType: video.mimeType || "video/mp4",
              }
            : await storedGenerationMedia(
                  video.dataUrl,
                  input.effectKey,
                  "video",
                  {
                      width: video.width,
                      height: video.height,
                      durationMs: video.durationMs,
                      bytes: video.bytes,
                      mimeType: video.mimeType || "video/mp4",
                  },
                  scope,
                  input.signal,
              );
        if (!stored.url) throw new Error("视频结果资源不可用");
        return {
            kind: "video",
            title: "生成视频",
            coverUrl: stored.url,
            tags: ["生成"],
            status: "confirmed",
            source: "生成任务",
            metadata,
            data: {
                url: stored.url,
                storageKey: stored.storageKey,
                width: stored.width || 0,
                height: stored.height || 0,
                durationMs: stored.durationMs,
                bytes: stored.bytes,
                mimeType: stored.mimeType || "video/mp4",
            },
        };
    }

    const audio = result.audio;
    if (!audio) throw new Error("生成任务缺少音频输出");
    const stored = audio.storageKey
        ? {
              url: await resolveMediaUrl(audio.storageKey, audio.dataUrl),
              storageKey: audio.storageKey,
              durationMs: audio.durationMs,
              bytes: audio.bytes || 0,
              mimeType: audio.mimeType || "audio/mpeg",
          }
        : await storedGenerationMedia(
              audio.dataUrl,
              input.effectKey,
              "audio",
              {
                  durationMs: audio.durationMs,
                  bytes: audio.bytes,
                  mimeType: audio.mimeType || "audio/mpeg",
              },
              scope,
              input.signal,
          );
    if (!stored.url) throw new Error("音频结果资源不可用");
    return {
        kind: "audio",
        title: "生成音频",
        coverUrl: "",
        tags: ["生成"],
        status: "confirmed",
        source: "生成任务",
        metadata,
        data: {
            url: stored.url,
            storageKey: stored.storageKey,
            durationMs: stored.durationMs,
            bytes: stored.bytes,
            mimeType: stored.mimeType || "audio/mpeg",
        },
    };
}

let generationTaskEffectStoreInstance: ReturnType<typeof createLocalDreaminaTaskEffectStore> | undefined;

function generationTaskEffectStore() {
    generationTaskEffectStoreInstance ??= createLocalDreaminaTaskEffectStore();
    return generationTaskEffectStoreInstance;
}

const materializeGenerationOutput: MaterializeGenerationTaskOutput = createIdempotentMaterializeOutput({
    async insertOrReturnAsset(input) {
        const scope = getActiveUserScope();
        const assetId = await withGenerationArtifactCommitLock(
            scope,
            async () => {
                throwIfAborted(input.signal);
                const asset = await generationOutputAsset(input, scope);
                throwIfAborted(input.signal);
                const createdAssetId = await useAssetStore.getState().addGenerationAsset(input.effectKey, asset, input.signal);
                throwIfAborted(input.signal);
                return createdAssetId;
            },
            { requireCrossRealmLock: true },
        );
        const storedAsset = useAssetStore.getState().assets.find((candidate) => candidate.id === assetId);
        if (storedAsset) {
            const syncResult = await uploadGeneratedAssetToConfiguredSources(storedAsset, input.signal);
            throwIfAborted(input.signal);
            if (syncResult.records.length) {
                const currentAsset = useAssetStore.getState().assets.find((candidate) => candidate.id === assetId) || storedAsset;
                useAssetStore.getState().updateAsset(assetId, {
                    metadata: { ...currentAsset.metadata, externalSync: syncResult.records },
                });
            }
        }
        return assetId;
    },
});

const dreaminaGenerationTaskMaterializer = createGenerationTaskMaterializer({
    effects: {
        claim: (effectKey, taskId) => generationTaskEffectStore().claim(effectKey, taskId),
        renew: (effectKey, taskId) => generationTaskEffectStore().renew(effectKey, taskId),
        complete: (effectKey, taskId, result) => generationTaskEffectStore().complete(effectKey, taskId, result),
        release: (effectKey, taskId) => generationTaskEffectStore().release(effectKey, taskId),
    },
    materializeOutput: materializeGenerationOutput,
});

function remoteGenerationTaskMaterializer() {
    return createGenerationTaskMaterializer({
        // 每个页面实例持有自己的租约；共享浏览器 storage + Web Lock 提供跨标签原子权威。
        effects: createProviderNeutralGenerationTaskEffectStore(),
        materializeOutput: materializeGenerationOutput,
    });
}

function generationTaskMaterializer(task: GenerationTask) {
    return task.provider === "dreamina-cli" ? dreaminaGenerationTaskMaterializer : remoteGenerationTaskMaterializer();
}

export async function materializeGenerationTaskAssets(task: GenerationTask, signal?: AbortSignal): Promise<GenerationTask> {
    return generationTaskMaterializer(task).materialize(projectGenerationTaskResult(task), signal);
}

export function attachGenerationTaskNode(task: GenerationTask, nodeId: string, outputIndex: number, consumer: Parameters<typeof dreaminaGenerationTaskMaterializer.attachNode>[3], signal?: AbortSignal) {
    return generationTaskMaterializer(task).attachNode(task, nodeId, outputIndex, consumer, signal);
}

export function attachGenerationTaskMessage(task: GenerationTask, messageId: string, outputIndex: number, consumer: Parameters<typeof dreaminaGenerationTaskMaterializer.attachMessage>[3], signal?: AbortSignal) {
    return generationTaskMaterializer(task).attachMessage(task, messageId, outputIndex, consumer, signal);
}

export function resumeGenerationTaskAgent(task: GenerationTask, continuationId: string, consumer: Parameters<typeof dreaminaGenerationTaskMaterializer.resumeAgent>[2], signal?: AbortSignal) {
    return generationTaskMaterializer(task).resumeAgent(task, continuationId, consumer, signal);
}

export async function consumeGenerationTaskNode(
    task: GenerationTask,
    nodeId: string,
    outputIndex: number,
    consumer: (input: { task: GenerationTask; output: GenerationTaskOutput; effectKey: string; signal?: AbortSignal }) => Promise<void> | void,
    dependencies: {
        signal?: AbortSignal;
        managed?: true;
        materialize?: typeof materializeGenerationTaskAssets;
        attachNode?: typeof attachGenerationTaskNode;
    } = {},
): Promise<GenerationTask> {
    if (!dependencies.managed) {
        return runGenerationConsumer(dependencies.signal, (signal) => consumeGenerationTaskNode(task, nodeId, outputIndex, consumer, { ...dependencies, signal, managed: true }));
    }
    const materialized = await (dependencies.materialize ?? materializeGenerationTaskAssets)(task, dependencies.signal);
    const output = materialized.outputs?.find((candidate) => candidate.outputIndex === outputIndex);
    if (!output?.materializedAssetId) throw new Error("生成任务输出尚未物化");
    await (dependencies.attachNode ?? attachGenerationTaskNode)(
        materialized,
        nodeId,
        outputIndex,
        async ({ effectKey, signal }) => {
            await consumer({ task: materialized, output, effectKey, signal });
        },
        dependencies.signal,
    );
    return materialized;
}

export async function consumeGenerationTaskAgent(
    task: GenerationTask,
    continuationId: string,
    consumer: (input: { task: GenerationTask; effectKey: string; signal?: AbortSignal }) => Promise<void> | void,
    dependencies: {
        signal?: AbortSignal;
        managed?: true;
        materialize?: typeof materializeGenerationTaskAssets;
        resumeAgent?: typeof resumeGenerationTaskAgent;
    } = {},
): Promise<GenerationTask> {
    if (!dependencies.managed) {
        return runGenerationConsumer(dependencies.signal, (signal) => consumeGenerationTaskAgent(task, continuationId, consumer, { ...dependencies, signal, managed: true }));
    }
    const materialized = task.outputs?.length ? await (dependencies.materialize ?? materializeGenerationTaskAssets)(task, dependencies.signal) : task;
    await (dependencies.resumeAgent ?? resumeGenerationTaskAgent)(
        materialized,
        continuationId,
        async ({ effectKey, signal }) => {
            await consumer({ task: materialized, effectKey, signal });
        },
        dependencies.signal,
    );
    return materialized;
}

export async function consumeGenerationTaskMessage(
    task: GenerationTask,
    messageId: string,
    consumer: (input: { task: GenerationTask; resultUrls: string[]; effectKey: string; signal?: AbortSignal }) => Promise<void> | void,
    dependencies: {
        signal?: AbortSignal;
        managed?: true;
        materialize?: typeof materializeGenerationTaskAssets;
        materializedUrls?: typeof generationTaskMaterializedUrls;
        attachMessage?: typeof attachGenerationTaskMessage;
    } = {},
): Promise<GenerationTask> {
    if (!dependencies.managed) {
        return runGenerationConsumer(dependencies.signal, (signal) => consumeGenerationTaskMessage(task, messageId, consumer, { ...dependencies, signal, managed: true }));
    }
    const materialized = await (dependencies.materialize ?? materializeGenerationTaskAssets)(task, dependencies.signal);
    const resultUrls = (dependencies.materializedUrls ?? generationTaskMaterializedUrls)(materialized);
    const attach = dependencies.attachMessage ?? attachGenerationTaskMessage;
    const outputs = materialized.outputs?.filter((output) => output.materializedAssetId) ?? [];
    for (const output of outputs) {
        await attach(
            materialized,
            messageId,
            output.outputIndex,
            async ({ effectKey, signal }) => {
                await consumer({ task: materialized, resultUrls, effectKey, signal });
            },
            dependencies.signal,
        );
    }
    return materialized;
}

export function generationTaskMaterializedUrls(task: GenerationTask): string[] {
    const assets = useAssetStore.getState().assets;
    return (task.outputs || []).flatMap((output) => {
        const asset = output.materializedAssetId ? assets.find((candidate) => candidate.id === output.materializedAssetId) : undefined;
        if (!asset) return [];
        if (asset.kind === "image") return [asset.data.dataUrl || asset.coverUrl];
        if (asset.kind === "video" || asset.kind === "audio") return [asset.data.url];
        return [];
    });
}
