import {
    acquireStateLock,
    readRuntimeDiskState,
    recoverStateReplacement,
    type RuntimeRecord,
} from "./dreamina-cli-state.js";
import { dreaminaTaskFromRuntimeJournal, type DreaminaTaskContext, type DreaminaTaskState } from "./dreamina-task-contract.js";
import {
    DreaminaTaskStore,
    DreaminaTaskStoreConflictError,
    type DreaminaStoredTask,
} from "./dreamina-task-store.js";

export type DreaminaProjectableJournalRecord = {
    recordId: string;
    journalVersion: number;
    requestHash: string;
    clientOperationId?: string;
    context?: DreaminaTaskContext;
    state: RuntimeRecord["state"];
    hasProviderTask: boolean;
    taskVersion?: 1;
    operation?: string;
    mode?: "image" | "video";
    model?: string;
    createdAt?: string;
    updatedAt: string;
    errorCode?: string;
    officialStatus?: RuntimeRecord["officialStatus"];
    accountBinding?: string;
    fenceEpoch?: number;
    providerOutputs?: RuntimeRecord["providerOutputs"];
    hidden?: true;
};

export type DreaminaTaskProjectorOptions = {
    store: DreaminaTaskStore;
    ownerId: string;
    journalFile: string;
    readJournal?: () => Promise<DreaminaProjectableJournalRecord[]>;
};

export class DreaminaTaskProjector {
    private readonly store: DreaminaTaskStore;
    private readonly ownerId: string;
    private readonly journalFile: string;
    private readonly readJournal: () => Promise<DreaminaProjectableJournalRecord[]>;

    constructor(options: DreaminaTaskProjectorOptions) {
        if (!/^[A-Za-z0-9._-]{16,120}$/.test(options.ownerId)) throw new Error("Dreamina owner is invalid");
        this.store = options.store;
        this.ownerId = options.ownerId;
        this.journalFile = options.journalFile;
        this.readJournal = options.readJournal ?? (() => readSafeJournal(this.journalFile, this.ownerId));
    }

    async recover() {
        const records = await this.readJournal();
        records.sort((left, right) => left.recordId.localeCompare(right.recordId));
        for (const record of records) {
            await this.projectJournalVersion(record.recordId, record.journalVersion, record);
        }
    }

    async projectJournalVersion(
        recordId: string,
        journalVersion: number,
        supplied?: DreaminaProjectableJournalRecord,
    ): Promise<DreaminaStoredTask | undefined> {
        validateRecordId(recordId);
        if (!Number.isSafeInteger(journalVersion) || journalVersion < 1) throw new Error("Dreamina journal version is invalid");
        const record = supplied ?? (await this.readJournal()).find((candidate) => (
            candidate.recordId === recordId && candidate.journalVersion === journalVersion
        ));
        if (!record) return undefined;
        validateJournalRecord(record);
        if (record.recordId !== recordId || record.journalVersion !== journalVersion) throw new Error("Dreamina journal projection identity is invalid");

        const taskId = `dreamina:${recordId}`;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            const current = await this.store.getTask(taskId);
            if (current && (current.requestHash !== record.requestHash || current.journalRecordId !== record.recordId)) {
                throw new Error("Dreamina journal projection identity changed");
            }
            if (current && current.projectedJournalVersion >= journalVersion) return current;
            const next = record.state === "deleted"
                ? projectDeletedRecord(record, current)
                : projectRecord(record, current);
            try {
                return await this.store.compareAndSwapTask({
                    taskId,
                    expectedVersion: current?.version ?? 0,
                    task: next,
                    effect: {
                        effectKey: projectionEffectKey(recordId, journalVersion),
                        kind: "task.projected",
                        taskId,
                        journalVersion,
                    },
                });
            } catch (error) {
                if (!(error instanceof DreaminaTaskStoreConflictError)) throw error;
            }
        }
        throw new DreaminaTaskStoreConflictError();
    }
}

export async function readSafeJournal(journalFile: string, ownerId: string): Promise<DreaminaProjectableJournalRecord[]> {
    const release = await acquireStateLock(journalFile);
    try {
        await recoverStateReplacement(journalFile, ownerId, release);
        const disk = await readRuntimeDiskState(journalFile, ownerId);
        return (disk?.records ?? []).map((record) => ({
            recordId: record.idempotencyKey,
            journalVersion: record.journalVersion ?? 1,
            requestHash: record.requestHash,
            ...(record.clientOperationId ? { clientOperationId: record.clientOperationId } : {}),
            ...(record.context ? { context: record.context } : {}),
            state: record.state,
            hasProviderTask: Boolean(record.submitId),
            ...(record.taskVersion ? { taskVersion: record.taskVersion } : {}),
            ...(record.operation ? { operation: record.operation } : {}),
            ...(record.mode ? { mode: record.mode } : {}),
            ...(record.model ? { model: record.model } : {}),
            ...(record.createdAt ? { createdAt: record.createdAt } : {}),
            updatedAt: record.updatedAt,
            ...(record.errorCode ? { errorCode: record.errorCode } : {}),
            ...(record.officialStatus ? { officialStatus: record.officialStatus } : {}),
            ...(record.accountBinding ? { accountBinding: record.accountBinding } : {}),
            ...(record.fenceEpoch ? { fenceEpoch: record.fenceEpoch } : {}),
            ...(record.providerOutputs ? { providerOutputs: record.providerOutputs.map((output) => ({ ...output })) } : {}),
            ...(record.hidden ? { hidden: true as const } : {}),
        }));
    } finally {
        await release();
    }
}

function projectRecord(record: DreaminaProjectableJournalRecord, current?: DreaminaStoredTask): Omit<DreaminaStoredTask, "version"> {
    if (current && (current.requestHash !== record.requestHash || current.journalRecordId !== record.recordId)) {
        throw new Error("Dreamina journal projection identity changed");
    }
    if (current?.accountBinding && record.accountBinding && current.accountBinding !== record.accountBinding) {
        throw new Error("Dreamina journal projection account binding changed");
    }
    const state = mergeProviderState(current, dreaminaTaskFromRuntimeJournal({
        state: record.state,
        receiptRecorded: record.hasProviderTask,
        errorCode: record.errorCode,
        officialStatus: record.officialStatus,
    }));
    const projectedOutputs = (record.providerOutputs ?? []).map((output) => ({ ...output }));
    const canProjectProviderOutputs = projectedOutputs.length > 0
        && (!current || (current.outputs.length === 0
            && (current.resultState === "NOT_AVAILABLE" || current.resultState === "PENDING_MATERIALIZATION")));
    const preserveProductResult = current && current.resultState !== "NOT_AVAILABLE" && !canProjectProviderOutputs;
    const syncState = state.syncState;
    return {
        taskId: `dreamina:${record.recordId}`,
        visibility: current?.visibility === "deleted"
            ? "deleted"
            : current?.visibility === "hidden" || record.hidden ? "hidden" : "visible",
        clientOperationId: record.clientOperationId ?? current?.clientOperationId ?? record.recordId,
        provider: "dreamina-cli",
        lifecycle: state.lifecycle,
        ...(state.terminalOutcome ? { terminalOutcome: state.terminalOutcome } : {}),
        syncState,
        resultState: preserveProductResult
            ? current.resultState
            : canProjectProviderOutputs ? "PENDING_MATERIALIZATION" : state.resultState,
        requestHash: record.requestHash,
        outputs: preserveProductResult
            ? current.outputs
            : canProjectProviderOutputs ? projectedOutputs : state.outputs,
        // Runtime records predating the shared product store have no trustworthy product scope.
        context: record.context ?? current?.context ?? { scope: "legacy_unscoped" },
        ...(record.officialStatus ? { officialStatus: record.officialStatus } : current?.officialStatus ? { officialStatus: current.officialStatus } : {}),
        ...(state.lastSyncErrorCode
            ? { lastSyncErrorCode: state.lastSyncErrorCode }
            : syncState === "SYNC_CONFLICT" && current?.lastSyncErrorCode ? { lastSyncErrorCode: current.lastSyncErrorCode } : {}),
        ...(record.mode ? { mode: record.mode } : current?.mode ? { mode: current.mode } : {}),
        ...(record.operation ? { operation: record.operation } : current?.operation ? { operation: current.operation } : {}),
        ...(record.model ? { model: record.model } : current?.model ? { model: current.model } : {}),
        ...(record.createdAt ? { createdAt: record.createdAt } : current?.createdAt ? { createdAt: current.createdAt } : {}),
        updatedAt: laterTimestamp(current?.updatedAt, record.updatedAt),
        journalRecordId: record.recordId,
        projectedJournalVersion: record.journalVersion,
        ...(current?.accountBinding
            ? { accountBinding: current.accountBinding }
            : record.accountBinding ? { accountBinding: record.accountBinding } : {}),
    };
}

function projectDeletedRecord(
    record: DreaminaProjectableJournalRecord,
    current?: DreaminaStoredTask,
): Omit<DreaminaStoredTask, "version"> {
    if (current) {
        return {
            ...current,
            visibility: "deleted",
            projectedJournalVersion: record.journalVersion,
            updatedAt: laterTimestamp(current.updatedAt, record.updatedAt),
        };
    }
    const state = deletedProviderState(record);
    return {
        ...projectRecord({ ...record, state }, undefined),
        visibility: "deleted",
        projectedJournalVersion: record.journalVersion,
    };
}

function deletedProviderState(record: DreaminaProjectableJournalRecord): RuntimeRecord["state"] {
    if (record.officialStatus === "completed") return "succeeded";
    if (record.officialStatus === "failed") return "failed";
    if (record.officialStatus === "cancelled") return "cancelled";
    return record.hasProviderTask ? "accepted" : "queued";
}

function mergeProviderState(current: DreaminaStoredTask | undefined, incoming: DreaminaTaskState): DreaminaTaskState {
    if (!current) return incoming;
    let lifecycle = incoming.lifecycle;
    let terminalOutcome = incoming.terminalOutcome;
    let syncState = current.syncState === "SYNC_CONFLICT" ? "SYNC_CONFLICT" : incoming.syncState;

    if (current.lifecycle === "TERMINAL") {
        if (incoming.lifecycle === "TERMINAL" && incoming.terminalOutcome !== current.terminalOutcome) syncState = "SYNC_CONFLICT";
        lifecycle = "TERMINAL";
        terminalOutcome = current.terminalOutcome;
    } else if (lifecycleRank(incoming.lifecycle) < lifecycleRank(current.lifecycle)) {
        lifecycle = current.lifecycle;
        terminalOutcome = current.terminalOutcome;
    }

    return {
        ...incoming,
        lifecycle,
        terminalOutcome,
        syncState,
        ...(syncState === "SYNC_CONFLICT" && current.lastSyncErrorCode && !incoming.lastSyncErrorCode
            ? { lastSyncErrorCode: current.lastSyncErrorCode }
            : {}),
    };
}

function lifecycleRank(lifecycle: DreaminaTaskState["lifecycle"]) {
    if (lifecycle === "QUEUED_LOCAL") return 0;
    if (lifecycle === "SUBMITTING") return 1;
    if (lifecycle === "SUBMISSION_UNCERTAIN") return 2;
    if (lifecycle === "ACCEPTED") return 3;
    if (lifecycle === "RUNNING") return 4;
    return 5;
}

function projectionEffectKey(recordId: string, journalVersion: number) {
    return `task.projected:dreamina-cli:${recordId}:${journalVersion}`;
}

function laterTimestamp(current: string | undefined, incoming: string) {
    return current && Date.parse(current) > Date.parse(incoming) ? current : incoming;
}

function validateJournalRecord(record: DreaminaProjectableJournalRecord) {
    validateRecordId(record.recordId);
    if (!Number.isSafeInteger(record.journalVersion) || record.journalVersion < 1
        || !/^[a-f0-9]{64}$/.test(record.requestHash)
        || !["queued", "pending", "accepted", "succeeded", "failed", "cancelled", "unknown", "deleted"].includes(record.state)
        || typeof record.hasProviderTask !== "boolean"
        || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
        throw new Error("Dreamina journal projection record is invalid");
    }
    if (record.taskVersion !== undefined && record.taskVersion !== 1) throw new Error("Dreamina journal projection record is invalid");
    if (record.clientOperationId !== undefined && !/^[A-Za-z0-9._:-]{16,120}$/.test(record.clientOperationId)) throw new Error("Dreamina journal projection record is invalid");
    if (record.context !== undefined && !validTaskContext(record.context)) throw new Error("Dreamina journal projection record is invalid");
    if (record.mode !== undefined && record.mode !== "image" && record.mode !== "video") throw new Error("Dreamina journal projection record is invalid");
    for (const value of [record.operation, record.model]) {
        if (value !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value)) throw new Error("Dreamina journal projection record is invalid");
    }
    if (record.createdAt !== undefined && !Number.isFinite(Date.parse(record.createdAt))) throw new Error("Dreamina journal projection record is invalid");
    if (record.errorCode !== undefined && !/^[a-z][a-z0-9_]{2,80}$/.test(record.errorCode)) throw new Error("Dreamina journal projection record is invalid");
    if (record.accountBinding !== undefined && !/^[a-f0-9]{64}$/.test(record.accountBinding)) throw new Error("Dreamina journal projection record is invalid");
    if (record.fenceEpoch !== undefined && (!Number.isSafeInteger(record.fenceEpoch) || record.fenceEpoch < 1)) throw new Error("Dreamina journal projection record is invalid");
    if (record.hidden !== undefined && record.hidden !== true) throw new Error("Dreamina journal projection record is invalid");
    if (record.officialStatus !== undefined && !["pending", "processing", "completed", "failed", "cancelled"].includes(record.officialStatus)) {
        throw new Error("Dreamina journal projection record is invalid");
    }
    if (record.providerOutputs !== undefined && (
        record.state !== "succeeded"
        || record.officialStatus !== "completed"
        || !Array.isArray(record.providerOutputs)
        || !record.providerOutputs.length
        || record.providerOutputs.length > 4
        || record.providerOutputs.some((output, index) => (
            output.outputIndex !== index
            || output.mediaType !== record.mode
            || !/^dreamina-provider-artifact:[a-f0-9-]{36}:[0-3]$/.test(output.providerArtifactRef)
        ))
    )) throw new Error("Dreamina journal projection record is invalid");
}

function validTaskContext(value: DreaminaTaskContext) {
    if (value.scope === "legacy_unscoped") return Object.keys(value).every((key) => key === "scope");
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"] as const) {
        const candidate = value[key];
        if (candidate !== undefined && (candidate.length < 1 || candidate.length > 200 || /[\u0000-\u001f\u007f]/.test(candidate))) return false;
    }
    return (value.batchIndex === undefined || (Number.isSafeInteger(value.batchIndex) && value.batchIndex >= 0))
        && (value.batchCount === undefined || (Number.isSafeInteger(value.batchCount) && value.batchCount >= 1));
}

function validateRecordId(value: string) {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(value)) throw new Error("Dreamina journal record id is invalid");
}
