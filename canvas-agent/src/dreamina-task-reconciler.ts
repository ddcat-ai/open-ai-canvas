import crypto from "node:crypto";

import { DreaminaCliError } from "./dreamina-cli-process.js";
import {
    acquireStateLock,
    persistRuntimeDiskState,
    readRuntimeDiskState,
    recoverStateReplacement,
    type RuntimeDiskState,
    type RuntimePollLease,
    type RuntimeProviderOutput,
    type RuntimeRecord,
    type StateLockLease,
} from "./dreamina-cli-state.js";
import type { DreaminaProviderObservation } from "./dreamina-task-contract.js";

export type DreaminaReconcileObservation = {
    status: DreaminaProviderObservation["status"];
    observedAt: string;
    result?: unknown;
    providerOutputs?: RuntimeProviderOutput[];
    retryCode?: string;
};

export type DreaminaReconcileApplied = {
    record: RuntimeRecord;
    observation?: DreaminaReconcileObservation;
    syncErrorCode?: string;
};

export type DreaminaTaskReconcilerOptions = {
    ownerId: string;
    stateFile: string;
    observe(record: Readonly<RuntimeRecord>, signal?: AbortSignal): Promise<DreaminaReconcileObservation>;
    onApplied?(event: DreaminaReconcileApplied): void | Promise<void>;
    now?: () => Date;
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    pollIntervalMs?: number;
    retryBaseMs?: number;
    retryMaxMs?: number;
    pollLeaseMs?: number;
    pollLeaseHeartbeatMs?: number;
    startupSpreadMs?: number;
    idleMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_RETRY_BASE_MS = 2_000;
const DEFAULT_RETRY_MAX_MS = 60_000;
const DEFAULT_POLL_LEASE_MS = 30_000;
const DEFAULT_POLL_LEASE_HEARTBEAT_MS = 5_000;
const DEFAULT_STARTUP_SPREAD_MS = 2_000;
const DEFAULT_IDLE_MS = 250;

export class DreaminaTaskReconciler {
    private readonly ownerId: string;
    private readonly stateFile: string;
    private readonly observe: DreaminaTaskReconcilerOptions["observe"];
    private readonly onApplied?: DreaminaTaskReconcilerOptions["onApplied"];
    private readonly now: () => Date;
    private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    private readonly pollIntervalMs: number;
    private readonly retryBaseMs: number;
    private readonly retryMaxMs: number;
    private readonly pollLeaseMs: number;
    private readonly pollLeaseHeartbeatMs: number;
    private readonly startupSpreadMs: number;
    private readonly idleMs: number;
    private readonly instanceId = crypto.randomUUID();
    private readonly shutdown = new AbortController();
    private readonly activeControllers = new Set<AbortController>();
    private initialized = false;
    private started = false;
    private disposed = false;
    private loopPromise?: Promise<void>;
    private wakeResolver?: () => void;

    constructor(options: DreaminaTaskReconcilerOptions) {
        if (!/^[A-Za-z0-9._-]{16,120}$/.test(options.ownerId)) throw new Error("Dreamina reconciler owner is invalid");
        this.ownerId = options.ownerId;
        this.stateFile = options.stateFile;
        this.observe = options.observe;
        this.onApplied = options.onApplied;
        this.now = options.now ?? (() => new Date());
        this.sleep = options.sleep ?? delay;
        this.pollIntervalMs = bounded(options.pollIntervalMs, 1, 300_000, DEFAULT_POLL_INTERVAL_MS);
        this.retryBaseMs = bounded(options.retryBaseMs, 1, 300_000, DEFAULT_RETRY_BASE_MS);
        this.retryMaxMs = bounded(options.retryMaxMs, this.retryBaseMs, 3_600_000, DEFAULT_RETRY_MAX_MS);
        this.pollLeaseMs = bounded(options.pollLeaseMs, 50, 300_000, DEFAULT_POLL_LEASE_MS);
        this.pollLeaseHeartbeatMs = options.pollLeaseHeartbeatMs === 0
            ? 0
            : bounded(options.pollLeaseHeartbeatMs, 10, this.pollLeaseMs, Math.min(DEFAULT_POLL_LEASE_HEARTBEAT_MS, Math.max(10, Math.floor(this.pollLeaseMs / 3))));
        this.startupSpreadMs = bounded(options.startupSpreadMs, 0, 60_000, DEFAULT_STARTUP_SPREAD_MS);
        this.idleMs = bounded(options.idleMs, 10, 10_000, DEFAULT_IDLE_MS);
    }

    async initialize(signal?: AbortSignal) {
        if (this.initialized) return;
        await this.withStateLock(async (lease) => {
            const disk = await this.readDisk(lease);
            if (!disk) return;
            let changed = false;
            const now = this.now();
            for (const record of disk.records) {
                if (!eligible(record) || record.nextPollAt !== undefined) continue;
                record.nextPollAt = new Date(now.getTime() + startupDelay(record.idempotencyKey, this.startupSpreadMs)).toISOString();
                record.retryCount ??= 0;
                changed = true;
            }
            if (changed) await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, lease);
        }, signal);
        this.initialized = true;
    }

    async start() {
        if (this.started || this.disposed) return;
        await this.initialize(this.shutdown.signal);
        this.started = true;
        this.loopPromise = this.loop();
    }

    async scheduleBackground(idempotencyKey: string, signal?: AbortSignal) {
        validateTaskId(idempotencyKey);
        await this.initialize(signal);
        await this.withStateLock(async (lease) => {
            const disk = await this.readDisk(lease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !eligible(record)) return;
            const scheduled = this.nextPollAt(record.idempotencyKey);
            if (record.nextPollAt && Date.parse(record.nextPollAt) <= Date.parse(scheduled)) return;
            record.nextPollAt = scheduled;
            record.retryCount ??= 0;
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, lease);
        }, signal);
        this.wake();
    }

    async requestNow(idempotencyKey: string, signal?: AbortSignal) {
        validateTaskId(idempotencyKey);
        await this.initialize(signal);
        await this.withStateLock(async (lease) => {
            const disk = await this.readDisk(lease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !eligible(record)) return;
            const priority = new Date(this.now().getTime() - 1).toISOString();
            if (record.nextPollAt === priority) return;
            record.nextPollAt = priority;
            record.retryCount ??= 0;
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, lease);
        }, signal);
        this.wake();
    }

    async runDueOnce(signal?: AbortSignal) {
        if (this.disposed) return false;
        await this.initialize(signal);
        const claimed = await this.claimDue(signal);
        if (!claimed) return false;
        const linked = linkedAbortController(signal, this.shutdown.signal);
        const { controller } = linked;
        this.activeControllers.add(controller);
        const stopHeartbeat = this.startHeartbeat(claimed.record.idempotencyKey, claimed.lease);
        try {
            const observation = await this.observe(claimed.record, controller.signal);
            validateObservation(observation);
            const applied = await this.commitObservation(claimed.record.idempotencyKey, claimed.lease, observation, controller.signal);
            if (applied) await this.onApplied?.({ record: applied, observation });
        } catch (error) {
            if (controller.signal.aborted) {
                await this.releaseLease(claimed.record.idempotencyKey, claimed.lease).catch(() => undefined);
                return true;
            }
            const code = safeSyncErrorCode(error);
            const applied = await this.commitSyncError(claimed.record.idempotencyKey, claimed.lease, code, controller.signal).catch(() => undefined);
            if (applied) await this.onApplied?.({ record: applied, syncErrorCode: code });
        } finally {
            await stopHeartbeat();
            this.activeControllers.delete(controller);
            linked.unlink();
            controller.abort();
        }
        return true;
    }

    async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.shutdown.abort();
        this.wake();
        for (const controller of this.activeControllers) controller.abort();
        await this.loopPromise?.catch(() => undefined);
        await this.releaseOwnedLeases().catch(() => undefined);
    }

    private async loop() {
        while (!this.disposed) {
            let worked = false;
            try { worked = await this.runDueOnce(this.shutdown.signal); } catch (error) {
                if (this.shutdown.signal.aborted) return;
            }
            if (this.disposed) return;
            if (!worked) await this.waitForWake();
        }
    }

    private async claimDue(signal?: AbortSignal) {
        return this.withStateLock(async (lease) => {
            const disk = await this.readDisk(lease);
            if (!disk) return undefined;
            const now = this.now();
            const due = disk.records
                .filter((record) => eligible(record)
                    && record.nextPollAt !== undefined
                    && Date.parse(record.nextPollAt) <= now.getTime()
                    && (!record.pollLease || Date.parse(record.pollLease.expiresAt) <= now.getTime()))
                .sort(compareDue)[0];
            if (!due) return undefined;
            const pollLease: RuntimePollLease = {
                leaseId: crypto.randomUUID(),
                ownerId: this.instanceId,
                expiresAt: new Date(now.getTime() + this.pollLeaseMs).toISOString(),
            };
            due.pollLease = pollLease;
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, lease);
            return { record: cloneRecord(due), lease: pollLease };
        }, signal);
    }

    private startHeartbeat(idempotencyKey: string, lease: RuntimePollLease) {
        if (this.pollLeaseHeartbeatMs === 0) return async () => undefined;
        let stopped = false;
        const shutdown = new AbortController();
        let refresh = Promise.resolve();
        const timer = setInterval(() => {
            refresh = refresh.then(async () => {
                if (stopped) return;
                await this.renewLease(idempotencyKey, lease, shutdown.signal);
            }).catch(() => { stopped = true; clearInterval(timer); });
        }, this.pollLeaseHeartbeatMs);
        timer.unref();
        return async () => {
            if (stopped) return;
            stopped = true;
            shutdown.abort();
            clearInterval(timer);
            await refresh;
        };
    }

    private async renewLease(idempotencyKey: string, lease: RuntimePollLease, signal: AbortSignal) {
        return this.withStateLock(async (stateLease) => {
            const disk = await this.readDisk(stateLease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !sameLease(record.pollLease, lease)) throw pollFenced();
            record.pollLease = { ...lease, expiresAt: new Date(this.now().getTime() + this.pollLeaseMs).toISOString() };
            lease.expiresAt = record.pollLease.expiresAt;
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, stateLease);
        }, signal);
    }

    private async commitObservation(idempotencyKey: string, lease: RuntimePollLease, observation: DreaminaReconcileObservation, signal?: AbortSignal) {
        return this.withStateLock(async (stateLease) => {
            const disk = await this.readDisk(stateLease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !sameLease(record.pollLease, lease)) return undefined;
            const observedAt = Date.parse(observation.observedAt);
            const previousObservedAt = record.lastObservedAt ? Date.parse(record.lastObservedAt) : Number.NEGATIVE_INFINITY;
            if (observedAt < previousObservedAt) {
                delete record.pollLease;
                if (eligible(record)) record.nextPollAt = this.nextPollAt(record.idempotencyKey);
                await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, stateLease);
                return cloneRecord(record);
            }

            applyObservation(record, observation);
            record.lastObservedAt = observation.observedAt;
            record.updatedAt = this.now().toISOString();
            delete record.pollLease;
            if (observation.status === "pending" || observation.status === "processing") {
                record.retryCount = 0;
                record.nextPollAt = this.nextPollAt(record.idempotencyKey);
            } else if (observation.status === "completed" && observation.retryCode) {
                record.retryCount = Math.min((record.retryCount ?? 0) + 1, 1_000_000);
                record.errorCode = safeCode(observation.retryCode) ? observation.retryCode : "dreamina_query_failed";
                record.nextPollAt = this.retryAt(record.retryCount);
            } else {
                record.retryCount = 0;
                delete record.nextPollAt;
            }
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, stateLease);
            return cloneRecord(record);
        }, signal);
    }

    private async commitSyncError(idempotencyKey: string, lease: RuntimePollLease, code: string, signal?: AbortSignal) {
        return this.withStateLock(async (stateLease) => {
            const disk = await this.readDisk(stateLease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !sameLease(record.pollLease, lease)) return undefined;
            delete record.pollLease;
            record.errorCode = code;
            record.retryCount = Math.min((record.retryCount ?? 0) + 1, 1_000_000);
            record.nextPollAt = this.retryAt(record.retryCount);
            record.updatedAt = this.now().toISOString();
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, stateLease);
            return cloneRecord(record);
        }, signal);
    }

    private async releaseLease(idempotencyKey: string, lease: RuntimePollLease) {
        return this.withStateLock(async (stateLease) => {
            const disk = await this.readDisk(stateLease);
            const record = disk?.records.find((candidate) => candidate.idempotencyKey === idempotencyKey);
            if (!disk || !record || !sameLease(record.pollLease, lease)) return;
            delete record.pollLease;
            await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, stateLease);
        });
    }

    private async releaseOwnedLeases() {
        return this.withStateLock(async (lease) => {
            const disk = await this.readDisk(lease);
            if (!disk) return;
            let changed = false;
            for (const record of disk.records) {
                if (record.pollLease?.ownerId !== this.instanceId) continue;
                delete record.pollLease;
                changed = true;
            }
            if (changed) await persistRuntimeDiskState(this.stateFile, this.ownerId, disk, lease);
        });
    }

    private nextPollAt(idempotencyKey: string) {
        const jitter = deterministicJitter(idempotencyKey, Math.min(500, Math.floor(this.pollIntervalMs / 5)));
        return new Date(this.now().getTime() + this.pollIntervalMs + jitter).toISOString();
    }

    private retryAt(retryCount: number) {
        const exponent = Math.max(0, Math.min(20, retryCount - 1));
        const delayMs = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** exponent));
        return new Date(this.now().getTime() + delayMs).toISOString();
    }

    private async readDisk(lease: StateLockLease) {
        await recoverStateReplacement(this.stateFile, this.ownerId, lease);
        return readRuntimeDiskState(this.stateFile, this.ownerId);
    }

    private async withStateLock<T>(action: (lease: StateLockLease) => Promise<T>, signal?: AbortSignal) {
        const lease = await acquireStateLock(this.stateFile, signal);
        try { return await action(lease); } finally { await lease(); }
    }

    private wake() {
        this.wakeResolver?.();
        this.wakeResolver = undefined;
    }

    private async waitForWake() {
        if (this.disposed) return;
        let resolve!: () => void;
        const wake = new Promise<void>((done) => { resolve = done; });
        this.wakeResolver = resolve;
        await Promise.race([
            wake,
            this.sleep(this.idleMs, this.shutdown.signal).catch(() => undefined),
        ]);
        if (this.wakeResolver === resolve) this.wakeResolver = undefined;
    }
}

function eligible(record: RuntimeRecord) {
    return Boolean(record.taskVersion && record.submitId)
        && (record.state === "accepted"
            || record.state === "unknown"
            || (record.state === "succeeded" && record.providerOutputs === undefined));
}

function compareDue(left: RuntimeRecord, right: RuntimeRecord) {
    const leftDue = Date.parse(left.nextPollAt ?? "");
    const rightDue = Date.parse(right.nextPollAt ?? "");
    if (leftDue !== rightDue) return leftDue - rightDue;
    const leftObserved = left.lastObservedAt ? Date.parse(left.lastObservedAt) : Number.NEGATIVE_INFINITY;
    const rightObserved = right.lastObservedAt ? Date.parse(right.lastObservedAt) : Number.NEGATIVE_INFINITY;
    if (leftObserved !== rightObserved) return leftObserved - rightObserved;
    return left.idempotencyKey.localeCompare(right.idempotencyKey);
}

function applyObservation(record: RuntimeRecord, observation: DreaminaReconcileObservation) {
    const status = observation.status;
    if (record.state === "succeeded" && status !== "completed") {
        record.errorCode = "dreamina_observation_conflict";
        return;
    }
    record.officialStatus = status;
    if (status === "pending" || status === "processing") {
        record.state = "accepted";
        clearSyncError(record);
        return;
    }
    if (status === "completed") {
        record.state = "succeeded";
        if (observation.providerOutputs) record.providerOutputs = observation.providerOutputs.map((output) => ({ ...output }));
        if (observation.retryCode) record.errorCode = safeCode(observation.retryCode) ? observation.retryCode : "dreamina_query_failed";
        else clearSyncError(record);
        return;
    }
    if (status === "cancelled") {
        record.state = "cancelled";
        record.errorCode = "dreamina_official_cancelled";
        return;
    }
    record.state = "failed";
    record.errorCode = "dreamina_official_failed";
}

function clearSyncError(record: RuntimeRecord) {
    if (!record.errorCode || record.errorCode === "dreamina_reference_cleanup_failed") return;
    delete record.errorCode;
}

function safeSyncErrorCode(error: unknown) {
    const value = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    return typeof value === "string" && safeCode(value) ? value : "dreamina_query_failed";
}

function validateObservation(observation: DreaminaReconcileObservation) {
    if (!observation || !["pending", "processing", "completed", "failed", "cancelled"].includes(observation.status)
        || typeof observation.observedAt !== "string" || !Number.isFinite(Date.parse(observation.observedAt))
        || (observation.retryCode !== undefined && !safeCode(observation.retryCode))
        || (observation.providerOutputs !== undefined && !validProviderOutputs(observation.providerOutputs))
        || (observation.providerOutputs !== undefined && (observation.status !== "completed" || observation.retryCode !== undefined))) {
        throw new DreaminaCliError("dreamina_query_response_invalid", "Dreamina reconciliation observation is invalid", 502);
    }
}

function validProviderOutputs(outputs: RuntimeProviderOutput[]) {
    if (!Array.isArray(outputs) || !outputs.length || outputs.length > 4) return false;
    const indexes = new Set<number>();
    return outputs.every((output) => {
        if (!output || !Number.isSafeInteger(output.outputIndex) || output.outputIndex < 0 || output.outputIndex > 3
            || indexes.has(output.outputIndex)
            || (output.mediaType !== "image" && output.mediaType !== "video")
            || !/^dreamina-provider-artifact:[a-f0-9-]{36}:[0-3]$/.test(output.providerArtifactRef)) return false;
        indexes.add(output.outputIndex);
        return true;
    });
}

function sameLease(current: RuntimePollLease | undefined, expected: RuntimePollLease) {
    return Boolean(current && current.leaseId === expected.leaseId && current.ownerId === expected.ownerId);
}

function cloneRecord(record: RuntimeRecord): RuntimeRecord {
    return { ...record, ...(record.pollLease ? { pollLease: { ...record.pollLease } } : {}) };
}

function linkedAbortController(...signals: Array<AbortSignal | undefined>) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const linked = new Set<AbortSignal>();
    for (const signal of signals) {
        if (!signal || linked.has(signal)) continue;
        linked.add(signal);
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", abort, { once: true });
    }
    return {
        controller,
        unlink() {
            for (const signal of linked) signal.removeEventListener("abort", abort);
            linked.clear();
        },
    };
}

function startupDelay(id: string, spreadMs: number) {
    return deterministicJitter(id, spreadMs);
}

function deterministicJitter(value: string, maxMs: number) {
    if (maxMs <= 0) return 0;
    const digest = crypto.createHash("sha256").update(value).digest();
    return digest.readUInt32BE(0) % (maxMs + 1);
}

function safeCode(value: string) {
    return /^[a-z][a-z0-9_]{2,80}$/.test(value);
}

function validateTaskId(value: string) {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("Dreamina reconciliation task id is invalid");
}

function pollFenced() {
    return new DreaminaCliError("dreamina_poll_fenced", "Dreamina reconciliation lease is no longer current", 409);
}

function bounded(value: number | undefined, min: number, max: number, fallback: number) {
    if (value === undefined) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}

function delay(delayMs: number, signal?: AbortSignal) {
    if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (signal.aborted) return Promise.reject(new DreaminaCliError("dreamina_cancelled", "Dreamina reconciliation cancelled", 499));
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new DreaminaCliError("dreamina_cancelled", "Dreamina reconciliation cancelled", 499)); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
