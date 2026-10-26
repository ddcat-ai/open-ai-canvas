import { scopedStorageKey } from "@/lib/user-scope";
import { browserGenerationScope, assertBrowserGenerationScope } from "@/lib/browser-generation-session";
import { assertPersonalOpenAIConfig } from "@/lib/personal-channel";
import { resolveModelRequestConfig, useConfigStore, encodeChannelModel, modelOptionName } from "@/stores/use-config-store";
import { requestGeneration, requestEdit, requestImageQuestion, type AiTextContentPart } from "@/services/api/image";
import { requestAudioGeneration } from "@/services/api/audio";
import { createVideoGenerationTask, pollVideoGenerationTask } from "@/services/api/video";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { setImageBlob, imageToDataUrl } from "@/services/image-storage";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import { readBrowserGeneration, writeBrowserGeneration, browserGenerationLock, type BrowserGenerationRecord } from "./browser-generation-store";
import type { BackendGenerationTaskOptions, BackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";

const running = new Map<string, AbortController>();
export function stopBrowserGenerationListeners() { for (const controller of running.values()) controller.abort(); }
export function isPersonalGeneration(options: Pick<BackendGenerationTaskOptions, "config">) {
    if ((options.config.taskWorkflowProvider || "model") !== "model") return false;
    return resolveModelRequestConfig(options.config, options.config.model).channelScope === "user";
}
export function assertBrowserGenerationOptions(options: BackendGenerationTaskOptions) {
    const config = resolveModelRequestConfig(options.config, options.config.model);
    assertPersonalOpenAIConfig(config);
    if (options.metadata?.promptTemplateOperation || options.metadata?.shotId || options.metadata?.chapterOperation || options.metadata?.artifactType) throw new Error("此受管生产流程依赖服务端模板或镜头回填，请选择系统渠道");
    if (/@\[tool:/u.test(options.prompt)) throw new Error("个人渠道暂不支持服务端工具提示词，请先将工具提示词展开为文本");
    if (options.referenceVideos?.length || options.referenceAudios?.length) throw new Error("标准 OpenAI 视频暂不支持参考视频或音频");
    if (options.mode === "video" && (options.referenceImages?.length || 0) > 1) throw new Error("标准 OpenAI 视频暂只支持一张参考图，请减少参考图后提交");
    if (!config.requestChannelId) throw new Error("请明确选择个人模型渠道");
    return config;
}
function assertScope(scope: string, signal?: AbortSignal) {
    assertBrowserGenerationScope(scope, signal);
}
function announce(task: GenerationTask) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("canvas:task-created", { detail: { task } }));
}
async function storeBlob(record: BrowserGenerationRecord, blob: Blob, kind: "image" | "video" | "audio", index: number, scope: string) {
    return withGenerationArtifactCommitLock(scope, async () => {
        assertScope(scope);
        const key = `${kind}:${scope}:${record.task.id}:${index}`;
        if (!blob.size || (blob.type && !blob.type.startsWith(`${kind}/`))) throw new Error("生成结果不是有效媒体文件");
        // pendingMedia/video is already durable and keeps this key alive until resultJson is committed.
        if (kind === "image") await setImageBlob(key, blob); else await setMediaBlob(key, blob);
        const stored = kind === "image" ? await import("@/services/image-storage").then((module) => module.getImageBlob(key)) : await getMediaBlob(key);
        assertScope(scope);
        if (!stored || stored.size !== blob.size) throw new Error("生成文件尚未可靠保存，请恢复文件下载，不要重新生成");
        return { dataUrl: "", storageKey: key, bytes: blob.size, mimeType: blob.type };
    }, { requireCrossRealmLock: true });
}
function currentRecordConfig(record: Pick<BrowserGenerationRecord, "channelId" | "baseUrl" | "protocol"> & { task: Pick<GenerationTask, "model"> }) {
    if (!record.task.model) throw new Error("原任务缺少模型标识，无法安全恢复");
    const current = useConfigStore.getState().config;
    const config = resolveModelRequestConfig(current, encodeChannelModel(record.channelId, modelOptionName(record.task.model)));
    assertPersonalOpenAIConfig(config);
    if (config.channelScope !== "user" || config.requestChannelId !== record.channelId || config.baseUrl !== record.baseUrl || (config.interfaceType || "") !== record.protocol) throw new Error("原渠道已变更，请恢复原渠道后继续查询");
    return config;
}
async function resultBlob(url: string, record: BrowserGenerationRecord, signal?: AbortSignal) {
    let headers: Record<string, string> | undefined;
    if (/^https?:/i.test(url) && new URL(url).origin === new URL(record.baseUrl).origin) {
        // Files served by the provider itself may require the same bearer key; never send it to a CDN.
        headers = channelRequest(currentRecordConfig(record), url).headers;
    }
    const response = await fetch(url, { headers, credentials: "omit", signal });
    if (!response.ok) throw new Error("生成文件下载失败，请恢复下载，不要重新生成");
    return response.blob();
}
async function finish(record: BrowserGenerationRecord, result: BackendGenerationResult, scope: string) {
    delete record.pendingMedia;
    record.task = { ...record.task, status: "succeeded", canRecoverMedia: false, progress: 100, stage: "completed", resultJson: JSON.stringify(result), completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: undefined };
    await writeBrowserGeneration(record, scope);
}
async function savePendingMedia(record: BrowserGenerationRecord, scope: string, signal?: AbortSignal) {
    const pending = record.pendingMedia;
    if (!pending) throw new Error("缺少生成结果，不能重新提交");
    const kind = pending.mode === "image" ? "image" : "audio";
    const items = [];
    for (const [index, source] of pending.sources.entries()) {
        assertScope(scope, signal);
        const key = `${kind}:${scope}:${record.task.id}:${index}`;
        const existing = kind === "image" ? await import("@/services/image-storage").then((module) => module.getImageBlob(key)) : await getMediaBlob(key);
        const blob = existing || (typeof source === "string" ? await resultBlob(source, record, signal) : source);
        items.push(await storeBlob(record, blob, kind, index, scope));
    }
    if (pending.mode === "image") await finish(record, { mode: "image", images: items }, scope);
    else await finish(record, { mode: "audio", audio: items[0] }, scope);
}
async function pollVideo(record: BrowserGenerationRecord, config: ReturnType<typeof resolveModelRequestConfig>, scope: string, signal: AbortSignal) {
    if (!record.video) throw new Error("视频任务缺少上游句柄");
    for (let attempt = 0; attempt < 360; attempt++) {
        assertScope(scope, signal);
        const state = await pollVideoGenerationTask(config, record.video, { signal });
        assertScope(scope, signal);
        if (state.status === "failed") throw new Error(state.error);
        if (state.status === "completed") {
            const blob = state.result.blob || await resultBlob(state.result.url || "", record, signal);
            const video = await storeBlob(record, blob, "video", 0, scope);
            await finish(record, { mode: "video", video }, scope);
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 2500);
            signal.addEventListener("abort", abort, { once: true });
        });
    }
    throw new Error("视频仍未完成；可继续查询原任务，请勿重新生成");
}
async function fail(record: BrowserGenerationRecord, error: unknown, scope: string) {
    const recoverable = Boolean(record.video || record.pendingMedia);
    record.task = { ...record.task, status: "failed", canRecoverMedia: recoverable, stage: recoverable ? "query_paused" : "submission_unknown", error: `${recoverable ? "查询或文件保存暂停，可继续恢复原结果" : "提交结果未知，禁止自动重发，请核对上游记录"}。${error instanceof Error ? error.message : "连接已中断"}`, updatedAt: new Date().toISOString() };
    await writeBrowserGeneration(record, scope);
}
export async function submitBrowserGeneration(options: BackendGenerationTaskOptions): Promise<GenerationTask> {
    const config = assertBrowserGenerationOptions(options);
    const scope = browserGenerationScope();
    assertScope(scope, options.signal);
    const live = currentRecordConfig({ task: { model: config.model }, channelId: config.requestChannelId!, baseUrl: config.baseUrl, protocol: config.interfaceType || "" });
    if (live.apiKey !== config.apiKey || JSON.stringify(live.headers || []) !== JSON.stringify(config.headers || [])) throw new Error("个人渠道配置已变更，请刷新页面后重新选择渠道");
    const operation = options.clientOperationId || crypto.randomUUID();
    const id = `browser:${operation}`;
    let fresh = false;
    const record = await browserGenerationLock(id + ":submit", async () => {
        try { const existing = await readBrowserGeneration(id, scope); return existing; }
        catch (error) { if (!(error instanceof Error) || !error.message.startsWith("本机任务记录不存在")) throw error; }
        const now = new Date().toISOString();
        const metadata = options.metadata || {};
        const task: GenerationTask = {
            id, executionSource: "browser", clientOperationId: operation, projectId: options.projectId,
            type: `canvas_${options.mode}`, operation: options.mode, prompt: options.prompt, model: config.model,
            status: "running", stage: "submitting", attempts: 1, createdAt: now, updatedAt: now,
            clientContext: {
                ...(typeof metadata.nodeId === "string" ? { nodeId: metadata.nodeId } : {}),
                ...(typeof metadata.conversationId === "string" ? { conversationId: metadata.conversationId } : {}),
                ...(typeof metadata.messageId === "string" ? { messageId: metadata.messageId } : {}),
                ...(typeof metadata.batchIndex === "number" ? { batchIndex: metadata.batchIndex } : {}),
                ...(typeof metadata.batchCount === "number" ? { batchCount: metadata.batchCount } : {}),
            },
        };
        const next: BrowserGenerationRecord = { task, channelId: config.requestChannelId!, baseUrl: config.baseUrl, protocol: config.interfaceType || "" };
        await writeBrowserGeneration(next, scope);
        fresh = true;
        return next;
    }, scope);
    assertScope(scope, options.signal);
    if (fresh) {
        announce(record.task);
        const controller = new AbortController();
        running.set(scopedStorageKey(id, scope), controller);
        // An observer stopping does not imply a provider cancellation; never start a second submission.
        void browserGenerationLock(id, async () => {
            try {
                assertScope(scope, controller.signal);
                const references = await Promise.all((options.referenceImages || []).map(async (image) => ({ ...image, storageKey: undefined, url: undefined, dataUrl: await imageToDataUrl(image) })));
                const mask = options.mask ? { ...options.mask, storageKey: undefined, url: undefined, dataUrl: await imageToDataUrl(options.mask) } : undefined;
                assertScope(scope, controller.signal);
                if (options.mode === "video") {
                    record.video = await createVideoGenerationTask(config, options.prompt, references, [], [], { signal: controller.signal });
                    record.task.stage = "submitted";
                    record.task.providerRequestId = record.video.id;
                    await writeBrowserGeneration(record, scope);
                    await pollVideo(record, config, scope, controller.signal);
                } else if (options.mode === "image") {
                    const images = references.length || mask ? await requestEdit(config, options.prompt, references, mask, { signal: controller.signal }) : await requestGeneration(config, options.prompt, { signal: controller.signal });
                    record.pendingMedia = { mode: "image", sources: images.map((image) => image.dataUrl) };
                    await writeBrowserGeneration(record, scope);
                    await savePendingMedia(record, scope, controller.signal);
                } else if (options.mode === "audio") {
                    const blob = await requestAudioGeneration(config, options.prompt, { signal: controller.signal });
                    record.pendingMedia = { mode: "audio", sources: [blob] };
                    await writeBrowserGeneration(record, scope);
                    await savePendingMedia(record, scope, controller.signal);
                } else {
                    const content: string | AiTextContentPart[] = references.length ? [{ type: "text", text: options.prompt }, ...references.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl! } }))] : options.prompt;
                    const text = await requestImageQuestion(config, [...(options.textHistory || []), { role: "user", content }], (delta) => { try { assertScope(scope, controller.signal); options.onTextDelta?.(delta); } catch { controller.abort(); } }, { signal: controller.signal });
                    await finish(record, { mode: "text", text }, scope);
                }
            } catch (error) { await fail(record, error, scope); }
            finally { running.delete(scopedStorageKey(id, scope)); }
        }, scope).catch((error) => { console.error("本机生成记录保存失败", error); });
    }
    return record.task;
}
export async function queryBrowserGeneration(id: string, options?: { signal?: AbortSignal }) {
    const scope = browserGenerationScope();
    assertScope(scope, options?.signal);
    const pending = await readBrowserGeneration(id, scope);
    // If another tab still owns execution, observe its durable state rather than marking it unknown.
    if (!running.has(scopedStorageKey(id, scope)) && (pending.task.status === "running" || pending.task.status === "queued")) {
        if (typeof navigator !== "undefined" && navigator.locks) {
            const locks = await navigator.locks.query();
            assertScope(scope, options?.signal);
            const held = locks.held?.some((lock) => lock.name === scopedStorageKey("yingce:browser-generation:" + id, scope));
            if (held) return pending.task;
        }
    }
    const record = pending;
    if (running.has(scopedStorageKey(id, scope)) || record.task.status === "succeeded") return record.task;
    if (record.pendingMedia) {
        await browserGenerationLock(id, async () => {
            const latest = await readBrowserGeneration(id, scope);
            if (latest.task.status === "succeeded") return;
            try { await savePendingMedia(latest, scope, options?.signal); }
            catch (error) { await fail(latest, error, scope); }
        }, scope);
        return (await readBrowserGeneration(id, scope)).task;
    }
    if (!record.video) {
        if (record.task.status === "running" || record.task.status === "queued") await fail(record, new Error("执行页面已关闭，无法判断同步请求是否完成"), scope);
        return record.task;
    }
    // Only GET/download can resume. The original channel must still exist with the same endpoint/protocol.
    await browserGenerationLock(id, async () => {
        const latest = await readBrowserGeneration(id, scope);
        if (latest.task.status === "succeeded") return;
        try {
            const config = currentRecordConfig(latest);
            assertScope(scope, options?.signal);
            const state = await pollVideoGenerationTask(config, latest.video!, options);
            assertScope(scope, options?.signal);
            if (state.status === "failed") throw new Error(state.error);
            if (state.status === "completed") await finish(latest, { mode: "video", video: await storeBlob(latest, state.result.blob || await resultBlob(state.result.url || "", latest, options?.signal), "video", 0, scope) }, scope);
            else { latest.task.status = "running"; latest.task.stage = "submitted"; latest.task.error = undefined; await writeBrowserGeneration(latest, scope); }
        } catch (error) { await fail(latest, error, scope); }
    }, scope);
    return (await readBrowserGeneration(id, scope)).task;
}
