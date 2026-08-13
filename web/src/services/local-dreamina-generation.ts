import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { LocalRuntimeClientError, type LocalRuntimeConnection } from "@/services/local-runtime-session";
import { getLocalRuntimeSessionClient } from "@/stores/use-local-runtime-store";
import type {
    GenerationTaskEffectClaim,
    GenerationTaskEffectResult,
    GenerationTaskEffectStore,
} from "@/services/generation-task-materializer";

const MAX_RESPONSE_BYTES = 256 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_TASK_LIST_RESPONSE_BYTES = 1024 * 1024;
const MAX_EFFECT_RESPONSE_BYTES = 16 * 1024;
const GENERATION_EFFECT_CONSUMER_ID = "web-generation-materializer";
const MAX_TASK_LIST_ITEMS = 100;
export const LOCAL_DREAMINA_WAIT_STOPPED_CODE = "dreamina_local_wait_stopped";
export const LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE = "仅停止本机等待，官方任务仍可能继续。";
export const LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_CODE = "dreamina_official_incomplete";
export const LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_MESSAGE = "官方任务未完成；可能已在官方取消或生成失败。";
export const LOCAL_DREAMINA_OFFICIAL_FAILED_CODE = "dreamina_official_failed";
export const LOCAL_DREAMINA_FAILED_OR_CANCELLED_MESSAGE = "任务未成功。当前 Dreamina CLI 无法可靠判断是官网取消还是生成失败。";
export const LOCAL_DREAMINA_OFFICIAL_FAILED_MESSAGE = LOCAL_DREAMINA_FAILED_OR_CANCELLED_MESSAGE;

export type LocalDreaminaTaskLifecycle = "QUEUED_LOCAL" | "SUBMITTING" | "SUBMISSION_UNCERTAIN" | "ACCEPTED" | "RUNNING" | "TERMINAL";
export type LocalDreaminaTerminalOutcome = "SUCCEEDED" | "REJECTED" | "FAILED" | "CANCELLED" | "FAILED_OR_CANCELLED";
export type LocalDreaminaTaskSyncState = "SYNC_OK" | "SYNC_RETRY_WAIT" | "SYNC_BLOCKED_ACCOUNT" | "SYNC_UNCERTAIN" | "SYNC_CONFLICT";
export type LocalDreaminaTaskResultState = "NOT_AVAILABLE" | "PENDING_MATERIALIZATION" | "MATERIALIZING" | "READY" | "FAILED_RETRYABLE" | "FAILED_PERMANENT";
export type LocalDreaminaTaskContext = {
    scope: "scoped";
    projectId?: string;
    nodeId?: string;
    conversationId?: string;
    messageId?: string;
    batchIndex?: number;
    batchCount?: number;
    retryOf?: string;
    attemptGroupId?: string;
} | { scope: "legacy_unscoped" };
export type LocalDreaminaTaskOutput = {
    outputIndex: number;
    mediaType: "image" | "video" | "audio";
    providerArtifactRef?: string;
    materializedAssetId?: string;
    materializationErrorCode?: string;
};
export type LocalDreaminaProviderObservation = {
    source: "submit_receipt" | "query_result" | "list_task";
    observedAt: string;
    accountBinding?: string;
    fenceEpoch?: number;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
};
export type LocalDreaminaProviderCapability = {
    adapterSupported: boolean;
    cancelSupported: boolean;
    pushStatusSupported: boolean;
    statusConsistency: "eventual_polling";
    accountEntitlement: "yes" | "no" | "unknown";
    currentlyObservedAvailable: "yes" | "no" | "unknown";
    references: { images: boolean; videos: boolean; audios: boolean; firstLastFrames: boolean };
};

export type LocalDreaminaReference =
    | { kind?: "image"; mimeType: "image/png" | "image/jpeg" | "image/webp"; bytes: Uint8Array; metadata?: { name?: string; width?: number; height?: number } }
    | { kind: "video"; mimeType: "video/mp4" | "video/quicktime" | "video/webm"; bytes: Uint8Array; metadata?: { name?: string; width?: number; height?: number; durationMs?: number } }
    | { kind: "audio"; mimeType: "audio/mpeg" | "audio/wav" | "audio/mp4" | "audio/aac" | "audio/flac"; bytes: Uint8Array; metadata?: { name?: string; durationMs?: number } };

export type LocalDreaminaGenerationInput = {
    model: `local:dreamina-cli:${string}`;
    mode: "image" | "video";
    prompt: string;
    settings: { aspect?: string; resolution?: string; duration?: number; count?: number };
    references: LocalDreaminaReference[];
    resumeOnly?: boolean;
    idempotencyKey?: string;
    clientOperationId?: string;
    context?: LocalDreaminaTaskContext;
};

export type LocalDreaminaGenerationResult = {
    mode: "image" | "video";
    images?: Array<{ dataUrl: string; mimeType: string; bytes: number }>;
    video?: { dataUrl: string; mimeType: string; bytes: number };
};

export type LocalDreaminaGenerationTask = {
    id: string;
    clientOperationId?: string;
    provider: "dreamina-cli";
    mode: "image" | "video";
    operation: string;
    model: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    stage: "queued" | "submitting" | "submitted" | "generating" | "succeeded" | "failed" | "cancelled" | "submission_unknown";
    progress?: number;
    receiptRecorded: boolean;
    errorCode?: string;
    officialStatus?: "pending" | "processing" | "completed" | "failed" | "cancelled";
    lifecycle?: LocalDreaminaTaskLifecycle;
    terminalOutcome?: LocalDreaminaTerminalOutcome;
    syncState?: LocalDreaminaTaskSyncState;
    resultState?: LocalDreaminaTaskResultState;
    outputs?: LocalDreaminaTaskOutput[];
    accountBinding?: string;
    context?: LocalDreaminaTaskContext;
    providerObservation?: LocalDreaminaProviderObservation;
    createdAt: string;
    updatedAt: string;
    result?: LocalDreaminaGenerationResult;
};

export class LocalDreaminaGenerationClientError extends Error {
    constructor(readonly code: string, message: string, readonly status = 500) {
        super(message);
        this.name = "LocalDreaminaGenerationClientError";
    }
}

type RuntimeClient = LocalRuntimeTransport & {
    connect(signal?: AbortSignal): Promise<LocalRuntimeConnection>;
    revokeLocalSession?(): void;
};
type Dependencies = {
    client?: RuntimeClient;
    idempotencyKey?: () => string;
    onTaskUpdate?: (task: LocalDreaminaGenerationTask) => void;
};
type ParsedInput = Omit<LocalDreaminaGenerationInput, "model"> & { model: string };

export function createLocalDreaminaTaskEffectStore(
    dependencies: Pick<Dependencies, "client"> = {},
): GenerationTaskEffectStore {
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    type EffectLease = {
        taskId: string;
        effectKey: string;
        leaseToken: string;
        expiresAt: string;
        fence: number;
    };
    const leases = new Map<string, EffectLease>();
    const leaseKey = (taskId: string, effectKey: string) => `${taskId}\0${effectKey}`;

    const call = async (path: string, body: Record<string, unknown>) => {
        const request = async () => {
            await requireConnection(client);
            const response = await client.request(path, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
            });
            return { response, value: await readBoundedJson(response, MAX_EFFECT_RESPONSE_BYTES) };
        };
        let result = await request();
        if (result.response.status === 401 || result.response.status === 403) {
            client.revokeLocalSession?.();
            result = await request();
        }
        if (!result.response.ok) throw runtimeError(result.response.status, result.value);
        const envelope = record(result.value);
        const value = record(envelope?.result);
        if (envelope?.ok !== true || !value) {
            throw new LocalDreaminaGenerationClientError("local_runtime_response_invalid", "本机任务副作用响应无效", 502);
        }
        return value;
    };

    return {
        async claim(effectKey, taskId): Promise<GenerationTaskEffectClaim> {
            const value = await call("/dreamina/generate/effects/claim", {
                consumerId: GENERATION_EFFECT_CONSUMER_ID,
                taskId,
                effectKey,
            });
            if (value.status === "busy") {
                if (typeof value.retryAt !== "string" || !Number.isFinite(Date.parse(value.retryAt))) {
                    throw new LocalDreaminaGenerationClientError("local_runtime_response_invalid", "本机任务副作用响应无效", 502);
                }
                return { status: "busy", retryAt: value.retryAt };
            }
            if (value.status === "completed") {
                const result = parseEffectResult(value.result);
                return { status: "completed", result };
            }
            if (value.status !== "claimed" || typeof value.leaseToken !== "string"
                || typeof value.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(value.leaseExpiresAt))
                || !Number.isSafeInteger(value.fence) || (value.fence as number) < 1) {
                throw new LocalDreaminaGenerationClientError("local_runtime_response_invalid", "本机任务副作用响应无效", 502);
            }
            const lease = {
                taskId,
                effectKey,
                leaseToken: value.leaseToken,
                expiresAt: value.leaseExpiresAt,
                fence: value.fence as number,
            };
            leases.set(leaseKey(taskId, effectKey), lease);
            return { status: "claimed", fence: lease.fence };
        },
        async renew(effectKey, taskId) {
            const key = leaseKey(taskId, effectKey);
            const lease = leases.get(key);
            if (!lease) throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_missing", "本机任务副作用租约缺失", 409);
            const value = await call("/dreamina/generate/effects/renew", {
                consumerId: GENERATION_EFFECT_CONSUMER_ID,
                taskId: lease.taskId,
                effectKey: lease.effectKey,
                leaseToken: lease.leaseToken,
                fence: lease.fence,
            });
            if (typeof value.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(value.leaseExpiresAt))
                || value.fence !== lease.fence) {
                throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_lost", "本机任务副作用租约已失效", 409);
            }
            lease.expiresAt = value.leaseExpiresAt;
            return { fence: lease.fence };
        },
        async complete(effectKey, taskId, result) {
            const key = leaseKey(taskId, effectKey);
            const lease = leases.get(key);
            if (!lease) throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_missing", "本机任务副作用租约缺失", 409);
            const value = await call("/dreamina/generate/effects/complete", {
                consumerId: GENERATION_EFFECT_CONSUMER_ID,
                taskId: lease.taskId,
                effectKey: lease.effectKey,
                leaseToken: lease.leaseToken,
                fence: lease.fence,
                result,
            });
            if (value.completed !== true) throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_lost", "本机任务副作用租约已失效", 409);
            leases.delete(key);
        },
        async release(effectKey, taskId) {
            const key = leaseKey(taskId, effectKey);
            const lease = leases.get(key);
            if (!lease) throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_missing", "本机任务副作用租约缺失", 409);
            const value = await call("/dreamina/generate/effects/release", {
                consumerId: GENERATION_EFFECT_CONSUMER_ID,
                taskId: lease.taskId,
                effectKey: lease.effectKey,
                leaseToken: lease.leaseToken,
                fence: lease.fence,
            });
            if (value.released !== true) {
                throw new LocalDreaminaGenerationClientError("local_runtime_effect_lease_lost", "本机任务副作用租约已失效", 409);
            }
            leases.delete(key);
        },
    };
}

function parseEffectResult(value: unknown): GenerationTaskEffectResult {
    const result = record(value);
    if (!result || Object.keys(result).some((key) => key !== "materializedAssetId")
        || (result.materializedAssetId !== undefined && typeof result.materializedAssetId !== "string")) {
        throw new LocalDreaminaGenerationClientError("local_runtime_response_invalid", "本机任务副作用响应无效", 502);
    }
    return typeof result.materializedAssetId === "string"
        ? { materializedAssetId: result.materializedAssetId }
        : {};
}

// Local CLI work goes straight to the signed Runtime; it must never create a backend task.
export async function runLocalDreaminaGenerationTask(
    input: LocalDreaminaGenerationInput,
    dependencies: Dependencies = {},
    signal?: AbortSignal,
): Promise<LocalDreaminaGenerationResult> {
    const parsed = parseInput(input);
    const idempotencyKey = parsed.idempotencyKey ?? dependencies.idempotencyKey?.() ?? crypto.randomUUID();
    validateTaskIdentity(idempotencyKey, parsed.mode);
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    let task = parsed.resumeOnly
        ? await queryLocalDreaminaGenerationTask(idempotencyKey, parsed.mode, { client }, signal)
        : await submitParsedTask(parsed, idempotencyKey, client, signal);
    dependencies.onTaskUpdate?.(task);
    if (task.status === "queued" || task.status === "running") {
        task = await waitForLocalDreaminaGenerationTask(idempotencyKey, parsed.mode, { client }, signal);
        dependencies.onTaskUpdate?.(task);
    }
    if (task.status === "succeeded" && task.result) return task.result;
    if (task.status === "cancelled") {
        if (task.errorCode === LOCAL_DREAMINA_WAIT_STOPPED_CODE) {
            throw new LocalDreaminaGenerationClientError(LOCAL_DREAMINA_WAIT_STOPPED_CODE, LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE, 409);
        }
        throw new DOMException("Aborted", "AbortError");
    }
    if (task.errorCode === LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_CODE) {
        throw new LocalDreaminaGenerationClientError(task.errorCode, LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_MESSAGE, 502);
    }
    if (task.errorCode === LOCAL_DREAMINA_OFFICIAL_FAILED_CODE) {
        throw new LocalDreaminaGenerationClientError(task.errorCode, LOCAL_DREAMINA_OFFICIAL_FAILED_MESSAGE, 502);
    }
    throw new LocalDreaminaGenerationClientError(task.errorCode ?? "local_generation_unknown", "本机即梦生成未完成", 502);
}

export async function queryLocalDreaminaGenerationTask(
    idempotencyKey: string,
    mode: "image" | "video" | undefined,
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    validateTaskIdentity(idempotencyKey, mode);
    return queryWithOneReconnect(dependencies.client ?? getLocalRuntimeSessionClient(), idempotencyKey, mode, signal);
}

export async function waitForLocalDreaminaGenerationTask(
    idempotencyKey: string,
    mode: "image" | "video" | undefined,
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    validateTaskIdentity(idempotencyKey, mode);
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    const request = async () => {
        await requireConnection(client, signal);
        const response = await client.request("/dreamina/generate/wait", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idempotencyKey, ...(mode ? { mode } : {}) }),
            signal,
        });
        return { response, value: await readBoundedJson(response) };
    };
    let result = await request();
    if (result.response.status === 401 || result.response.status === 403) {
        client.revokeLocalSession?.();
        result = await request();
    }
    if (!result.response.ok) throw runtimeError(result.response.status, result.value);
    return parseTask(result.value, mode);
}

export async function listLocalDreaminaGenerationTaskPage(
    page: { limit: number; cursor?: string; projectId?: string; activeOnly?: boolean },
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(100, Math.trunc(page.limit)))) });
    if (page.cursor) params.set("cursor", page.cursor);
    if (page.projectId) params.set("projectId", page.projectId);
    if (page.activeOnly) params.set("activeOnly", "true");
    const request = async () => {
        await requireConnection(client, signal);
        const response = await client.request(`/dreamina/generate/tasks?${params.toString()}`, { method: "GET", signal });
        return { response, value: await readBoundedJson(response, MAX_TASK_LIST_RESPONSE_BYTES) };
    };
    let result = await request();
    if (result.response.status === 401 || result.response.status === 403) {
        client.revokeLocalSession?.();
        result = await request();
    }
    if (!result.response.ok) throw runtimeError(result.response.status, result.value);
    return parseTaskPage(result.value);
}

export async function listLocalDreaminaGenerationTasks(
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    const tasks: LocalDreaminaGenerationTask[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
        const page = await listLocalDreaminaGenerationTaskPage({ limit: 100, ...(cursor ? { cursor } : {}) }, dependencies, signal);
        tasks.push(...page.tasks);
        if (!page.nextCursor || seenCursors.has(page.nextCursor)) break;
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
    } while (true);
    return tasks;
}

export async function cancelLocalDreaminaGenerationTask(
    idempotencyKey: string,
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    validateTaskIdentity(idempotencyKey, "image");
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    await requireConnection(client, signal);
    const response = await client.request("/dreamina/generate/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
        signal,
    });
    const value = await readBoundedJson(response);
    if (!response.ok) throw runtimeError(response.status, value);
    return parseTask(value);
}

export async function deleteLocalDreaminaGenerationTask(
    idempotencyKey: string,
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    validateTaskIdentity(idempotencyKey, "image");
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    await requireConnection(client, signal);
    const response = await client.request("/dreamina/generate/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
        signal,
    });
    const value = await readBoundedJson(response);
    if (!response.ok) throw runtimeError(response.status, value);
    const envelope = record(value);
    const result = envelope?.ok === true ? record(envelope.result) : undefined;
    if (!result || typeof result !== "object" || Array.isArray(result) || (result as { deleted?: unknown }).deleted !== true) {
        throw new LocalDreaminaGenerationClientError("dreamina_response_invalid", "本机即梦任务响应无效", 502);
    }
    return { deleted: true as const };
}

export async function refreshLocalDreaminaGenerationTask(
    idempotencyKey: string,
    dependencies: Pick<Dependencies, "client"> = {},
    signal?: AbortSignal,
) {
    validateTaskIdentity(idempotencyKey, "image");
    const client = dependencies.client ?? getLocalRuntimeSessionClient();
    await requireConnection(client, signal);
    const response = await client.request("/dreamina/generate/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
        signal,
    });
    const value = await readBoundedJson(response);
    if (!response.ok) throw runtimeError(response.status, value);
    return parseTask(value);
}

async function submitParsedTask(parsed: ParsedInput, idempotencyKey: string, client: RuntimeClient, signal?: AbortSignal) {
    // Mutation retries are forbidden: establish the side-effect-free session before the only paid POST.
    await requireConnection(client, signal);
    let response: Response;
    let value: unknown;
    try {
        response = await client.request("/dreamina/generate", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                idempotencyKey,
                clientOperationId: parsed.clientOperationId ?? idempotencyKey,
                operation: operationFor(parsed.mode, parsed.references),
                model: parsed.model,
                prompt: parsed.prompt,
                settings: parsed.settings,
                references: parsed.references.map((reference) => ({
                    kind: reference.kind ?? "image",
                    mimeType: reference.mimeType,
                    contentBase64: bytesToBase64(reference.bytes),
                    ...(reference.metadata ? { metadata: reference.metadata } : {}),
                })),
                context: parsed.context ?? { scope: "scoped" },
            }),
            signal,
        });
        value = await readBoundedJson(response);
    } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw submissionUnknown();
        throw error;
    }
    if (!response.ok) throw runtimeError(response.status, value);
    return parseTask(value, parsed.mode);
}

async function queryWithOneReconnect(client: RuntimeClient, idempotencyKey: string, mode: "image" | "video" | undefined, signal?: AbortSignal) {
    const request = async () => {
        await requireConnection(client, signal);
        const response = await client.request("/dreamina/generate/query", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ idempotencyKey, ...(mode ? { mode } : {}) }),
            signal,
        });
        return { response, value: await readBoundedJson(response) };
    };
    let result = await request();
    if (result.response.status === 401 || result.response.status === 403) {
        client.revokeLocalSession?.();
        result = await request();
    }
    if (!result.response.ok) throw runtimeError(result.response.status, result.value);
    return parseTask(result.value, mode);
}

async function requireConnection(client: RuntimeClient, signal?: AbortSignal) {
    const connection = await client.connect(signal);
    if (connection.state !== "connected") throw new LocalRuntimeClientError("origin_not_trusted", "本机连接需要重新建立", 403);
}

function parseInput(value: LocalDreaminaGenerationInput): ParsedInput {
    if (!value || typeof value !== "object" || !/^local:dreamina-cli:[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.model)
        || (value.mode !== "image" && value.mode !== "video")
        || typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 20_000
        || !Array.isArray(value.references) || !validReferenceCounts(value.model, value.references)
        || (value.idempotencyKey !== undefined && !/^[A-Za-z0-9._:-]{16,120}$/.test(value.idempotencyKey))
        || (value.clientOperationId !== undefined && !/^[A-Za-z0-9._:-]{16,120}$/.test(value.clientOperationId))) throw invalidRequest();
    const model = value.model.slice("local:dreamina-cli:".length);
    const settings = value.settings ?? {};
    if (!settings || typeof settings !== "object" || Array.isArray(settings)
        || Object.keys(settings).some((key) => !["aspect", "resolution", "duration", "count"].includes(key))) throw invalidRequest();
    if (settings.duration !== undefined && (!Number.isInteger(settings.duration) || settings.duration < 1 || settings.duration > 60)) throw invalidRequest();
    if (settings.count !== undefined && (!Number.isInteger(settings.count) || settings.count < 1 || settings.count > 4)) throw invalidRequest();
    if (value.mode === "video" && settings.count !== undefined && settings.count !== 1) throw invalidRequest();
    if (value.mode === "image" && settings.duration !== undefined) throw invalidRequest();
    if (model === "seedance2.0mini" && ((settings.duration ?? 4) < 4 || (settings.duration ?? 4) > 15)) throw unavailable();
    if (value.context !== undefined) parseInputContext(value.context);
    let bytes = 0;
    for (const reference of value.references) {
        const kind = reference?.kind ?? "image";
        const validMime = kind === "image"
            ? ["image/png", "image/jpeg", "image/webp"].includes(reference?.mimeType)
            : kind === "video"
                ? ["video/mp4", "video/quicktime", "video/webm"].includes(reference?.mimeType)
                : kind === "audio" && ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/flac"].includes(reference?.mimeType);
        if (!reference || !validMime || !(reference.bytes instanceof Uint8Array) || !reference.bytes.byteLength
            || !safeReferenceMetadata(reference.metadata, kind)) throw invalidRequest();
        bytes += reference.bytes.byteLength;
        if (bytes > MAX_REFERENCE_BYTES) throw invalidRequest();
    }
    return { ...value, model, prompt: value.prompt.trim(), settings };
}

function validReferenceCounts(model: string, references: LocalDreaminaReference[]) {
    if (model !== "local:dreamina-cli:seedance2.5") return references.length <= 30;
    if (references.length > 50) return false;
    const counts = { image: 0, video: 0, audio: 0 };
    for (const reference of references) {
        const kind = reference?.kind ?? "image";
        if (kind === "image" || kind === "video" || kind === "audio") counts[kind] += 1;
    }
    return counts.image <= 30 && counts.video <= 10 && counts.audio <= 10;
}

function operationFor(mode: "image" | "video", references: LocalDreaminaReference[]) {
    if (mode === "image") return references.length ? "image-to-image" : "text-to-image";
    const imageCount = references.filter((reference) => (reference.kind ?? "image") === "image").length;
    const hasMultimodal = references.some((reference) => reference.kind === "video" || reference.kind === "audio");
    if (!references.length) return "text-to-video";
    return hasMultimodal || imageCount > 2 ? "reference-to-video" : "image-to-video";
}

function parseInputContext(value: LocalDreaminaTaskContext) {
    const context = value as unknown as Record<string, unknown>;
    if (!context || (context.scope !== "scoped" && context.scope !== "legacy_unscoped")) throw invalidRequest();
    if (context.scope === "legacy_unscoped") {
        if (Object.keys(context).some((key) => key !== "scope")) throw invalidRequest();
        return;
    }
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(context).some((key) => !allowed.includes(key))) throw invalidRequest();
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"]) {
        if (context[key] !== undefined && !safeCorrelationId(context[key])) throw invalidRequest();
    }
    if (context.batchIndex !== undefined && (!Number.isSafeInteger(context.batchIndex) || (context.batchIndex as number) < 0)) throw invalidRequest();
    if (context.batchCount !== undefined && (!Number.isSafeInteger(context.batchCount) || (context.batchCount as number) < 1)) throw invalidRequest();
}

function safeReferenceMetadata(value: unknown, kind: "image" | "video" | "audio") {
    if (value === undefined) return true;
    const metadata = record(value);
    if (!metadata) return false;
    const allowed = kind === "image" ? ["name", "width", "height"]
        : kind === "video" ? ["name", "width", "height", "durationMs"]
            : ["name", "durationMs"];
    if (Object.keys(metadata).some((key) => !allowed.includes(key))) return false;
    if (metadata.name !== undefined && (typeof metadata.name !== "string" || metadata.name.length > 200 || /[\u0000-\u001f\u007f]/.test(metadata.name))) return false;
    for (const key of ["width", "height", "durationMs"]) {
        if (metadata[key] !== undefined && (!Number.isFinite(metadata[key]) || (metadata[key] as number) <= 0)) return false;
    }
    return true;
}

async function readBoundedJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw invalidResponse();
    if (!response.body) throw invalidResponse();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            total += item.value.byteLength;
            if (total > maxBytes) { await reader.cancel(); throw invalidResponse(); }
            chunks.push(item.value);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw invalidResponse(); }
}

function parseTask(value: unknown, expectedMode?: "image" | "video", allowMissingResult = false): LocalDreaminaGenerationTask {
    const envelope = record(value);
    const source = envelope?.ok === true ? record(envelope.result) : undefined;
    const status = source?.status;
    const stage = source?.stage;
    if (!source || typeof source.id !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(source.id)
        || source.provider !== "dreamina-cli" || (source.mode !== "image" && source.mode !== "video")
        || (expectedMode && source.mode !== expectedMode) || typeof source.operation !== "string" || typeof source.model !== "string"
        || !["queued", "running", "succeeded", "failed", "cancelled"].includes(String(status))
        || !["queued", "submitting", "submitted", "generating", "succeeded", "failed", "cancelled", "submission_unknown"].includes(String(stage))
        || typeof source.receiptRecorded !== "boolean"
        || typeof source.createdAt !== "string" || !Number.isFinite(Date.parse(source.createdAt))
        || typeof source.updatedAt !== "string" || !Number.isFinite(Date.parse(source.updatedAt))) throw invalidResponse();
    const result = source.result === undefined ? undefined : parseResult(source.result, source.mode);
    if (status === "succeeded" && !result && !allowMissingResult) throw invalidResponse();
    return {
        id: source.id,
        ...(typeof source.clientOperationId === "string" && /^[A-Za-z0-9._:-]{16,120}$/.test(source.clientOperationId)
            ? { clientOperationId: source.clientOperationId }
            : {}),
        provider: "dreamina-cli",
        mode: source.mode,
        operation: source.operation,
        model: source.model,
        status: status as LocalDreaminaGenerationTask["status"],
        stage: stage as LocalDreaminaGenerationTask["stage"],
        ...(typeof source.progress === "number" && source.progress >= 0 && source.progress <= 100 ? { progress: source.progress } : {}),
        receiptRecorded: source.receiptRecorded,
        ...(typeof source.errorCode === "string" ? { errorCode: source.errorCode } : {}),
        ...(typeof source.officialStatus === "string" && ["pending", "processing", "completed", "failed", "cancelled"].includes(source.officialStatus)
            ? { officialStatus: source.officialStatus as LocalDreaminaGenerationTask["officialStatus"] }
            : {}),
        ...parseTaskContract(source),
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        ...(result ? { result } : {}),
    };
}

function parseTaskContract(source: Record<string, unknown>): Partial<LocalDreaminaGenerationTask> {
    const contractKeys = ["lifecycle", "terminalOutcome", "syncState", "resultState", "outputs", "accountBinding", "context", "providerObservation"];
    if (!contractKeys.some((key) => source[key] !== undefined)) return {};

    const lifecycle = source.lifecycle;
    const terminalOutcome = source.terminalOutcome;
    const syncState = source.syncState;
    const resultState = source.resultState;
    if (!["QUEUED_LOCAL", "SUBMITTING", "SUBMISSION_UNCERTAIN", "ACCEPTED", "RUNNING", "TERMINAL"].includes(String(lifecycle))
        || !["SYNC_OK", "SYNC_RETRY_WAIT", "SYNC_BLOCKED_ACCOUNT", "SYNC_UNCERTAIN", "SYNC_CONFLICT"].includes(String(syncState))
        || !["NOT_AVAILABLE", "PENDING_MATERIALIZATION", "MATERIALIZING", "READY", "FAILED_RETRYABLE", "FAILED_PERMANENT"].includes(String(resultState))
        || (lifecycle === "TERMINAL") !== (typeof terminalOutcome === "string")
        || (terminalOutcome !== undefined && !["SUCCEEDED", "REJECTED", "FAILED", "CANCELLED", "FAILED_OR_CANCELLED"].includes(String(terminalOutcome)))) {
        throw invalidResponse();
    }

    const accountBinding = source.accountBinding === undefined ? undefined : parseAccountBinding(source.accountBinding);
    const context = parseTaskContext(source.context);
    const outputs = parseTaskOutputs(source.outputs);
    const providerObservation = source.providerObservation === undefined ? undefined : parseProviderObservation(source.providerObservation);
    return {
        lifecycle: lifecycle as LocalDreaminaTaskLifecycle,
        ...(terminalOutcome === undefined ? {} : { terminalOutcome: terminalOutcome as LocalDreaminaTerminalOutcome }),
        syncState: syncState as LocalDreaminaTaskSyncState,
        resultState: resultState as LocalDreaminaTaskResultState,
        outputs,
        ...(accountBinding ? { accountBinding } : {}),
        context,
        ...(providerObservation ? { providerObservation } : {}),
    };
}

function parseTaskContext(value: unknown): LocalDreaminaTaskContext {
    const context = record(value);
    if (!context || (context.scope !== "scoped" && context.scope !== "legacy_unscoped")) throw invalidResponse();
    if (context.scope === "legacy_unscoped") {
        if (Object.keys(context).some((key) => key !== "scope")) throw invalidResponse();
        return { scope: "legacy_unscoped" };
    }
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(context).some((key) => !allowed.includes(key))) throw invalidResponse();
    const parsed: Extract<LocalDreaminaTaskContext, { scope: "scoped" }> = { scope: "scoped" };
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"] as const) {
        if (context[key] === undefined) continue;
        if (!safeCorrelationId(context[key])) throw invalidResponse();
        parsed[key] = context[key] as string;
    }
    if (context.batchIndex !== undefined) {
        if (!Number.isSafeInteger(context.batchIndex) || (context.batchIndex as number) < 0) throw invalidResponse();
        parsed.batchIndex = context.batchIndex as number;
    }
    if (context.batchCount !== undefined) {
        if (!Number.isSafeInteger(context.batchCount) || (context.batchCount as number) < 1) throw invalidResponse();
        parsed.batchCount = context.batchCount as number;
    }
    return parsed;
}

function parseTaskOutputs(value: unknown): LocalDreaminaTaskOutput[] {
    if (!Array.isArray(value) || value.length > 32) throw invalidResponse();
    const indexes = new Set<number>();
    return value.map((candidate) => {
        const output = record(candidate);
        if (!output || !Number.isSafeInteger(output.outputIndex) || (output.outputIndex as number) < 0 || (output.outputIndex as number) > 999
            || indexes.has(output.outputIndex as number) || !["image", "video", "audio"].includes(String(output.mediaType))
            || (output.providerArtifactRef !== undefined && !safeOpaqueRef(output.providerArtifactRef))
            || (output.materializedAssetId !== undefined && !safeOpaqueRef(output.materializedAssetId))
            || (output.materializationErrorCode !== undefined && !safeErrorCode(output.materializationErrorCode))) throw invalidResponse();
        indexes.add(output.outputIndex as number);
        return {
            outputIndex: output.outputIndex as number,
            mediaType: output.mediaType as LocalDreaminaTaskOutput["mediaType"],
            ...(typeof output.providerArtifactRef === "string" ? { providerArtifactRef: output.providerArtifactRef } : {}),
            ...(typeof output.materializedAssetId === "string" ? { materializedAssetId: output.materializedAssetId } : {}),
            ...(typeof output.materializationErrorCode === "string" ? { materializationErrorCode: output.materializationErrorCode } : {}),
        };
    });
}

function parseProviderObservation(value: unknown): LocalDreaminaProviderObservation {
    const observation = record(value);
    if (!observation || !["submit_receipt", "query_result", "list_task"].includes(String(observation.source))
        || typeof observation.observedAt !== "string" || !Number.isFinite(Date.parse(observation.observedAt))
        || !["pending", "processing", "completed", "failed", "cancelled"].includes(String(observation.status))
        || (observation.accountBinding !== undefined && !safeAccountBinding(observation.accountBinding))
        || (observation.fenceEpoch !== undefined && (!Number.isSafeInteger(observation.fenceEpoch) || (observation.fenceEpoch as number) < 0))) {
        throw invalidResponse();
    }
    return {
        source: observation.source as LocalDreaminaProviderObservation["source"],
        observedAt: observation.observedAt,
        ...(typeof observation.accountBinding === "string" ? { accountBinding: observation.accountBinding } : {}),
        ...(typeof observation.fenceEpoch === "number" ? { fenceEpoch: observation.fenceEpoch } : {}),
        status: observation.status as LocalDreaminaProviderObservation["status"],
    };
}

function parseAccountBinding(value: unknown) {
    if (!safeAccountBinding(value)) throw invalidResponse();
    return value as string;
}

function safeAccountBinding(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value);
}

function safeCorrelationId(value: unknown): value is string {
    return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

function safeOpaqueRef(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function safeErrorCode(value: unknown): value is string {
    return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/.test(value);
}

function parseTaskPage(value: unknown) {
    const envelope = record(value);
    const rawResult = envelope?.ok === true ? envelope.result : undefined;
    const result = record(rawResult);
    const items = Array.isArray(rawResult) ? rawResult : result?.tasks;
    const nextCursor = result?.nextCursor;
    if (!Array.isArray(items) || items.length > MAX_TASK_LIST_ITEMS
        || (nextCursor !== undefined && (typeof nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(nextCursor)))) throw invalidResponse();
    return {
        tasks: items.map((item) => parseTask({ ok: true, result: item }, undefined, true)),
        ...(typeof nextCursor === "string" ? { nextCursor } : {}),
    };
}

function parseResult(value: unknown, mode: "image" | "video"): LocalDreaminaGenerationResult {
    const result = record(value);
    if (!result || result.mode !== mode) throw invalidResponse();
    if (mode === "video") return { mode, video: parseMedia(result.video, "video/") };
    if (!Array.isArray(result.images) || !result.images.length || result.images.length > 4) throw invalidResponse();
    return { mode, images: result.images.map((image) => parseMedia(image, "image/")) };
}

function parseMedia(value: unknown, prefix: "image/" | "video/") {
    const media = record(value);
    const bytes = media?.bytes;
    if (!media || typeof media.dataUrl !== "string" || typeof media.mimeType !== "string"
        || !media.mimeType.startsWith(prefix) || !Number.isInteger(bytes) || (bytes as number) <= 0
        || !media.dataUrl.startsWith(`data:${media.mimeType};base64,`)) throw invalidResponse();
    return { dataUrl: media.dataUrl, mimeType: media.mimeType, bytes: bytes as number };
}

function runtimeError(status: number, value: unknown) {
    const source = record(value);
    const code = typeof source?.code === "string" ? source.code : "local_generation_request_failed";
    const allowed = /^(?:local_generation|dreamina)_[a-z0-9_]{2,80}$/.test(code);
    throw new LocalDreaminaGenerationClientError(allowed ? code : "local_generation_request_failed", "本机即梦生成请求失败", status || 502);
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function submissionUnknown() {
    return new LocalDreaminaGenerationClientError("dreamina_submission_unknown", "Dreamina submission result is unknown", 502);
}

function validateTaskIdentity(idempotencyKey: string, mode: "image" | "video" | undefined) {
    if (!/^[A-Za-z0-9._:-]{16,120}$/.test(idempotencyKey) || (mode !== undefined && mode !== "image" && mode !== "video")) throw invalidRequest();
}

function invalidRequest() { return new LocalDreaminaGenerationClientError("local_generation_request_invalid", "本机即梦生成参数无效", 400); }
function unavailable() { return new LocalDreaminaGenerationClientError("local_generation_model_unavailable", "所选本机即梦模型或操作不可用", 409); }
function invalidResponse() { return new LocalDreaminaGenerationClientError("local_generation_response_invalid", "本机即梦生成响应无效", 502); }
