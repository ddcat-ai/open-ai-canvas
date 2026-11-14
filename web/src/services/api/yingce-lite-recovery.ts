import { isTextWire } from "@/lib/model-protocols";
import { getActiveUserScope } from "@/lib/user-scope";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import { withGenerationArtifactCommitLock } from "@/services/generation-asset-repository";
import { generationArtifactStorageKey } from "@/services/generation-artifact-sink";
import { parseGeminiImagePayload, parseImagePayload } from "@/services/api/image-response";
import type { GeminiPayload, ImageApiResponse } from "@/services/api/image-contracts";
import { acknowledgeYingceGeneration, readYingceGenerationJournal, type YingceJournalRecord } from "@/services/api/yingce-lite-ipc";
import { yingceReceiptStore } from "@/services/api/yingce-lite-receipts";
import { parseYingceTextResponse } from "@/services/api/yingce-lite-text";
import type { GenerationTask } from "@/services/api/task-center";

const defaults = {
    readJournal: readYingceGenerationJournal,
    acknowledge: acknowledgeYingceGeneration,
    getReceipt: (id: string, scope: string) => yingceReceiptStore.get(id, scope),
    saveReceipt: (task: GenerationTask, scope: string) => yingceReceiptStore.saveIfAbsent(task, scope),
    scope: getActiveUserScope,
    lock: withGenerationArtifactCommitLock,
    writeImage: setImageBlob,
    readImage: getImageBlob,
    writeAudio: setMediaBlob,
    readAudio: getMediaBlob,
    fetch: globalThis.fetch,
};

const inFlight = new Map<string, Promise<RecoverySummary>>();
type RecoverySummary = { restored: number; failures: string[]; unknown: number; pendingIds: string[] };

export async function waitForYingceRecoveredReceipt(
    id: string,
    signal: AbortSignal,
    dependencies: { recover: () => Promise<RecoverySummary>; get: () => Promise<GenerationTask | undefined>; wait: (signal: AbortSignal) => Promise<void> },
): Promise<GenerationTask> {
    for (;;) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const summary = await dependencies.recover();
        const receipt = await dependencies.get();
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (receipt) return receipt;
        if (!summary.pendingIds.includes(id)) throw new Error("本地生成状态未确认，请核对结果后再手动发起新请求。");
        await dependencies.wait(signal);
    }
}

/** Restore only completed results. Unknown outcomes are never dispatched again. */
export function recoverYingceGenerations(dependencies: typeof defaults = defaults): Promise<RecoverySummary> {
    const scope = dependencies.scope();
    const existing = inFlight.get(scope);
    if (existing) return existing;
    const operation = recover(dependencies).finally(() => {
        if (inFlight.get(scope) === operation) inFlight.delete(scope);
    });
    inFlight.set(scope, operation);
    return operation;
}

async function recover(dependencies: typeof defaults): Promise<RecoverySummary> {
    const { owner, scope, records } = await dependencies.readJournal();
    const failures: string[] = [];
    let restored = 0;
    for (const record of records) {
        if (record.status === "invalid") {
            failures.push(record.context.id);
            continue;
        }
        if (record.status !== "completed") continue;
        try {
            if (scope !== dependencies.scope()) break;
            if (!(await dependencies.getReceipt(record.context.id, scope))) await commitResult(record, scope, dependencies);
            if (scope !== dependencies.scope()) break;
            await dependencies.acknowledge(owner, record.context.id, { expectedScope: scope });
            restored++;
        } catch {
            // Keep the journal record so a later recovery can retry local persistence.
            failures.push(record.context.id);
        }
    }
    return { restored, failures, unknown: records.filter((record) => record.status === "unknown").length, pendingIds: records.filter((record) => record.status === "pending").map((record) => record.context.id) };
}

async function commitResult(record: Exclude<YingceJournalRecord, { status: "invalid" }>, scope: string, dependencies: typeof defaults) {
    const context = record.context;
    const now = new Date().toISOString();
    const metadata = {
        ...(context.nodeId ? { nodeId: context.nodeId } : {}),
        ...(context.sourceNodeId ? { sourceNodeId: context.sourceNodeId } : {}),
        ...(context.domainProjectId ? { domainProjectId: context.domainProjectId } : {}),
        ...(context.edit ? { edit: context.edit } : {}),
        ...(context.layerDecomposition ? { layerDecomposition: true } : {}),
        ...(context.batchId ? { source: "workbench", workbenchKind: "image", workbench: { kind: "image", batch: { id: context.batchId, index: context.batchIndex, count: context.batchCount } } } : {}),
    };
    const task: GenerationTask = {
        id: context.id,
        type: `canvas_${context.capability}`,
        status: "succeeded",
        prompt: context.prompt,
        model: context.model,
        ...(context.projectId ? { projectId: context.projectId } : {}),
        ...(context.batchId && context.batchIndex !== undefined && context.batchCount !== undefined ? { clientContext: { batchId: context.batchId, batchIndex: context.batchIndex, batchCount: context.batchCount } } : {}),
        inputJson: JSON.stringify({ mode: context.capability, metadata }),
        attempts: 1,
        progress: 100,
        createdAt: context.createdAt,
        updatedAt: now,
        completedAt: now,
    };
    if (context.capability === "text") {
        if (!isTextWire(context.textWire)) throw new Error("文本恢复协议无效");
        const parsed = parseYingceTextResponse(context.textWire, record.result);
        task.resultJson = JSON.stringify({ mode: "text", text: parsed.content, toolCalls: parsed.toolCalls, ...(parsed.reasoning ? { reasoning: parsed.reasoning } : {}) });
        await dependencies.saveReceipt(task, scope);
        return;
    }
    await dependencies.lock(scope, async () => {
        if (context.capability === "audio") {
            const result = record.result as { contentType?: unknown; bytesBase64?: unknown } | null;
            if (!result || typeof result.contentType !== "string" || !/^audio\/[a-z0-9.+-]+$/i.test(result.contentType) || typeof result.bytesBase64 !== "string" || !/^[a-z0-9+/]+={0,2}$/i.test(result.bytesBase64)) throw new Error("音频恢复记录无效");
            const bytes = Uint8Array.from(atob(result.bytesBase64), (character) => character.charCodeAt(0));
            if (!bytes.length) throw new Error("音频恢复记录为空");
            const blob = new Blob([bytes], { type: result.contentType });
            const storageKey = generationArtifactStorageKey(context.id, "audio", scope);
            await dependencies.writeAudio(storageKey, blob);
            const stored = await dependencies.readAudio(storageKey);
            if (!stored || stored.size !== blob.size || stored.type !== blob.type) throw new Error("音频恢复保存失败");
            task.resultJson = JSON.stringify({ mode: "audio", audio: { dataUrl: "", storageKey, bytes: blob.size, mimeType: blob.type, format: context.format } });
        } else {
            const images = context.protocol === "gemini-image" ? parseGeminiImagePayload(record.result as GeminiPayload) : parseImagePayload(record.result as ImageApiResponse);
            const storedImages = [];
            for (const [index, image] of images.entries()) {
                if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(image.dataUrl) && !/^https:\/\//i.test(image.dataUrl)) throw new Error("图片恢复地址无效");
                const response = await dependencies.fetch(image.dataUrl, { credentials: "omit", redirect: "error" });
                if (!response.ok) throw new Error("图片恢复下载失败");
                const blob = await response.blob();
                if (!/^image\/[a-z0-9.+-]+$/i.test(blob.type) || !blob.size || blob.size > 50 * 1024 * 1024) throw new Error("图片恢复内容无效");
                const storageKey = generationArtifactStorageKey(`${context.id}:${index}`, "image", scope);
                await dependencies.writeImage(storageKey, blob);
                const stored = await dependencies.readImage(storageKey);
                if (!stored || stored.size !== blob.size || stored.type !== blob.type) throw new Error("图片恢复保存失败");
                storedImages.push({ dataUrl: "", storageKey, bytes: blob.size, mimeType: blob.type });
            }
            task.resultJson = JSON.stringify({ mode: "image", images: storedImages });
        }
        await dependencies.saveReceipt(task, scope);
    });
}
