import crypto from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { acquireStateLock, stateInvalid, type StateLockLease } from "./dreamina-cli-state.js";
import {
    reduceDreaminaTask,
    type DreaminaProviderObservation,
    type DreaminaTaskContext,
    type DreaminaTaskEvent,
    type DreaminaTaskLifecycle,
    type DreaminaTaskOutput,
    type DreaminaTaskResultState,
    type DreaminaTaskState,
    type DreaminaTaskSyncState,
    type DreaminaTerminalOutcome,
} from "./dreamina-task-contract.js";

export type DreaminaStoredTask = {
    taskId: string;
    visibility?: "visible" | "hidden" | "deleted";
    clientOperationId: string;
    provider: "dreamina-cli";
    lifecycle: DreaminaTaskLifecycle;
    terminalOutcome?: DreaminaTerminalOutcome;
    syncState: DreaminaTaskSyncState;
    resultState: DreaminaTaskResultState;
    requestHash: string;
    version: number;
    outputs: DreaminaTaskOutput[];
    context: DreaminaTaskContext;
    accountBinding?: string;
    officialStatus?: DreaminaProviderObservation["status"];
    lastSyncErrorCode?: string;
    mode?: "image" | "video";
    operation?: string;
    model?: string;
    createdAt?: string;
    updatedAt: string;
    journalRecordId: string;
    projectedJournalVersion: number;
};

export type DreaminaTaskOutboxEffect = {
    effectKey: string;
    kind: "task.projected" | "task.mutated" | "product.effect";
    taskId: string;
    journalVersion?: number;
    taskVersion: number;
    createdAt: string;
};

export type DreaminaTaskEffectResult = {
    materializedAssetId?: string;
};

export type DreaminaTaskInboxRecord = {
    consumerId: string;
    taskId: string;
    effectKey: string;
    state: "pending" | "completed" | "released";
    fence: number;
    leaseToken?: string;
    leaseExpiresAt?: string;
    completedAt?: string;
    releasedAt?: string;
    result?: DreaminaTaskEffectResult;
};

type TaskStoreCapacity = {
    maxTasks: number;
    maxEffects: number;
};

type TaskStoreDiskState = {
    version: 1;
    revision: number;
    tasks: DreaminaStoredTask[];
    outbox: DreaminaTaskOutboxEffect[];
    inbox: DreaminaTaskInboxRecord[];
};

type EffectInput = Pick<DreaminaTaskOutboxEffect, "effectKey" | "kind" | "taskId" | "journalVersion">;
type DreaminaProductTaskEvent = Exclude<DreaminaTaskEvent, { type: "provider_observation" } | { type: "transition" }>;
export type DreaminaProductTaskMutation =
    | { type: "event"; event: DreaminaProductTaskEvent; updatedAt: string }
    | { type: "materialization"; resultState: DreaminaTaskResultState; outputs: DreaminaTaskOutput[]; updatedAt: string };

const BACKUP_SUFFIX = ".replace-backup";
const REPLACE_DENIED_CODES = new Set(["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"]);
const TEMP_UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const MAX_TASKS = 10_000;
const MAX_EFFECTS = 50_000;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class DreaminaTaskStoreConflictError extends Error {
    constructor() {
        super("Dreamina task version changed");
        this.name = "DreaminaTaskStoreConflictError";
    }
}

export class DreaminaTaskStore {
    private readonly stateFile: string;
    private readonly now: () => Date;
    private readonly capacity: TaskStoreCapacity;

    constructor(options: { stateFile: string; now?: () => Date; maxTasks?: number; maxEffects?: number }) {
        this.stateFile = path.resolve(options.stateFile);
        this.now = options.now ?? (() => new Date());
        this.capacity = {
            maxTasks: options.maxTasks ?? MAX_TASKS,
            maxEffects: options.maxEffects ?? MAX_EFFECTS,
        };
        if (!Number.isSafeInteger(this.capacity.maxTasks) || this.capacity.maxTasks < 1 || this.capacity.maxTasks > MAX_TASKS
            || !Number.isSafeInteger(this.capacity.maxEffects) || this.capacity.maxEffects < 1 || this.capacity.maxEffects > MAX_EFFECTS) {
            throw stateInvalid();
        }
    }

    async getTask(taskId: string): Promise<DreaminaStoredTask | undefined> {
        validateTaskId(taskId);
        return this.withDisk(async (disk) => cloneTask(disk.tasks.find((task) => task.taskId === taskId)));
    }

    async listTasks(): Promise<DreaminaStoredTask[]> {
        return this.withDisk(async (disk) => disk.tasks
            .filter((task) => task.visibility === undefined || task.visibility === "visible")
            .slice()
            .sort((left, right) => left.taskId.localeCompare(right.taskId))
            .map((task) => cloneTask(task)!));
    }

    async listOutbox(): Promise<DreaminaTaskOutboxEffect[]> {
        return this.withDisk(async (disk) => disk.outbox.map((effect) => ({ ...effect })));
    }

    async listInbox(): Promise<Array<Pick<DreaminaTaskInboxRecord, "consumerId" | "taskId" | "effectKey" | "state">>> {
        return this.withDisk(async (disk) => disk.inbox.map(({ consumerId, taskId, effectKey, state }) => ({ consumerId, taskId, effectKey, state })));
    }

    async compareAndSwapTask(input: {
        taskId: string;
        expectedVersion: number;
        task: Record<string, unknown>;
        effect: EffectInput;
    }): Promise<DreaminaStoredTask> {
        validateTaskId(input.taskId);
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.effect.kind !== "task.projected") throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const index = disk.tasks.findIndex((task) => task.taskId === input.taskId);
            const current = index < 0 ? undefined : disk.tasks[index]!;
            const currentVersion = current?.version ?? 0;
            if (currentVersion !== input.expectedVersion) throw new DreaminaTaskStoreConflictError();
            const nextVersion = currentVersion + 1;
            const task = normalizeTask(input.taskId, input.task, nextVersion);
            assertProjectionMutation(current, task);
            const effect = normalizeEffect(input.effect, task, this.now().toISOString());
            if (disk.outbox.some((candidate) => candidate.effectKey === effect.effectKey)) throw stateInvalid();
            if (index < 0) disk.tasks.push(task);
            else disk.tasks[index] = task;
            disk.outbox.push(effect);
            await this.persist(disk, lease);
            return cloneTask(task)!;
        });
    }

    async mutateTask(input: {
        taskId: string;
        expectedVersion: number;
        mutation: unknown;
        effectKey: string;
    }): Promise<DreaminaStoredTask> {
        validateTaskId(input.taskId);
        validateEffectKey(input.effectKey);
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const index = disk.tasks.findIndex((task) => task.taskId === input.taskId);
            if (index < 0) throw new DreaminaTaskStoreConflictError();
            const current = disk.tasks[index]!;
            if (current.version !== input.expectedVersion) throw new DreaminaTaskStoreConflictError();
            const next = applyProductMutation(current, parseProductMutation(input.mutation));
            const task = normalizeTask(input.taskId, next, current.version + 1);
            const effect = normalizeEffect({
                effectKey: input.effectKey,
                kind: "task.mutated",
                taskId: input.taskId,
            }, task, this.now().toISOString());
            if (disk.outbox.some((candidate) => candidate.effectKey === effect.effectKey)) throw stateInvalid();
            disk.tasks[index] = task;
            disk.outbox.push(effect);
            await this.persist(disk, lease);
            return cloneTask(task)!;
        });
    }

    async claimOutboxEffect(
        consumerId: string,
        effectKey: string,
        leaseMs = 30_000,
    ): Promise<{ leaseToken: string; leaseExpiresAt: string } | undefined> {
        validateOpaqueId(consumerId, 1, 120);
        validateEffectKey(effectKey);
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 3_600_000) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const effect = disk.outbox.find((candidate) => candidate.effectKey === effectKey);
            if (!effect) return undefined;
            const now = this.now();
            const item = disk.inbox.find((candidate) => candidate.consumerId === consumerId && candidate.effectKey === effectKey);
            if (item && item.taskId !== effect.taskId) throw stateInvalid();
            if (item?.state === "completed") return undefined;
            if (item?.state === "pending" && Date.parse(item.leaseExpiresAt!) > now.getTime()) return undefined;
            const leaseToken = crypto.randomUUID();
            const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
            const fence = (item?.fence ?? 0) + 1;
            if (item) {
                Object.assign(item, { state: "pending" as const, fence, leaseToken, leaseExpiresAt });
                delete item.completedAt;
                delete item.releasedAt;
            } else {
                disk.inbox.push({ consumerId, taskId: effect.taskId, effectKey, state: "pending", fence, leaseToken, leaseExpiresAt });
            }
            await this.persist(disk, lease);
            return { leaseToken, leaseExpiresAt };
        });
    }

    async claimProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseMs?: number;
    }): Promise<
        | { status: "claimed"; leaseToken: string; leaseExpiresAt: string; fence: number }
        | { status: "busy"; retryAt: string }
        | { status: "completed"; result: DreaminaTaskEffectResult }
    > {
        validateOpaqueId(input.consumerId, 1, 120);
        validateTaskId(input.taskId);
        validateEffectKey(input.effectKey);
        const leaseMs = input.leaseMs ?? 30_000;
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 3_600_000) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const task = disk.tasks.find((candidate) => candidate.taskId === input.taskId);
            if (!task || task.visibility === "deleted") throw stateInvalid();
            const now = this.now();
            const item = disk.inbox.find((candidate) => candidate.consumerId === input.consumerId && candidate.effectKey === input.effectKey);
            if (item && item.taskId !== input.taskId) throw stateInvalid();
            if (item?.state === "completed") {
                return { status: "completed", result: { ...item.result } };
            }
            if (item?.state === "pending" && Date.parse(item.leaseExpiresAt!) > now.getTime()) {
                return { status: "busy", retryAt: item.leaseExpiresAt! };
            }
            let effect = disk.outbox.find((candidate) => candidate.effectKey === input.effectKey);
            if (effect && (effect.kind !== "product.effect" || effect.taskId !== input.taskId)) throw stateInvalid();
            if (!effect) {
                effect = {
                    effectKey: input.effectKey,
                    kind: "product.effect",
                    taskId: input.taskId,
                    taskVersion: task.version,
                    createdAt: now.toISOString(),
                };
                disk.outbox.push(effect);
            }
            const leaseToken = crypto.randomUUID();
            const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
            const fence = (item?.fence ?? 0) + 1;
            if (item) {
                Object.assign(item, { state: "pending" as const, fence, leaseToken, leaseExpiresAt });
                delete item.completedAt;
                delete item.releasedAt;
                delete item.result;
            } else {
                disk.inbox.push({
                    consumerId: input.consumerId,
                    taskId: input.taskId,
                    effectKey: input.effectKey,
                    state: "pending",
                    fence,
                    leaseToken,
                    leaseExpiresAt,
                });
            }
            await this.persist(disk, lease);
            return { status: "claimed", leaseToken, leaseExpiresAt, fence };
        });
    }

    async renewProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
        leaseMs?: number;
    }): Promise<{ leaseExpiresAt: string; fence: number } | undefined> {
        validateOpaqueId(input.consumerId, 1, 120);
        validateTaskId(input.taskId);
        validateEffectKey(input.effectKey);
        if (!UUID_PATTERN.test(input.leaseToken) || !Number.isSafeInteger(input.fence) || input.fence < 1) throw stateInvalid();
        const leaseMs = input.leaseMs ?? 30_000;
        if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 3_600_000) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const item = disk.inbox.find((candidate) => candidate.consumerId === input.consumerId
                && candidate.taskId === input.taskId && candidate.effectKey === input.effectKey);
            const now = this.now();
            if (!item || item.state !== "pending" || item.leaseToken !== input.leaseToken
                || item.fence !== input.fence || Date.parse(item.leaseExpiresAt!) <= now.getTime()) return undefined;
            item.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
            await this.persist(disk, lease);
            return { leaseExpiresAt: item.leaseExpiresAt, fence: item.fence };
        });
    }

    async completeProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
        result: DreaminaTaskEffectResult;
    }): Promise<boolean> {
        if (!validEffectResult(input.result)) throw stateInvalid();
        return this.finishProductEffect(input, false);
    }

    async releaseProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
    }): Promise<boolean> {
        return this.finishProductEffect({ ...input, result: {} }, true);
    }

    private async finishProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
        result: DreaminaTaskEffectResult;
    }, release: boolean): Promise<boolean> {
        validateOpaqueId(input.consumerId, 1, 120);
        validateTaskId(input.taskId);
        validateEffectKey(input.effectKey);
        if (!UUID_PATTERN.test(input.leaseToken) || !Number.isSafeInteger(input.fence) || input.fence < 1) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const itemIndex = disk.inbox.findIndex((candidate) => candidate.consumerId === input.consumerId
                && candidate.taskId === input.taskId && candidate.effectKey === input.effectKey);
            const item = itemIndex < 0 ? undefined : disk.inbox[itemIndex];
            if (!item || item.state !== "pending" || item.leaseToken !== input.leaseToken || item.fence !== input.fence) return false;
            const now = this.now();
            if (Date.parse(item.leaseExpiresAt!) <= now.getTime()) return false;
            if (release) {
                item.state = "released";
                item.releasedAt = now.toISOString();
                delete item.leaseToken;
                delete item.leaseExpiresAt;
                delete item.completedAt;
                delete item.result;
            } else {
                item.state = "completed";
                item.completedAt = now.toISOString();
                item.result = { ...input.result };
                delete item.leaseToken;
                delete item.leaseExpiresAt;
                delete item.releasedAt;
            }
            await this.persist(disk, lease);
            return true;
        });
    }

    async completeOutboxEffect(consumerId: string, effectKey: string, leaseToken: string): Promise<boolean> {
        validateOpaqueId(consumerId, 1, 120);
        validateEffectKey(effectKey);
        if (!UUID_PATTERN.test(leaseToken)) throw stateInvalid();
        return this.withExclusiveDisk(async (disk, lease) => {
            const item = disk.inbox.find((candidate) => candidate.consumerId === consumerId && candidate.effectKey === effectKey);
            if (!item || item.state !== "pending" || item.leaseToken !== leaseToken) return false;
            const now = this.now();
            if (Date.parse(item.leaseExpiresAt!) <= now.getTime()) return false;
            item.state = "completed";
            item.completedAt = now.toISOString();
            delete item.leaseToken;
            delete item.leaseExpiresAt;
            await this.persist(disk, lease);
            return true;
        });
    }

    private async withDisk<T>(action: (disk: TaskStoreDiskState) => Promise<T>): Promise<T> {
        const release = await acquireStateLock(this.stateFile);
        try {
            await recoverStoreReplacement(this.stateFile, release, this.capacity);
            return await action(await readStoreDisk(this.stateFile, this.capacity) ?? emptyDisk());
        } finally {
            await release();
        }
    }

    private async withExclusiveDisk<T>(action: (disk: TaskStoreDiskState, lease: StateLockLease) => Promise<T>): Promise<T> {
        const release = await acquireStateLock(this.stateFile);
        try {
            await recoverStoreReplacement(this.stateFile, release, this.capacity);
            return await action(await readStoreDisk(this.stateFile, this.capacity) ?? emptyDisk(), release);
        } finally {
            await release();
        }
    }

    private async persist(disk: TaskStoreDiskState, lease: StateLockLease) {
        compactStoreDisk(disk, this.capacity);
        disk.revision += 1;
        disk.tasks.sort((left, right) => left.taskId.localeCompare(right.taskId));
        disk.inbox.sort((left, right) => `${left.consumerId}\0${left.effectKey}`.localeCompare(`${right.consumerId}\0${right.effectKey}`));
        await persistStoreDisk(this.stateFile, disk, lease);
    }
}

function emptyDisk(): TaskStoreDiskState {
    return { version: 1, revision: 0, tasks: [], outbox: [], inbox: [] };
}

async function readStoreDisk(stateFile: string, capacity: TaskStoreCapacity = { maxTasks: MAX_TASKS, maxEffects: MAX_EFFECTS }): Promise<TaskStoreDiskState | undefined> {
    let value: unknown;
    try {
        value = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw stateInvalid();
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw stateInvalid();
    if (Object.keys(value).some((key) => !["version", "revision", "tasks", "outbox", "inbox"].includes(key))) throw stateInvalid();
    const disk = value as Partial<TaskStoreDiskState>;
    if (disk.version !== 1 || !Number.isSafeInteger(disk.revision) || (disk.revision ?? -1) < 0
        || !Array.isArray(disk.tasks) || disk.tasks.length > capacity.maxTasks
        || !Array.isArray(disk.outbox) || disk.outbox.length > capacity.maxEffects
        || !Array.isArray(disk.inbox) || disk.inbox.length > capacity.maxEffects) throw stateInvalid();
    const taskIds = new Set<string>();
    for (const task of disk.tasks) {
        if (!validStoredTask(task) || taskIds.has(task.taskId)) throw stateInvalid();
        taskIds.add(task.taskId);
    }
    const effectKeys = new Set<string>();
    for (const effect of disk.outbox) {
        if (!validEffect(effect) || effectKeys.has(effect.effectKey) || !taskIds.has(effect.taskId)) throw stateInvalid();
        effectKeys.add(effect.effectKey);
    }
    const inboxKeys = new Set<string>();
    for (const item of disk.inbox) {
        const effect = disk.outbox.find((candidate) => candidate.effectKey === item.effectKey);
        if (!validInbox(item)
            || (effect ? effect.taskId !== item.taskId : !isProductEffectKey(item.effectKey))
            || !taskIds.has(item.taskId)) throw stateInvalid();
        const key = `${item.consumerId}\0${item.effectKey}`;
        if (inboxKeys.has(key)) throw stateInvalid();
        inboxKeys.add(key);
    }
    return disk as TaskStoreDiskState;
}

function normalizeTask(taskId: string, input: Record<string, unknown>, version: number): DreaminaStoredTask {
    const candidate = { ...input, taskId, version } as unknown;
    if (!validStoredTask(candidate)) throw stateInvalid();
    return cloneTask(candidate)!;
}

function assertProjectionMutation(current: DreaminaStoredTask | undefined, next: DreaminaStoredTask) {
    if (!current) return;
    if (next.clientOperationId !== current.clientOperationId
        || next.provider !== current.provider
        || next.requestHash !== current.requestHash
        || next.journalRecordId !== current.journalRecordId
        || next.projectedJournalVersion <= current.projectedJournalVersion
        || visibilityResurrected(current.visibility, next.visibility)
        || (current.accountBinding !== undefined && next.accountBinding !== current.accountBinding)
        || !isDeepStrictEqual(next.context, current.context)
        || !projectionOutputsAllowed(current, next)
        || (current.resultState !== "NOT_AVAILABLE"
            && !(current.resultState === "PENDING_MATERIALIZATION" && next.resultState === "PENDING_MATERIALIZATION")
            && next.resultState !== current.resultState)) throw stateInvalid();
}

function projectionOutputsAllowed(current: DreaminaStoredTask, next: DreaminaStoredTask) {
    if (isDeepStrictEqual(next.outputs, current.outputs)) return true;
    return current.outputs.length === 0
        && (current.resultState === "NOT_AVAILABLE" || current.resultState === "PENDING_MATERIALIZATION")
        && next.resultState === "PENDING_MATERIALIZATION"
        && next.outputs.length > 0
        && next.outputs.every((output) => Boolean(output.providerArtifactRef)
            && output.materializedAssetId === undefined
            && output.materializationErrorCode === undefined);
}

function parseProductMutation(value: unknown): DreaminaProductTaskMutation {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw stateInvalid();
    const mutation = value as Record<string, unknown>;
    if (mutation.type === "event") {
        if (Object.keys(mutation).some((key) => !["type", "event", "updatedAt"].includes(key))
            || typeof mutation.updatedAt !== "string" || !Number.isFinite(Date.parse(mutation.updatedAt))) throw stateInvalid();
        if (!mutation.event || typeof mutation.event !== "object" || Array.isArray(mutation.event)) throw stateInvalid();
        const event = mutation.event as Record<string, unknown>;
        if (event.type === "provider_observation") throw stateInvalid();
        if (event.type === "bind_context" && event.accountBinding !== undefined) throw stateInvalid();
        if (!["sync_error", "sync_recovered", "bind_context"].includes(String(event.type))) throw stateInvalid();
        return mutation as unknown as DreaminaProductTaskMutation;
    }
    if (mutation.type === "materialization") {
        if (Object.keys(mutation).some((key) => !["type", "resultState", "outputs", "updatedAt"].includes(key))
            || !RESULT_STATES.has(String(mutation.resultState)) || !Array.isArray(mutation.outputs)
            || typeof mutation.updatedAt !== "string" || !Number.isFinite(Date.parse(mutation.updatedAt))) throw stateInvalid();
        return mutation as unknown as DreaminaProductTaskMutation;
    }
    throw stateInvalid();
}

function applyProductMutation(current: DreaminaStoredTask, mutation: DreaminaProductTaskMutation): Omit<DreaminaStoredTask, "version"> {
    if (Date.parse(mutation.updatedAt) < Date.parse(current.updatedAt)) throw stateInvalid();
    if (mutation.type === "materialization") {
        if (current.lifecycle !== "TERMINAL" || current.terminalOutcome !== "SUCCEEDED"
            || !RESULT_TRANSITIONS[current.resultState].includes(mutation.resultState)) throw stateInvalid();
        return {
            ...current,
            resultState: mutation.resultState,
            outputs: mutation.outputs,
            updatedAt: mutation.updatedAt,
        };
    }
    if (mutation.event.type === "bind_context" && current.context.scope === "legacy_unscoped") throw stateInvalid();
    const state = reduceDreaminaTask(storedTaskState(current), mutation.event);
    return {
        ...current,
        lifecycle: state.lifecycle,
        ...(state.terminalOutcome ? { terminalOutcome: state.terminalOutcome } : { terminalOutcome: undefined }),
        syncState: state.syncState,
        resultState: state.resultState,
        outputs: state.outputs,
        context: state.context,
        ...(state.lastSyncErrorCode ? { lastSyncErrorCode: state.lastSyncErrorCode } : { lastSyncErrorCode: undefined }),
        updatedAt: mutation.updatedAt,
    };
}

function storedTaskState(task: DreaminaStoredTask): DreaminaTaskState {
    return {
        lifecycle: task.lifecycle,
        ...(task.terminalOutcome ? { terminalOutcome: task.terminalOutcome } : {}),
        syncState: task.syncState,
        resultState: task.resultState,
        outputs: task.outputs,
        ...(task.accountBinding ? { accountBinding: task.accountBinding } : {}),
        context: task.context,
        ...(task.lastSyncErrorCode ? { lastSyncErrorCode: task.lastSyncErrorCode } : {}),
    };
}

function normalizeEffect(input: EffectInput, task: DreaminaStoredTask, createdAt: string): DreaminaTaskOutboxEffect {
    const effect: DreaminaTaskOutboxEffect = {
        ...input,
        taskVersion: task.version,
        createdAt,
    };
    if (effect.taskId !== task.taskId || !validEffect(effect)
        || (effect.kind === "task.projected" && effect.journalVersion !== task.projectedJournalVersion)) throw stateInvalid();
    return effect;
}

function validStoredTask(value: unknown): value is DreaminaStoredTask {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const task = value as Partial<DreaminaStoredTask>;
    const allowed = [
        "taskId", "visibility", "clientOperationId", "provider", "lifecycle", "terminalOutcome", "syncState", "resultState",
        "requestHash", "version", "outputs", "context", "accountBinding", "officialStatus", "lastSyncErrorCode",
        "mode", "operation", "model", "createdAt", "updatedAt", "journalRecordId", "projectedJournalVersion",
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
    if (!safeTaskId(task.taskId) || (task.visibility !== undefined && task.visibility !== "visible" && task.visibility !== "hidden" && task.visibility !== "deleted")
        || !safeOperationId(task.clientOperationId) || task.provider !== "dreamina-cli"
        || !LIFECYCLES.has(String(task.lifecycle)) || !SYNC_STATES.has(String(task.syncState))
        || !RESULT_STATES.has(String(task.resultState)) || !/^[a-f0-9]{64}$/.test(task.requestHash ?? "")
        || !Number.isSafeInteger(task.version) || (task.version ?? 0) < 1
        || !Number.isSafeInteger(task.projectedJournalVersion) || (task.projectedJournalVersion ?? 0) < 1
        || !safeOperationId(task.journalRecordId)
        || typeof task.updatedAt !== "string" || !Number.isFinite(Date.parse(task.updatedAt))) return false;
    if ((task.lifecycle === "TERMINAL") !== (typeof task.terminalOutcome === "string")) return false;
    if (task.terminalOutcome !== undefined && !OUTCOMES.has(task.terminalOutcome)) return false;
    if (!validContext(task.context) || !Array.isArray(task.outputs) || task.outputs.length > 32 || !task.outputs.every(validOutput)
        || new Set(task.outputs.map((output) => output.outputIndex)).size !== task.outputs.length) return false;
    if (task.accountBinding !== undefined && !safeOpaqueId(task.accountBinding, 8, 160)) return false;
    if (task.officialStatus !== undefined && !OFFICIAL_STATUSES.has(task.officialStatus)) return false;
    if (task.lastSyncErrorCode !== undefined && !/^[a-z][a-z0-9_]{2,80}$/.test(task.lastSyncErrorCode)) return false;
    if (task.mode !== undefined && task.mode !== "image" && task.mode !== "video") return false;
    if (task.operation !== undefined && !safeOpaqueId(task.operation, 1, 120)) return false;
    if (task.model !== undefined && !safeOpaqueId(task.model, 1, 120)) return false;
    if (task.createdAt !== undefined && (typeof task.createdAt !== "string" || !Number.isFinite(Date.parse(task.createdAt)))) return false;
    return true;
}

function validContext(value: unknown): value is DreaminaTaskContext {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    if (context.scope === "legacy_unscoped") return Object.keys(context).length === 1;
    if (context.scope !== "scoped") return false;
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(context).some((key) => !allowed.includes(key))) return false;
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"]) {
        if (context[key] !== undefined && !safeOpaqueId(context[key], 1, 200)) return false;
    }
    if (context.batchIndex !== undefined && (!Number.isSafeInteger(context.batchIndex) || (context.batchIndex as number) < 0)) return false;
    if (context.batchCount !== undefined && (!Number.isSafeInteger(context.batchCount) || (context.batchCount as number) < 1)) return false;
    return true;
}

function validOutput(value: unknown): value is DreaminaTaskOutput {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const output = value as Partial<DreaminaTaskOutput>;
    const allowed = ["outputIndex", "mediaType", "providerArtifactRef", "materializedAssetId", "materializationErrorCode"];
    return !Object.keys(value).some((key) => !allowed.includes(key))
        && Number.isSafeInteger(output.outputIndex) && (output.outputIndex ?? -1) >= 0
        && (output.mediaType === "image" || output.mediaType === "video" || output.mediaType === "audio")
        && (output.providerArtifactRef === undefined || safeOpaqueId(output.providerArtifactRef, 1, 256))
        && (output.materializedAssetId === undefined || safeOpaqueId(output.materializedAssetId, 1, 256))
        && (output.materializationErrorCode === undefined || /^[a-z][a-z0-9_]{2,80}$/.test(output.materializationErrorCode));
}

function validEffect(value: unknown): value is DreaminaTaskOutboxEffect {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const effect = value as Partial<DreaminaTaskOutboxEffect>;
    const journalVersionValid = effect.kind === "task.projected"
        ? Number.isSafeInteger(effect.journalVersion) && (effect.journalVersion ?? 0) >= 1
        : effect.journalVersion === undefined || (Number.isSafeInteger(effect.journalVersion) && effect.journalVersion >= 1);
    return Object.keys(value).every((key) => ["effectKey", "kind", "taskId", "journalVersion", "taskVersion", "createdAt"].includes(key))
        && validEffectKeyValue(effect.effectKey)
        && (effect.kind === "task.projected" || effect.kind === "task.mutated" || effect.kind === "product.effect")
        && safeTaskId(effect.taskId)
        && journalVersionValid
        && Number.isSafeInteger(effect.taskVersion) && (effect.taskVersion ?? 0) >= 1
        && typeof effect.createdAt === "string" && Number.isFinite(Date.parse(effect.createdAt));
}

function isProductEffectKey(effectKey: string) {
    return effectKey.startsWith("materialize:")
        || effectKey.startsWith("attach-node:")
        || effectKey.startsWith("attach-message:")
        || effectKey.startsWith("agent-resume:");
}

function validEffectResult(value: unknown): value is DreaminaTaskEffectResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const result = value as DreaminaTaskEffectResult;
    return Object.keys(value).every((key) => key === "materializedAssetId")
        && (result.materializedAssetId === undefined || safeOpaqueId(result.materializedAssetId, 1, 256));
}

function validInbox(value: unknown): value is DreaminaTaskInboxRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const item = value as Partial<DreaminaTaskInboxRecord>;
    if (!Object.keys(value).every((key) => ["consumerId", "taskId", "effectKey", "state", "fence", "leaseToken", "leaseExpiresAt", "completedAt", "releasedAt", "result"].includes(key))
        || !safeOpaqueId(item.consumerId, 1, 120) || !safeTaskId(item.taskId) || !validEffectKeyValue(item.effectKey)
        || !Number.isSafeInteger(item.fence) || (item.fence ?? 0) < 1
        || (item.state !== "pending" && item.state !== "completed" && item.state !== "released")) return false;
    if (item.state === "pending") {
        return typeof item.leaseToken === "string" && UUID_PATTERN.test(item.leaseToken)
            && typeof item.leaseExpiresAt === "string" && Number.isFinite(Date.parse(item.leaseExpiresAt))
            && item.completedAt === undefined && item.releasedAt === undefined && item.result === undefined;
    }
    if (item.state === "released") {
        return item.leaseToken === undefined && item.leaseExpiresAt === undefined
            && item.completedAt === undefined && item.result === undefined
            && typeof item.releasedAt === "string" && Number.isFinite(Date.parse(item.releasedAt));
    }
    return item.leaseToken === undefined && item.leaseExpiresAt === undefined
        && item.releasedAt === undefined
        && typeof item.completedAt === "string" && Number.isFinite(Date.parse(item.completedAt))
        && (item.result === undefined || validEffectResult(item.result));
}

function compactStoreDisk(disk: TaskStoreDiskState, capacity: TaskStoreCapacity) {
    if (disk.tasks.length > capacity.maxTasks) {
        const deleted = disk.tasks
            .filter((task) => task.visibility === "deleted")
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
        for (const task of deleted) {
            if (disk.tasks.length <= capacity.maxTasks) break;
            if (disk.inbox.some((item) => item.taskId === task.taskId && item.state === "pending")) continue;
            disk.tasks = disk.tasks.filter((candidate) => candidate.taskId !== task.taskId);
            disk.outbox = disk.outbox.filter((effect) => effect.taskId !== task.taskId);
            disk.inbox = disk.inbox.filter((item) => item.taskId !== task.taskId);
        }
    }

    const compactOutbox = () => {
        while (disk.outbox.length > capacity.maxEffects) {
            const candidate = disk.outbox.find((effect) => effect.kind === "product.effect")
                ?? disk.outbox.find((effect) => {
                    const deliveries = disk.inbox.filter((item) => item.effectKey === effect.effectKey);
                    return deliveries.length > 0 && deliveries.every((item) => item.state === "completed");
                });
            if (!candidate) break;
            disk.outbox = disk.outbox.filter((effect) => effect.effectKey !== candidate.effectKey);
            if (candidate.kind !== "product.effect") {
                disk.inbox = disk.inbox.filter((item) => item.effectKey !== candidate.effectKey);
            }
        }
    };

    compactOutbox();
    while (disk.inbox.length > capacity.maxEffects) {
        const candidate = disk.inbox.find((item) => item.state === "released")
            ?? disk.inbox.find((item) => {
                if (item.state !== "completed") return false;
                const effect = disk.outbox.find((entry) => entry.effectKey === item.effectKey);
                const task = disk.tasks.find((entry) => entry.taskId === item.taskId);
                const productEffect = effect?.kind === "product.effect"
                    || (!effect && isProductEffectKey(item.effectKey));
                return !productEffect || task?.visibility === "deleted";
            });
        if (!candidate) break;
        disk.inbox = disk.inbox.filter((item) => item !== candidate);
        disk.outbox = disk.outbox.filter((entry) => entry.effectKey !== candidate.effectKey);
    }
    compactOutbox();

    if (disk.tasks.length > capacity.maxTasks
        || disk.outbox.length > capacity.maxEffects
        || disk.inbox.length > capacity.maxEffects) throw stateInvalid();
}

async function persistStoreDisk(stateFile: string, disk: TaskStoreDiskState, lease: StateLockLease) {
    await lease.assertOwned();
    await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await writeSyncedTemporary(temporary, JSON.stringify(disk));
        await lease.assertOwned();
        await replaceStoreFile(temporary, stateFile, lease);
        await lease.assertOwned();
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function recoverStoreReplacement(stateFile: string, lease: StateLockLease, capacity: TaskStoreCapacity) {
    await lease.assertOwned();
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    const previous = await readStoreDisk(backup, capacity);
    if (previous) {
        const current = await readStoreDisk(stateFile, capacity);
        if (!current) {
            await lease.assertOwned();
            await fs.rename(backup, stateFile);
            await syncParentDirectory(stateFile);
        } else {
            assertStoreProgression(previous, current);
            await lease.assertOwned();
            await fs.rm(backup, { force: true });
            await syncParentDirectory(stateFile);
        }
    }
    await scavengeTemporaries(stateFile, lease);
}

function visibilityResurrected(
    previous: DreaminaStoredTask["visibility"],
    next: DreaminaStoredTask["visibility"],
) {
    if (previous === "deleted") return next !== "deleted";
    return previous === "hidden" && (next === undefined || next === "visible");
}

function assertStoreProgression(previous: TaskStoreDiskState, current: TaskStoreDiskState) {
    if (current.revision < previous.revision) throw stateInvalid();
    if (current.revision === previous.revision) {
        if (!isDeepStrictEqual(current, previous)) throw stateInvalid();
        return;
    }

    const tasks = new Map(current.tasks.map((task) => [task.taskId, task]));
    for (const prior of previous.tasks) {
        const next = tasks.get(prior.taskId);
        if (!next) {
            if (prior.visibility === "deleted") continue;
            throw stateInvalid();
        }
        if (next.clientOperationId !== prior.clientOperationId
            || next.provider !== prior.provider
            || next.requestHash !== prior.requestHash
            || next.journalRecordId !== prior.journalRecordId
            || visibilityResurrected(prior.visibility, next.visibility)
            || next.version < prior.version
            || next.projectedJournalVersion < prior.projectedJournalVersion
            || (prior.accountBinding !== undefined && next.accountBinding !== prior.accountBinding)
            || (next.version === prior.version && !isDeepStrictEqual(next, prior))) throw stateInvalid();
    }

    const previousTasks = new Map(previous.tasks.map((task) => [task.taskId, task]));
    const outbox = new Map(current.outbox.map((effect) => [effect.effectKey, effect]));
    for (const prior of previous.outbox) {
        const next = outbox.get(prior.effectKey);
        if (isDeepStrictEqual(next, prior)) continue;
        const deliveries = previous.inbox.filter((item) => item.effectKey === prior.effectKey);
        const legallyCompacted = !next && (
            prior.kind === "product.effect"
            || previousTasks.get(prior.taskId)?.visibility === "deleted"
            || (deliveries.length > 0 && deliveries.every((item) => item.state === "completed"))
        );
        if (!legallyCompacted) throw stateInvalid();
    }
    const previousOutbox = new Map(previous.outbox.map((effect) => [effect.effectKey, effect]));
    const inbox = new Map(current.inbox.map((item) => [`${item.consumerId}\0${item.effectKey}`, item]));
    for (const prior of previous.inbox) {
        const next = inbox.get(`${prior.consumerId}\0${prior.effectKey}`);
        if (next && inboxProgresses(prior, next)) continue;
        const legallyCompacted = !next && (
            prior.state === "released"
            || previousTasks.get(prior.taskId)?.visibility === "deleted"
            || (prior.state === "completed" && previousOutbox.get(prior.effectKey)?.kind !== "product.effect")
        );
        if (!legallyCompacted) throw stateInvalid();
    }
}

function inboxProgresses(previous: DreaminaTaskInboxRecord, current: DreaminaTaskInboxRecord) {
    if (previous.consumerId !== current.consumerId || previous.taskId !== current.taskId || previous.effectKey !== current.effectKey) return false;
    if (previous.state === "completed") return isDeepStrictEqual(previous, current);
    if (current.state === "completed") return current.fence >= previous.fence;
    if (previous.state === "released") {
        return current.state === "released"
            ? isDeepStrictEqual(previous, current)
            : current.state === "pending" && current.fence > previous.fence;
    }
    if (current.state === "released") return current.fence === previous.fence;
    if (current.fence < previous.fence) return false;
    if (current.fence > previous.fence) return true;
    return current.leaseToken === previous.leaseToken
        && Date.parse(current.leaseExpiresAt!) >= Date.parse(previous.leaseExpiresAt!);
}

async function replaceStoreFile(temporary: string, stateFile: string, lease: StateLockLease) {
    try {
        await fs.rename(temporary, stateFile);
        await syncParentDirectory(stateFile);
        return;
    } catch (error) {
        if (!REPLACE_DENIED_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    await lease.assertOwned();
    if (await regularFile(backup)) throw stateInvalid();
    try {
        await fs.rename(stateFile, backup);
        await syncParentDirectory(stateFile);
        await lease.assertOwned();
        await fs.rename(temporary, stateFile);
        await syncParentDirectory(stateFile);
        await lease.assertOwned();
        await fs.rm(backup, { force: true });
        await syncParentDirectory(stateFile);
    } catch (error) {
        if (!(await regularFile(stateFile)) && await regularFile(backup)) {
            await fs.rename(backup, stateFile).catch(() => undefined);
        }
        throw error;
    }
}

async function writeSyncedTemporary(temporary: string, payload: string) {
    const bytes = Buffer.from(payload, "utf8");
    let handle: FileHandle | undefined;
    try {
        handle = await fs.open(temporary, "wx", 0o600);
        let position = 0;
        while (position < bytes.length) {
            const result = await handle.write(bytes, position, bytes.length - position, position);
            if (result.bytesWritten <= 0) throw stateInvalid();
            position += result.bytesWritten;
        }
        await handle.sync();
        if ((await handle.stat()).size !== bytes.length) throw stateInvalid();
    } finally {
        await handle?.close();
    }
}

async function scavengeTemporaries(stateFile: string, lease: StateLockLease) {
    const directory = path.dirname(stateFile);
    const pattern = new RegExp(`^${escapeRegExp(path.basename(stateFile))}\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !pattern.test(entry.name)) continue;
        await lease.assertOwned();
        await fs.rm(path.join(directory, entry.name), { force: true });
    }
}

async function regularFile(candidate: string) {
    try {
        const stats = await fs.lstat(candidate);
        if (!stats.isFile() || stats.isSymbolicLink()) throw stateInvalid();
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function syncParentDirectory(stateFile: string) {
    if (process.platform === "win32") return;
    const directory = await fs.open(path.dirname(stateFile), "r");
    try { await directory.sync(); } finally { await directory.close(); }
}

function cloneTask(task: DreaminaStoredTask | undefined): DreaminaStoredTask | undefined {
    return task ? JSON.parse(JSON.stringify(task)) as DreaminaStoredTask : undefined;
}

function validateTaskId(value: string) {
    if (!safeTaskId(value)) throw stateInvalid();
}
function validateOpaqueId(value: string, min: number, max: number) {
    if (!safeOpaqueId(value, min, max)) throw stateInvalid();
}
function validateEffectKey(value: string) {
    if (!validEffectKeyValue(value)) throw stateInvalid();
}
function safeTaskId(value: unknown): value is string {
    return typeof value === "string" && /^dreamina:[A-Za-z0-9._:-]{8,160}$/.test(value);
}
function safeOperationId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value);
}
function safeOpaqueId(value: unknown, min: number, max: number): value is string {
    return typeof value === "string" && value.length >= min && value.length <= max && /^[A-Za-z0-9._:-]+$/.test(value);
}
function validEffectKeyValue(value: unknown): value is string {
    return typeof value === "string" && value.length <= 300 && /^[A-Za-z0-9._:-]+$/.test(value);
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const LIFECYCLES = new Set(["QUEUED_LOCAL", "SUBMITTING", "SUBMISSION_UNCERTAIN", "ACCEPTED", "RUNNING", "TERMINAL"]);
const OUTCOMES = new Set(["SUCCEEDED", "REJECTED", "FAILED", "CANCELLED", "FAILED_OR_CANCELLED"]);
const SYNC_STATES = new Set(["SYNC_OK", "SYNC_RETRY_WAIT", "SYNC_BLOCKED_ACCOUNT", "SYNC_UNCERTAIN", "SYNC_CONFLICT"]);
const RESULT_STATES = new Set(["NOT_AVAILABLE", "PENDING_MATERIALIZATION", "MATERIALIZING", "READY", "FAILED_RETRYABLE", "FAILED_PERMANENT"]);
const RESULT_TRANSITIONS: Readonly<Record<DreaminaTaskResultState, readonly DreaminaTaskResultState[]>> = {
    NOT_AVAILABLE: [],
    PENDING_MATERIALIZATION: ["MATERIALIZING", "READY", "FAILED_RETRYABLE", "FAILED_PERMANENT"],
    MATERIALIZING: ["READY", "FAILED_RETRYABLE", "FAILED_PERMANENT"],
    READY: [],
    FAILED_RETRYABLE: ["MATERIALIZING", "FAILED_PERMANENT"],
    FAILED_PERMANENT: [],
};
const OFFICIAL_STATUSES = new Set(["pending", "processing", "completed", "failed", "cancelled"]);
