import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    acquireStateLock,
    persistRuntimeDiskState,
    readRuntimeDiskState,
    type RuntimeDiskState,
} from "../src/dreamina-cli-state.js";

type SafeJournalRecord = {
    recordId: string;
    journalVersion: number;
    requestHash: string;
    state: "queued" | "pending" | "accepted" | "succeeded" | "failed" | "cancelled" | "unknown" | "deleted";
    hasProviderTask: boolean;
    taskVersion?: 1;
    operation?: string;
    mode?: "image" | "video";
    model?: string;
    createdAt?: string;
    updatedAt: string;
    errorCode?: string;
    officialStatus?: "pending" | "processing" | "completed" | "failed" | "cancelled";
    accountBinding?: string;
    hidden?: true;
};

type StoredTask = {
    taskId: string;
    visibility?: "visible" | "hidden" | "deleted";
    lifecycle: string;
    terminalOutcome?: string;
    syncState: string;
    resultState: string;
    outputs?: Array<{ outputIndex: number; mediaType: string; materializedAssetId?: string }>;
    context: { scope: string; projectId?: string };
    accountBinding?: string;
    projectedJournalVersion: number;
    version: number;
};

type OutboxEffect = {
    effectKey: string;
    kind: "task.projected" | "task.mutated" | "product.effect";
    taskId: string;
    journalVersion?: number;
    taskVersion: number;
};

type Store = {
    getTask(taskId: string): Promise<StoredTask | undefined>;
    listTasks(): Promise<StoredTask[]>;
    listOutbox(): Promise<OutboxEffect[]>;
    listInbox(): Promise<Array<{ consumerId: string; taskId: string; effectKey: string; state?: string }>>;
    compareAndSwapTask(input: {
        taskId: string;
        expectedVersion: number;
        task: Record<string, unknown>;
        effect: Omit<OutboxEffect, "taskVersion">;
    }): Promise<StoredTask>;
    mutateTask(input: {
        taskId: string;
        expectedVersion: number;
        mutation: Record<string, unknown>;
        effectKey: string;
    }): Promise<StoredTask>;
    claimOutboxEffect(consumerId: string, effectKey: string, leaseMs?: number): Promise<{ leaseToken: string; leaseExpiresAt: string } | undefined>;
    completeOutboxEffect(consumerId: string, effectKey: string, leaseToken: string): Promise<boolean>;
    claimProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseMs?: number;
    }): Promise<
        | { status: "claimed"; leaseToken: string; leaseExpiresAt: string; fence: number }
        | { status: "busy"; retryAt: string }
        | { status: "completed"; result: { materializedAssetId?: string } }
    >;
    renewProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
        leaseMs?: number;
    }): Promise<{ leaseExpiresAt: string; fence: number } | undefined>;
    completeProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
        result: { materializedAssetId?: string };
    }): Promise<boolean>;
    releaseProductEffect(input: {
        consumerId: string;
        taskId: string;
        effectKey: string;
        leaseToken: string;
        fence: number;
    }): Promise<boolean>;
};

type StoreCtor = new (options: { stateFile: string; now?: () => Date; maxTasks?: number; maxEffects?: number }) => Store;
type Projector = {
    recover(): Promise<void>;
    projectJournalVersion(recordId: string, journalVersion: number, record?: SafeJournalRecord): Promise<StoredTask | undefined>;
};
type ProjectorCtor = new (options: {
    store: Store;
    ownerId: string;
    journalFile: string;
    readJournal?: () => Promise<SafeJournalRecord[]>;
}) => Projector;

type StoreModule = {
    DreaminaTaskStore: StoreCtor;
    DreaminaTaskStoreConflictError: new (...args: never[]) => Error;
};
type ProjectionModule = { DreaminaTaskProjector: ProjectorCtor };

const storeModule = await import("../src/dreamina-task-store.ts").catch(() => undefined) as StoreModule | undefined;
const projectionModule = await import("../src/dreamina-task-projection.ts").catch(() => undefined) as ProjectionModule | undefined;

function requireModules() {
    assert.ok(storeModule, "Dreamina durable task store module must exist");
    assert.ok(projectionModule, "Dreamina repeatable task projector module must exist");
    assert.equal(typeof storeModule.DreaminaTaskStore, "function");
    assert.equal(typeof projectionModule.DreaminaTaskProjector, "function");
    return { ...storeModule, ...projectionModule };
}

const ownerId = "owner-task-store-0001";
const timestamp = "2026-08-13T00:00:00.000Z";

function journalRecord(overrides: Partial<SafeJournalRecord> = {}): SafeJournalRecord {
    return {
        recordId: "dreamina-store-task-0001",
        journalVersion: 1,
        requestHash: "a".repeat(64),
        state: "accepted",
        hasProviderTask: true,
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0mini",
        createdAt: timestamp,
        updatedAt: timestamp,
        ...overrides,
    };
}

async function sandbox() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-task-store-"));
    return {
        root,
        storeFile: path.join(root, "task-store.json"),
        journalFile: path.join(root, "runtime-journal.json"),
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
}

test("Dreamina provider journal assigns monotonic journal versions while preserving legacy version-1 records", async () => {
    const box = await sandbox();
    const stateFile = box.journalFile;
    const legacy: RuntimeDiskState = {
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-journal-version-0001",
            requestHash: "b".repeat(64),
            state: "queued",
            updatedAt: timestamp,
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: timestamp,
        }],
    };
    await fs.writeFile(stateFile, JSON.stringify(legacy));
    const release = await acquireStateLock(stateFile);
    try {
        const current = await readRuntimeDiskState(stateFile, ownerId);
        assert(current);
        current.records[0]!.state = "pending";
        current.records[0]!.updatedAt = "2026-08-13T00:01:00.000Z";
        await persistRuntimeDiskState(stateFile, ownerId, current, release);
        const first = await readRuntimeDiskState(stateFile, ownerId);
        assert.equal((first?.records[0] as { journalVersion?: number } | undefined)?.journalVersion, 2);
        await persistRuntimeDiskState(stateFile, ownerId, first!, release);
        const duplicate = await readRuntimeDiskState(stateFile, ownerId);
        assert.equal((duplicate?.records[0] as { journalVersion?: number } | undefined)?.journalVersion, 2);

        const rewritten = structuredClone(duplicate!);
        rewritten.records[0]!.requestHash = "d".repeat(64);
        rewritten.records[0]!.updatedAt = "2026-08-13T00:02:00.000Z";
        await assert.rejects(
            persistRuntimeDiskState(stateFile, ownerId, rewritten, release),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        assert.equal((await readRuntimeDiskState(stateFile, ownerId))?.records[0]?.requestHash, "b".repeat(64));

        const accepted = structuredClone(duplicate!);
        accepted.records[0]!.state = "accepted";
        accepted.records[0]!.submitId = "provider-task-fixture-0001";
        accepted.records[0]!.updatedAt = "2026-08-13T00:03:00.000Z";
        await persistRuntimeDiskState(stateFile, ownerId, accepted, release);
        const durableAccepted = await readRuntimeDiskState(stateFile, ownerId);
        assert.equal(durableAccepted?.records[0]?.journalVersion, 3);

        const missing = structuredClone(durableAccepted!);
        missing.records = [];
        await assert.rejects(
            persistRuntimeDiskState(stateFile, ownerId, missing, release),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        assert.equal((await readRuntimeDiskState(stateFile, ownerId))?.records.length, 1);
    } finally {
        await release();
        await box.cleanup();
    }
});

test("Dreamina submission uncertainty with a durable receipt reconciles only from an official observation", async () => {
    const box = await sandbox();
    const stateFile = box.journalFile;
    const uncertain: RuntimeDiskState = {
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-journal-uncertain-0001",
            requestHash: "9".repeat(64),
            state: "unknown",
            journalVersion: 4,
            submitId: "provider-task-fixture-reconciled",
            updatedAt: timestamp,
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: timestamp,
            errorCode: "dreamina_submission_unknown",
        }],
    };
    await fs.writeFile(stateFile, JSON.stringify(uncertain));
    const release = await acquireStateLock(stateFile);
    try {
        const reliable = structuredClone(uncertain);
        reliable.records[0]!.state = "accepted";
        reliable.records[0]!.errorCode = undefined;
        reliable.records[0]!.officialStatus = "pending";
        reliable.records[0]!.lastObservedAt = "2026-08-13T00:01:00.000Z";
        reliable.records[0]!.updatedAt = "2026-08-13T00:01:00.000Z";
        await persistRuntimeDiskState(stateFile, ownerId, reliable, release);
        const accepted = await readRuntimeDiskState(stateFile, ownerId);
        assert.equal(accepted?.records[0]?.state, "accepted");
        assert.equal(accepted?.records[0]?.journalVersion, 5);
        assert.equal(accepted?.records[0]?.submitId, "provider-task-fixture-reconciled");

        await fs.writeFile(stateFile, JSON.stringify(uncertain));
        const weakGuess = structuredClone(uncertain);
        weakGuess.records[0]!.state = "accepted";
        weakGuess.records[0]!.updatedAt = "2026-08-13T00:02:00.000Z";
        await assert.rejects(
            persistRuntimeDiskState(stateFile, ownerId, weakGuess, release),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        assert.equal((await readRuntimeDiskState(stateFile, ownerId))?.records[0]?.state, "unknown");
    } finally {
        await release();
        await box.cleanup();
    }
});

test("Dreamina restart recovers a durable provider acceptance that crashed before product projection", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const durableJournal = journalRecord({ journalVersion: 4 });
    try {
        // The provider journal is already durable here; the simulated process dies before any task-store write.
        const restartedStore = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const restartedProjector = new DreaminaTaskProjector({
            store: restartedStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [durableJournal],
        });
        await restartedProjector.recover();

        const tasks = await restartedStore.listTasks();
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0]?.taskId, "dreamina:dreamina-store-task-0001");
        assert.equal(tasks[0]?.lifecycle, "ACCEPTED");
        assert.equal(tasks[0]?.projectedJournalVersion, 4);
        assert.deepEqual(tasks[0]?.context, { scope: "legacy_unscoped" });
        assert.equal(tasks[0]?.accountBinding, undefined);
        const serialized = await fs.readFile(box.storeFile, "utf8");
        assert.doesNotMatch(serialized, /submitId|providerTaskId|prompt|stdout|stderr|argv|cookie|token/i);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina journal projection preserves explicit product identity and scoped context", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord({
            clientOperationId: "retry-client-store-task-0001",
            context: {
                scope: "scoped",
                projectId: "project-store-task-0001",
                nodeId: "node-store-task-0001",
                retryOf: "dreamina:prior-store-task-0001",
                attemptGroupId: "dreamina:prior-store-task-0001",
            },
        } as Parameters<typeof journalRecord>[0]));
        assert.equal(projected?.clientOperationId, "retry-client-store-task-0001");
        assert.deepEqual(projected?.context, {
            scope: "scoped",
            projectId: "project-store-task-0001",
            nodeId: "node-store-task-0001",
            retryOf: "dreamina:prior-store-task-0001",
            attemptGroupId: "dreamina:prior-store-task-0001",
        });
    } finally {
        await box.cleanup();
    }
});

test("Dreamina journal projection carries the provider account binding into the product task", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const accountA = "a".repeat(64);
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord({ accountBinding: accountA }));
        assert.equal(projected?.accountBinding, accountA);
        await assert.rejects(projector.projectJournalVersion("dreamina-store-task-0001", 2, journalRecord({
            journalVersion: 2,
            accountBinding: "b".repeat(64),
        })));
        assert.equal((await store.getTask("dreamina:dreamina-store-task-0001"))?.accountBinding, accountA);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina account-blocked sync projects for accepted and succeeded provider lifecycles", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const accepted = await projector.projectJournalVersion("dreamina-account-blocked-accepted", 1, journalRecord({
            recordId: "dreamina-account-blocked-accepted",
            accountBinding: "a".repeat(64),
            errorCode: "dreamina_account_session_changed",
        }));
        assert.equal(accepted?.lifecycle, "ACCEPTED");
        assert.equal(accepted?.syncState, "SYNC_BLOCKED_ACCOUNT");

        const succeeded = await projector.projectJournalVersion("dreamina-account-blocked-succeeded", 1, journalRecord({
            recordId: "dreamina-account-blocked-succeeded",
            state: "succeeded",
            accountBinding: "a".repeat(64),
            errorCode: "dreamina_account_session_changed",
        }));
        assert.equal(succeeded?.lifecycle, "TERMINAL");
        assert.equal(succeeded?.terminalOutcome, "SUCCEEDED");
        assert.equal(succeeded?.syncState, "SYNC_BLOCKED_ACCOUNT");
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task projection is idempotent for duplicate and out-of-order journal versions", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const version3 = journalRecord({ journalVersion: 3, state: "accepted" });
        const first = await projector.projectJournalVersion(version3.recordId, 3, version3);
        const duplicate = await projector.projectJournalVersion(version3.recordId, 3, version3);
        const stale = await projector.projectJournalVersion(version3.recordId, 2, journalRecord({
            journalVersion: 2,
            state: "pending",
            hasProviderTask: false,
        }));

        assert.equal(first?.version, 1);
        assert.equal(duplicate?.version, 1);
        assert.equal(stale?.version, 1);
        const task = await store.getTask("dreamina:dreamina-store-task-0001");
        assert.equal(task?.lifecycle, "ACCEPTED");
        assert.equal(task?.projectedJournalVersion, 3);
        assert.equal(task?.version, 1);
        const outbox = await store.listOutbox();
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0]?.journalVersion, 3);
        assert.equal(outbox[0]?.effectKey, "task.projected:dreamina-cli:dreamina-store-task-0001:3");
        await assert.rejects(projector.projectJournalVersion(version3.recordId, 3, {
            ...version3,
            requestHash: "e".repeat(64),
        }), /identity/i);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product task writes use versioned CAS and cannot overwrite a fresh mutation", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector, DreaminaTaskStoreConflictError } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        assert(projected);
        await assert.rejects(store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: 0,
            mutation: {
                type: "event",
                event: { type: "sync_error", errorKind: "query", code: "dreamina_query_fixture" },
                updatedAt: "2026-08-13T00:01:00.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:stale",
        }), (error: unknown) => error instanceof DreaminaTaskStoreConflictError);
        assert.equal((await store.getTask(projected.taskId))?.version, 1);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product mutations use the shared reducer and cannot rewrite provider-owned facts", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord({
            state: "succeeded",
            officialStatus: "completed",
        }));
        assert(projected);

        await assert.rejects(store.compareAndSwapTask({
            taskId: projected.taskId,
            expectedVersion: projected.version,
            task: { ...projected, lifecycle: "RUNNING", terminalOutcome: undefined },
            effect: {
                effectKey: "task.mutated:dreamina-store-task-0001:raw-regression",
                kind: "task.mutated",
                taskId: projected.taskId,
            },
        }));
        assert.equal(typeof store.mutateTask, "function", "product mutations must use a controlled mutation API");

        const invalidMutations = [
            { type: "event", event: { type: "transition", lifecycle: "RUNNING" }, updatedAt: "2026-08-13T00:01:00.000Z" },
            { type: "event", event: { type: "transition", lifecycle: "TERMINAL", terminalOutcome: "FAILED" }, updatedAt: "2026-08-13T00:01:00.000Z" },
            { type: "provider_facts", officialStatus: "failed", updatedAt: "2026-08-13T00:01:00.000Z" },
            {
                type: "event",
                event: {
                    type: "provider_observation",
                    observation: { source: "query_result", observedAt: "2026-08-13T00:01:00.000Z", status: "failed" },
                },
                updatedAt: "2026-08-13T00:01:00.000Z",
            },
            {
                type: "event",
                event: {
                    type: "bind_context",
                    accountBinding: "current-account-must-not-bind",
                    context: { scope: "scoped", projectId: "current-project-must-not-bind" },
                },
                updatedAt: "2026-08-13T00:01:00.000Z",
            },
            {
                type: "event",
                event: { type: "bind_context", context: { scope: "scoped", projectId: "current-project-must-not-bind" } },
                updatedAt: "2026-08-13T00:01:00.000Z",
            },
        ];
        for (const [index, mutation] of invalidMutations.entries()) {
            await assert.rejects(store.mutateTask({
                taskId: projected.taskId,
                expectedVersion: projected.version,
                mutation,
                effectKey: `task.mutated:dreamina-store-task-0001:invalid-${index}`,
            }), undefined, JSON.stringify(mutation));
        }
        assert.equal((await store.getTask(projected.taskId))?.version, projected.version);
        assert.equal((await store.getTask(projected.taskId))?.officialStatus, "completed");
        assert.equal((await store.getTask(projected.taskId))?.accountBinding, undefined);
        assert.deepEqual((await store.getTask(projected.taskId))?.context, { scope: "legacy_unscoped" });

        const syncFailed = await store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: projected.version,
            mutation: {
                type: "event",
                event: { type: "sync_error", errorKind: "query", code: "dreamina_query_fixture" },
                updatedAt: "2026-08-13T00:01:10.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:sync-error",
        });
        assert.equal(syncFailed.syncState, "SYNC_RETRY_WAIT");
        const syncRecovered = await store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: syncFailed.version,
            mutation: {
                type: "event",
                event: { type: "sync_recovered" },
                updatedAt: "2026-08-13T00:01:20.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:sync-recovered",
        });
        assert.equal(syncRecovered.syncState, "SYNC_OK");

        const materialized = await store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: syncRecovered.version,
            mutation: {
                type: "materialization",
                resultState: "READY",
                outputs: [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-fixture-0001" }],
                updatedAt: "2026-08-13T00:02:00.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:ready",
        });
        assert.equal(materialized.resultState, "READY");
        assert.equal(materialized.terminalOutcome, "SUCCEEDED");
        assert.equal(materialized.officialStatus, "completed");

        const disk = JSON.parse(await fs.readFile(box.storeFile, "utf8")) as { tasks: Array<Record<string, unknown>> };
        disk.tasks[0]!.context = { scope: "scoped", projectId: "project-fixture-0001" };
        await fs.writeFile(box.storeFile, JSON.stringify(disk));
        const scoped = await store.getTask(projected.taskId);
        assert(scoped);
        const contextUpdated = await store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: scoped.version,
            mutation: {
                type: "event",
                event: { type: "bind_context", context: { scope: "scoped", nodeId: "node-fixture-0001" } },
                updatedAt: "2026-08-13T00:03:00.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:context",
        });
        assert.deepEqual(contextUpdated.context, {
            scope: "scoped",
            projectId: "project-fixture-0001",
            nodeId: "node-fixture-0001",
        });
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product mutation lane cannot author provider lifecycle transitions", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    const cases = [
        {
            record: journalRecord({ recordId: "dreamina-authority-accepted-success", requestHash: "1".repeat(64), state: "accepted" }),
            event: { type: "transition", lifecycle: "TERMINAL", terminalOutcome: "SUCCEEDED" },
            lifecycle: "ACCEPTED",
        },
        {
            record: journalRecord({ recordId: "dreamina-authority-accepted-failed", requestHash: "2".repeat(64), state: "accepted" }),
            event: { type: "transition", lifecycle: "TERMINAL", terminalOutcome: "FAILED" },
            lifecycle: "ACCEPTED",
        },
        {
            record: journalRecord({ recordId: "dreamina-authority-accepted-cancelled", requestHash: "3".repeat(64), state: "accepted" }),
            event: { type: "transition", lifecycle: "TERMINAL", terminalOutcome: "CANCELLED" },
            lifecycle: "ACCEPTED",
        },
        {
            record: journalRecord({
                recordId: "dreamina-authority-uncertain-accepted",
                requestHash: "4".repeat(64),
                state: "unknown",
                hasProviderTask: false,
                errorCode: "dreamina_submission_unknown",
            }),
            event: { type: "transition", lifecycle: "ACCEPTED" },
            lifecycle: "SUBMISSION_UNCERTAIN",
        },
        {
            record: journalRecord({
                recordId: "dreamina-authority-submitting-rejected",
                requestHash: "5".repeat(64),
                state: "pending",
                hasProviderTask: false,
            }),
            event: { type: "transition", lifecycle: "TERMINAL", terminalOutcome: "REJECTED" },
            lifecycle: "SUBMITTING",
        },
    ] as const;
    try {
        for (const [index, item] of cases.entries()) {
            const projected = await projector.projectJournalVersion(item.record.recordId, 1, item.record);
            assert(projected);
            assert.equal(projected.lifecycle, item.lifecycle);
            await assert.rejects(store.mutateTask({
                taskId: projected.taskId,
                expectedVersion: projected.version,
                mutation: {
                    type: "event",
                    event: item.event,
                    updatedAt: `2026-08-13T00:0${index + 1}:00.000Z`,
                },
                effectKey: `task.mutated:${item.record.recordId}:provider-authority`,
            }), (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid", JSON.stringify(item.event));
            const unchanged = await store.getTask(projected.taskId);
            assert.equal(unchanged?.lifecycle, item.lifecycle);
            assert.equal(unchanged?.terminalOutcome, undefined);
            assert.equal(unchanged?.version, projected.version);
        }
    } finally {
        await box.cleanup();
    }
});

test("Dreamina higher journal versions cannot regress or contradict an established provider terminal outcome", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const succeeded = await projector.projectJournalVersion("dreamina-store-task-0001", 5, journalRecord({
            journalVersion: 5,
            state: "succeeded",
            officialStatus: "completed",
        }));
        assert.equal(succeeded?.terminalOutcome, "SUCCEEDED");

        const staleNonterminal = await projector.projectJournalVersion("dreamina-store-task-0001", 6, journalRecord({
            journalVersion: 6,
            state: "accepted",
            officialStatus: "processing",
            updatedAt: "2026-08-13T00:06:00.000Z",
        }));
        assert.equal(staleNonterminal?.lifecycle, "TERMINAL");
        assert.equal(staleNonterminal?.terminalOutcome, "SUCCEEDED");
        assert.equal(staleNonterminal?.projectedJournalVersion, 6);

        const contradiction = await projector.projectJournalVersion("dreamina-store-task-0001", 7, journalRecord({
            journalVersion: 7,
            state: "failed",
            officialStatus: "failed",
            errorCode: "dreamina_official_failed",
            updatedAt: "2026-08-13T00:07:00.000Z",
        }));
        assert.equal(contradiction?.lifecycle, "TERMINAL");
        assert.equal(contradiction?.terminalOutcome, "SUCCEEDED");
        assert.equal(contradiction?.syncState, "SYNC_CONFLICT");
        assert.equal(contradiction?.projectedJournalVersion, 7);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina outbox preserves durable mutation order instead of lexicographic journal-version order", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 2, journalRecord({ journalVersion: 2 }));
        await projector.projectJournalVersion("dreamina-store-task-0001", 10, journalRecord({
            journalVersion: 10,
            officialStatus: "processing",
            updatedAt: "2026-08-13T00:10:00.000Z",
        }));
        assert.deepEqual((await store.listOutbox()).map((effect) => effect.journalVersion), [2, 10]);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina local deletion leaves a durable hidden tombstone without changing provider lifecycle", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const accepted = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        assert.equal(accepted?.lifecycle, "ACCEPTED");
        const deleted = await projector.projectJournalVersion("dreamina-store-task-0001", 2, journalRecord({
            journalVersion: 2,
            state: "deleted",
            updatedAt: "2026-08-13T00:02:00.000Z",
        }));
        assert.equal(deleted?.visibility, "deleted");
        assert.equal(deleted?.lifecycle, "ACCEPTED");
        assert.equal(deleted?.terminalOutcome, undefined);
        assert.equal(deleted?.projectedJournalVersion, 2);
        assert.deepEqual(await store.listTasks(), []);

        const stale = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        assert.equal(stale?.visibility, "deleted");
        assert.equal(stale?.lifecycle, "ACCEPTED");
        assert.deepEqual(await store.listTasks(), []);

        const emptyStoreFile = path.join(box.root, "empty-task-store.json");
        const emptyStore = new DreaminaTaskStore({ stateFile: emptyStoreFile, now: () => new Date(timestamp) });
        const emptyProjector = new DreaminaTaskProjector({ store: emptyStore, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
        const tombstone = await emptyProjector.projectJournalVersion("dreamina-deleted-only-0001", 4, journalRecord({
            recordId: "dreamina-deleted-only-0001",
            journalVersion: 4,
            state: "deleted",
            hasProviderTask: true,
        }));
        assert.equal(tombstone?.visibility, "deleted");
        assert.equal(tombstone?.lifecycle, "ACCEPTED");
        assert.equal(tombstone?.terminalOutcome, undefined);
        assert.deepEqual(await emptyStore.listTasks(), []);
        const duplicate = await emptyProjector.projectJournalVersion("dreamina-deleted-only-0001", 4, journalRecord({
            recordId: "dreamina-deleted-only-0001",
            journalVersion: 4,
            state: "deleted",
            hasProviderTask: true,
        }));
        assert.equal(duplicate?.visibility, "deleted");
        const older = await emptyProjector.projectJournalVersion("dreamina-deleted-only-0001", 3, journalRecord({
            recordId: "dreamina-deleted-only-0001",
            journalVersion: 3,
            state: "accepted",
            hasProviderTask: true,
        }));
        assert.equal(older?.visibility, "deleted");
        assert.deepEqual(await emptyStore.listTasks(), []);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina hidden accepted journal projection stays private through terminal updates and old replay", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    for (const terminal of ["cancelled", "succeeded"] as const) {
        const box = await sandbox();
        const id = `dreamina-hidden-projection-${terminal}-0001`;
        const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile });
        const accepted = {
            ownerId,
            idempotencyKey: id,
            requestHash: terminal === "cancelled" ? "b".repeat(64) : "c".repeat(64),
            state: "accepted" as const,
            journalVersion: 1,
            submitId: `receipt-hidden-projection-${terminal}`,
            updatedAt: timestamp,
            taskVersion: 1 as const,
            operation: "text2video",
            mode: "video" as const,
            model: "seedance2.0mini",
            createdAt: timestamp,
            hidden: true as const,
        };
        try {
            await fs.writeFile(box.journalFile, JSON.stringify({ version: 1, records: [accepted] }));
            await projector.recover();
            let task = await store.getTask(`dreamina:${id}`);
            assert.equal(task?.visibility, "hidden");
            assert.equal(task?.lifecycle, "ACCEPTED");
            assert.deepEqual(await store.listTasks(), []);

            await fs.writeFile(box.journalFile, JSON.stringify({
                version: 1,
                records: [{
                    ...accepted,
                    state: terminal,
                    journalVersion: 2,
                    officialStatus: terminal === "succeeded" ? "completed" : "cancelled",
                    errorCode: terminal === "cancelled" ? "dreamina_official_cancelled" : undefined,
                    updatedAt: "2026-08-13T00:02:00.000Z",
                }],
            }));
            await projector.recover();
            task = await store.getTask(`dreamina:${id}`);
            assert.equal(task?.visibility, "hidden");
            assert.equal(task?.lifecycle, "TERMINAL");
            assert.equal(task?.terminalOutcome, terminal === "succeeded" ? "SUCCEEDED" : "CANCELLED");
            assert.deepEqual(await store.listTasks(), []);

            const replayed = await projector.projectJournalVersion(id, 1, {
                recordId: id,
                journalVersion: 1,
                requestHash: accepted.requestHash,
                state: "accepted",
                hasProviderTask: true,
                taskVersion: 1,
                operation: accepted.operation,
                mode: accepted.mode,
                model: accepted.model,
                createdAt: accepted.createdAt,
                updatedAt: accepted.updatedAt,
            });
            assert.equal(replayed?.visibility, "hidden");
            assert.deepEqual(await store.listTasks(), []);
        } finally {
            await box.cleanup();
        }
    }
});

test("Dreamina task store rejects unknown top-level durable fields", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        const disk = JSON.parse(await fs.readFile(box.storeFile, "utf8")) as Record<string, unknown>;
        disk.unexpectedField = true;
        await fs.writeFile(box.storeFile, JSON.stringify(disk));
        await assert.rejects(
            new DreaminaTaskStore({ stateFile: box.storeFile }).getTask("dreamina:dreamina-store-task-0001"),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product CAS rejects duplicate output indexes", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord({
            state: "succeeded",
            officialStatus: "completed",
        }));
        assert(projected);
        await assert.rejects(store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: projected.version,
            mutation: {
                type: "materialization",
                resultState: "READY",
                outputs: [
                    { outputIndex: 0, mediaType: "video", materializedAssetId: "asset-fixture-0001" },
                    { outputIndex: 0, mediaType: "video", materializedAssetId: "asset-fixture-0002" },
                ],
                updatedAt: "2026-08-13T00:01:00.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:duplicate-output",
        }), (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid");
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product CAS emits a mutation outbox and later journal projection preserves product-owned results", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        const projected = await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord({
            state: "succeeded",
            officialStatus: "completed",
        }));
        assert(projected);
        assert.equal(projected.resultState, "PENDING_MATERIALIZATION");

        const conflicted = await projector.projectJournalVersion("dreamina-store-task-0001", 2, journalRecord({
            journalVersion: 2,
            state: "failed",
            officialStatus: "failed",
            errorCode: "dreamina_official_failed",
            updatedAt: "2026-08-13T00:01:00.000Z",
        }));
        assert.equal(conflicted?.syncState, "SYNC_CONFLICT");
        const mutated = await store.mutateTask({
            taskId: projected.taskId,
            expectedVersion: conflicted!.version,
            mutation: {
                type: "materialization",
                resultState: "READY",
                outputs: [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-fixture-0001" }],
                updatedAt: "2026-08-13T00:02:00.000Z",
            },
            effectKey: "task.mutated:dreamina-store-task-0001:materialized",
        });
        assert.equal(mutated.version, 3);
        assert.equal(mutated.resultState, "READY");

        const refreshed = await projector.projectJournalVersion("dreamina-store-task-0001", 3, journalRecord({
            journalVersion: 3,
            state: "succeeded",
            officialStatus: "completed",
            updatedAt: "2026-08-13T00:03:00.000Z",
        }));
        assert.equal(refreshed?.version, 4);
        assert.equal(refreshed?.syncState, "SYNC_CONFLICT");
        assert.equal(refreshed?.resultState, "READY");
        assert.deepEqual(refreshed?.outputs, [{ outputIndex: 0, mediaType: "video", materializedAssetId: "asset-fixture-0001" }]);
        const outbox = await store.listOutbox();
        assert.equal(outbox.find((effect) => effect.effectKey === "task.mutated:dreamina-store-task-0001:materialized")?.kind, "task.mutated");
        assert.equal(outbox.filter((effect) => effect.kind === "task.projected").length, 3);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task mutation and outbox survive a crash and completed delivery stays deduped", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const durableJournal = journalRecord({ journalVersion: 5, officialStatus: "processing" });
    try {
        const beforeCrashStore = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const beforeCrashProjector = new DreaminaTaskProjector({
            store: beforeCrashStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [durableJournal],
        });
        await beforeCrashProjector.recover();
        // Crash point: task mutation + outbox are durable, but no consumer has claimed the notification.

        const restartedStore = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const restartedProjector = new DreaminaTaskProjector({
            store: restartedStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [durableJournal],
        });
        await restartedProjector.recover();

        assert.equal((await restartedStore.listTasks()).length, 1);
        const outbox = await restartedStore.listOutbox();
        assert.equal(outbox.length, 1);
        const effectKey = outbox[0]!.effectKey;
        const lease = await restartedStore.claimOutboxEffect("task-service", effectKey);
        assert(lease?.leaseToken);
        assert.equal(await restartedStore.claimOutboxEffect("task-service", effectKey), undefined);
        assert.equal(await restartedStore.completeOutboxEffect("task-service", effectKey, lease.leaseToken), true);

        const secondRestart = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        assert.equal(await secondRestart.claimOutboxEffect("task-service", effectKey), undefined);
        assert.deepEqual(await secondRestart.listInbox(), [{
            consumerId: "task-service",
            taskId: "dreamina:dreamina-store-task-0001",
            effectKey,
            state: "completed",
        }]);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina outbox delivery requires an expiring durable lease and explicit completion", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    let nowMs = Date.parse(timestamp);
    const now = () => new Date(nowMs);
    try {
        const firstStore = new DreaminaTaskStore({ stateFile: box.storeFile, now });
        const projector = new DreaminaTaskProjector({
            store: firstStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [journalRecord({ journalVersion: 5, officialStatus: "processing" })],
        });
        await projector.recover();
        const effectKey = (await firstStore.listOutbox())[0]!.effectKey;

        const firstLease = await firstStore.claimOutboxEffect("task-service", effectKey, 1_000);
        assert(firstLease?.leaseToken);
        assert.equal(firstLease.leaseExpiresAt, "2026-08-13T00:00:01.000Z");
        // Crash point: lease is durable, but the external effect has not run and no ack was written.

        nowMs += 500;
        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now });
        assert.equal(await restarted.claimOutboxEffect("task-service", effectKey, 1_000), undefined);

        nowMs += 600;
        const successorLease = await restarted.claimOutboxEffect("task-service", effectKey, 1_000);
        assert(successorLease?.leaseToken);
        assert.notEqual(successorLease.leaseToken, firstLease.leaseToken);
        assert.equal(await restarted.completeOutboxEffect("task-service", effectKey, firstLease.leaseToken), false);
        assert.equal(await restarted.completeOutboxEffect("task-service", effectKey, successorLease.leaseToken), true);

        nowMs += 5_000;
        const completedRestart = new DreaminaTaskStore({ stateFile: box.storeFile, now });
        assert.equal(await completedRestart.claimOutboxEffect("task-service", effectKey, 1_000), undefined);
        assert.deepEqual(await completedRestart.listInbox(), [{
            consumerId: "task-service",
            taskId: "dreamina:dreamina-store-task-0001",
            effectKey,
            state: "completed",
        }]);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product effects require a canonical task before creating durable state", async () => {
    const { DreaminaTaskStore } = requireModules();
    const box = await sandbox();
    try {
        const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        await assert.rejects(store.claimProductEffect({
            consumerId: "web-generation-materializer",
            taskId: "dreamina:missing-product-effect-task",
            effectKey: "materialize:dreamina:missing-product-effect-task:0",
            leaseMs: 1_000,
        }), (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid");
        assert.deepEqual(await store.listOutbox(), []);
        assert.deepEqual(await store.listInbox(), []);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product effect leases stay atomically bound to their canonical task", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    try {
        const firstStore = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const secondStore = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        await new DreaminaTaskProjector({
            store: firstStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [journalRecord()],
        }).recover();
        const input = {
            consumerId: "web-generation-materializer",
            taskId: "dreamina:dreamina-store-task-0001",
            effectKey: "materialize:dreamina:dreamina-store-task-0001:0",
            leaseMs: 1_000,
        };

        const claims = await Promise.all([
            firstStore.claimProductEffect(input),
            secondStore.claimProductEffect(input),
        ]);

        assert.deepEqual(claims.map((claim) => claim.status).sort(), ["busy", "claimed"]);
        const claimed = claims.find((claim) => claim.status === "claimed");
        assert(claimed?.status === "claimed");
        assert.deepEqual(await firstStore.listInbox(), [{
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            state: "pending",
        }]);
        assert.equal(await firstStore.completeProductEffect({
            consumerId: input.consumerId,
            taskId: "dreamina:other-task",
            effectKey: input.effectKey,
            leaseToken: claimed.leaseToken,
            fence: claimed.fence,
            result: { materializedAssetId: "asset-durable-id" },
        }), false);
        assert.equal(await firstStore.releaseProductEffect({
            consumerId: input.consumerId,
            taskId: "dreamina:other-task",
            effectKey: input.effectKey,
            leaseToken: claimed.leaseToken,
            fence: claimed.fence,
        }), false);
        assert.equal(await firstStore.completeProductEffect({
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            leaseToken: claimed.leaseToken,
            fence: claimed.fence,
            result: { materializedAssetId: "asset-durable-id" },
        }), true);

        const completed = await secondStore.claimProductEffect(input);
        assert.deepEqual(completed, {
            status: "completed",
            result: { materializedAssetId: "asset-durable-id" },
        });
        assert.equal((await secondStore.listOutbox()).filter((effect) => effect.effectKey === input.effectKey).length, 1);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina product effect renewal preserves ownership and a successor fences the expired lease", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    let nowMs = Date.parse(timestamp);
    const now = () => new Date(nowMs);
    try {
        const firstStore = new DreaminaTaskStore({ stateFile: box.storeFile, now });
        const secondStore = new DreaminaTaskStore({ stateFile: box.storeFile, now });
        await new DreaminaTaskProjector({
            store: firstStore,
            ownerId,
            journalFile: box.journalFile,
            readJournal: async () => [journalRecord()],
        }).recover();
        const input = {
            consumerId: "web-generation-materializer",
            taskId: "dreamina:dreamina-store-task-0001",
            effectKey: "attach-node:dreamina:dreamina-store-task-0001:node-safe-id:0",
            leaseMs: 100,
        };
        const first = await firstStore.claimProductEffect(input);
        assert.equal(first.status, "claimed");
        assert(first.status === "claimed");
        assert.equal(first.fence, 1);
        assert.equal(first.leaseExpiresAt, "2026-08-13T00:00:00.100Z");

        nowMs += 80;
        assert.deepEqual(await firstStore.renewProductEffect({
            ...input,
            leaseToken: first.leaseToken,
            fence: first.fence,
        }), {
            leaseExpiresAt: "2026-08-13T00:00:00.180Z",
            fence: 1,
        });
        nowMs += 40;
        assert.deepEqual(await secondStore.claimProductEffect(input), {
            status: "busy",
            retryAt: "2026-08-13T00:00:00.180Z",
        });

        nowMs += 61;
        const successor = await secondStore.claimProductEffect(input);
        assert.equal(successor.status, "claimed");
        assert(successor.status === "claimed");
        assert.equal(successor.fence, 2);
        assert.equal(await firstStore.completeProductEffect({
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            leaseToken: first.leaseToken,
            fence: first.fence,
            result: {},
        }), false);
        assert.equal(await secondStore.completeProductEffect({
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            leaseToken: successor.leaseToken,
            fence: successor.fence,
            result: {},
        }), true);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina startup recovery scans journal version gaps and advances without replaying older effects", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    let records = [journalRecord({ journalVersion: 1, state: "accepted" })];
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    try {
        await new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => records }).recover();
        records = [journalRecord({
            journalVersion: 3,
            state: "succeeded",
            officialStatus: "completed",
            updatedAt: "2026-08-13T00:03:00.000Z",
        })];
        await new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => records }).recover();

        const task = await store.getTask("dreamina:dreamina-store-task-0001");
        assert.equal(task?.projectedJournalVersion, 3);
        assert.equal(task?.version, 2);
        assert.equal(task?.lifecycle, "TERMINAL");
        assert.equal(task?.terminalOutcome, "SUCCEEDED");
        assert.deepEqual((await store.listOutbox()).map((effect) => effect.journalVersion), [1, 3]);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina journal projection recovers a provider replacement backup before scanning versions", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    await fs.writeFile(`${box.journalFile}.replace-backup`, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-journal-backup-0001",
            requestHash: "c".repeat(64),
            state: "queued",
            journalVersion: 4,
            updatedAt: "2026-08-13T00:04:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: timestamp,
        }],
    }));
    try {
        const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile });
        await projector.recover();
        const task = await store.getTask("dreamina:dreamina-journal-backup-0001");
        assert.equal(task?.projectedJournalVersion, 4);
        assert.equal(task?.lifecycle, "QUEUED_LOCAL");
        await fs.access(box.journalFile);
        await assert.rejects(fs.stat(`${box.journalFile}.replace-backup`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
        await box.cleanup();
    }
});

test("Windows replacement rejects a newer pending inbox revision that changes the lease token at the same fence", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("same-fence-token-task", 1, journalRecord({ recordId: "same-fence-token-task" }));
        const claim = await store.claimProductEffect({
            consumerId: "web-generation-materializer",
            taskId: "dreamina:same-fence-token-task",
            effectKey: "attach-node:dreamina:same-fence-token-task:node-safe-id:0",
            leaseMs: 1_000,
        });
        assert.equal(claim.status, "claimed");
        assert(claim.status === "claimed");

        const previous = JSON.parse(await fs.readFile(box.storeFile, "utf8")) as {
            revision: number;
            inbox: Array<{ fence: number; leaseToken: string; leaseExpiresAt: string }>;
        };
        const changed = structuredClone(previous);
        changed.revision += 1;
        changed.inbox[0]!.leaseToken = "99999999-9999-4999-8999-999999999999";
        changed.inbox[0]!.leaseExpiresAt = "2026-08-13T00:00:02.000Z";
        await fs.writeFile(`${box.storeFile}.replace-backup`, JSON.stringify(previous));
        await fs.writeFile(box.storeFile, JSON.stringify(changed));

        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        await assert.rejects(
            restarted.listInbox(),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        await fs.access(`${box.storeFile}.replace-backup`);
    } finally {
        await box.cleanup();
    }
});

test("released product effect survives a Windows replacement crash after the new state commit", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        const input = {
            consumerId: "web-generation-materializer",
            taskId: "dreamina:dreamina-store-task-0001",
            effectKey: "materialize:dreamina:dreamina-store-task-0001:0",
            leaseMs: 1_000,
        };
        const claim = await store.claimProductEffect(input);
        assert.equal(claim.status, "claimed");
        assert(claim.status === "claimed");
        const previous = await fs.readFile(box.storeFile, "utf8");
        assert.equal(await store.releaseProductEffect({
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            leaseToken: claim.leaseToken,
            fence: claim.fence,
        }), true);
        // Model Windows fallback replacement after temporary -> state commit but before backup deletion.
        await fs.writeFile(`${box.storeFile}.replace-backup`, previous);

        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        assert.deepEqual(await restarted.listInbox(), [{
            consumerId: input.consumerId,
            taskId: input.taskId,
            effectKey: input.effectKey,
            state: "released",
        }]);
        const reclaimed = await restarted.claimProductEffect(input);
        assert.equal(reclaimed.status, "claimed");
        assert(reclaimed.status === "claimed");
        assert.equal(reclaimed.fence, claim.fence + 1);
        await assert.rejects(fs.stat(`${box.storeFile}.replace-backup`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task store compacts released effects before MAX+1 and rejects a non-compactable write before disk corruption", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const options = {
        stateFile: box.storeFile,
        now: () => new Date(timestamp),
        maxTasks: 2,
        maxEffects: 2,
    };
    try {
        const store = new DreaminaTaskStore(options);
        const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
        await projector.projectJournalVersion("capacity-effects-task", 1, journalRecord({ recordId: "capacity-effects-task" }));
        const input = (suffix: string) => ({
            consumerId: "web-generation-materializer",
            taskId: "dreamina:capacity-effects-task",
            effectKey: `attach-node:dreamina:capacity-effects-task:node-${suffix}:0`,
            leaseMs: 1_000,
        });

        const released = await store.claimProductEffect(input("released"));
        assert.equal(released.status, "claimed");
        assert(released.status === "claimed");
        assert.equal(await store.releaseProductEffect({
            ...input("released"),
            leaseToken: released.leaseToken,
            fence: released.fence,
        }), true);
        await store.claimProductEffect(input("pending-a"));
        const beforeCompaction = await fs.readFile(box.storeFile, "utf8");
        await store.claimProductEffect(input("pending-b"));

        // Windows replacement may leave the pre-compaction state as backup after the compacted state committed.
        await fs.writeFile(`${box.storeFile}.replace-backup`, beforeCompaction);
        const restarted = new DreaminaTaskStore(options);
        assert.equal((await restarted.listInbox()).length, 2);
        await assert.rejects(
            restarted.claimProductEffect(input("pending-c")),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );

        const afterRejectedWrite = new DreaminaTaskStore(options);
        assert.equal((await afterRejectedWrite.listInbox()).length, 2);
        assert.ok((await afterRejectedWrite.listOutbox()).length <= 2);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task store never compacts visible completed product tombstones to admit MAX+1", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const options = {
        stateFile: box.storeFile,
        now: () => new Date(timestamp),
        maxTasks: 2,
        maxEffects: 2,
    };
    try {
        const store = new DreaminaTaskStore(options);
        const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
        await projector.projectJournalVersion("capacity-tombstone-task", 1, journalRecord({ recordId: "capacity-tombstone-task" }));
        const input = (suffix: string) => ({
            consumerId: "web-generation-materializer",
            taskId: "dreamina:capacity-tombstone-task",
            effectKey: `attach-message:dreamina:capacity-tombstone-task:message-${suffix}:0`,
            leaseMs: 1_000,
        });
        for (const suffix of ["a", "b"]) {
            const claim = await store.claimProductEffect(input(suffix));
            assert.equal(claim.status, "claimed");
            assert(claim.status === "claimed");
            assert.equal(await store.completeProductEffect({
                ...input(suffix),
                leaseToken: claim.leaseToken,
                fence: claim.fence,
                result: {},
            }), true);
        }
        await assert.rejects(
            store.claimProductEffect(input("c")),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );

        const restarted = new DreaminaTaskStore(options);
        assert.deepEqual(await restarted.claimProductEffect(input("a")), { status: "completed", result: {} });
        assert.deepEqual(await restarted.claimProductEffect(input("b")), { status: "completed", result: {} });
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task store compacts a deleted task at MAX and Windows recovery accepts the bounded progression", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const options = {
        stateFile: box.storeFile,
        now: () => new Date(timestamp),
        maxTasks: 2,
        maxEffects: 8,
    };
    try {
        const store = new DreaminaTaskStore(options);
        const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
        await projector.projectJournalVersion("capacity-task-a", 1, journalRecord({ recordId: "capacity-task-a" }));
        await projector.projectJournalVersion("capacity-task-b", 1, journalRecord({ recordId: "capacity-task-b" }));
        await assert.rejects(
            projector.projectJournalVersion("capacity-task-c", 1, journalRecord({ recordId: "capacity-task-c" })),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );

        await projector.projectJournalVersion("capacity-task-a", 2, journalRecord({
            recordId: "capacity-task-a",
            journalVersion: 2,
            state: "deleted",
            updatedAt: "2026-08-13T00:02:00.000Z",
        }));
        const beforeCompaction = await fs.readFile(box.storeFile, "utf8");
        await projector.projectJournalVersion("capacity-task-c", 1, journalRecord({ recordId: "capacity-task-c" }));
        await fs.writeFile(`${box.storeFile}.replace-backup`, beforeCompaction);

        const restarted = new DreaminaTaskStore(options);
        assert.equal(await restarted.getTask("dreamina:capacity-task-a"), undefined);
        assert.deepEqual((await restarted.listTasks()).map((task) => task.taskId), [
            "dreamina:capacity-task-b",
            "dreamina:capacity-task-c",
        ]);
        await assert.rejects(fs.stat(`${box.storeFile}.replace-backup`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task-store replacement fails closed on divergent equal-revision files", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        const previous = JSON.parse(await fs.readFile(box.storeFile, "utf8")) as { tasks: Array<Record<string, unknown>> };
        await fs.writeFile(`${box.storeFile}.replace-backup`, JSON.stringify(previous));
        const divergent = structuredClone(previous);
        divergent.tasks[0]!.syncState = "SYNC_RETRY_WAIT";
        await fs.writeFile(box.storeFile, JSON.stringify(divergent));

        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        await assert.rejects(
            restarted.getTask("dreamina:dreamina-store-task-0001"),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        await fs.access(`${box.storeFile}.replace-backup`);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task-store replacement rejects a newer revision that drops prior durable effects", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        const previous = await fs.readFile(box.storeFile, "utf8");
        await projector.projectJournalVersion("dreamina-store-task-0001", 2, journalRecord({
            journalVersion: 2,
            officialStatus: "processing",
            updatedAt: "2026-08-13T00:02:00.000Z",
        }));
        const divergent = JSON.parse(await fs.readFile(box.storeFile, "utf8")) as {
            outbox: Array<{ journalVersion: number }>;
        };
        divergent.outbox = divergent.outbox.filter((effect) => effect.journalVersion !== 1);
        await fs.writeFile(`${box.storeFile}.replace-backup`, previous);
        await fs.writeFile(box.storeFile, JSON.stringify(divergent));

        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        await assert.rejects(
            restarted.getTask("dreamina:dreamina-store-task-0001"),
            (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
        );
        await fs.access(`${box.storeFile}.replace-backup`);
    } finally {
        await box.cleanup();
    }
});

test("Dreamina task-store replacement backup restores the last durable transaction after an interrupted replace", async () => {
    const { DreaminaTaskStore, DreaminaTaskProjector } = requireModules();
    const box = await sandbox();
    const store = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
    const projector = new DreaminaTaskProjector({ store, ownerId, journalFile: box.journalFile, readJournal: async () => [] });
    try {
        await projector.projectJournalVersion("dreamina-store-task-0001", 1, journalRecord());
        await fs.rename(box.storeFile, `${box.storeFile}.replace-backup`);

        const restarted = new DreaminaTaskStore({ stateFile: box.storeFile, now: () => new Date(timestamp) });
        const task = await restarted.getTask("dreamina:dreamina-store-task-0001");
        assert.equal(task?.projectedJournalVersion, 1);
        assert.equal((await restarted.listOutbox()).length, 1);
        await assert.rejects(fs.stat(`${box.storeFile}.replace-backup`), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
        await box.cleanup();
    }
});
