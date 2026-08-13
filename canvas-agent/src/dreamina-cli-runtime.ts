import crypto from "node:crypto";
import { watch as watchFileSystem } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
    dreaminaCliInputSchema,
    type DreaminaCliInput,
    type DreaminaGenerationInput,
} from "./dreamina-cli-contract.js";
import { DreaminaCliArbiter, type DreaminaCliSessionSnapshot } from "./dreamina-cli-arbiter.js";
import { dreaminaTaskFromRuntimeJournal, type DreaminaTaskContext, type DreaminaTaskState } from "./dreamina-task-contract.js";
import {
    discoverDreaminaExecutable,
    DreaminaCliError,
    runDreaminaProcess,
    sanitizeDreaminaDiagnostic,
    type DreaminaProcessRequest,
    type DreaminaProcessResult,
} from "./dreamina-cli-process.js";
import {
    acquireStateLock,
    persistRuntimeDiskState,
    readRuntimeDiskState,
    recordKey,
    recoverStateReplacement,
    stateInvalid,
    stateRank,
    type RuntimeDiskState,
    type RuntimeRecord,
    type StateLockLease,
} from "./dreamina-cli-state.js";
import { scavengeStaleStagingDirectories, stageReferences } from "./dreamina-cli-staging.js";
import {
    DreaminaTaskReconciler,
    type DreaminaReconcileApplied,
    type DreaminaReconcileObservation,
} from "./dreamina-task-reconciler.js";
import { DreaminaProviderArtifactStore } from "./dreamina-provider-artifacts.js";
import { DreaminaTaskProjector } from "./dreamina-task-projection.js";
import { DreaminaTaskStore } from "./dreamina-task-store.js";
import {
    collectDreaminaGenerationResult,
    LocalDreaminaGenerationError,
    unknownGenerationResult,
    type DreaminaGenerationResult,
} from "./dreamina-generation.js";

export { acquireStateLock } from "./dreamina-cli-state.js";

type Installation = { installed: true; executable: string } | { installed: false };
const DEFAULT_SUBMISSION_RESERVATION_LEASE_MS = 30_000;
const DEFAULT_SUBMISSION_RESERVATION_HEARTBEAT_MS = 5_000;
export type DreaminaRuntimeResult =
    | { state: "accepted"; submitId: string }
    | { state: "query"; result: unknown };
export type DreaminaRuntimeRunOptions = {
    signal?: AbortSignal;
    requestFingerprint?: string;
    clientOperationId?: string;
    taskContext?: DreaminaTaskContext;
};
export type DreaminaPublicGenerationTask = {
    id: string;
    clientOperationId?: string;
    context?: DreaminaTaskContext;
    provider: "dreamina-cli";
    mode: "image" | "video";
    operation: DreaminaGenerationInput["operation"];
    model: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    stage: "queued" | "submitting" | "submitted" | "generating" | "succeeded" | "failed" | "cancelled" | "submission_unknown";
    progress?: number;
    receiptRecorded: boolean;
    errorCode?: string;
    officialStatus?: "pending" | "processing" | "completed" | "failed" | "cancelled";
    createdAt: string;
    updatedAt: string;
    result?: DreaminaGenerationResult;
};

export type DreaminaCliRuntimeOptions = {
    ownerId: string;
    stateFile: string;
    referenceRoots?: () => readonly string[];
    ensureReady: (signal?: AbortSignal) => Promise<DreaminaCliSessionSnapshot | void>;
    env?: Record<string, string | undefined>;
    discover?: (signal?: AbortSignal) => Promise<Installation>;
    runProcess?: (request: DreaminaProcessRequest) => Promise<DreaminaProcessResult>;
    now?: () => Date;
    generationRoot?: string;
    sleep?: (delayMs: number) => Promise<void>;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
    maxActiveTasks?: number;
    arbiter?: DreaminaCliArbiter;
    reservationLeaseMs?: number;
    reservationHeartbeatMs?: number;
    reconciler?: DreaminaTaskReconciler;
    watchStateFile?: (listener: (filename: string | null) => void) => { close(): void };
    scheduleDurableReload?: (callback: () => void, delayMs: number) => { cancel(): void };
    durableReloadIntervalMs?: number;
    onQueueHeartbeatWait?: (event: "started" | "settled", key: string) => void;
    taskStore?: DreaminaTaskStore;
    taskProjector?: DreaminaTaskProjector;
    artifactStore?: DreaminaProviderArtifactStore;
};

type InFlightSubmission = {
    requestHash: string;
    promise: Promise<DreaminaRuntimeResult>;
    controller: AbortController;
    waiters: number;
    settled: boolean;
};

type PreparedAsyncTask = {
    key: string;
    requestHash: string;
    input?: DreaminaGenerationInput;
    cleanup: () => Promise<void>;
    cleanupId: string;
    controller: AbortController;
    completion: Promise<DreaminaGenerationResult>;
    resolve: (result: DreaminaGenerationResult) => void;
    reject: (error: unknown) => void;
    result?: DreaminaGenerationResult;
    error?: unknown;
    background?: Promise<void>;
    starting?: Promise<DreaminaPublicGenerationTask>;
    polling: boolean;
    settled: boolean;
};

type EnqueueInFlight = { requestHash: string; promise: Promise<DreaminaPublicGenerationTask> };
type SubmissionReservation = { reservationId: string; reservationOwnerId: string };

function encodeTaskListCursor(updatedAt: string, id: string) {
    return Buffer.from(JSON.stringify([updatedAt, id]), "utf8").toString("base64url");
}

function decodeTaskListCursor(cursor: string) {
    try {
        if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error("invalid cursor");
        const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
        if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") throw new Error("invalid cursor");
        if (!Number.isFinite(Date.parse(value[0])) || !/^[A-Za-z0-9._:-]{16,120}$/.test(value[1])) throw new Error("invalid cursor");
        return { updatedAt: value[0], id: value[1] };
    } catch {
        throw new DreaminaCliError("dreamina_request_invalid", "Dreamina 请求参数无效", 400);
    }
}

export class DreaminaCliRuntime {
    private readonly ownerId: string;
    private readonly stateFile: string;
    private readonly referenceRoots: () => readonly string[];
    private readonly ensureReady: (signal?: AbortSignal) => Promise<DreaminaCliSessionSnapshot | void>;
    private readonly env: Record<string, string | undefined>;
    private readonly discover: (signal?: AbortSignal) => Promise<Installation>;
    private readonly runProcess: (request: DreaminaProcessRequest) => Promise<DreaminaProcessResult>;
    private readonly now: () => Date;
    private readonly generationRoot: string;
    private readonly pollIntervalMs: number;
    private readonly maxActiveTasks: number;
    private readonly reservationOwnerId = crypto.randomUUID();
    private readonly reservationLeaseMs: number;
    private readonly reservationHeartbeatMs: number;
    private readonly records = new Map<string, RuntimeRecord>();
    private readonly inFlight = new Map<string, InFlightSubmission>();
    private readonly asyncTasks = new Map<string, PreparedAsyncTask>();
    private readonly enqueueInFlight = new Map<string, EnqueueInFlight>();
    private readonly queue: string[] = [];
    private readonly activeTasks = new Set<string>();
    private readonly queueHeartbeats = new Map<string, () => Promise<void>>();
    private readonly deferredCleanups = new Map<string, () => Promise<void>>();
    private readonly arbiter: DreaminaCliArbiter;
    private readonly reconciler: DreaminaTaskReconciler;
    private readonly taskStore: DreaminaTaskStore;
    private readonly taskProjector: DreaminaTaskProjector;
    private readonly artifactStore: DreaminaProviderArtifactStore;
    private readonly watchStateFile: NonNullable<DreaminaCliRuntimeOptions["watchStateFile"]>;
    private readonly scheduleDurableReload: NonNullable<DreaminaCliRuntimeOptions["scheduleDurableReload"]>;
    private readonly durableReloadIntervalMs: number;
    private readonly onQueueHeartbeatWait?: NonNullable<DreaminaCliRuntimeOptions["onQueueHeartbeatWait"]>;
    private readonly queryShutdown = new AbortController();
    private loadPromise?: Promise<void>;
    private enqueueSerial: Promise<void> = Promise.resolve();
    private recoveryStarted = false;
    private disposed = false;

    constructor(options: DreaminaCliRuntimeOptions) {
        if (!/^[A-Za-z0-9._-]{16,120}$/.test(options.ownerId)) throw new Error("Dreamina owner is invalid");
        this.ownerId = options.ownerId;
        this.stateFile = options.stateFile;
        this.referenceRoots = options.referenceRoots ?? (() => []);
        this.ensureReady = options.ensureReady;
        this.env = options.env ?? process.env;
        this.discover = options.discover ?? ((signal) => discoverDreaminaExecutable(this.env, signal));
        this.runProcess = options.runProcess ?? runDreaminaProcess;
        this.now = options.now ?? (() => new Date());
        this.generationRoot = path.resolve(options.generationRoot ?? path.join(path.dirname(this.stateFile), "dreamina-generation-runs"));
        this.pollIntervalMs = boundedInteger(options.pollIntervalMs, 0, 60_000, 2_000);
        this.maxActiveTasks = boundedInteger(options.maxActiveTasks, 1, 32, 5);
        this.reservationLeaseMs = boundedInteger(options.reservationLeaseMs, 50, 300_000, DEFAULT_SUBMISSION_RESERVATION_LEASE_MS);
        this.reservationHeartbeatMs = options.reservationHeartbeatMs === 0
            ? 0
            : boundedInteger(options.reservationHeartbeatMs, 10, this.reservationLeaseMs, Math.min(DEFAULT_SUBMISSION_RESERVATION_HEARTBEAT_MS, Math.max(10, Math.floor(this.reservationLeaseMs / 3))));
        this.arbiter = options.arbiter ?? new DreaminaCliArbiter({
            stateFile: path.join(path.dirname(this.stateFile), "dreamina-cli-arbiter.json"),
        });
        this.taskStore = options.taskStore ?? new DreaminaTaskStore({
            stateFile: path.join(path.dirname(this.stateFile), "dreamina-generation-task-store.json"),
            now: this.now,
        });
        this.taskProjector = options.taskProjector ?? new DreaminaTaskProjector({
            store: this.taskStore,
            ownerId: this.ownerId,
            journalFile: this.stateFile,
        });
        this.artifactStore = options.artifactStore ?? new DreaminaProviderArtifactStore({
            root: path.join(path.dirname(this.stateFile), "dreamina-provider-artifacts"),
            now: this.now,
        });
        this.watchStateFile = options.watchStateFile ?? ((listener) => {
            const watcher = watchFileSystem(path.dirname(this.stateFile), { persistent: false }, (_event, filename) => {
                listener(filename === null ? null : String(filename));
            });
            return { close: () => watcher.close() };
        });
        this.scheduleDurableReload = options.scheduleDurableReload ?? ((callback, delayMs) => {
            let active = true;
            const timer = setTimeout(() => {
                if (!active) return;
                active = false;
                callback();
            }, delayMs);
            timer.unref();
            return {
                cancel() {
                    if (!active) return;
                    active = false;
                    clearTimeout(timer);
                },
            };
        });
        this.durableReloadIntervalMs = boundedInteger(options.durableReloadIntervalMs, 5, 5_000, 250);
        this.onQueueHeartbeatWait = options.onQueueHeartbeatWait;
        this.reconciler = options.reconciler ?? new DreaminaTaskReconciler({
            ownerId: this.ownerId,
            stateFile: this.stateFile,
            now: this.now,
            pollIntervalMs: Math.max(1, this.pollIntervalMs),
            observe: (record, signal) => this.observeReconciliation(record, signal),
            onApplied: (event) => this.handleReconcileApplied(event),
        });
    }

    async start() {
        await this.loadState();
        await this.startRecoveryOnce();
    }

    enqueue(value: unknown, options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaPublicGenerationTask> {
        try {
            throwIfCancelled(options.signal);
            const input = parseInput(value);
            if (input.operation === "query_result") throw generationRequestInvalid();
            const requestHash = trustedRequestFingerprint(options.requestFingerprint) ?? hashRequest(input);
            const key = recordKey(this.ownerId, input.idempotencyKey);
            const pending = this.enqueueInFlight.get(key);
            if (pending) {
                if (pending.requestHash !== requestHash) return Promise.reject(idempotencyConflict());
                return waitForAbort(pending.promise, options.signal);
            }
            const promise = this.enqueueSerial.then(() => this.enqueueNew(key, requestHash, input, options))
                .finally(() => {
                    if (this.enqueueInFlight.get(key)?.promise === promise) this.enqueueInFlight.delete(key);
                });
            this.enqueueSerial = promise.then(() => undefined, () => undefined);
            this.enqueueInFlight.set(key, { requestHash, promise });
            return waitForAbort(promise, options.signal);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    async getTask(idempotencyKey: string, options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaPublicGenerationTask> {
        throwIfCancelled(options.signal);
        validateIdempotencyKey(idempotencyKey);
        await this.load(options.signal);
        const key = recordKey(this.ownerId, idempotencyKey);
        const record = this.records.get(key);
        if (!record?.taskVersion || record.state === "deleted" || record.hidden) throw taskNotFound();
        let task = this.asyncTasks.get(key);
        if (record.state === "succeeded" && record.submitId && !task?.result) {
            const durableResult = await this.readDurableResult(record).catch(() => undefined);
            task = task ?? this.createRecoveredTask(key, record);
            this.asyncTasks.set(key, task);
            if (durableResult) this.resolvePreparedTask(task, durableResult);
            else void this.reconciler.requestNow(record.idempotencyKey).catch(() => undefined);
        }
        return this.publicTask(record, task);
    }

    async refreshTask(idempotencyKey: string, options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaPublicGenerationTask> {
        throwIfCancelled(options.signal);
        validateIdempotencyKey(idempotencyKey);
        await this.loadState(options.signal);
        const key = recordKey(this.ownerId, idempotencyKey);
        const record = this.records.get(key);
        if (!record?.taskVersion || record.state === "deleted" || record.hidden) throw taskNotFound();
        if (!record.submitId || (record.state !== "accepted" && record.state !== "unknown" && record.state !== "succeeded")) {
            if (isPublicTerminal(record.state)) return this.publicTask(record, this.asyncTasks.get(key));
            throw submissionUnknown();
        }
        await this.reconciler.requestNow(record.idempotencyKey, options.signal);
        await this.reconciler.start();
        return this.publicTask(record, this.asyncTasks.get(key));
    }

    async listTasks(options: Pick<DreaminaRuntimeRunOptions, "signal"> = {}): Promise<DreaminaPublicGenerationTask[]> {
        return (await this.listTaskPage({ limit: 100, signal: options.signal })).tasks;
    }

    async listTaskPage(options: {
        limit?: number;
        cursor?: string;
        projectId?: string;
        activeOnly?: boolean;
        signal?: AbortSignal;
    } = {}): Promise<{ tasks: DreaminaPublicGenerationTask[]; nextCursor?: string }> {
        throwIfCancelled(options.signal);
        await this.loadState(options.signal);
        const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(100, options.limit as number)) : 50;
        const projectId = options.projectId?.trim();
        const cursor = options.cursor ? decodeTaskListCursor(options.cursor) : undefined;
        const visible = [...this.records.entries()]
            .filter(([, record]) => record.ownerId === this.ownerId && Boolean(record.taskVersion) && record.state !== "deleted" && !record.hidden)
            .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt)
                || right.idempotencyKey.localeCompare(left.idempotencyKey))
            .map(([key, record]) => {
                const summary = { ...this.publicTask(record, this.asyncTasks.get(key)) };
                delete summary.result;
                return summary;
            })
            .filter((task) => !projectId || (task.context?.scope === "scoped" && task.context.projectId === projectId))
            .filter((task) => !options.activeOnly || task.status === "queued" || task.status === "running")
            .filter((task) => !cursor || task.updatedAt < cursor.updatedAt || (task.updatedAt === cursor.updatedAt && task.id < cursor.id));
        const tasks = visible.slice(0, limit);
        const last = tasks.at(-1);
        return {
            tasks,
            ...(last && visible.length > tasks.length ? { nextCursor: encodeTaskListCursor(last.updatedAt, last.id) } : {}),
        };
    }

    async waitForTask(idempotencyKey: string, mode: "image" | "video", options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaGenerationResult> {
        throwIfCancelled(options.signal);
        validateIdempotencyKey(idempotencyKey);
        if (mode !== "image" && mode !== "video") throw generationRequestInvalid();
        await this.load(options.signal);
        // Startup recovery may yield while another Runtime commits a terminal result.
        // Refresh the durable journal before this waiter classifies the task.
        await this.loadState(options.signal);
        const key = recordKey(this.ownerId, idempotencyKey);
        const record = this.records.get(key);
        if (!record?.taskVersion || record.mode !== mode) throw taskNotFound();
        let task = this.asyncTasks.get(key);
        if (record.state === "succeeded" && !task?.result) {
            const durableResult = await this.readDurableResult(record).catch(() => undefined);
            if (durableResult) {
                task = task ?? this.createRecoveredTask(key, record);
                this.asyncTasks.set(key, task);
                this.resolvePreparedTask(task, durableResult);
            }
        }
        if (!task && record.submitId && (record.state === "accepted" || record.state === "succeeded")) {
            task = this.createRecoveredTask(key, record);
            this.asyncTasks.set(key, task);
        }
        if (task?.result) return task.result;
        if (record.state === "cancelled") throw cancelled();
        if (record.state === "failed" || record.state === "unknown") throw taskFailed(record.errorCode);
        if (!task || !record.submitId) throw taskFailed(record.errorCode);
        await this.reconciler.requestNow(record.idempotencyKey, options.signal);
        await this.reconciler.start();
        const durableWaitController = new AbortController();
        const durableWait = this.waitForDurableTerminal(key, mode, record.state, durableWaitController.signal);
        try {
            return await waitForAbort(Promise.race([task.completion, durableWait]), options.signal);
        } finally {
            durableWaitController.abort();
            await durableWait.catch(() => undefined);
        }
    }

    async cancelTask(idempotencyKey: string): Promise<DreaminaPublicGenerationTask> {
        validateIdempotencyKey(idempotencyKey);
        const key = recordKey(this.ownerId, idempotencyKey);
        await this.stopQueueHeartbeat(key);
        await this.load();
        let finalRecord!: RuntimeRecord;
        let pendingSubmission = false;
        let cancelledNow = false;
        await this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(key);
            if (!record?.taskVersion) throw taskNotFound();
            finalRecord = record;
            if (isPublicTerminal(record.state)) return;
            if (record.state === "pending") {
                pendingSubmission = true;
                return;
            }
            if (record.state === "accepted" && record.submitId) return;
            const next: RuntimeRecord = {
                ...record,
                state: "cancelled",
                errorCode: "dreamina_cancelled",
                updatedAt: this.now().toISOString(),
            };
            clearQueueLease(next);
            this.records.set(key, next);
            await this.persistUnlocked(lease);
            finalRecord = next;
            cancelledNow = true;
        });
        const task = this.asyncTasks.get(key);
        if (pendingSubmission) {
            task?.controller.abort();
            throw submissionUnknown();
        }
        if (!cancelledNow) return this.publicTask(finalRecord, task);
        const cancelledRecord = finalRecord;
        task?.controller.abort();
        const queuedIndex = this.queue.indexOf(key);
        if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
        if (task && !task.settled) {
            task.settled = true;
            task.error = cancelled();
            task.reject(task.error);
            task.completion.catch(() => undefined);
            await this.cleanupPreparedTask(task);
            task.input = undefined;
        }
        this.releaseSlot(key);
        return this.publicTask(cancelledRecord, task);
    }

    async deleteTask(idempotencyKey: string): Promise<{ deleted: true }> {
        validateIdempotencyKey(idempotencyKey);
        const key = recordKey(this.ownerId, idempotencyKey);
        await this.stopQueueHeartbeat(key);
        await this.loadState();
        let task: PreparedAsyncTask | undefined;
        let removeLocally = false;
        await this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(key);
            if (!record?.taskVersion || record.state === "deleted" || record.hidden) {
                if (record?.state === "deleted" || record?.hidden) return;
                throw taskNotFound();
            }
            task = this.asyncTasks.get(key);
            removeLocally = record.state === "queued"
                || (record.state === "pending" && record.submissionPhase === "reserved");
            const next: RuntimeRecord = {
                ...record,
                ...(removeLocally ? { state: "deleted" as const } : { hidden: true as const }),
                updatedAt: this.now().toISOString(),
            };
            if (removeLocally) clearQueueLease(next);
            this.records.set(key, next);
            await this.persistUnlocked(lease);
        });
        if (!removeLocally) return { deleted: true };
        task?.controller.abort();
        const queuedIndex = this.queue.indexOf(key);
        if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
        if (task && !task.settled) {
            task.settled = true;
            task.error = cancelled();
            task.reject(task.error);
            task.completion.catch(() => undefined);
            await this.cleanupPreparedTask(task);
            task.input = undefined;
        }
        this.releaseSlot(key);
        this.asyncTasks.delete(key);
        return { deleted: true };
    }

    async dispose() {
        this.disposed = true;
        this.queryShutdown.abort();
        await Promise.allSettled([...this.queueHeartbeats.keys()].map((key) => this.stopQueueHeartbeat(key)));
        await this.failOwnedQueuedTasksOnDispose();
        await this.reconciler.dispose();
        for (const task of this.asyncTasks.values()) task.controller.abort();
        await Promise.allSettled([...this.asyncTasks.values()].map(async (task) => {
            const pending: Promise<unknown>[] = [];
            if (task.starting) pending.push(task.starting);
            if (task.background) pending.push(task.background);
            await Promise.allSettled(pending);
            await this.cleanupPreparedTask(task);
            task.input = undefined;
        }));
        await Promise.allSettled([...this.deferredCleanups.entries()].map(async ([key, cleanup]) => {
            await cleanup();
            this.deferredCleanups.delete(key);
        }));
    }

    run(value: unknown, options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaRuntimeResult> {
        try {
            throwIfCancelled(options.signal);
            const input = parseInput(value);
            if (input.operation === "query_result") throw generationRequestInvalid();
            return this.generate(input, options.signal);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    async generateToResult(value: unknown, options: DreaminaRuntimeRunOptions = {}): Promise<DreaminaGenerationResult> {
        throwIfCancelled(options.signal);
        const input = parseInput(value);
        if (input.operation === "query_result") throw generationRequestInvalid();
        await this.enqueue(input, options);
        return this.waitForTask(input.idempotencyKey, resultMode(input), options);
    }

    private async enqueueNew(
        key: string,
        requestHash: string,
        input: DreaminaGenerationInput,
        options: DreaminaRuntimeRunOptions,
    ) {
        const signal = options.signal;
        await this.load(signal);
        const existing = this.records.get(key);
        if (existing) {
            if (existing.requestHash !== requestHash) throw idempotencyConflict();
            if (!existing.taskVersion) throw submissionUnknown();
            return this.publicTask(existing, this.asyncTasks.get(key));
        }
        const staged = await stageReferences(input, this.referenceRoots(), path.dirname(this.stateFile), signal);
        const task = createPreparedTask(key, requestHash, staged.input, staged.cleanup);
        try {
            const createdAt = this.now().toISOString();
            await this.withStateLock(async (lease) => {
                await this.reloadFromDisk(lease);
                const concurrent = this.records.get(key);
                if (concurrent) {
                    if (concurrent.requestHash !== requestHash) throw idempotencyConflict();
                    throw submissionUnknown();
                }
                this.records.set(key, {
                    ownerId: this.ownerId,
                    idempotencyKey: input.idempotencyKey,
                    clientOperationId: options.clientOperationId ?? input.idempotencyKey,
                    context: options.taskContext ?? { scope: "legacy_unscoped" },
                    requestHash,
                    state: "queued",
                    queueOwnerId: this.reservationOwnerId,
                    queueExpiresAt: this.queueExpiry(),
                    updatedAt: createdAt,
                    taskVersion: 1,
                    operation: input.operation,
                    mode: resultMode(input),
                    model: modelName(input),
                    createdAt,
                });
                await this.persistUnlocked(lease);
            }, signal);
            this.asyncTasks.set(key, task);
            return await this.startTask(task, signal);
        } catch (error) {
            if (!this.asyncTasks.has(key)) {
                const current = this.records.get(key);
                if (current?.requestHash === requestHash && current.state === "queued") this.records.delete(key);
                await this.cleanupPreparedTask(task);
                task.input = undefined;
            }
            throw error;
        }
    }

    private startTask(task: PreparedAsyncTask, signal?: AbortSignal): Promise<DreaminaPublicGenerationTask> {
        const starting = this.startTaskNow(task, signal);
        task.starting = starting;
        void starting.finally(() => {
            if (task.starting === starting) task.starting = undefined;
        }).catch(() => undefined);
        return starting;
    }

    private async startTaskNow(task: PreparedAsyncTask, signal?: AbortSignal): Promise<DreaminaPublicGenerationTask> {
        if (this.disposed) throw cancelled();
        const abort = () => task.controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        let reserved = false;
        try {
            if (signal?.aborted) task.controller.abort();
            const reservation = await this.reserveSubmissionSlot(task, task.controller.signal);
            reserved = Boolean(reservation);
            if (!reservation) {
                this.startQueueHeartbeat(task);
                if (!this.queue.includes(task.key)) this.queue.push(task.key);
                return this.publicTask(this.records.get(task.key)!, task);
            }
            await this.stopQueueHeartbeat(task.key);
            this.activeTasks.add(task.key);
            const stopHeartbeat = this.startReservationHeartbeat(task.key, task.requestHash, reservation);
            const mode = resultMode(task.input!);
            let accepted: { state: "accepted"; submitId: string };
            try {
                accepted = await this.submitPrepared(task, reservation, task.controller.signal);
            } finally {
                await stopHeartbeat();
            }
            const submitted = this.publicTask(this.records.get(task.key)!, task);
            task.polling = true;
            void this.waitForEnqueueDrain(task.controller.signal)
                .then(() => this.reconciler.scheduleBackground(submitted.id, task.controller.signal))
                .catch(() => undefined);
            return submitted;
        } catch (error) {
            if (reserved && !(error instanceof DreaminaCliError
                && (error.code === "dreamina_cli_fenced" || error.code === "dreamina_account_session_changed"))) {
                await this.failTask(task, errorCode(error));
                this.releaseSlot(task.key);
            }
            throw error;
        } finally {
            signal?.removeEventListener("abort", abort);
        }
    }

    private async reserveSubmissionSlot(task: PreparedAsyncTask, signal?: AbortSignal) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(task.key);
            if (!record || record.requestHash !== task.requestHash) throw stateInvalid();
            if (record.state !== "queued") throw submissionUnknown();
            if (!this.hasGenerationCapacity()) return undefined;
            const reservation: SubmissionReservation = {
                reservationId: crypto.randomUUID(),
                reservationOwnerId: this.reservationOwnerId,
            };
            clearQueueLease(record);
            Object.assign(record, {
                state: "pending",
                ...reservation,
                submissionPhase: "reserved" as const,
                reservationExpiresAt: this.reservationExpiry(),
                updatedAt: this.now().toISOString(),
            });
            await this.persistUnlocked(lease);
            return reservation;
        }, signal);
    }

    private reservationExpiry() {
        return new Date(this.now().getTime() + this.reservationLeaseMs).toISOString();
    }

    private queueExpiry() {
        return new Date(this.now().getTime() + this.reservationLeaseMs).toISOString();
    }

    private startQueueHeartbeat(task: PreparedAsyncTask) {
        if (this.reservationHeartbeatMs === 0 || this.queueHeartbeats.has(task.key)) return;
        let stopped = false;
        const shutdown = new AbortController();
        let refresh = Promise.resolve();
        const renew = async () => {
            if (stopped) return;
            this.onQueueHeartbeatWait?.("started", task.key);
            try {
                await this.renewQueueLease(task.key, task.requestHash, shutdown.signal);
            } catch {
                stopped = true;
                clearInterval(timer);
                this.queueHeartbeats.delete(task.key);
            } finally {
                this.onQueueHeartbeatWait?.("settled", task.key);
            }
        };
        const timer = setInterval(() => {
            refresh = refresh.then(renew);
        }, this.reservationHeartbeatMs);
        timer.unref();
        this.queueHeartbeats.set(task.key, async () => {
            if (stopped) return;
            stopped = true;
            shutdown.abort();
            clearInterval(timer);
            await refresh;
            this.queueHeartbeats.delete(task.key);
        });
    }

    private async stopQueueHeartbeat(key: string) {
        await this.queueHeartbeats.get(key)?.();
    }

    private async renewQueueLease(key: string, requestHash: string, signal: AbortSignal) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(key);
            if (!record || record.requestHash !== requestHash || record.state !== "queued"
                || record.queueOwnerId !== this.reservationOwnerId || !liveQueueLease(record, this.now())) throw cliFenced();
            record.queueExpiresAt = this.queueExpiry();
            await this.persistUnlocked(lease);
        }, signal);
    }

    private startReservationHeartbeat(key: string, requestHash: string, reservation: SubmissionReservation) {
        if (this.reservationHeartbeatMs === 0) return async () => undefined;
        let stopped = false;
        let lost = false;
        let refresh = Promise.resolve();
        const renew = async () => {
            if (stopped || lost) return;
            try {
                await this.renewReservation(key, requestHash, reservation);
            } catch {
                lost = true;
                clearInterval(timer);
            }
        };
        const timer = setInterval(() => {
            refresh = refresh.then(renew);
        }, this.reservationHeartbeatMs);
        timer.unref();
        return async () => {
            if (stopped) return;
            stopped = true;
            clearInterval(timer);
            await refresh;
        };
    }

    private async renewReservation(key: string, requestHash: string, reservation: SubmissionReservation) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(key);
            if (!matchesReservation(record, requestHash, reservation) || !liveReservation(record, this.now())) throw cliFenced();
            record.reservationExpiresAt = this.reservationExpiry();
            await this.persistUnlocked(lease);
        });
    }

    private async submitPrepared(
        task: PreparedAsyncTask,
        reservation: SubmissionReservation,
        signal?: AbortSignal,
    ): Promise<{ state: "accepted"; submitId: string }> {
        let spawned = false;
        let fenceEpoch: number | undefined;
        try {
            throwIfCancelled(signal);
            const expectedSession = await this.ensureReady(signal);
            const installation = await this.discover(signal);
            if (!installation.installed) throw new DreaminaCliError("dreamina_missing", "Dreamina CLI is not installed", 404);
            const invocation = await this.arbiter.acquire({ signal, expectedSession: expectedSession ?? undefined });
            fenceEpoch = invocation.fenceEpoch;
            let submitId: string;
            try {
                await this.commitInvocationFence(task, reservation, fenceEpoch, expectedSession ?? undefined, signal);
                const result = await this.runProcess({
                    executable: installation.executable,
                    args: generationArguments(task.input!),
                    timeoutMs: 45_000,
                    completeOnJsonOutput: isSubmitReceiptOutput,
                    env: this.env,
                    signal,
                    onSpawn: () => { spawned = true; },
                });
                spawned = true;
                const submitted = submittedReceipt(result);
                if (!submitted.ok) throw submitFailure(submitted.code);
                submitId = submitted.submitId;
                await invocation.assertCurrent(expectedSession ?? undefined);
                await this.commitAcceptedReceipt(
                    task,
                    reservation,
                    fenceEpoch,
                    submitId,
                    () => invocation.assertCurrent(expectedSession ?? undefined),
                    expectedSession ?? undefined,
                    signal,
                );
            } finally {
                await invocation.release();
            }

            // Receipt persistence is the irreversible provider boundary. Local staging
            // maintenance after this point must never rewrite provider acceptance to unknown.
            const cleanupSucceeded = await this.cleanupPreparedTask(task);
            task.input = undefined;
            if (!cleanupSucceeded) await this.persistCleanupWarning(task, fenceEpoch).catch(() => undefined);
            return { state: "accepted", submitId };
        } catch (error) {
            if (error instanceof DreaminaCliError && (error.code === "dreamina_cli_fenced" || error.code === "dreamina_account_session_changed")) {
                throw error;
            }
            const code = submitFailureCode(error, spawned);
            let durableCommitError: DreaminaCliError | undefined;
            await this.commitSubmissionFailure(task, reservation, fenceEpoch, spawned, code).catch((commitError) => {
                if (isDurableJournalCommitError(commitError)) durableCommitError = commitError;
            });
            await this.cleanupPreparedTask(task);
            task.input = undefined;
            if (durableCommitError) throw durableCommitError;
            if (!spawned && error instanceof DreaminaCliError && error.code !== "dreamina_submission_unknown") {
                this.asyncTasks.delete(task.key);
                if (error.code === "dreamina_spawn_failed") throw submitFailure("dreamina_submit_spawn_failed");
                throw error;
            }
            throw submitFailure(code);
        }
    }

    private async commitInvocationFence(
        task: PreparedAsyncTask,
        reservation: SubmissionReservation,
        fenceEpoch: number,
        expectedSession?: DreaminaCliSessionSnapshot,
        signal?: AbortSignal,
    ) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(task.key);
            if (!matchesReservation(record, task.requestHash, reservation) || !liveReservation(record, this.now())) throw cliFenced();
            if (record.fenceEpoch !== undefined && record.fenceEpoch > fenceEpoch) throw cliFenced();
            record.fenceEpoch = fenceEpoch;
            if (expectedSession?.accountBinding) {
                if (record.accountBinding && record.accountBinding !== expectedSession.accountBinding) throw accountChanged();
                record.accountBinding = expectedSession.accountBinding;
                record.sessionEpoch = expectedSession.sessionEpoch;
            }
            record.submissionPhase = "spawn_permitted";
            record.reservationExpiresAt = this.reservationExpiry();
            await this.persistUnlocked(lease);
            return record;
        }, signal);
    }

    private async commitAcceptedReceipt(
        task: PreparedAsyncTask,
        reservation: SubmissionReservation,
        fenceEpoch: number,
        submitId: string,
        assertInvocationCurrent: () => Promise<void>,
        expectedSession?: DreaminaCliSessionSnapshot,
        signal?: AbortSignal,
    ) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(task.key);
            if (!matchesReservation(record, task.requestHash, reservation)
                || record.submissionPhase !== "spawn_permitted" || record.fenceEpoch !== fenceEpoch) throw cliFenced();
            if (expectedSession?.accountBinding
                && (record.accountBinding !== expectedSession.accountBinding || record.sessionEpoch !== expectedSession.sessionEpoch)) throw accountChanged();
            await assertInvocationCurrent();
            Object.assign(record, { state: "accepted", submitId, updatedAt: this.now().toISOString() });
            clearReservation(record);
            await this.persistUnlocked(lease);
            return record;
        }, signal);
    }

    private async commitSubmissionFailure(
        task: PreparedAsyncTask,
        reservation: SubmissionReservation,
        fenceEpoch: number | undefined,
        spawned: boolean,
        code: string,
    ) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(task.key);
            if (!matchesReservation(record, task.requestHash, reservation)) throw cliFenced();
            if (fenceEpoch !== undefined && record.fenceEpoch !== fenceEpoch) throw cliFenced();
            if (!spawned) this.records.delete(task.key);
            else {
                Object.assign(record, { state: "unknown", errorCode: code, updatedAt: this.now().toISOString() });
                clearReservation(record);
            }
            await this.persistUnlocked(lease);
        });
    }

    private async cleanupPreparedTask(task: PreparedAsyncTask) {
        try {
            await task.cleanup();
            this.deferredCleanups.delete(task.cleanupId);
            return true;
        } catch {
            this.deferredCleanups.set(task.cleanupId, task.cleanup);
            return false;
        }
    }

    private async observeReconciliation(record: Readonly<RuntimeRecord>, signal?: AbortSignal): Promise<DreaminaReconcileObservation> {
        if (!record.submitId) throw new DreaminaCliError("dreamina_submission_unknown", "Dreamina reconciliation requires a durable receipt", 409);
        const queried = await this.query(record.submitId, signal, undefined, record.accountBinding);
        const status = queryOfficialStatus(queried);
        const observedAt = this.now().toISOString();
        if (status !== "completed") return { status, observedAt };
        try {
            const mode = record.mode ?? "video";
            const result = await this.materializeCompletedResultOnce(record.submitId, mode, signal, record.accountBinding);
            const providerOutputs = await this.artifactStore.persistResult(result, this.artifactBinding(record, mode));
            return { status, observedAt, result, providerOutputs };
        } catch (error) {
            return { status, observedAt, retryCode: reconciliationRetryCode(error) };
        }
    }

    private async materializeCompletedResultOnce(
        submitId: string,
        mode: "image" | "video",
        signal?: AbortSignal,
        accountBinding?: string,
    ) {
        await fs.mkdir(this.generationRoot, { recursive: true, mode: 0o700 });
        const runRoot = await fs.mkdtemp(path.join(this.generationRoot, "run-"));
        const outputRoot = path.join(runRoot, "output");
        await fs.mkdir(outputRoot, { mode: 0o700 });
        try {
            const materialized = await this.query(submitId, signal, outputRoot, accountBinding);
            if (queryState(materialized) !== "completed") {
                throw new DreaminaCliError("dreamina_query_materialization_retry", "Dreamina result materialization is not ready", 502);
            }
            return await collectDreaminaGenerationResult(outputRoot, mode);
        } finally {
            await fs.rm(runRoot, { recursive: true, force: true });
        }
    }

    private async handleReconcileApplied(event: DreaminaReconcileApplied) {
        const key = recordKey(this.ownerId, event.record.idempotencyKey);
        this.records.set(key, { ...event.record, ...(event.record.pollLease ? { pollLease: { ...event.record.pollLease } } : {}) });
        const task = this.asyncTasks.get(key);
        if (event.syncErrorCode === "dreamina_account_session_changed") {
            if (task && !task.settled) {
                task.polling = false;
                task.settled = true;
                task.error = accountChanged();
                task.reject(task.error);
                task.completion.catch(() => undefined);
                if (this.asyncTasks.get(key) === task) this.asyncTasks.delete(key);
            }
            return;
        }
        if (event.record.state === "accepted") {
            if (task) task.polling = true;
            return;
        }
        if (event.record.state === "succeeded") {
            this.releaseSlot(key);
            if (!task) return;
            const durableResult = await this.readDurableResult(event.record).catch(() => undefined);
            task.polling = !durableResult;
            if (durableResult) this.resolvePreparedTask(task, durableResult);
            return;
        }
        if (event.record.state === "failed" || event.record.state === "cancelled") {
            this.releaseSlot(key);
            if (!task) return;
            task.polling = false;
            if (!task.settled) {
                task.settled = true;
                task.error = event.record.state === "cancelled" ? cancelled() : taskFailed(event.record.errorCode);
                task.reject(task.error);
                task.completion.catch(() => undefined);
            }
        }
    }

    private async persistCleanupWarning(task: PreparedAsyncTask, fenceEpoch: number) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(task.key);
            if (!record || record.state !== "accepted" || record.fenceEpoch !== fenceEpoch) throw cliFenced();
            Object.assign(record, { errorCode: "dreamina_reference_cleanup_failed", updatedAt: this.now().toISOString() });
            await this.persistUnlocked(lease);
        });
    }

    private async waitForEnqueueDrain(signal?: AbortSignal) {
        let pending: Promise<void>;
        do {
            throwIfCancelled(signal);
            pending = this.enqueueSerial;
            await waitForAbort(pending, signal);
        } while (this.enqueueInFlight.size > 0 || pending !== this.enqueueSerial);
    }

    private async failTask(task: PreparedAsyncTask, code: string) {
        await this.stopQueueHeartbeat(task.key);
        const record = this.records.get(task.key);
        if (record && !isPublicTerminal(record.state)) {
            const final = await this.transitionTask(task.key, (current) => {
                const next: RuntimeRecord = { ...current, state: "failed", errorCode: code, updatedAt: this.now().toISOString() };
                clearQueueLease(next);
                return next;
            });
            if (final.state === "succeeded") {
                task.polling = false;
                if (this.asyncTasks.get(task.key) === task) this.asyncTasks.delete(task.key);
            }
        }
        if (!task.settled) {
            task.settled = true;
            task.error ||= taskFailed(code);
            task.reject(task.error);
            task.completion.catch(() => undefined);
        }
    }

    private async failOwnedQueuedTasksOnDispose() {
        if (![...this.records.values()].some((record) => record.state === "queued"
            && record.queueOwnerId === this.reservationOwnerId)) return;
        await this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            let changed = false;
            for (const record of this.records.values()) {
                if (record.state !== "queued" || record.queueOwnerId !== this.reservationOwnerId) continue;
                record.state = "failed";
                record.errorCode = "dreamina_interrupted_before_submission";
                record.updatedAt = this.now().toISOString();
                clearQueueLease(record);
                changed = true;
            }
            if (changed) await this.persistUnlocked(lease);
        });
    }

    private releaseSlot(key: string) {
        if (!this.activeTasks.delete(key)) return;
        while (this.queue.length) {
            const nextKey = this.queue.shift()!;
            const next = this.asyncTasks.get(nextKey);
            if (!next || this.records.get(nextKey)?.state !== "queued") continue;
            void this.startTask(next).then((result) => {
                if (result.status === "queued" && !this.queue.includes(nextKey)) this.queue.unshift(nextKey);
            }).catch(() => undefined);
            return;
        }
    }

    private publicTask(record: RuntimeRecord, task?: PreparedAsyncTask): DreaminaPublicGenerationTask {
        if (!record.taskVersion || !record.operation || !record.mode || !record.model || !record.createdAt) throw stateInvalid();
        const state = publicState(record.state, dreaminaTaskFromRuntimeJournal(record));
        if (record.state === "accepted" && record.officialStatus === "processing") {
            state.stage = "generating";
            state.progress = undefined;
        }
        return {
            id: record.idempotencyKey,
            ...(record.clientOperationId ? { clientOperationId: record.clientOperationId } : {}),
            ...(record.context ? { context: record.context } : {}),
            provider: "dreamina-cli",
            mode: record.mode,
            operation: record.operation as DreaminaGenerationInput["operation"],
            model: record.model,
            status: state.status,
            stage: state.stage,
            ...(state.progress === undefined ? {} : { progress: state.progress }),
            receiptRecorded: Boolean(record.submitId),
            ...(record.errorCode ? { errorCode: record.errorCode } : {}),
            ...(record.officialStatus ? { officialStatus: record.officialStatus } : {}),
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            ...(task?.result ? { result: task.result } : {}),
        };
    }

    private async transitionTask(key: string, update: (record: RuntimeRecord) => RuntimeRecord) {
        return this.withStateLock(async (lease) => {
            await this.reloadFromDisk(lease);
            const record = this.records.get(key);
            if (!record?.taskVersion) throw stateInvalid();
            // The fresh record read under this lease is authoritative. A stale Runtime may
            // observe accepted work, but it can never overwrite a terminal result written
            // by another Runtime instance.
            if (isPublicTerminal(record.state)) return record;
            const next = update(record);
            this.records.set(key, next);
            await this.persistUnlocked(lease);
            return next;
        });
    }

    async resumeToResult(
        idempotencyKey: string,
        mode: "image" | "video",
        options: DreaminaRuntimeRunOptions = {},
    ): Promise<DreaminaGenerationResult> {
        throwIfCancelled(options.signal);
        if (!/^[A-Za-z0-9._:-]{16,120}$/.test(idempotencyKey) || (mode !== "image" && mode !== "video")) throw generationRequestInvalid();
        return this.waitForTask(idempotencyKey, mode, options);
    }

    private generate(input: DreaminaGenerationInput, signal?: AbortSignal, trustedFingerprint?: string) {
        const key = recordKey(this.ownerId, input.idempotencyKey);
        const requestHash = trustedFingerprint ?? hashRequest(input);
        const active = this.inFlight.get(key);
        if (active) {
            if (active.requestHash !== requestHash) return Promise.reject(idempotencyConflict());
            return subscribeToSubmission(active, signal);
        }
        const controller = new AbortController();
        const submission = {
            requestHash,
            controller,
            waiters: 0,
            settled: false,
        } as InFlightSubmission;
        submission.promise = this.load(controller.signal).then(() => {
            throwIfCancelled(controller.signal);
            const existing = this.records.get(key);
            if (existing) {
                if (existing.requestHash !== requestHash) throw idempotencyConflict();
                if (existing.state === "accepted" && existing.submitId) {
                    return { state: "accepted" as const, submitId: existing.submitId };
                }
                throw submissionUnknown();
            }
            return this.submitWithLock(key, requestHash, input, controller.signal);
        })
            .finally(() => {
                submission.settled = true;
                if (this.inFlight.get(key) === submission) this.inFlight.delete(key);
            });
        this.inFlight.set(key, submission);
        return subscribeToSubmission(submission, signal);
    }

    private async submitWithLock(
        key: string,
        requestHash: string,
        input: DreaminaGenerationInput,
        signal?: AbortSignal,
    ) {
        return this.withStateLock(async (lease) => {
            throwIfCancelled(signal);
            await this.reloadFromDisk(lease);
            const existing = this.records.get(key);
            if (existing) {
                if (existing.requestHash !== requestHash) throw idempotencyConflict();
                if (existing.state === "accepted" && existing.submitId) {
                    return { state: "accepted" as const, submitId: existing.submitId };
                }
                throw submissionUnknown();
            }
            if (!this.hasGenerationCapacity()) throw generationCapacityFull();
            return await this.submit(key, requestHash, input, lease, signal);
        }, signal);
    }

    private async submit(
        key: string,
        requestHash: string,
        input: DreaminaGenerationInput,
        lease: StateLockLease,
        signal?: AbortSignal,
    ): Promise<DreaminaRuntimeResult> {
        throwIfCancelled(signal);
        await lease.assertOwned();
        const staged = await stageReferences(input, this.referenceRoots(), path.dirname(this.stateFile), signal);
        const cleanupId = crypto.randomUUID();
        let receiptCommitted = false;
        let primaryError: unknown;
        try {
            throwIfCancelled(signal);
            const expectedSession = await this.ensureReady(signal);
            throwIfCancelled(signal);
            await lease.assertOwned();
            const installation = await this.discover(signal);
            throwIfCancelled(signal);
            await lease.assertOwned();
            if (!installation.installed) throw new DreaminaCliError("dreamina_missing", "未检测到 Dreamina CLI", 404);

            const record: RuntimeRecord = {
                ownerId: this.ownerId,
                idempotencyKey: input.idempotencyKey,
                requestHash,
                state: "pending",
                updatedAt: this.now().toISOString(),
            };
            this.records.set(key, record);
            await this.persistUnlocked(lease);

            let spawned = false;
            try {
                throwIfCancelled(signal);
                await lease.assertOwned();
                const invocation = await this.arbiter.acquire({ signal, expectedSession: expectedSession ?? undefined });
                record.fenceEpoch = invocation.fenceEpoch;
                if (expectedSession?.accountBinding) {
                    record.accountBinding = expectedSession.accountBinding;
                    record.sessionEpoch = expectedSession.sessionEpoch;
                }
                await this.persistUnlocked(lease);
                let submitId: string;
                try {
                    const result = await this.runProcess({
                        executable: installation.executable,
                        args: generationArguments(staged.input),
                        timeoutMs: 45_000,
                        completeOnJsonOutput: isSubmitReceiptOutput,
                        env: this.env,
                        signal,
                        onSpawn: () => { spawned = true; },
                    });
                    // A returned process result proves that process creation was attempted even
                    // when an injected runner did not call onSpawn.
                    spawned = true;
                    const submitted = submittedReceipt(result);
                    if (!submitted.ok) throw submitFailure(submitted.code);
                    submitId = submitted.submitId;
                    await invocation.assertCurrent(expectedSession ?? undefined);
                    Object.assign(record, {
                        state: "accepted",
                        submitId,
                        updatedAt: this.now().toISOString(),
                    });
                    await this.persistUnlocked(lease);
                    receiptCommitted = true;
                } finally {
                    await invocation.release();
                }
                try {
                    await staged.cleanup();
                    this.deferredCleanups.delete(cleanupId);
                } catch {
                    this.deferredCleanups.set(cleanupId, staged.cleanup);
                    Object.assign(record, {
                        errorCode: "dreamina_reference_cleanup_failed",
                        updatedAt: this.now().toISOString(),
                    });
                    try { await this.persistUnlocked(lease); } catch {
                        // Provider acceptance is already durable; a maintenance-warning write
                        // failure cannot turn this paid submit into an unknown/retryable result.
                    }
                }
                return { state: "accepted", submitId };
            } catch (error) {
                if (error instanceof DreaminaCliError && error.code === "dreamina_cli_fenced") throw error;
                if (receiptCommitted && record.state === "accepted" && record.submitId) {
                    this.deferredCleanups.set(cleanupId, staged.cleanup);
                    return { state: "accepted", submitId: record.submitId };
                }
                if (!spawned && error instanceof DreaminaCliError && error.code === "dreamina_state_fenced") {
                    this.records.delete(key);
                    throw error;
                }
                if (!spawned && error instanceof DreaminaCliError && error.code !== "dreamina_submission_unknown") {
                    this.records.delete(key);
                    await this.persistUnlocked(lease);
                    throw error;
                }
                const code = submitFailureCode(error, spawned);
                Object.assign(record, { state: "unknown", errorCode: code, updatedAt: this.now().toISOString() });
                delete record.submitId;
                try { await this.persistUnlocked(lease); } catch {
                    // The pending receipt was fsynced before spawn, so a lost lease or second
                    // persistence failure must stay non-retryable until recovery.
                }
                throw submitFailure(code);
            }
        } catch (error) {
            primaryError = error;
            throw error;
        } finally {
            if (!receiptCommitted) {
                try {
                    await staged.cleanup();
                    this.deferredCleanups.delete(cleanupId);
                } catch (cleanupError) {
                    this.deferredCleanups.set(cleanupId, staged.cleanup);
                    if (primaryError === undefined) throw cleanupError;
                }
            }
        }
    }

    private async query(
        submitId: string,
        signal?: AbortSignal,
        downloadDirectory?: string,
        accountBinding?: string,
    ): Promise<DreaminaRuntimeResult> {
        const combined = combineAbortSignals(signal, this.queryShutdown.signal);
        let invocation: Awaited<ReturnType<DreaminaCliArbiter["acquire"]>> | undefined;
        try {
            throwIfCancelled(combined.signal);
            const expectedSession = await this.ensureReady(combined.signal);
            if (accountBinding !== undefined) {
                if (!expectedSession || expectedSession.accountBinding !== accountBinding) throw accountChanged();
            } else if (expectedSession !== undefined) {
                // A session-aware Runtime must not guess which account owns an unbound legacy receipt.
                throw accountChanged();
            }
            throwIfCancelled(combined.signal);
            const installation = await this.discover(combined.signal);
            throwIfCancelled(combined.signal);
            if (!installation.installed) throw new DreaminaCliError("dreamina_missing", "未检测到 Dreamina CLI", 404);
            // The cross-process arbiter covers this one CLI invocation only; official work
            // remains outside the lease after the process returns.
            invocation = await this.arbiter.acquire({ signal: combined.signal, expectedSession: expectedSession ?? undefined });
            throwIfCancelled(combined.signal);
            const result = await this.runProcess({
                executable: installation.executable,
                args: [
                    "query_result",
                    `--submit_id=${submitId}`,
                    ...(downloadDirectory ? [`--download_dir=${exactGenerationDirectory(this.generationRoot, downloadDirectory)}`] : []),
                ],
                timeoutMs: 30_000,
                completeOnJsonOutput: downloadDirectory ? undefined : isCompleteQueryOutput,
                env: this.env,
                signal: combined.signal,
            });
            await invocation.assertCurrent(expectedSession ?? undefined);
            if (result.exitCode !== 0) throw new DreaminaCliError("dreamina_query_failed", "Dreamina 任务查询失败", 502);
            return { state: "query", result: safeJsonResult(result.stdout) };
        } finally {
            await invocation?.release();
            combined.dispose();
        }
    }

    private waitForDurableTerminal(
        key: string,
        mode: "image" | "video",
        initialState: RuntimeRecord["state"],
        signal: AbortSignal,
    ): Promise<DreaminaGenerationResult> {
        const combined = combineAbortSignals(signal, this.queryShutdown.signal);
        return new Promise<DreaminaGenerationResult>((resolve, reject) => {
            let settled = false;
            let checking = false;
            let checkAgain = false;
            let abortPending = false;
            let watcher: { close(): void } | undefined;
            let fallback: { cancel(): void } | undefined;
            const closeSignals = () => {
                watcher?.close();
                watcher = undefined;
                fallback?.cancel();
                fallback = undefined;
            };
            const finish = (action: () => void) => {
                if (settled) return;
                settled = true;
                combined.signal.removeEventListener("abort", onAbort);
                closeSignals();
                combined.dispose();
                action();
            };
            const onAbort = () => {
                closeSignals();
                if (checking) {
                    abortPending = true;
                    checkAgain = false;
                    return;
                }
                finish(() => reject(cancelled()));
            };
            const scheduleFallback = () => {
                if (settled || abortPending || combined.signal.aborted || fallback) return;
                fallback = this.scheduleDurableReload(() => {
                    fallback = undefined;
                    void check();
                }, this.durableReloadIntervalMs);
            };
            const check = async () => {
                if (settled) return;
                if (checking) {
                    checkAgain = true;
                    return;
                }
                checking = true;
                do {
                    checkAgain = false;
                    try {
                        await this.loadState();
                        if (combined.signal.aborted) {
                            abortPending = true;
                            break;
                        }
                        const record = this.records.get(key);
                        if (!record?.taskVersion || record.mode !== mode) {
                            finish(() => reject(taskNotFound()));
                        } else if (record.state === "succeeded") {
                            const durableResult = await this.readDurableResult(record).catch(() => undefined);
                            if (durableResult) finish(() => resolve(durableResult));
                            else if (initialState !== "succeeded") {
                                void this.reconciler.requestNow(record.idempotencyKey).catch(() => undefined);
                            }
                        } else if (record.state === "cancelled") {
                            finish(() => reject(cancelled()));
                        } else if (record.state === "failed" || record.state === "unknown" || record.state === "deleted") {
                            finish(() => reject(taskFailed(record.errorCode)));
                        }
                    } catch (error) {
                        if (combined.signal.aborted) abortPending = true;
                        else finish(() => reject(error));
                    }
                } while (checkAgain && !settled && !abortPending);
                checking = false;
                if (abortPending && !settled) finish(() => reject(cancelled()));
                else scheduleFallback();
            };
            const stateName = path.basename(this.stateFile);
            try {
                watcher = this.watchStateFile((filename) => {
                    if (filename !== null && filename !== stateName) return;
                    void check();
                });
            } catch {
                // The durable reload timer remains authoritative when fs.watch is unavailable.
            }
            combined.signal.addEventListener("abort", onAbort, { once: true });
            if (combined.signal.aborted) onAbort();
            else {
                scheduleFallback();
                void check();
            }
        });
    }

    private load(signal?: AbortSignal) {
        return this.loadState(signal).then(() => this.startRecoveryOnce());
    }

    private loadState(signal?: AbortSignal) {
        return waitForAbort(this.withStateLock((lease) => this.reloadFromDisk(lease)), signal);
    }

    private async startRecoveryOnce() {
        if (this.recoveryStarted) return this.reconciler.start();
        this.recoveryStarted = true;
        for (const [key, record] of this.records) {
            if (!record.taskVersion || !record.submitId || (record.state !== "accepted" && record.state !== "succeeded")) continue;
            const task = this.createRecoveredTask(key, record);
            this.asyncTasks.set(key, task);
            task.polling = true;
            if (record.state === "accepted") this.activeTasks.add(key);
        }
        await this.artifactStore.scavenge([...this.records.values()].flatMap((record) => record.providerOutputs ?? []));
        await this.reconciler.start();
    }

    private async reloadFromDisk(lease: StateLockLease) {
        await lease.assertOwned();
        await recoverStateReplacement(this.stateFile, this.ownerId, lease);
        await lease.assertOwned();
        await scavengeStaleStagingDirectories(path.dirname(this.stateFile), lease);
        await lease.assertOwned();
        const disk = await readRuntimeDiskState(this.stateFile, this.ownerId);
        if (!disk) {
            if (this.records.size === 0) return;
            throw stateInvalid();
        }
        let recovered = false;
        const next = new Map<string, RuntimeRecord>();
        for (const value of disk.records) {
            const record = { ...value };
            const key = recordKey(record.ownerId, record.idempotencyKey);
            if (record.state === "pending" && !liveReservation(record, this.now())) {
                if (record.submissionPhase === "reserved" && record.reservationId && record.reservationOwnerId) {
                    record.state = "failed";
                    record.errorCode = "dreamina_interrupted_before_submission";
                } else {
                    record.state = "unknown";
                    if (record.taskVersion) record.errorCode = "dreamina_submission_unknown";
                }
                record.updatedAt = this.now().toISOString();
                clearReservation(record);
                recovered = true;
            } else if (record.taskVersion && record.state === "queued" && !liveQueueLease(record, this.now())) {
                record.state = "failed";
                record.errorCode = "dreamina_interrupted_before_submission";
                record.updatedAt = this.now().toISOString();
                clearQueueLease(record);
                recovered = true;
            }
            next.set(key, record);
        }
        for (const [key, current] of this.records) {
            const incoming = next.get(key);
            if (!incoming || incoming.requestHash !== current.requestHash || stateRank(incoming.state) < stateRank(current.state)) {
                throw stateInvalid();
            }
        }
        this.records.clear();
        for (const [key, record] of next) this.records.set(key, record);
        if (recovered) await this.persistUnlocked(lease);
    }

    private hasGenerationCapacity() {
        return [...this.records.values()].filter(reservesOfficialSlot).length < this.maxActiveTasks;
    }

    private async persistUnlocked(lease: StateLockLease) {
        const payload: RuntimeDiskState = {
            version: 1,
            records: [...this.records.values()].sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey)),
        };
        await persistRuntimeDiskState(this.stateFile, this.ownerId, payload, lease);
    }

    private async withStateLock<T>(action: (lease: StateLockLease) => Promise<T>, signal?: AbortSignal) {
        const release = await acquireStateLock(this.stateFile, signal);
        try { return await action(release); } finally { await release(); }
    }

    private artifactBinding(record: Readonly<RuntimeRecord>, mode: "image" | "video") {
        return {
            ownerId: record.ownerId,
            idempotencyKey: record.idempotencyKey,
            ...(record.accountBinding ? { accountBinding: record.accountBinding } : {}),
            ...(record.fenceEpoch ? { fenceEpoch: record.fenceEpoch } : {}),
            mode,
        };
    }

    private async readDurableResult(record: Readonly<RuntimeRecord>) {
        if (!record.taskVersion || !record.mode || !record.providerOutputs?.length) return undefined;
        const projected = await this.taskProjector.projectJournalVersion(
            record.idempotencyKey,
            record.journalVersion ?? 1,
        );
        if (!projected || projected.visibility === "deleted"
            || projected.projectedJournalVersion < (record.journalVersion ?? 1)
            || projected.outputs.length !== record.providerOutputs.length) return undefined;
        const outputs = projected.outputs.map((output) => {
            if ((output.mediaType !== "image" && output.mediaType !== "video") || !output.providerArtifactRef) {
                throw stateInvalid();
            }
            return {
                outputIndex: output.outputIndex,
                mediaType: output.mediaType,
                providerArtifactRef: output.providerArtifactRef,
            };
        });
        return this.artifactStore.readResult(outputs, this.artifactBinding(record, record.mode));
    }

    private resolvePreparedTask(task: PreparedAsyncTask, result: DreaminaGenerationResult) {
        task.result = result;
        task.polling = false;
        if (task.settled) return;
        task.settled = true;
        task.resolve(result);
    }

    private createRecoveredTask(key: string, record: RuntimeRecord) {
        return createPreparedTask(key, record.requestHash, undefined, async () => undefined);
    }
}

function parseInput(value: unknown): DreaminaCliInput {
    const result = dreaminaCliInputSchema.safeParse(value);
    if (!result.success) throw new DreaminaCliError("dreamina_request_invalid", "Dreamina 请求参数无效", 400);
    return result.data;
}

function resultMode(input: DreaminaGenerationInput): "image" | "video" {
    return input.operation === "text2image" || input.operation === "image2image" || input.operation === "image_upscale" ? "image" : "video";
}

function modelName(input: DreaminaGenerationInput) {
    if ("modelVersion" in input && input.modelVersion) return input.modelVersion;
    if (input.operation === "text2image" || input.operation === "image2image") return "5.0";
    if (input.operation === "image_upscale") return "image-upscale";
    if (input.operation === "text2video") return "seedance2.0fast";
    return "seedance2.0_vip";
}

function createPreparedTask(
    key: string,
    requestHash: string,
    input: DreaminaGenerationInput | undefined,
    cleanup: () => Promise<void>,
): PreparedAsyncTask {
    let resolve!: (result: DreaminaGenerationResult) => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<DreaminaGenerationResult>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    completion.catch(() => undefined);
    return {
        key,
        requestHash,
        input,
        cleanup,
        cleanupId: crypto.randomUUID(),
        controller: new AbortController(),
        completion,
        resolve,
        reject,
        settled: false,
        polling: false,
    };
}

function publicState(
    journalState: RuntimeRecord["state"],
    state: DreaminaTaskState,
): Pick<DreaminaPublicGenerationTask, "status" | "stage" | "progress"> {
    // Task 1 freezes product semantics without changing the legacy public DTO. Old Runtime
    // records can encode local sync failure or stopped waiting as failed/cancelled; Task 4
    // removes that transport-era presentation after shared reconciliation owns the lifecycle.
    if (journalState === "failed") return { status: "failed", stage: "failed" };
    if (journalState === "cancelled") return { status: "cancelled", stage: "cancelled" };
    if (state.lifecycle === "QUEUED_LOCAL") return { status: "queued", stage: "queued", progress: 0 };
    if (state.lifecycle === "SUBMITTING") return { status: "running", stage: "submitting" };
    if (state.lifecycle === "SUBMISSION_UNCERTAIN") return { status: "failed", stage: "submission_unknown" };
    if (state.lifecycle === "ACCEPTED") return { status: "running", stage: "submitted", progress: 10 };
    if (state.lifecycle === "RUNNING") return { status: "running", stage: "generating" };
    if (state.terminalOutcome === "SUCCEEDED") return { status: "succeeded", stage: "succeeded", progress: 100 };
    return { status: "failed", stage: "failed" };
}

function isPublicTerminal(state: RuntimeRecord["state"]) {
    return state === "succeeded" || state === "failed" || state === "cancelled" || state === "unknown" || state === "deleted";
}

function reservesOfficialSlot(record: RuntimeRecord) {
    return record.state === "pending" || record.state === "unknown" || record.state === "accepted";
}

function liveQueueLease(record: RuntimeRecord, now: Date) {
    return record.state === "queued"
        && typeof record.queueOwnerId === "string"
        && typeof record.queueExpiresAt === "string"
        && Date.parse(record.queueExpiresAt) > now.getTime();
}

function clearQueueLease(record: RuntimeRecord) {
    delete record.queueOwnerId;
    delete record.queueExpiresAt;
}

function liveReservation(record: RuntimeRecord, now: Date) {
    return record.state === "pending"
        && typeof record.reservationId === "string"
        && typeof record.reservationOwnerId === "string"
        && (record.submissionPhase === "reserved" || record.submissionPhase === "spawn_permitted")
        && typeof record.reservationExpiresAt === "string"
        && Date.parse(record.reservationExpiresAt) > now.getTime();
}

function matchesReservation(
    record: RuntimeRecord | undefined,
    requestHash: string,
    reservation: SubmissionReservation,
): record is RuntimeRecord & {
    state: "pending";
    reservationId: string;
    reservationOwnerId: string;
} {
    return Boolean(record
        && record.requestHash === requestHash
        && record.state === "pending"
        && record.reservationId === reservation.reservationId
        && record.reservationOwnerId === reservation.reservationOwnerId);
}

function clearReservation(record: RuntimeRecord) {
    delete record.reservationId;
    delete record.reservationOwnerId;
    delete record.reservationExpiresAt;
    delete record.submissionPhase;
}

function validateIdempotencyKey(value: string) {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw generationRequestInvalid();
}

function taskNotFound() {
    return new DreaminaCliError("dreamina_task_not_found", "Dreamina generation task was not found", 404);
}

function taskFailed(code?: string) {
    return new DreaminaCliError(code ?? "dreamina_generation_failed", "Dreamina generation did not complete", 502);
}

function errorCode(error: unknown) {
    if (error instanceof DreaminaCliError || error instanceof LocalDreaminaGenerationError) return error.code;
    return "dreamina_generation_failed";
}

function isDurableJournalCommitError(error: unknown) {
    return error instanceof DreaminaCliError && [
        "dreamina_cli_fenced",
        "dreamina_state_fenced",
        "dreamina_state_busy",
        "dreamina_state_invalid",
    ].includes(error.code);
}

function queryState(value: DreaminaRuntimeResult): "pending" | "completed" | "incomplete" {
    if (value.state !== "query" || !value.result || typeof value.result !== "object" || Array.isArray(value.result)) return "pending";
    const result = value.result as Record<string, unknown>;
    const state = String(result.status ?? result.state ?? result.genStatus ?? result.code ?? "").toLowerCase();
    if (/(?:fail|error|reject|cancel|blocked|denied)/.test(state)) return "incomplete";
    if (/(?:success|complete|finished|done)/.test(state) || result.completed === true) return "completed";
    return "pending";
}

function queryOfficialStatus(value: DreaminaRuntimeResult): NonNullable<RuntimeRecord["officialStatus"]> {
    if (value.state !== "query" || !value.result || typeof value.result !== "object" || Array.isArray(value.result)) throw queryResponseInvalid();
    const result = value.result as Record<string, unknown>;
    const status = result.genStatus ?? result.status ?? result.state ?? result.code;
    if (status === "pending" || status === "processing" || status === "completed" || status === "failed" || status === "cancelled") return status;
    throw queryResponseInvalid();
}

function exactGenerationDirectory(root: string, value: string) {
    if (!path.isAbsolute(value) || value.includes("\0")) throw unknownGenerationResult();
    const resolved = path.resolve(value);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw unknownGenerationResult();
    return resolved;
}

function boundedInteger(value: number | undefined, min: number, max: number, fallback: number) {
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fallback;
}

function generationRequestInvalid() {
    return new LocalDreaminaGenerationError("local_generation_request_invalid", "本机生成请求无效", 400);
}

function trustedRequestFingerprint(value: string | undefined) {
    if (value === undefined) return undefined;
    if (!/^[a-f0-9]{64}$/.test(value)) throw new DreaminaCliError("dreamina_request_invalid", "Dreamina 请求指纹无效", 400);
    return value;
}

export function generationArguments(input: DreaminaGenerationInput) {
    const args: string[] = [input.operation];
    if ("prompt" in input && input.prompt) args.push(`--prompt=${input.prompt}`);
    if ("modelVersion" in input && input.modelVersion) args.push(`--model_version=${input.modelVersion}`);
    if ("ratio" in input && input.ratio) args.push(`--ratio=${input.ratio}`);
    if ("resolutionType" in input) args.push(`--resolution_type=${input.resolutionType}`);
    if ("videoResolution" in input) args.push(`--video_resolution=${input.videoResolution}`);
    if ("duration" in input && input.duration !== undefined) args.push(`--duration=${input.duration}`);
    if ("generateNum" in input && input.generateNum !== undefined) args.push(`--generate_num=${input.generateNum}`);
    if (input.operation === "image2image") args.push(`--images=${input.referenceImages.join(",")}`);
    if (input.operation === "image_upscale" || input.operation === "image2video") args.push(`--image=${input.referenceImages[0]}`);
    if (input.operation === "frames2video") {
        args.push(`--first=${input.referenceImages[0]}`, `--last=${input.referenceImages[1]}`);
    }
    if (input.operation === "multiframe2video") {
        args.push(`--images=${input.referenceImages.join(",")}`);
        for (const value of input.transitionPrompts ?? []) args.push(`--transition-prompt=${value}`);
        for (const value of input.transitionDurations ?? []) args.push(`--transition-duration=${value}`);
    }
    if (input.operation === "multimodal2video") {
        for (const value of input.referenceImages ?? []) args.push(`--image=${value}`);
        for (const value of input.referenceVideos ?? []) args.push(`--video=${value}`);
        for (const value of input.referenceAudios ?? []) args.push(`--audio=${value}`);
    }
    return args;
}

function hashRequest(input: DreaminaGenerationInput) {
    const entries = Object.entries(input)
        .filter(([key]) => key !== "idempotencyKey")
        .sort(([left], [right]) => left.localeCompare(right));
    return crypto.createHash("sha256").update(JSON.stringify(Object.fromEntries(entries))).digest("hex");
}

function extractSubmitId(stdout: string) {
    try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const value = parsed.submit_id ?? parsed.submitId;
        return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value) ? value : "";
    } catch {
        return "";
    }
}

function submittedReceipt(result: DreaminaProcessResult): { ok: true; submitId: string } | { ok: false; code: string } {
    if (result.exitCode !== 0) return { ok: false, code: "dreamina_submit_exit_nonzero" };
    const submitId = extractSubmitId(result.stdout);
    return submitId ? { ok: true, submitId } : { ok: false, code: "dreamina_submit_receipt_missing" };
}

function isSubmitReceiptOutput(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    if (Object.keys(source).some((key) => key !== "submit_id" && key !== "submitId")) return false;
    const submitId = source.submit_id ?? source.submitId;
    return typeof submitId === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(submitId);
}

function safeJsonResult(stdout: string): unknown {
    let parsed: unknown;
    try { parsed = JSON.parse(stdout); } catch { throw queryResponseInvalid(); }
    return safeQueryResult(parsed);
}

function safeQueryResult(parsed: unknown): unknown {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw queryResponseInvalid();
    const source = parsed as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const submitId = safeQueryId(source.submit_id ?? source.submitId);
    const status = safeQueryEnum(source.status, QUERY_STATUS_MAP);
    const state = safeQueryEnum(source.state, QUERY_STATUS_MAP);
    const genStatus = safeQueryEnum(source.gen_status, QUERY_STATUS_MAP);
    const code = safeQueryEnum(source.code, QUERY_CODE_MAP);
    const progress = typeof source.progress === "number"
        && Number.isFinite(source.progress)
        && source.progress >= 0
        && source.progress <= 100
        ? source.progress
        : undefined;
    const completed = typeof source.completed === "boolean"
        ? source.completed
        : typeof source.success === "boolean" ? source.success : undefined;
    const message = typeof source.message === "string" ? sanitizeDreaminaDiagnostic(source.message) : undefined;
    if (submitId) result.submitId = submitId;
    if (status) result.status = status;
    if (state) result.state = state;
    if (genStatus) result.genStatus = genStatus;
    if (code) result.code = code;
    if (progress !== undefined) result.progress = progress;
    if (completed !== undefined) result.completed = completed;
    if (message) result.message = message;
    if (!Object.keys(result).length) throw queryResponseInvalid();
    return result;
}

function isCompleteQueryOutput(value: unknown) {
    try {
        const result = safeQueryResult(value) as Record<string, unknown>;
        return ["status", "state", "genStatus", "code", "completed"].some((key) => key in result);
    } catch {
        return false;
    }
}

function safeQueryId(value: unknown) {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value) ? value : undefined;
}

const QUERY_STATUS_MAP = new Map([
    ["pending", "pending"], ["processing", "processing"], ["querying", "processing"], ["running", "processing"],
    ["completed", "completed"], ["success", "completed"], ["succeeded", "completed"],
    ["fail", "failed"], ["failed", "failed"], ["error", "failed"], ["cancelled", "cancelled"], ["canceled", "cancelled"],
]);
const QUERY_CODE_MAP = new Map([
    ["0", "success"], ["ok", "success"], ["success", "success"], ["pending", "pending"],
    ["processing", "processing"], ["failed", "failed"], ["cancelled", "cancelled"], ["canceled", "cancelled"],
]);

function safeQueryEnum(value: unknown, values: ReadonlyMap<string, string>) {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw queryResponseInvalid();
    const result = values.get(value.toLowerCase());
    if (!result) throw queryResponseInvalid();
    return result;
}

function queryResponseInvalid() { return new DreaminaCliError("dreamina_query_response_invalid", "Dreamina 查询响应无法识别", 502); }
function idempotencyConflict() { return new DreaminaCliError("dreamina_idempotency_conflict", "同一幂等键不能用于不同 Dreamina 请求", 409); }
function submissionUnknown() { return new DreaminaCliError("dreamina_submission_unknown", "Dreamina 提交结果不确定，已禁止自动重试；请按 receipt 查询或人工确认", 409); }
function generationCapacityFull() { return new DreaminaCliError("dreamina_generation_capacity_full", "Dreamina 官方生成名额已满", 409); }
function submitFailure(code: string) { return new DreaminaCliError(code, "Dreamina 提交未完成，已禁止自动重试", code === "dreamina_submit_spawn_failed" ? 503 : 409); }
function submitFailureCode(error: unknown, spawned: boolean) {
    if (!spawned && error instanceof DreaminaCliError && error.code === "dreamina_spawn_failed") return "dreamina_submit_spawn_failed";
    if (error instanceof DreaminaCliError && error.code === "dreamina_command_timeout") return "dreamina_submit_timeout";
    if (error instanceof DreaminaCliError && error.code === "dreamina_submit_exit_nonzero") return error.code;
    if (error instanceof DreaminaCliError && error.code === "dreamina_submit_receipt_missing") return error.code;
    return "dreamina_submission_unknown";
}
function cliFenced() { return new DreaminaCliError("dreamina_cli_fenced", "Dreamina CLI invocation lease 已失效", 409); }
function reconciliationRetryCode(error: unknown) {
    if (isAccountSessionError(error)) return "dreamina_account_session_changed";
    if (error instanceof DreaminaCliError && /^[a-z][a-z0-9_]{2,80}$/.test(error.code)) return error.code;
    if (error instanceof LocalDreaminaGenerationError && /^[a-z][a-z0-9_]{2,80}$/.test(error.code)) {
        return error.code === "local_generation_result_invalid" ? "dreamina_query_materialization_retry" : error.code;
    }
    return "dreamina_query_materialization_retry";
}

function accountChanged() { return new DreaminaCliError("dreamina_account_session_changed", "Dreamina 账号会话已变化", 409); }
function isAccountSessionError(error: unknown) {
    return error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed";
}
function cancelled() { return new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499); }
function throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }

function combineAbortSignals(...signals: Array<AbortSignal | undefined>) {
    const present = signals.filter((signal): signal is AbortSignal => Boolean(signal));
    if (present.length === 1) return { signal: present[0], dispose: () => undefined };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    for (const signal of present) signal.addEventListener("abort", onAbort, { once: true });
    if (present.some((signal) => signal.aborted)) controller.abort();
    return {
        signal: controller.signal,
        dispose: () => {
            for (const signal of present) signal.removeEventListener("abort", onAbort);
        },
    };
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    throwIfCancelled(signal);
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(cancelled()); };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
            (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
        );
        if (signal.aborted) onAbort();
    });
}

function subscribeToSubmission(submission: InFlightSubmission, signal?: AbortSignal) {
    throwIfCancelled(signal);
    submission.waiters += 1;
    return new Promise<DreaminaRuntimeResult>((resolve, reject) => {
        let finished = false;
        const finish = () => {
            if (finished) return false;
            finished = true;
            signal?.removeEventListener("abort", onAbort);
            submission.waiters -= 1;
            if (submission.waiters === 0 && !submission.settled) submission.controller.abort();
            return true;
        };
        const onAbort = () => {
            if (finish()) reject(cancelled());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        submission.promise.then(
            (value) => { if (finish()) resolve(value); },
            (error) => { if (finish()) reject(error); },
        );
        if (signal?.aborted) onAbort();
    });
}
