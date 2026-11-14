import { createClientUUID } from "@/lib/client-id";
import { normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { getActiveUserScope } from "@/lib/user-scope";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, imageToDataUrl, setImageBlob } from "@/services/image-storage";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import { generationArtifactStorageKey } from "@/services/generation-artifact-sink";
import { requestYingceGeneration, resolveYingceSystemModel, serializeYingceImageForm, type YingceRecoveryContext } from "@/services/api/yingce-lite-ipc";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { parseYingceTextResponse, prepareYingceTextRequest } from "@/services/api/yingce-lite-text";
import { YINGCE_RECEIPT_PREFIX, yingceReceiptStore } from "@/services/api/yingce-lite-receipts";
import type { ResponseFunctionTool, ResponseInputMessage, ToolChoice } from "@/services/api/image-contracts";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

type Options = {
    config: AiConfig;
    prompt: string;
    messages: ResponseInputMessage[];
    tools?: ResponseFunctionTool[];
    toolChoice?: ToolChoice;
    projectId?: string;
    metadata?: Record<string, unknown>;
    signal?: AbortSignal;
    expectedScope?: string;
    onIntentPrepared?: (id: string) => Promise<void>;
};

async function prepareIntent(options: Pick<Options, "onIntentPrepared" | "signal">, id: string, scope: string, currentScope: () => string) {
    await options.onIntentPrepared?.(id);
    if (scope !== currentScope()) throw new Error("账号已切换，请重新发起生成");
    if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
}

function recoveryContext(options: Pick<Options, "prompt" | "projectId" | "metadata">, id: string, capability: YingceRecoveryContext["capability"], model: string): YingceRecoveryContext {
    const nodeId = options.metadata?.nodeId;
    const workbench = options.metadata?.workbench;
    const batch = workbench && typeof workbench === "object" ? (workbench as Record<string, unknown>).batch : undefined;
    const info = batch && typeof batch === "object" ? (batch as Record<string, unknown>) : undefined;
    return {
        id,
        capability,
        prompt: options.prompt,
        model,
        createdAt: new Date().toISOString(),
        ...(options.projectId ? { projectId: options.projectId } : {}),
        ...(typeof nodeId === "string" && nodeId ? { nodeId } : {}),
        ...(typeof options.metadata?.sourceNodeId === "string" && options.metadata.sourceNodeId ? { sourceNodeId: options.metadata.sourceNodeId } : {}),
        ...(typeof options.metadata?.domainProjectId === "string" && options.metadata.domainProjectId ? { domainProjectId: options.metadata.domainProjectId } : {}),
        ...(typeof options.metadata?.edit === "string" && options.metadata.edit ? { edit: options.metadata.edit } : {}),
        ...(options.metadata?.layerDecomposition === true ? { layerDecomposition: true } : {}),
        ...(info && typeof info.id === "string" && info.id && Number.isSafeInteger(info.index) && Number.isSafeInteger(info.count) && (info.index as number) >= 0 && (info.count as number) >= 0
            ? { batchId: info.id, batchIndex: info.index as number, batchCount: info.count as number }
            : {}),
    };
}

export async function yingceTextMessagesWithImages(
    prompt: string,
    history: ResponseInputMessage[],
    images: ReferenceImage[],
    dependencies = { convert: imageToDataUrl, scope: getActiveUserScope },
): Promise<{ messages: ResponseInputMessage[]; scope: string }> {
    const scope = dependencies.scope();
    if (!scope || scope === "guest") throw new Error("请先登录后生成");
    const urls = await Promise.all(images.map((image) => dependencies.convert(image)));
    if (scope !== dependencies.scope()) throw new Error("账号已切换，请重新发起生成");
    if (urls.some((url) => !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i.test(url))) throw new Error("参考图片无法读取，请重新选择");
    if (urls.reduce((size, url) => size + url.length, 0) > 15 * 1024 * 1024) throw new Error("参考图片过大，请减少图片后重试");
    return { scope, messages: [...history, { role: "user", content: urls.length ? [{ type: "text", text: prompt }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt }] };
}

export async function runYingceImageGeneration(
    options: Omit<Options, "messages" | "tools" | "toolChoice"> & { referenceImages?: ReferenceImage[]; mask?: ReferenceImage },
    dependencies = {
        request: requestYingceGeneration,
        save: (task: GenerationTask, scope: string) => yingceReceiptStore.save(task, scope),
        write: setImageBlob,
        read: getImageBlob,
        lock: withGenerationArtifactCommitLock,
        scope: getActiveUserScope,
        createId: createClientUUID,
        fetch: globalThis.fetch,
    },
) {
    if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const scope = dependencies.scope();
    if (!scope || scope === "guest") throw new Error("请先登录后生成");
    const selected = resolveYingceSystemModel(options.config, "image");
    if (!["openai-image", "gemini-image", "grok-image", "volcengine-ark-image", "volcengine-ark-agent-plan-image"].includes(selected.model.protocol || "")) throw new Error("该图片模型协议暂不支持，请选择其他模型");
    const id = YINGCE_RECEIPT_PREFIX + dependencies.createId();
    const recovery = { ...recoveryContext(options, id, "image", selected.modelKey), protocol: selected.model.protocol };
    // A catalog can advertise the same model key for several capabilities.
    // The existing serializer resolves its protocol by the first matching model,
    // so keep the selected image entry first for this request only.
    const imageConfig = {
        ...options.config,
        channels: options.config.channels.map((channel) => (channel.yingceChannelId === selected.channelId ? { ...channel, modelCosts: [selected.model, ...(channel.modelCosts || []).filter((item) => item !== selected.model)] } : channel)),
    };
    const references = options.referenceImages || [];
    let dispatched = false;
    const requestOptions = {
        imageRequest: async (providerPath: string, body: Record<string, unknown> | FormData) => {
            if (dispatched) throw new Error("该生成意图已提交，请核对结果后再手动发起新请求。");
            dispatched = true;
            const content = body instanceof FormData ? { multipart: await serializeYingceImageForm(body) } : { body };
            await prepareIntent(options, id, scope, dependencies.scope);
            return dependencies.request({ channelId: selected.channelId, capability: "image", providerPath, recovery, ...content }, { retainForOriginalScope: true });
        },
    };
    const images = references.length || options.mask ? await requestEdit(imageConfig, options.prompt, references, options.mask, requestOptions) : await requestGeneration(imageConfig, options.prompt, requestOptions);
    const blobs = await Promise.all(
        images.map(async ({ dataUrl }) => {
            if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) && !/^https:\/\//i.test(dataUrl)) throw new Error("图片服务返回了不支持的地址，生成结果未保存");
            const response = await dependencies.fetch(dataUrl, { credentials: "omit", redirect: "error" });
            if (!response.ok) throw new Error("图片生成完成，但下载失败；请核对结果");
            const blob = await response.blob();
            if (!/^image\/[a-z0-9.+-]+$/i.test(blob.type) || !blob.size || blob.size > 50 * 1024 * 1024) throw new Error("图片生成完成，但返回的图片无效或过大");
            return blob;
        }),
    );
    const now = new Date().toISOString();
    const storedImages = blobs.map((blob, index) => ({ dataUrl: "", storageKey: generationArtifactStorageKey(`${id}:${index}`, "image", scope), bytes: blob.size, mimeType: blob.type }));
    const workbench = options.metadata?.workbench;
    const batch = workbench && typeof workbench === "object" ? (workbench as Record<string, unknown>).batch : undefined;
    const batchInfo = batch && typeof batch === "object" ? (batch as Record<string, unknown>) : undefined;
    const clientContext =
        batchInfo && typeof batchInfo.id === "string" && batchInfo.id && Number.isInteger(batchInfo.index) && Number.isInteger(batchInfo.count)
            ? { batchId: batchInfo.id, batchIndex: batchInfo.index as number, batchCount: batchInfo.count as number }
            : undefined;
    const task: GenerationTask = {
        id,
        type: "canvas_image",
        status: "succeeded",
        prompt: options.prompt,
        model: selected.modelKey,
        ...(clientContext ? { clientContext } : {}),
        ...(options.projectId ? { projectId: options.projectId } : {}),
        inputJson: JSON.stringify({ mode: "image", metadata: options.metadata || {} }),
        resultJson: JSON.stringify({ mode: "image", images: storedImages }),
        attempts: 1,
        progress: 100,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
    };
    await dependencies.lock(scope, async () => {
        for (const [index, image] of storedImages.entries()) {
            await dependencies.write(image.storageKey, blobs[index]);
            const stored = await dependencies.read(image.storageKey);
            if (!stored || stored.size !== blobs[index].size || stored.type !== blobs[index].type) throw new Error("图片生成完成，但本地保存失败；请检查本地存储");
        }
        await dependencies.save(task, scope);
    });
    if (scope !== dependencies.scope()) throw new Error("账号已切换，结果已保存到原账号");
    if (options.signal?.aborted) throw new DOMException("请求已停止，结果已保存", "AbortError");
    return { task };
}

export async function runYingceTextGeneration(
    options: Options,
    dependencies = { request: requestYingceGeneration, save: (task: GenerationTask, scope: string) => yingceReceiptStore.save(task, scope), scope: getActiveUserScope, createId: createClientUUID },
) {
    if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const scope = dependencies.scope();
    if (!scope || scope === "guest") throw new Error("请先登录后生成");
    if (options.expectedScope && scope !== options.expectedScope) throw new Error("账号已切换，请重新发起生成");
    const selected = resolveYingceSystemModel(options.config, "text");
    const prepared = prepareYingceTextRequest({ ...options.config, model: selected.modelKey }, selected.model.textWire, options.messages, options.tools, options.toolChoice);
    const id = YINGCE_RECEIPT_PREFIX + dependencies.createId();
    const recovery = { ...recoveryContext(options, id, "text", selected.modelKey), textWire: prepared.textWire };
    await prepareIntent(options, id, scope, dependencies.scope);
    // Keep waiting after dispatch even if the view closes so a paid result can be saved.
    const payload = await dependencies.request({ channelId: selected.channelId, capability: "text", providerPath: prepared.providerPath, body: prepared.body, recovery }, { retainForOriginalScope: true });
    const parsed = parseYingceTextResponse(prepared.textWire, payload);
    const now = new Date().toISOString();
    const task: GenerationTask = {
        id,
        type: "canvas_text",
        status: "succeeded",
        prompt: options.prompt,
        model: selected.modelKey,
        ...(options.projectId ? { projectId: options.projectId } : {}),
        inputJson: JSON.stringify({ mode: "text", metadata: options.metadata || {} }),
        resultJson: JSON.stringify({ mode: "text", text: parsed.content, toolCalls: parsed.toolCalls, ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}) }),
        attempts: 1,
        progress: 100,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
    };
    await dependencies.save(task, scope);
    if (scope !== dependencies.scope()) throw new Error("账号已切换，结果已保存到原账号");
    if (options.signal?.aborted) throw new DOMException("请求已停止，结果已保存", "AbortError");
    return { task, result: parsed };
}

export async function runYingceAudioGeneration(
    options: Omit<Options, "messages" | "tools" | "toolChoice">,
    dependencies = {
        request: requestYingceGeneration,
        save: (task: GenerationTask, scope: string) => yingceReceiptStore.save(task, scope),
        write: setMediaBlob,
        read: getMediaBlob,
        lock: withGenerationArtifactCommitLock,
        scope: getActiveUserScope,
        createId: createClientUUID,
    },
) {
    if (options.signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    const scope = dependencies.scope();
    if (!scope || scope === "guest") throw new Error("请先登录后生成");
    const selected = resolveYingceSystemModel(options.config, "audio");
    if (selected.model.protocol !== "openai-audio") throw new Error("该语音模型协议暂不支持同步语音合成");
    const format = normalizeAudioFormatValue(options.config.audioFormat);
    const instructions = options.config.audioInstructions.trim();
    const id = YINGCE_RECEIPT_PREFIX + dependencies.createId();
    const recovery = { ...recoveryContext(options, id, "audio", selected.modelKey), format };
    await prepareIntent(options, id, scope, dependencies.scope);
    const payload = await dependencies.request(
        {
            channelId: selected.channelId,
            capability: "audio",
            providerPath: "/audio/speech",
            recovery,
            body: {
                model: selected.modelKey,
                input: options.prompt,
                voice: normalizeAudioVoiceValue(options.config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(options.config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
        },
        { retainForOriginalScope: true },
    );
    const audio = payload as { contentType?: unknown; bytes?: unknown } | null;
    if (!audio || typeof audio.contentType !== "string" || !/^audio\/[a-z0-9.+-]+$/i.test(audio.contentType) || !(audio.bytes instanceof Uint8Array) || !audio.bytes.byteLength) throw new Error("语音服务返回的音频无效");
    const blob = new Blob([new Uint8Array(audio.bytes)], { type: audio.contentType });
    const storageKey = generationArtifactStorageKey(id, "audio", scope);
    const now = new Date().toISOString();
    const task: GenerationTask = {
        id,
        type: "canvas_audio",
        status: "succeeded",
        prompt: options.prompt,
        model: selected.modelKey,
        ...(options.projectId ? { projectId: options.projectId } : {}),
        inputJson: JSON.stringify({ mode: "audio", metadata: options.metadata || {} }),
        resultJson: JSON.stringify({ mode: "audio", audio: { dataUrl: "", storageKey, bytes: blob.size, mimeType: blob.type, format } }),
        attempts: 1,
        progress: 100,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
    };
    await dependencies.lock(scope, async () => {
        await dependencies.write(storageKey, blob);
        const stored = await dependencies.read(storageKey);
        if (!stored || stored.size !== blob.size || stored.type !== blob.type) throw new Error("音频生成完成，但本地保存失败；请检查本地存储");
        await dependencies.save(task, scope);
    });
    if (scope !== dependencies.scope()) throw new Error("账号已切换，结果已保存到原账号");
    if (options.signal?.aborted) throw new DOMException("请求已停止，结果已保存", "AbortError");
    return { task };
}
