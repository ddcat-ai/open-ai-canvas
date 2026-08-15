export type DreaminaTaskLifecycle =
    | "QUEUED_LOCAL"
    | "SUBMITTING"
    | "SUBMISSION_UNCERTAIN"
    | "ACCEPTED"
    | "RUNNING"
    | "TERMINAL";

export type DreaminaTerminalOutcome =
    | "SUCCEEDED"
    | "REJECTED"
    | "FAILED"
    | "CANCELLED"
    | "FAILED_OR_CANCELLED";

export type DreaminaTaskSyncState =
    | "SYNC_OK"
    | "SYNC_RETRY_WAIT"
    | "SYNC_BLOCKED_ACCOUNT"
    | "SYNC_UNCERTAIN"
    | "SYNC_CONFLICT";

export type DreaminaTaskResultState =
    | "NOT_AVAILABLE"
    | "PENDING_MATERIALIZATION"
    | "MATERIALIZING"
    | "READY"
    | "FAILED_RETRYABLE"
    | "FAILED_PERMANENT";

export type DreaminaTaskMediaType = "image" | "video" | "audio";
export type DreaminaAvailability = "yes" | "no" | "unknown";

export type DreaminaTaskOutput = {
    outputIndex: number;
    mediaType: DreaminaTaskMediaType;
    providerArtifactRef?: string;
    materializedAssetId?: string;
    materializationErrorCode?: string;
};

export type DreaminaScopedTaskContext = {
    scope: "scoped";
    projectId?: string;
    nodeId?: string;
    conversationId?: string;
    messageId?: string;
    batchIndex?: number;
    batchCount?: number;
    retryOf?: string;
    attemptGroupId?: string;
};

export type DreaminaTaskContext = DreaminaScopedTaskContext | { scope: "legacy_unscoped" };

export type DreaminaProviderObservation = {
    source: "submit_receipt" | "query_result" | "list_task";
    observedAt: string;
    accountBinding?: string;
    fenceEpoch?: number;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
};

export type DreaminaProviderCapability = {
    adapterSupported: boolean;
    cancelSupported: boolean;
    pushStatusSupported: boolean;
    statusConsistency: "eventual_polling";
    accountEntitlement: DreaminaAvailability;
    currentlyObservedAvailable: DreaminaAvailability;
    references: {
        images: boolean;
        videos: boolean;
        audios: boolean;
        firstLastFrames: boolean;
    };
};

export type DreaminaGenerationTaskContract = {
    taskId: string;
    clientOperationId: string;
    provider: "dreamina-cli";
    accountBinding?: string;
    lifecycle: DreaminaTaskLifecycle;
    terminalOutcome?: DreaminaTerminalOutcome;
    syncState: DreaminaTaskSyncState;
    resultState: DreaminaTaskResultState;
    projectId?: string;
    nodeId?: string;
    conversationId?: string;
    messageId?: string;
    batchIndex?: number;
    batchCount?: number;
    retryOf?: string;
    attemptGroupId?: string;
    requestHash: string;
    providerTaskId?: string;
    officialStatus?: DreaminaProviderObservation["status"];
    lastObservedAt?: string;
    lastSyncErrorCode?: string;
    nextPollAt?: string;
    version: number;
    outputs: DreaminaTaskOutput[];
};

export type DreaminaTaskState = {
    lifecycle: DreaminaTaskLifecycle;
    terminalOutcome?: DreaminaTerminalOutcome;
    syncState: DreaminaTaskSyncState;
    resultState: DreaminaTaskResultState;
    outputs: DreaminaTaskOutput[];
    accountBinding?: string;
    context: DreaminaTaskContext;
    providerObservation?: DreaminaProviderObservation;
    lastSyncErrorCode?: string;
};

export type DreaminaLocalSyncErrorKind = "query" | "transport" | "parse" | "lock" | "login" | "account";

export type DreaminaTaskEvent =
    | { type: "transition"; lifecycle: DreaminaTaskLifecycle; terminalOutcome?: DreaminaTerminalOutcome }
    | { type: "provider_observation"; observation: DreaminaProviderObservation }
    | { type: "sync_error"; errorKind: DreaminaLocalSyncErrorKind; code: string }
    | { type: "sync_recovered" }
    | { type: "bind_context"; accountBinding?: string; context: DreaminaScopedTaskContext };

// These values are a compatibility journal contract, not a second product lifecycle.
export type DreaminaRuntimeJournalState =
    | "queued"
    | "pending"
    | "accepted"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "unknown"
    | "deleted";

export type DreaminaRuntimeJournalSnapshot = {
    state: DreaminaRuntimeJournalState;
    submitId?: string;
    receiptRecorded?: boolean;
    errorCode?: string;
    officialStatus?: DreaminaProviderObservation["status"];
};

const FORWARD_TRANSITIONS: Readonly<Record<DreaminaTaskLifecycle, readonly DreaminaTaskLifecycle[]>> = {
    QUEUED_LOCAL: ["SUBMITTING"],
    SUBMITTING: ["ACCEPTED", "SUBMISSION_UNCERTAIN", "TERMINAL"],
    SUBMISSION_UNCERTAIN: ["ACCEPTED", "TERMINAL"],
    ACCEPTED: ["RUNNING", "TERMINAL"],
    RUNNING: ["TERMINAL"],
    TERMINAL: [],
};

export class DreaminaTaskTransitionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DreaminaTaskTransitionError";
    }
}

export function reduceDreaminaTask(state: DreaminaTaskState, event: DreaminaTaskEvent): DreaminaTaskState {
    if (event.type === "transition") return transitionLifecycle(state, event.lifecycle, event.terminalOutcome);
    if (event.type === "provider_observation") return applyProviderObservation(state, event.observation);
    if (event.type === "sync_error") {
        assertSafeErrorCode(event.code);
        return {
            ...state,
            syncState: event.errorKind === "account" ? "SYNC_BLOCKED_ACCOUNT" : "SYNC_RETRY_WAIT",
            lastSyncErrorCode: event.code,
        };
    }
    if (event.type === "sync_recovered") {
        if (state.syncState === "SYNC_CONFLICT") return state;
        return { ...state, syncState: "SYNC_OK", lastSyncErrorCode: undefined };
    }
    return bindContext(state, event);
}

export function dreaminaTaskFromRuntimeJournal(input: DreaminaRuntimeJournalSnapshot): DreaminaTaskState {
    const base: DreaminaTaskState = {
        lifecycle: "QUEUED_LOCAL",
        syncState: "SYNC_OK",
        resultState: "NOT_AVAILABLE",
        outputs: [],
        context: { scope: "legacy_unscoped" },
    };
    if (input.state === "queued") return base;
    if (input.state === "pending") return { ...base, lifecycle: "SUBMITTING" };
    if (input.state === "unknown") {
        return {
            ...base,
            lifecycle: "SUBMISSION_UNCERTAIN",
            syncState: "SYNC_UNCERTAIN",
            ...(input.errorCode ? { lastSyncErrorCode: input.errorCode } : {}),
        };
    }
    if (input.state === "accepted") {
        return {
            ...base,
            lifecycle: input.officialStatus === "processing" ? "RUNNING" : "ACCEPTED",
            ...(input.errorCode === "dreamina_account_session_changed"
                ? { syncState: "SYNC_BLOCKED_ACCOUNT" as const, lastSyncErrorCode: input.errorCode }
                : input.errorCode && isLocalSyncErrorCode(input.errorCode)
                    ? { syncState: "SYNC_RETRY_WAIT" as const, lastSyncErrorCode: input.errorCode }
                    : {}),
        };
    }
    if (input.state === "succeeded") {
        return {
            ...base,
            lifecycle: "TERMINAL",
            terminalOutcome: "SUCCEEDED",
            resultState: "PENDING_MATERIALIZATION",
            ...(input.errorCode === "dreamina_account_session_changed"
                ? { syncState: "SYNC_BLOCKED_ACCOUNT" as const, lastSyncErrorCode: input.errorCode }
                : {}),
        };
    }
    if (input.state === "cancelled") {
        if (hasProviderTask(input) && input.errorCode === "dreamina_local_wait_stopped") {
            return { ...base, lifecycle: "ACCEPTED" };
        }
        return { ...base, lifecycle: "TERMINAL", terminalOutcome: "CANCELLED" };
    }
    if (input.state === "failed") {
        if (hasProviderTask(input) && input.errorCode && isLocalSyncErrorCode(input.errorCode)) {
            return {
                ...base,
                lifecycle: "ACCEPTED",
                syncState: "SYNC_RETRY_WAIT",
                lastSyncErrorCode: input.errorCode,
            };
        }
        return {
            ...base,
            lifecycle: "TERMINAL",
            terminalOutcome: isAmbiguousOfficialFailure(input) ? "FAILED_OR_CANCELLED" : "FAILED",
        };
    }
    return { ...base, lifecycle: "TERMINAL", terminalOutcome: "FAILED" };
}

function transitionLifecycle(
    state: DreaminaTaskState,
    lifecycle: DreaminaTaskLifecycle,
    terminalOutcome?: DreaminaTerminalOutcome,
): DreaminaTaskState {
    if (lifecycle === state.lifecycle) {
        if (lifecycle !== "TERMINAL") {
            if (terminalOutcome !== undefined) throw lifecycleError(state.lifecycle, lifecycle);
            return state;
        }
        if (!terminalOutcome || terminalOutcome !== state.terminalOutcome) throw lifecycleError(state.lifecycle, lifecycle);
        return state;
    }
    if (!FORWARD_TRANSITIONS[state.lifecycle].includes(lifecycle)) throw lifecycleError(state.lifecycle, lifecycle);
    if (lifecycle === "TERMINAL" && !terminalOutcome) throw lifecycleError(state.lifecycle, lifecycle);
    if (lifecycle !== "TERMINAL" && terminalOutcome !== undefined) throw lifecycleError(state.lifecycle, lifecycle);
    if (state.lifecycle === "SUBMITTING" && lifecycle === "TERMINAL" && terminalOutcome !== "REJECTED") {
        throw lifecycleError(state.lifecycle, lifecycle);
    }
    if (state.lifecycle === "SUBMISSION_UNCERTAIN" && lifecycle === "TERMINAL") {
        throw lifecycleError(state.lifecycle, lifecycle);
    }

    const next: DreaminaTaskState = {
        ...state,
        lifecycle,
        terminalOutcome: lifecycle === "TERMINAL" ? terminalOutcome : undefined,
    };
    if (lifecycle === "SUBMISSION_UNCERTAIN") {
        next.syncState = "SYNC_UNCERTAIN";
    } else if (state.lifecycle === "SUBMISSION_UNCERTAIN" && lifecycle === "ACCEPTED") {
        next.syncState = "SYNC_OK";
        next.lastSyncErrorCode = undefined;
    }
    if (lifecycle === "TERMINAL" && terminalOutcome === "SUCCEEDED" && next.resultState === "NOT_AVAILABLE") {
        next.resultState = "PENDING_MATERIALIZATION";
    }
    return next;
}

function applyProviderObservation(state: DreaminaTaskState, observation: DreaminaProviderObservation): DreaminaTaskState {
    assertObservation(observation);
    if (state.accountBinding && observation.accountBinding && state.accountBinding !== observation.accountBinding) {
        return { ...state, syncState: "SYNC_CONFLICT" };
    }
    const withObservation: DreaminaTaskState = {
        ...state,
        ...(state.accountBinding || !observation.accountBinding ? {} : { accountBinding: observation.accountBinding }),
        providerObservation: observation,
        syncState: state.syncState === "SYNC_CONFLICT" ? "SYNC_CONFLICT" : "SYNC_OK",
        lastSyncErrorCode: undefined,
    };
    const observedOutcome = terminalOutcomeForObservation(observation.status);

    if (state.lifecycle === "TERMINAL") {
        if (!observedOutcome || observedOutcome === state.terminalOutcome) return withObservation;
        return { ...withObservation, syncState: "SYNC_CONFLICT", terminalOutcome: state.terminalOutcome };
    }
    if (observedOutcome) {
        return transitionLifecycleFromObservation(withObservation, observedOutcome);
    }
    if (observation.status === "processing") {
        if (state.lifecycle === "RUNNING") return withObservation;
        return { ...withObservation, lifecycle: "RUNNING", terminalOutcome: undefined };
    }
    if (state.lifecycle === "RUNNING") return withObservation;
    if (state.lifecycle === "ACCEPTED") return withObservation;
    return { ...withObservation, lifecycle: "ACCEPTED", terminalOutcome: undefined };
}

function transitionLifecycleFromObservation(state: DreaminaTaskState, outcome: DreaminaTerminalOutcome): DreaminaTaskState {
    const next: DreaminaTaskState = {
        ...state,
        lifecycle: "TERMINAL",
        terminalOutcome: outcome,
    };
    if (outcome === "SUCCEEDED" && next.resultState === "NOT_AVAILABLE") next.resultState = "PENDING_MATERIALIZATION";
    return next;
}

function bindContext(
    state: DreaminaTaskState,
    event: Extract<DreaminaTaskEvent, { type: "bind_context" }>,
): DreaminaTaskState {
    if (state.context.scope === "legacy_unscoped") return state;
    if (event.accountBinding && state.accountBinding && event.accountBinding !== state.accountBinding) {
        return { ...state, syncState: "SYNC_CONFLICT" };
    }
    const context = { ...state.context };
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"] as const) {
        const incoming = event.context[key];
        const current = context[key];
        if (incoming === undefined) continue;
        if (current !== undefined && current !== incoming) return { ...state, syncState: "SYNC_CONFLICT" };
        Object.assign(context, { [key]: incoming });
    }
    return {
        ...state,
        context,
        ...(state.accountBinding || !event.accountBinding ? {} : { accountBinding: event.accountBinding }),
    };
}

function terminalOutcomeForObservation(status: DreaminaProviderObservation["status"]): DreaminaTerminalOutcome | undefined {
    if (status === "completed") return "SUCCEEDED";
    if (status === "cancelled") return "CANCELLED";
    if (status === "failed") return "FAILED_OR_CANCELLED";
    return undefined;
}

function hasProviderTask(input: DreaminaRuntimeJournalSnapshot) {
    return Boolean(input.submitId) || input.receiptRecorded === true;
}

function isAmbiguousOfficialFailure(input: DreaminaRuntimeJournalSnapshot) {
    return input.officialStatus === "failed"
        || input.errorCode === "dreamina_official_failed"
        || input.errorCode === "dreamina_official_incomplete";
}

function isLocalSyncErrorCode(code: string) {
    return /(?:query|transport|parse|state_busy|state_fenced|login|session|unknown|origin_not_trusted)/.test(code)
        && !/^dreamina_official_/.test(code);
}

function assertObservation(observation: DreaminaProviderObservation) {
    if (!Number.isFinite(Date.parse(observation.observedAt))) throw new DreaminaTaskTransitionError("Dreamina provider observation timestamp is invalid");
    if (observation.fenceEpoch !== undefined && (!Number.isSafeInteger(observation.fenceEpoch) || observation.fenceEpoch < 0)) {
        throw new DreaminaTaskTransitionError("Dreamina provider observation fence epoch is invalid");
    }
}

function assertSafeErrorCode(code: string) {
    if (!/^[a-z][a-z0-9_]{2,80}$/.test(code)) throw new DreaminaTaskTransitionError("Dreamina sync error code is invalid");
}

function lifecycleError(from: DreaminaTaskLifecycle, to: DreaminaTaskLifecycle) {
    return new DreaminaTaskTransitionError(`Dreamina task lifecycle transition ${from} -> ${to} is forbidden`);
}
