import crypto from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import { DreaminaCliError } from "./dreamina-cli-process.js";
import type { DreaminaProviderObservation, DreaminaRuntimeJournalState, DreaminaTaskContext } from "./dreamina-task-contract.js";

export type RuntimePollLease = {
    leaseId: string;
    ownerId: string;
    expiresAt: string;
};

export type RuntimeProviderOutput = {
    outputIndex: number;
    mediaType: "image" | "video";
    providerArtifactRef: string;
};

export type RuntimeRecord = {
    ownerId: string;
    idempotencyKey: string;
    clientOperationId?: string;
    context?: DreaminaTaskContext;
    requestHash: string;
    state: DreaminaRuntimeJournalState;
    journalVersion?: number;
    fenceEpoch?: number;
    accountBinding?: string;
    sessionEpoch?: number;
    reservationId?: string;
    reservationOwnerId?: string;
    reservationExpiresAt?: string;
    submissionPhase?: "reserved" | "spawn_permitted";
    queueOwnerId?: string;
    queueExpiresAt?: string;
    queueTicket?: number;
    updatedAt: string;
    submitId?: string;
    taskVersion?: 1;
    operation?: string;
    mode?: "image" | "video";
    model?: string;
    createdAt?: string;
    errorCode?: string;
    officialStatus?: DreaminaProviderObservation["status"];
    nextPollAt?: string;
    pollLease?: RuntimePollLease;
    retryCount?: number;
    lastObservedAt?: string;
    providerOutputs?: RuntimeProviderOutput[];
    hidden?: true;
};
export type RuntimeDiskState = { version: 1; records: RuntimeRecord[]; nextQueueTicket?: number };
export type StateLockLease = (() => Promise<void>) & { assertOwned: () => Promise<void> };

const BACKUP_SUFFIX = ".replace-backup";
const REPLACE_DENIED_CODES = new Set(["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"]);
const TEMP_UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const LOCK_WAIT_MS = 70_000;
const LOCK_STALE_MS = 120_000;
const LOCK_REFRESH_MS = 30_000;
const LOCK_NONCE = /^[a-f0-9-]{36}$/;
const LOCK_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const LOCK_RENAME_RETRY_ATTEMPTS = 100;
const LOCK_RENAME_RETRY_MS = 5;

export async function persistRuntimeDiskState(
    stateFile: string,
    ownerId: string,
    payload: RuntimeDiskState,
    lease: StateLockLease,
) {
    await lease.assertOwned();
    await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    await recoverStateReplacement(stateFile, ownerId, lease);
    const previous = await readRuntimeDiskState(stateFile, ownerId);
    assignJournalVersions(previous, payload);
    if (!validRuntimeDiskState(payload, ownerId)) throw stateInvalid();
    const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await writeSyncedTemporary(temporary, JSON.stringify(payload));
        await lease.assertOwned();
        await replaceStateFile(temporary, stateFile, lease);
        await lease.assertOwned();
    } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        if (error instanceof DreaminaCliError) throw error;
        throw stateInvalid();
    }
}

export async function recoverStateReplacement(stateFile: string, ownerId: string, lease: StateLockLease) {
    await lease.assertOwned();
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    if (await isRegularFile(backup)) {
        const previous = await readRuntimeDiskState(backup, ownerId);
        if (!previous) throw stateInvalid();
        if (!(await isRegularFile(stateFile))) {
            try {
                await lease.assertOwned();
                await fs.rename(backup, stateFile);
                await syncParentDirectory(stateFile);
                await lease.assertOwned();
            } catch (error) {
                if (error instanceof DreaminaCliError) throw error;
                throw stateInvalid();
            }
        } else {
            const current = await readRuntimeDiskState(stateFile, ownerId);
            if (!current) throw stateInvalid();
            assertProgression(previous, current);
            try {
                await lease.assertOwned();
                await fs.rm(backup, { force: true });
                await syncParentDirectory(stateFile);
                await lease.assertOwned();
            } catch (error) {
                if (error instanceof DreaminaCliError) throw error;
                throw stateInvalid();
            }
        }
    }
    await scavengeTemporaries(stateFile, lease);
}

async function replaceStateFile(temporary: string, stateFile: string, lease: StateLockLease) {
    try {
        await fs.rename(temporary, stateFile);
        await syncParentDirectory(stateFile);
        return;
    } catch (error) {
        if (!REPLACE_DENIED_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }

    // Windows does not guarantee rename-overwrite. The fixed backup leaves a recoverable
    // state at every interruption point and is manipulated only while this lease is owned.
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    await lease.assertOwned();
    if (await isRegularFile(backup)) throw stateInvalid();
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
        await restoreBackup(stateFile, backup, lease);
        throw error;
    }
}

async function restoreBackup(stateFile: string, backup: string, lease: StateLockLease) {
    try {
        await lease.assertOwned();
        if (await isRegularFile(stateFile)) return;
        if (!(await isRegularFile(backup))) return;
        await fs.rename(backup, stateFile);
        await syncParentDirectory(stateFile);
        await lease.assertOwned();
    } catch {
        // Leave the backup for the next lock owner if recovery cannot finish safely.
    }
}

async function writeSyncedTemporary(temporary: string, payload: string) {
    const bytes = Buffer.from(payload, "utf8");
    let handle: FileHandle | undefined;
    let failure: unknown;
    try {
        handle = await fs.open(temporary, "wx", 0o600);
        let position = 0;
        while (position < bytes.length) {
            const result = await handle.write(bytes, position, bytes.length - position, position);
            if (result.bytesWritten <= 0 || result.bytesWritten > bytes.length - position) {
                throw new Error("state write made no progress");
            }
            position += result.bytesWritten;
        }
        await handle.sync();
        if ((await handle.stat()).size !== bytes.length) throw new Error("state write size mismatch");
    } catch (error) {
        failure = error;
    }
    if (handle) {
        try { await handle.close(); } catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
}

export async function readRuntimeDiskState(stateFile: string, ownerId: string): Promise<RuntimeDiskState | undefined> {
    let value: unknown;
    try {
        value = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw stateInvalid();
    }
    if (!validRuntimeDiskState(value, ownerId)) throw stateInvalid();
    return value;

}

function assertProgression(previous: RuntimeDiskState, current: RuntimeDiskState) {
    if ((current.nextQueueTicket ?? 1) < (previous.nextQueueTicket ?? 1)) throw stateInvalid();
    const next = new Map(current.records.map((record) => [recordKey(record.ownerId, record.idempotencyKey), record]));
    for (const record of previous.records) {
        const incoming = next.get(recordKey(record.ownerId, record.idempotencyKey));
        if (!incoming) throw stateInvalid();
        assertRecordProgression(record, incoming);
        const previousVersion = journalVersion(record);
        const currentVersion = journalVersion(incoming);
        if (currentVersion < previousVersion
            || (currentVersion === previousVersion && !sameJournalRecord(record, incoming))) throw stateInvalid();
    }
}

async function isRegularFile(candidate: string) {
    try {
        const stats = await fs.lstat(candidate);
        if (!stats.isFile() || stats.isSymbolicLink()) throw stateInvalid();
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function scavengeTemporaries(stateFile: string, lease: StateLockLease) {
    const directory = path.dirname(stateFile);
    const pattern = new RegExp(`^${escapeRegExp(path.basename(stateFile))}\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`);
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw stateInvalid();
    }
    for (const entry of entries) {
        if (!entry.isFile() || !pattern.test(entry.name)) continue;
        await lease.assertOwned();
        try { await fs.rm(path.join(directory, entry.name), { force: true }); }
        catch { throw stateInvalid(); }
    }
}

async function syncParentDirectory(stateFile: string) {
    if (process.platform === "win32") return;
    const directory = await fs.open(path.dirname(stateFile), "r");
    try { await directory.sync(); } finally { await directory.close(); }
}

export function recordKey(ownerId: string, idempotencyKey: string) {
    return `${ownerId}\u0000${idempotencyKey}`;
}

export function stateInvalid() {
    return new DreaminaCliError("dreamina_state_invalid", "Dreamina 幂等状态无效", 503);
}

export function stateRank(state: RuntimeRecord["state"]) {
    if (state === "queued") return 0;
    if (state === "pending") return 1;
    if (state === "accepted") return 2;
    return 3;
}

function validRuntimeDiskState(value: unknown, ownerId: string): value is RuntimeDiskState {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const disk = value as Partial<RuntimeDiskState>;
    if (disk.version !== 1 || !Array.isArray(disk.records) || disk.records.length > 10_000
        || (disk.nextQueueTicket !== undefined && (!Number.isSafeInteger(disk.nextQueueTicket) || disk.nextQueueTicket < 1))) return false;
    const keys = new Set<string>();
    for (const record of disk.records) {
        if (!validRecord(record) || record.ownerId !== ownerId) return false;
        const key = recordKey(record.ownerId, record.idempotencyKey);
        if (keys.has(key)) return false;
        keys.add(key);
    }
    return true;
}

function validRecord(value: unknown): value is RuntimeRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Partial<RuntimeRecord>;
    const allowed = ["idempotencyKey", "clientOperationId", "context", "ownerId", "requestHash", "state", "journalVersion", "fenceEpoch", "accountBinding", "sessionEpoch", "reservationId", "reservationOwnerId", "reservationExpiresAt", "submissionPhase", "queueOwnerId", "queueExpiresAt", "queueTicket", "submitId", "updatedAt", "taskVersion", "operation", "mode", "model", "createdAt", "errorCode", "officialStatus", "nextPollAt", "pollLease", "retryCount", "lastObservedAt", "providerOutputs", "hidden"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
    const hasSubmitId = typeof record.submitId === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(record.submitId);
    const hasReservation = typeof record.reservationId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.reservationId)
        && typeof record.reservationOwnerId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.reservationOwnerId)
        && typeof record.reservationExpiresAt === "string"
        && Number.isFinite(Date.parse(record.reservationExpiresAt))
        && (record.submissionPhase === "reserved" || record.submissionPhase === "spawn_permitted")
        && (record.submissionPhase !== "spawn_permitted" || (Number.isSafeInteger(record.fenceEpoch) && (record.fenceEpoch ?? 0) >= 1));
    const noReservation = record.reservationId === undefined
        && record.reservationOwnerId === undefined
        && record.reservationExpiresAt === undefined
        && record.submissionPhase === undefined;
    // Task 3 may load durable pending records written by the previous reservation format.
    // Without a durable owner/phase they are never treated as a live pre-spawn lease; recovery
    // conservatively fences them as submission-uncertain and forbids replay.
    const legacyReservation = record.state === "pending"
        && typeof record.reservationId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.reservationId)
        && record.reservationOwnerId === undefined
        && typeof record.reservationExpiresAt === "string"
        && Number.isFinite(Date.parse(record.reservationExpiresAt))
        && record.submissionPhase === undefined;
    const reservationShapeValid = noReservation || legacyReservation || (record.state === "pending" && hasReservation);
    const noQueueLease = record.queueOwnerId === undefined && record.queueExpiresAt === undefined;
    const hasQueueLease = record.state === "queued"
        && typeof record.queueOwnerId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.queueOwnerId)
        && typeof record.queueExpiresAt === "string"
        && Number.isFinite(Date.parse(record.queueExpiresAt));
    const baseValid = Boolean(
        /^[A-Za-z0-9._-]{16,120}$/.test(record.ownerId ?? "")
        && /^[A-Za-z0-9._:-]{8,160}$/.test(record.idempotencyKey ?? "")
        && (record.clientOperationId === undefined || /^[A-Za-z0-9._:-]{16,120}$/.test(record.clientOperationId))
        && (record.context === undefined || validTaskContext(record.context))
        && /^[a-f0-9]{64}$/.test(record.requestHash ?? "")
        && ["queued", "pending", "accepted", "succeeded", "failed", "cancelled", "unknown", "deleted"].includes(record.state ?? "")
        && (record.journalVersion === undefined || (Number.isSafeInteger(record.journalVersion) && record.journalVersion >= 1))
        && (record.fenceEpoch === undefined || (Number.isSafeInteger(record.fenceEpoch) && record.fenceEpoch >= 1))
        && (record.accountBinding === undefined || /^[a-f0-9]{64}$/.test(record.accountBinding))
        && (record.sessionEpoch === undefined || (Number.isSafeInteger(record.sessionEpoch) && record.sessionEpoch >= 0))
        && ((record.accountBinding === undefined) === (record.sessionEpoch === undefined))
        && reservationShapeValid
        && (noQueueLease || hasQueueLease)
        && (record.queueTicket === undefined || (Number.isSafeInteger(record.queueTicket) && record.queueTicket >= 1))
        && (record.nextPollAt === undefined || (typeof record.nextPollAt === "string" && Number.isFinite(Date.parse(record.nextPollAt))))
        && (record.pollLease === undefined || validPollLease(record.pollLease))
        && (record.retryCount === undefined || (Number.isSafeInteger(record.retryCount) && record.retryCount >= 0 && record.retryCount <= 1_000_000))
        && (record.lastObservedAt === undefined || (typeof record.lastObservedAt === "string" && Number.isFinite(Date.parse(record.lastObservedAt))))
        && (record.providerOutputs === undefined || validProviderOutputs(record.providerOutputs, record.mode))
        && (record.hidden === undefined || record.hidden === true)
        && typeof record.updatedAt === "string"
        && Number.isFinite(Date.parse(record.updatedAt))
        && (!["queued", "pending"].includes(record.state ?? "") || record.submitId === undefined)
        && (record.state !== "accepted" || hasSubmitId)
    );
    if (!baseValid) return false;
    if (record.taskVersion === undefined) {
        return ["pending", "accepted", "unknown"].includes(record.state ?? "")
            && record.clientOperationId === undefined
            && record.context === undefined
            && record.operation === undefined
            && record.mode === undefined
            && record.model === undefined
            && record.createdAt === undefined
            && record.nextPollAt === undefined
            && record.pollLease === undefined
            && record.retryCount === undefined
            && record.lastObservedAt === undefined
            && record.providerOutputs === undefined
            && (record.errorCode === undefined
                || (record.state === "accepted" && record.errorCode === "dreamina_reference_cleanup_failed"));
    }
    return record.taskVersion === 1
        && (record.clientOperationId === undefined || /^[A-Za-z0-9._:-]{16,120}$/.test(record.clientOperationId))
        && (record.context === undefined || validTaskContext(record.context))
        && typeof record.operation === "string"
        && /^(?:text2image|image2image|image_upscale|text2video|image2video|frames2video|multiframe2video|multimodal2video)$/.test(record.operation)
        && (record.mode === "image" || record.mode === "video")
        && typeof record.model === "string"
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(record.model)
        && typeof record.createdAt === "string"
        && Number.isFinite(Date.parse(record.createdAt))
        && ((record.state === "accepted" || record.state === "succeeded") ? hasSubmitId : true)
        && (record.providerOutputs === undefined || (record.state === "succeeded" && record.officialStatus === "completed"))
        && (record.errorCode === undefined || /^[a-z][a-z0-9_]{2,80}$/.test(record.errorCode))
        && (record.officialStatus === undefined || ["pending", "processing", "completed", "failed", "cancelled"].includes(record.officialStatus));
}

function validTaskContext(value: unknown): value is DreaminaTaskContext {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const context = value as Record<string, unknown>;
    if (context.scope === "legacy_unscoped") return Object.keys(context).every((key) => key === "scope");
    if (context.scope !== "scoped") return false;
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(context).some((key) => !allowed.includes(key))) return false;
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"]) {
        const candidate = context[key];
        if (candidate !== undefined && (typeof candidate !== "string" || candidate.length < 1 || candidate.length > 200 || /[\u0000-\u001f\u007f]/.test(candidate))) return false;
    }
    return (context.batchIndex === undefined || (Number.isSafeInteger(context.batchIndex) && (context.batchIndex as number) >= 0))
        && (context.batchCount === undefined || (Number.isSafeInteger(context.batchCount) && (context.batchCount as number) >= 1));
}

function validProviderOutputs(value: unknown, mode: RuntimeRecord["mode"]): value is RuntimeProviderOutput[] {
    if (!Array.isArray(value) || !value.length || value.length > 4 || (mode !== "image" && mode !== "video")) return false;
    const indexes = new Set<number>();
    for (const output of value) {
        if (!output || typeof output !== "object" || Array.isArray(output)) return false;
        const candidate = output as Partial<RuntimeProviderOutput>;
        if (Object.keys(output).some((key) => !["outputIndex", "mediaType", "providerArtifactRef"].includes(key))
            || !Number.isSafeInteger(candidate.outputIndex) || (candidate.outputIndex ?? -1) < 0 || (candidate.outputIndex ?? 4) > 3
            || indexes.has(candidate.outputIndex!)
            || candidate.mediaType !== mode
            || typeof candidate.providerArtifactRef !== "string"
            || !/^dreamina-provider-artifact:[a-f0-9-]{36}:[0-3]$/.test(candidate.providerArtifactRef)) return false;
        indexes.add(candidate.outputIndex!);
    }
    return mode === "image" || value.length === 1;
}

function validPollLease(value: unknown): value is RuntimePollLease {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const lease = value as Partial<RuntimePollLease>;
    return Object.keys(value).every((key) => ["leaseId", "ownerId", "expiresAt"].includes(key))
        && typeof lease.leaseId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(lease.leaseId)
        && typeof lease.ownerId === "string"
        && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(lease.ownerId)
        && typeof lease.expiresAt === "string"
        && Number.isFinite(Date.parse(lease.expiresAt));
}

function isTerminal(state: RuntimeRecord["state"]) {
    return state === "succeeded" || state === "failed" || state === "cancelled" || state === "unknown" || state === "deleted";
}

function assignJournalVersions(previous: RuntimeDiskState | undefined, payload: RuntimeDiskState) {
    const existing = new Map((previous?.records ?? []).map((record) => [recordKey(record.ownerId, record.idempotencyKey), record]));
    const incomingKeys = new Set<string>();
    for (const record of payload.records) {
        const key = recordKey(record.ownerId, record.idempotencyKey);
        if (incomingKeys.has(key)) throw stateInvalid();
        incomingKeys.add(key);
        const prior = existing.get(key);
        if (!prior) {
            record.journalVersion = 1;
            continue;
        }
        assertRecordProgression(prior, record);
        const priorVersion = journalVersion(prior);
        record.journalVersion = sameJournalRecord(prior, record) ? priorVersion : priorVersion + 1;
    }
    for (const [key, prior] of existing) {
        if (!incomingKeys.has(key) && !removablePreSpawnIntent(prior)) throw stateInvalid();
    }
}

function journalVersion(record: RuntimeRecord) {
    return record.journalVersion ?? 1;
}

function removablePreSpawnIntent(record: RuntimeRecord) {
    return record.state === "pending" && record.submitId === undefined;
}

function assertRecordProgression(previous: RuntimeRecord, incoming: RuntimeRecord) {
    const reconciledUncertain = previous.state === "unknown"
        && Boolean(previous.submitId)
        && incoming.submitId === previous.submitId
        && reliableUncertainReconciliation(incoming);
    if (incoming.requestHash !== previous.requestHash
        || (!reconciledUncertain && stateRank(incoming.state) < stateRank(previous.state))) throw stateInvalid();
    if (incoming.taskVersion !== previous.taskVersion
        || incoming.clientOperationId !== previous.clientOperationId
        || JSON.stringify(incoming.context) !== JSON.stringify(previous.context)
        || incoming.operation !== previous.operation
        || incoming.mode !== previous.mode
        || incoming.model !== previous.model
        || incoming.createdAt !== previous.createdAt) throw stateInvalid();
    if (!reconciledUncertain && isTerminal(previous.state) && incoming.state !== previous.state && incoming.state !== "deleted") throw stateInvalid();
    if (previous.submitId && incoming.submitId !== previous.submitId) throw stateInvalid();
    if (previous.hidden && !incoming.hidden) throw stateInvalid();
    if (previous.providerOutputs && !sameProviderOutputs(previous.providerOutputs, incoming.providerOutputs)) throw stateInvalid();
    if (previous.fenceEpoch !== undefined && (incoming.fenceEpoch ?? 0) < previous.fenceEpoch) throw stateInvalid();
    if (previous.accountBinding !== undefined && incoming.accountBinding !== previous.accountBinding) throw stateInvalid();
    if (previous.sessionEpoch !== undefined && (incoming.sessionEpoch ?? -1) < previous.sessionEpoch) throw stateInvalid();
    if (previous.state === "queued" && incoming.state === "queued" && previous.queueOwnerId !== undefined) {
        if (incoming.queueOwnerId !== previous.queueOwnerId
            || incoming.queueTicket !== previous.queueTicket
            || Date.parse(incoming.queueExpiresAt ?? "") < Date.parse(previous.queueExpiresAt ?? "")) throw stateInvalid();
    }
    if (previous.state === "pending" && incoming.state === "pending" && previous.reservationId !== undefined) {
        const phaseRegressed = previous.submissionPhase === "spawn_permitted" && incoming.submissionPhase !== "spawn_permitted";
        if (incoming.reservationId !== previous.reservationId
            || incoming.reservationOwnerId !== previous.reservationOwnerId
            || phaseRegressed
            || Date.parse(incoming.reservationExpiresAt ?? "") < Date.parse(previous.reservationExpiresAt ?? "")) throw stateInvalid();
    }
}

function reliableUncertainReconciliation(record: RuntimeRecord) {
    if (!record.lastObservedAt || !Number.isFinite(Date.parse(record.lastObservedAt))) return false;
    if (record.state === "accepted") return record.officialStatus === "pending" || record.officialStatus === "processing";
    if (record.state === "succeeded") return record.officialStatus === "completed";
    if (record.state === "failed") return record.officialStatus === "failed";
    if (record.state === "cancelled") return record.officialStatus === "cancelled";
    return false;
}

function sameJournalRecord(left: RuntimeRecord, right: RuntimeRecord) {
    const keys: Array<keyof RuntimeRecord> = [
        "ownerId", "idempotencyKey", "clientOperationId", "requestHash", "state", "updatedAt", "fenceEpoch", "accountBinding", "sessionEpoch", "reservationId", "reservationOwnerId", "reservationExpiresAt", "submissionPhase", "queueOwnerId", "queueExpiresAt", "queueTicket", "submitId", "taskVersion",
        "operation", "mode", "model", "createdAt", "errorCode", "officialStatus", "nextPollAt", "retryCount", "lastObservedAt", "hidden",
    ];
    return keys.every((key) => left[key] === right[key])
        && JSON.stringify(left.context) === JSON.stringify(right.context)
        && sameProviderOutputs(left.providerOutputs, right.providerOutputs)
        && samePollLease(left.pollLease, right.pollLease);
}

function sameProviderOutputs(left: RuntimeProviderOutput[] | undefined, right: RuntimeProviderOutput[] | undefined) {
    if (left === undefined || right === undefined) return left === right;
    return left.length === right.length && left.every((output, index) => {
        const candidate = right[index];
        return candidate?.outputIndex === output.outputIndex
            && candidate.mediaType === output.mediaType
            && candidate.providerArtifactRef === output.providerArtifactRef;
    });
}

function samePollLease(left: RuntimePollLease | undefined, right: RuntimePollLease | undefined) {
    if (left === undefined || right === undefined) return left === right;
    return left.leaseId === right.leaseId && left.ownerId === right.ownerId && left.expiresAt === right.expiresAt;
}

export async function acquireStateLock(stateFile: string, signal?: AbortSignal) {
    const lockDirectory = `${stateFile}.lock`;
    const leaseFile = path.join(lockDirectory, "lease");
    const deadline = Date.now() + LOCK_WAIT_MS;
    await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    while (true) {
        throwIfCancelled(signal);
        const nonce = crypto.randomUUID();
        try {
            await fs.mkdir(lockDirectory, { mode: 0o700 });
            try { await fs.writeFile(leaseFile, nonce, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
            catch (error) {
                await fs.rm(lockDirectory, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
            const lease = createLease(lockDirectory, nonce);
            if (signal?.aborted) {
                await lease();
                throw cancelled();
            }
            return lease;
        } catch (error) {
            if (error instanceof DreaminaCliError) throw error;
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw stateInvalid();
        }
        if (await takeoverStaleLease(lockDirectory)) continue;
        if (Date.now() >= deadline) throw new DreaminaCliError("dreamina_state_busy", "Dreamina 幂等状态正在由另一个本机进程处理", 503);
        await delayWithAbort(25, signal);
    }
}

function createLease(lockDirectory: string, nonce: string): StateLockLease {
    const leaseFile = path.join(lockDirectory, "lease");
    let refresh = Promise.resolve();
    let stopped = false;
    const timer = setInterval(() => {
        refresh = refresh.then(async () => {
            if (stopped) return;
            const current = await readLease(lockDirectory);
            if (current?.nonce !== nonce) { stopped = true; return; }
            const now = new Date();
            await fs.utimes(leaseFile, now, now).catch((error) => {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                stopped = true;
            });
        }).catch(() => { stopped = true; });
    }, LOCK_REFRESH_MS);
    timer.unref();

    const release = async () => {
        stopped = true;
        clearInterval(timer);
        await refresh;
        if ((await readLease(lockDirectory))?.nonce !== nonce) return;
        const released = `${lockDirectory}.${nonce}.${crypto.randomUUID()}.released`;
        if (!(await renameLockDirectory(lockDirectory, released))) return;
        if ((await readLease(released))?.nonce !== nonce) {
            await fs.rename(released, lockDirectory).catch(() => undefined);
            throw stateInvalid();
        }
        try { await fs.rm(released, { recursive: true, force: true }); }
        catch { throw stateInvalid(); }
    };
    return Object.assign(release, {
        assertOwned: async () => {
            await refresh;
            if (stopped || (await readLease(lockDirectory))?.nonce !== nonce) {
                throw new DreaminaCliError("dreamina_state_fenced", "Dreamina 幂等状态租约已失效", 409);
            }
        },
    });
}

async function takeoverStaleLease(lockDirectory: string) {
    let observed: Awaited<ReturnType<typeof readLease>>;
    let modifiedAt: number;
    try {
        observed = await readLease(lockDirectory);
        modifiedAt = observed?.modifiedAt ?? (await fs.stat(lockDirectory)).mtimeMs;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        return false;
    }
    if (Date.now() - modifiedAt <= LOCK_STALE_MS) return false;
    const abandoned = `${lockDirectory}.${observed?.nonce ?? "unknown"}.${crypto.randomUUID()}.abandoned`;
    try {
        if (!(await renameLockDirectory(lockDirectory, abandoned))) return true;
    } catch {
        return false;
    }
    const moved = await readLease(abandoned);
    const movedAt = moved?.modifiedAt ?? (await fs.stat(abandoned)).mtimeMs;
    if (moved?.nonce !== observed?.nonce || Date.now() - movedAt <= LOCK_STALE_MS) {
        try { await fs.rename(abandoned, lockDirectory); } catch { throw stateInvalid(); }
        return false;
    }
    try { await fs.rm(abandoned, { recursive: true, force: true }); } catch { throw stateInvalid(); }
    return true;
}

async function renameLockDirectory(source: string, destination: string) {
    for (let attempt = 0; attempt < LOCK_RENAME_RETRY_ATTEMPTS; attempt += 1) {
        try {
            await fs.rename(source, destination);
            return true;
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code ?? "";
            if (code === "ENOENT") return false;
            if (!LOCK_RENAME_RETRY_CODES.has(code) || attempt + 1 >= LOCK_RENAME_RETRY_ATTEMPTS) throw stateInvalid();
            await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RENAME_RETRY_MS));
        }
    }
    throw stateInvalid();
}

async function readLease(lockDirectory: string) {
    try {
        const leaseFile = path.join(lockDirectory, "lease");
        const [nonce, stat] = await Promise.all([fs.readFile(leaseFile, "utf8"), fs.stat(leaseFile)]);
        return LOCK_NONCE.test(nonce) ? { nonce, modifiedAt: stat.mtimeMs } : undefined;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

function delayWithAbort(delayMs: number, signal?: AbortSignal) {
    if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    throwIfCancelled(signal);
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(cancelled()); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, delayMs);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
}

function cancelled() { return new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499); }
function throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
