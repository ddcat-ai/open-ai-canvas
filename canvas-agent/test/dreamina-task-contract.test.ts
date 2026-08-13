import assert from "node:assert/strict";
import { test } from "node:test";

type ContractState = {
    lifecycle: string;
    terminalOutcome?: string;
    syncState: string;
    resultState: string;
    outputs: unknown[];
    accountBinding?: string;
    context: Record<string, unknown>;
    providerObservation?: Record<string, unknown>;
    lastSyncErrorCode?: string;
};

type ContractModule = {
    reduceDreaminaTask: (state: ContractState, event: Record<string, unknown>) => ContractState;
    dreaminaTaskFromRuntimeJournal: (input: Record<string, unknown>) => ContractState;
};

const moduleUrl = new URL("../src/dreamina-task-contract.ts", import.meta.url).href;
const contract = await import(moduleUrl).catch(() => undefined) as ContractModule | undefined;

function requireContract(): ContractModule {
    assert.ok(contract, "shared Dreamina task contract module must exist");
    assert.equal(typeof contract.reduceDreaminaTask, "function", "shared Dreamina task reducer must exist");
    assert.equal(typeof contract.dreaminaTaskFromRuntimeJournal, "function", "legacy Runtime journal adapter must exist");
    return contract;
}

function base(overrides: Partial<ContractState> = {}): ContractState {
    return {
        lifecycle: "QUEUED_LOCAL",
        syncState: "SYNC_OK",
        resultState: "NOT_AVAILABLE",
        outputs: [],
        context: { scope: "scoped" },
        ...overrides,
    };
}

test("Dreamina shared lifecycle accepts only the specified forward transitions", () => {
    const { reduceDreaminaTask } = requireContract();
    const transitions = [
        ["QUEUED_LOCAL", "SUBMITTING"],
        ["SUBMITTING", "ACCEPTED"],
        ["ACCEPTED", "RUNNING"],
    ] as const;

    for (const [from, to] of transitions) {
        const next = reduceDreaminaTask(base({ lifecycle: from }), { type: "transition", lifecycle: to });
        assert.equal(next.lifecycle, to, `${from} -> ${to}`);
        assert.equal(next.terminalOutcome, undefined);
    }

    const terminal = reduceDreaminaTask(base({ lifecycle: "RUNNING" }), {
        type: "transition",
        lifecycle: "TERMINAL",
        terminalOutcome: "SUCCEEDED",
    });
    assert.equal(terminal.lifecycle, "TERMINAL");
    assert.equal(terminal.terminalOutcome, "SUCCEEDED");
});

test("Dreamina shared lifecycle rejects terminal regression and uncertain resubmission", () => {
    const { reduceDreaminaTask } = requireContract();
    assert.throws(
        () => reduceDreaminaTask(base({ lifecycle: "TERMINAL", terminalOutcome: "SUCCEEDED" }), {
            type: "transition",
            lifecycle: "RUNNING",
        }),
        /lifecycle/i,
    );
    assert.throws(
        () => reduceDreaminaTask(base({ lifecycle: "SUBMISSION_UNCERTAIN", syncState: "SYNC_UNCERTAIN" }), {
            type: "transition",
            lifecycle: "SUBMITTING",
        }),
        /lifecycle/i,
    );
});

test("Dreamina SUBMITTING only permits explicit pre-receipt rejection as a direct terminal transition", () => {
    const { reduceDreaminaTask } = requireContract();
    const rejected = reduceDreaminaTask(base({ lifecycle: "SUBMITTING" }), {
        type: "transition",
        lifecycle: "TERMINAL",
        terminalOutcome: "REJECTED",
    });
    assert.equal(rejected.lifecycle, "TERMINAL");
    assert.equal(rejected.terminalOutcome, "REJECTED");

    for (const terminalOutcome of ["SUCCEEDED", "FAILED", "CANCELLED", "FAILED_OR_CANCELLED"] as const) {
        assert.throws(
            () => reduceDreaminaTask(base({ lifecycle: "SUBMITTING" }), {
                type: "transition",
                lifecycle: "TERMINAL",
                terminalOutcome,
            }),
            /lifecycle/i,
            terminalOutcome,
        );
    }
});

test("Dreamina SUBMISSION_UNCERTAIN cannot terminate without provider observation evidence", () => {
    const { reduceDreaminaTask } = requireContract();
    for (const terminalOutcome of ["SUCCEEDED", "FAILED", "CANCELLED", "FAILED_OR_CANCELLED", "REJECTED"] as const) {
        assert.throws(
            () => reduceDreaminaTask(base({ lifecycle: "SUBMISSION_UNCERTAIN", syncState: "SYNC_UNCERTAIN" }), {
                type: "transition",
                lifecycle: "TERMINAL",
                terminalOutcome,
            }),
            /lifecycle/i,
            terminalOutcome,
        );
    }

    const observed = reduceDreaminaTask(base({ lifecycle: "SUBMISSION_UNCERTAIN", syncState: "SYNC_UNCERTAIN" }), {
        type: "provider_observation",
        observation: {
            source: "query_result",
            observedAt: "2026-08-13T00:03:00.000Z",
            status: "completed",
        },
    });
    assert.equal(observed.lifecycle, "TERMINAL");
    assert.equal(observed.terminalOutcome, "SUCCEEDED");
});

test("Dreamina sync recovery preserves unresolved conflicts but clears recoverable sync states", () => {
    const { reduceDreaminaTask } = requireContract();
    const conflict = reduceDreaminaTask(base({
        lifecycle: "ACCEPTED",
        syncState: "SYNC_CONFLICT",
        lastSyncErrorCode: "dreamina_query_fixture",
    }), { type: "sync_recovered" });
    assert.equal(conflict.syncState, "SYNC_CONFLICT");
    assert.equal(conflict.lastSyncErrorCode, "dreamina_query_fixture");

    for (const syncState of ["SYNC_RETRY_WAIT", "SYNC_BLOCKED_ACCOUNT", "SYNC_UNCERTAIN"] as const) {
        const recovered = reduceDreaminaTask(base({
            lifecycle: "ACCEPTED",
            syncState,
            lastSyncErrorCode: "dreamina_query_fixture",
        }), { type: "sync_recovered" });
        assert.equal(recovered.syncState, "SYNC_OK", syncState);
        assert.equal(recovered.lastSyncErrorCode, undefined, syncState);
    }
});

test("Dreamina rejects wrong-account observations without absorbing their facts", () => {
    const { reduceDreaminaTask } = requireContract();
    const originalObservation = {
        source: "query_result",
        observedAt: "2026-08-13T00:01:00.000Z",
        accountBinding: "account-binding-a",
        fenceEpoch: 4,
        status: "processing",
    };
    const current = base({
        lifecycle: "RUNNING",
        accountBinding: "account-binding-a",
        providerObservation: originalObservation,
    });
    const next = reduceDreaminaTask(current, {
        type: "provider_observation",
        observation: {
            source: "query_result",
            observedAt: "2026-08-13T00:02:00.000Z",
            accountBinding: "account-binding-b",
            fenceEpoch: 5,
            status: "failed",
        },
    });

    assert.equal(next.lifecycle, "RUNNING");
    assert.equal(next.terminalOutcome, undefined);
    assert.equal(next.accountBinding, "account-binding-a");
    assert.deepEqual(next.providerObservation, originalObservation);
    assert.equal(next.syncState, "SYNC_CONFLICT");
});

test("Dreamina bare provider fail is terminal FAILED_OR_CANCELLED, never guessed failed or cancelled", () => {
    const { reduceDreaminaTask } = requireContract();
    const next = reduceDreaminaTask(base({ lifecycle: "RUNNING" }), {
        type: "provider_observation",
        observation: {
            source: "query_result",
            observedAt: "2026-08-13T00:00:00.000Z",
            accountBinding: "account-binding-a",
            fenceEpoch: 7,
            status: "failed",
        },
    });

    assert.equal(next.lifecycle, "TERMINAL");
    assert.equal(next.terminalOutcome, "FAILED_OR_CANCELLED");
    assert.equal(next.syncState, "SYNC_OK");
});

test("Dreamina local query, transport, parse, lock, and login errors change only sync state", () => {
    const { reduceDreaminaTask } = requireContract();
    for (const errorKind of ["query", "transport", "parse", "lock", "login"] as const) {
        const current = base({ lifecycle: "ACCEPTED", accountBinding: "account-binding-a" });
        const next = reduceDreaminaTask(current, {
            type: "sync_error",
            errorKind,
            code: `dreamina_${errorKind}_fixture`,
        });
        assert.equal(next.lifecycle, "ACCEPTED", errorKind);
        assert.equal(next.terminalOutcome, undefined, errorKind);
        assert.equal(next.syncState, "SYNC_RETRY_WAIT", errorKind);
        assert.equal(next.lastSyncErrorCode, `dreamina_${errorKind}_fixture`, errorKind);
    }
});

test("Dreamina legacy_unscoped records never acquire the current project or account", () => {
    const { reduceDreaminaTask } = requireContract();
    const legacy = base({
        lifecycle: "ACCEPTED",
        context: { scope: "legacy_unscoped" },
        accountBinding: undefined,
    });
    const next = reduceDreaminaTask(legacy, {
        type: "bind_context",
        accountBinding: "current-account-must-not-bind",
        context: {
            scope: "scoped",
            projectId: "current-project-must-not-bind",
            nodeId: "current-node-must-not-bind",
        },
    });

    assert.deepEqual(next.context, { scope: "legacy_unscoped" });
    assert.equal(next.accountBinding, undefined);
});

test("Dreamina terminal provider observations never regress and conflicting terminal evidence is fail-closed", () => {
    const { reduceDreaminaTask } = requireContract();
    const succeeded = base({
        lifecycle: "TERMINAL",
        terminalOutcome: "SUCCEEDED",
        resultState: "PENDING_MATERIALIZATION",
    });
    const stale = reduceDreaminaTask(succeeded, {
        type: "provider_observation",
        observation: {
            source: "list_task",
            observedAt: "2026-08-13T00:01:00.000Z",
            status: "processing",
        },
    });
    assert.equal(stale.lifecycle, "TERMINAL");
    assert.equal(stale.terminalOutcome, "SUCCEEDED");

    const conflict = reduceDreaminaTask(succeeded, {
        type: "provider_observation",
        observation: {
            source: "query_result",
            observedAt: "2026-08-13T00:02:00.000Z",
            status: "failed",
        },
    });
    assert.equal(conflict.lifecycle, "TERMINAL");
    assert.equal(conflict.terminalOutcome, "SUCCEEDED");
    assert.equal(conflict.syncState, "SYNC_CONFLICT");
});

test("Dreamina legacy Runtime journal maps unknown and bare official failure into the shared contract without guessing context", () => {
    const { dreaminaTaskFromRuntimeJournal } = requireContract();
    const uncertain = dreaminaTaskFromRuntimeJournal({ state: "unknown", errorCode: "dreamina_submit_timeout" });
    assert.equal(uncertain.lifecycle, "SUBMISSION_UNCERTAIN");
    assert.equal(uncertain.syncState, "SYNC_UNCERTAIN");
    assert.deepEqual(uncertain.context, { scope: "legacy_unscoped" });

    const failed = dreaminaTaskFromRuntimeJournal({
        state: "failed",
        receiptRecorded: true,
        officialStatus: "failed",
        errorCode: "dreamina_official_failed",
    });
    assert.equal(failed.lifecycle, "TERMINAL");
    assert.equal(failed.terminalOutcome, "FAILED_OR_CANCELLED");
});

test("Dreamina legacy Runtime local observation errors remain nonterminal in the shared contract", () => {
    const { dreaminaTaskFromRuntimeJournal } = requireContract();
    for (const errorCode of ["dreamina_query_failed", "local_generation_unknown", "dreamina_state_busy", "dreamina_session_invalid", "origin_not_trusted"] as const) {
        const state = dreaminaTaskFromRuntimeJournal({
            state: "failed",
            receiptRecorded: true,
            errorCode,
        });
        assert.equal(state.lifecycle, "ACCEPTED", errorCode);
        assert.equal(state.terminalOutcome, undefined, errorCode);
        assert.equal(state.syncState, "SYNC_RETRY_WAIT", errorCode);
        assert.equal(state.lastSyncErrorCode, errorCode, errorCode);
    }
});

test("Dreamina legacy local wait stop never becomes an official CANCELLED outcome", () => {
    const { dreaminaTaskFromRuntimeJournal } = requireContract();
    const state = dreaminaTaskFromRuntimeJournal({
        state: "cancelled",
        receiptRecorded: true,
        errorCode: "dreamina_local_wait_stopped",
    });
    assert.equal(state.lifecycle, "ACCEPTED");
    assert.equal(state.terminalOutcome, undefined);
    assert.equal(state.syncState, "SYNC_OK");
});
