import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { acquireStateLock } from "../src/dreamina-cli-state.js";
import { DreaminaTaskReconciler } from "../src/dreamina-task-reconciler.js";

const ownerId = "owner-reconciler-fixture-0001";
const accepted = (id: string, overrides: Record<string, unknown> = {}) => ({
    ownerId,
    idempotencyKey: id,
    requestHash: "a".repeat(64),
    state: "accepted",
    submitId: `receipt-${id}`,
    accountBinding: "b".repeat(64),
    sessionEpoch: 1,
    updatedAt: "2026-08-13T00:00:00.000Z",
    taskVersion: 1,
    operation: "text2video",
    mode: "video",
    model: "seedance2.0mini",
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
});

async function sandbox() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-reconciler-"));
    return {
        root,
        stateFile: path.join(root, "runtime.json"),
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
}

async function writeState(stateFile: string, records: Array<Record<string, unknown>>) {
    await fs.writeFile(stateFile, JSON.stringify({ version: 1, records }));
}

async function readRecord(stateFile: string, id: string) {
    const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
    return disk.records.find((record) => record.idempotencyKey === id)!;
}

test("two reconcilers coalesce one due task behind one durable poll lease", async () => {
    const box = await sandbox();
    const taskId = "dreamina-reconcile-coalesce-0001";
    await writeState(box.stateFile, [accepted(taskId, { nextPollAt: "2026-08-13T00:00:00.000Z", retryCount: 0 })]);
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const observe = async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
            await gate;
            return { status: "processing" as const, observedAt: "2026-08-13T00:00:01.000Z" };
        } finally {
            active -= 1;
        }
    };
    const options = {
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date("2026-08-13T00:00:01.000Z"),
        startupSpreadMs: 0,
        pollIntervalMs: 1_000,
        pollLeaseMs: 10_000,
        pollLeaseHeartbeatMs: 0,
        observe,
    };
    const left = new DreaminaTaskReconciler(options);
    const right = new DreaminaTaskReconciler(options);
    try {
        const first = left.runDueOnce();
        await waitFor(() => calls === 1);
        const second = right.runDueOnce();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(calls, 1);
        release();
        await Promise.all([first, second]);
        assert.equal(maxActive, 1);
        const record = await readRecord(box.stateFile, taskId);
        assert.equal(record.state, "accepted");
        assert.equal(record.officialStatus, "processing");
        assert.equal(record.lastObservedAt, "2026-08-13T00:00:01.000Z");
        assert.equal(record.retryCount, 0);
        assert.equal(record.pollLease, undefined);
        const nextPollAt = Date.parse(String(record.nextPollAt));
        assert.ok(nextPollAt >= Date.parse("2026-08-13T00:00:02.000Z"));
        assert.ok(nextPollAt <= Date.parse("2026-08-13T00:00:02.500Z"));
    } finally {
        release();
        await Promise.all([left.dispose(), right.dispose()]);
        await box.cleanup();
    }
});

test("dispose aborts a poll-heartbeat state-lock waiter before it can renew", async () => {
    const box = await sandbox();
    const taskId = "dreamina-poll-dispose-abort-0001";
    await writeState(box.stateFile, [accepted(taskId, {
        nextPollAt: "2026-08-13T00:00:00.000Z",
        retryCount: 0,
    })]);

    let observeEntered!: () => void;
    const observing = new Promise<void>((resolve) => { observeEntered = resolve; });
    let releaseObserve!: () => void;
    const observeGate = new Promise<void>((resolve) => { releaseObserve = resolve; });
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date("2026-08-13T00:00:01.000Z"),
        startupSpreadMs: 0,
        pollLeaseMs: 10_000,
        pollLeaseHeartbeatMs: 50,
        observe: async () => {
            observeEntered();
            await observeGate;
            throw Object.assign(new Error("controlled query failure"), { code: "dreamina_query_failed" });
        },
    });

    let renewEntered!: () => void;
    const renewing = new Promise<void>((resolve) => { renewEntered = resolve; });
    let renewSettled!: () => void;
    const renewed = new Promise<void>((resolve) => { renewSettled = resolve; });
    let syncCommitEntered!: () => void;
    const committingSyncError = new Promise<void>((resolve) => { syncCommitEntered = resolve; });
    let completedRenewals = 0;
    let heartbeatSignal: AbortSignal | undefined;
    let heartbeatError: unknown;
    const heartbeat = reconciler as unknown as {
        renewLease(idempotencyKey: string, lease: unknown, signal?: AbortSignal): Promise<void>;
        commitSyncError(idempotencyKey: string, lease: unknown, code: string, signal?: AbortSignal): Promise<unknown>;
    };
    const renewLease = heartbeat.renewLease.bind(reconciler);
    heartbeat.renewLease = async (idempotencyKey, lease, signal) => {
        heartbeatSignal = signal;
        renewEntered();
        try {
            await renewLease(idempotencyKey, lease, signal);
            completedRenewals += 1;
        } catch (error) {
            heartbeatError = error;
            throw error;
        } finally {
            renewSettled();
        }
    };
    const commitSyncError = heartbeat.commitSyncError.bind(reconciler);
    heartbeat.commitSyncError = async (idempotencyKey, lease, code, signal) => {
        syncCommitEntered();
        return commitSyncError(idempotencyKey, lease, code, signal);
    };

    let releaseExternalLock: (() => Promise<void>) | undefined;
    let disposePromise: Promise<void> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await reconciler.start();
        await observing;
        releaseExternalLock = await acquireStateLock(box.stateFile);
        await renewing;
        releaseObserve();
        await committingSyncError;

        disposePromise = reconciler.dispose();
        const heartbeatOutcome = await Promise.race([
            renewed.then(() => "settled" as const),
            new Promise<"timeout">((resolve) => {
                timeout = setTimeout(() => resolve("timeout"), 250);
            }),
        ]);
        if (timeout) clearTimeout(timeout);
        assert.equal(heartbeatOutcome, "settled");
        assert.equal(heartbeatSignal?.aborted, true);
        assert.equal((heartbeatError as { code?: unknown } | undefined)?.code, "dreamina_cancelled");

        await releaseExternalLock();
        releaseExternalLock = undefined;
        await disposePromise;
        disposePromise = undefined;

        assert.equal(completedRenewals, 0);
        const record = await readRecord(box.stateFile, taskId);
        assert.equal(record.state, "accepted");
        assert.equal(record.pollLease, undefined);
        assert.equal(record.errorCode, undefined);
    } finally {
        if (timeout) clearTimeout(timeout);
        releaseObserve();
        await releaseExternalLock?.();
        await disposePromise?.catch(() => undefined);
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("repeated scheduler iterations detach one linked shutdown listener per run", async () => {
    const box = await sandbox();
    const taskId = "dreamina-listener-balance-0001";
    await writeState(box.stateFile, [accepted(taskId, {
        nextPollAt: "2026-08-13T00:00:00.000Z",
        retryCount: 0,
    })]);
    let now = Date.parse("2026-08-13T00:00:01.000Z");
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date(now),
        startupSpreadMs: 0,
        pollIntervalMs: 1,
        pollLeaseHeartbeatMs: 0,
        observe: async () => ({
            status: "processing" as const,
            observedAt: new Date(now).toISOString(),
        }),
    });

    const source = (reconciler as unknown as { shutdown: AbortController }).shutdown.signal;
    const addEventListener = source.addEventListener.bind(source);
    const removeEventListener = source.removeEventListener.bind(source);
    let abortListenerAdds = 0;
    let abortListenerRemoves = 0;
    const addCallsByListener = new Map<EventListenerOrEventListenerObject, number>();
    Object.defineProperty(source, "addEventListener", {
        configurable: true,
        value(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
            if (type === "abort") {
                abortListenerAdds += 1;
                addCallsByListener.set(listener, (addCallsByListener.get(listener) ?? 0) + 1);
            }
            return addEventListener(type, listener, options);
        },
    });
    Object.defineProperty(source, "removeEventListener", {
        configurable: true,
        value(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
            if (type === "abort") abortListenerRemoves += 1;
            return removeEventListener(type, listener, options);
        },
    });

    try {
        for (let iteration = 0; iteration < 6; iteration += 1) {
            assert.equal(await reconciler.runDueOnce(source), true);
            now += 2;
        }
        assert.equal(Math.max(...addCallsByListener.values()), 1);
        assert.equal(abortListenerAdds, abortListenerRemoves);
    } finally {
        Reflect.deleteProperty(source, "addEventListener");
        Reflect.deleteProperty(source, "removeEventListener");
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("manual priority and startup recovery share one fair durable schedule", async () => {
    const box = await sandbox();
    const ids = ["dreamina-reconcile-fair-0001", "dreamina-reconcile-fair-0002", "dreamina-reconcile-fair-0003"];
    await writeState(box.stateFile, ids.map((id) => accepted(id)));
    const order: string[] = [];
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date("2026-08-13T00:00:10.000Z"),
        startupSpreadMs: 0,
        pollIntervalMs: 1_000,
        observe: async (record) => {
            order.push(record.idempotencyKey);
            return { status: "pending" as const, observedAt: "2026-08-13T00:00:10.000Z" };
        },
    });
    try {
        await reconciler.initialize();
        await reconciler.requestNow(ids[2]!);
        await reconciler.runDueOnce();
        await reconciler.runDueOnce();
        await reconciler.runDueOnce();
        assert.equal(order[0], ids[2]);
        assert.deepEqual(new Set(order), new Set(ids));
        for (const id of ids) {
            const record = await readRecord(box.stateFile, id);
            assert.equal(typeof record.nextPollAt, "string");
            assert.equal(record.retryCount, 0);
        }
    } finally {
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("completed durable outputs are not re-queried while completed records missing outputs remain repairable", async () => {
    const box = await sandbox();
    const completeId = "dreamina-reconcile-complete-outputs-0001";
    const repairId = "dreamina-reconcile-missing-outputs-0001";
    const providerOutputs = [{
        outputIndex: 0,
        mediaType: "video",
        providerArtifactRef: "dreamina-provider-artifact:00000000-0000-4000-8000-000000000001:0",
    }];
    await writeState(box.stateFile, [
        accepted(completeId, {
            state: "succeeded",
            officialStatus: "completed",
            providerOutputs,
        }),
        accepted(repairId, {
            state: "succeeded",
            officialStatus: "completed",
            errorCode: "dreamina_query_materialization_retry",
        }),
    ]);
    const observed: string[] = [];
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date("2026-08-13T00:00:10.000Z"),
        startupSpreadMs: 0,
        observe: async (record) => {
            observed.push(record.idempotencyKey);
            return {
                status: "completed" as const,
                observedAt: "2026-08-13T00:00:10.000Z",
                providerOutputs,
            };
        },
    });
    try {
        await reconciler.requestNow(completeId);
        await reconciler.requestNow(repairId);
        assert.equal(await reconciler.runDueOnce(), true);
        assert.deepEqual(observed, [repairId]);

        const complete = await readRecord(box.stateFile, completeId);
        assert.equal(complete.nextPollAt, undefined);
        assert.deepEqual(complete.providerOutputs, providerOutputs);

        const repaired = await readRecord(box.stateFile, repairId);
        assert.equal(repaired.state, "succeeded");
        assert.equal(repaired.nextPollAt, undefined);
        assert.equal(repaired.errorCode, undefined);
        assert.deepEqual(repaired.providerOutputs, providerOutputs);
    } finally {
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("transient query errors persist sync retry metadata without changing provider lifecycle", async () => {
    const box = await sandbox();
    const taskId = "dreamina-reconcile-backoff-0001";
    await writeState(box.stateFile, [accepted(taskId, { nextPollAt: "2026-08-13T00:00:00.000Z", retryCount: 0 })]);
    let now = Date.parse("2026-08-13T00:00:10.000Z");
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date(now),
        startupSpreadMs: 0,
        retryBaseMs: 2_000,
        retryMaxMs: 20_000,
        observe: async () => { throw Object.assign(new Error("private transport detail"), { code: "dreamina_query_failed" }); },
    });
    try {
        await reconciler.runDueOnce();
        const first = await readRecord(box.stateFile, taskId);
        assert.equal(first.state, "accepted");
        assert.equal(first.officialStatus, undefined);
        assert.equal(first.errorCode, "dreamina_query_failed");
        assert.equal(first.retryCount, 1);
        assert.equal(first.lastObservedAt, undefined);
        assert.equal(first.nextPollAt, "2026-08-13T00:00:12.000Z");
        assert.equal(JSON.stringify(first).includes("private transport detail"), false);
        now += 2_000;
        await reconciler.runDueOnce();
        const second = await readRecord(box.stateFile, taskId);
        assert.equal(second.state, "accepted");
        assert.equal(second.retryCount, 2);
        assert.equal(second.nextPollAt, "2026-08-13T00:00:16.000Z");
    } finally {
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("reliable cancelled and bare failed observations map terminally while local failures never do", async () => {
    const box = await sandbox();
    const cancelledId = "dreamina-reconcile-cancelled-0001";
    const failedId = "dreamina-reconcile-failed-0001";
    await writeState(box.stateFile, [
        accepted(cancelledId, { nextPollAt: "2026-08-13T00:00:00.000Z" }),
        accepted(failedId, { nextPollAt: "2026-08-13T00:00:00.000Z" }),
    ]);
    const reconciler = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date("2026-08-13T00:00:10.000Z"),
        startupSpreadMs: 0,
        observe: async (record) => ({
            status: record.idempotencyKey === cancelledId ? "cancelled" as const : "failed" as const,
            observedAt: "2026-08-13T00:00:10.000Z",
        }),
    });
    try {
        await reconciler.runDueOnce();
        await reconciler.runDueOnce();
        const cancelled = await readRecord(box.stateFile, cancelledId);
        const failed = await readRecord(box.stateFile, failedId);
        assert.equal(cancelled.state, "cancelled");
        assert.equal(cancelled.officialStatus, "cancelled");
        assert.equal(cancelled.nextPollAt, undefined);
        assert.equal(failed.state, "failed");
        assert.equal(failed.officialStatus, "failed");
        assert.equal(failed.nextPollAt, undefined);
    } finally {
        await reconciler.dispose();
        await box.cleanup();
    }
});

test("expired poll lease takeover fences a late observation from the stale scheduler", async () => {
    const box = await sandbox();
    const taskId = "dreamina-reconcile-fence-0001";
    await writeState(box.stateFile, [accepted(taskId, { nextPollAt: "2026-08-13T00:00:00.000Z" })]);
    let now = Date.parse("2026-08-13T00:00:01.000Z");
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let enteredA = false;
    const left = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date(now),
        pollLeaseMs: 100,
        pollLeaseHeartbeatMs: 0,
        startupSpreadMs: 0,
        observe: async () => {
            enteredA = true;
            await gateA;
            return { status: "completed" as const, observedAt: "2026-08-13T00:00:03.000Z" };
        },
    });
    const right = new DreaminaTaskReconciler({
        ownerId,
        stateFile: box.stateFile,
        now: () => new Date(now),
        pollLeaseMs: 100,
        pollLeaseHeartbeatMs: 0,
        startupSpreadMs: 0,
        observe: async () => ({ status: "processing" as const, observedAt: "2026-08-13T00:00:02.000Z" }),
    });
    try {
        const stale = left.runDueOnce();
        await waitFor(() => enteredA);
        now += 101;
        await right.runDueOnce();
        releaseA();
        await stale;
        const record = await readRecord(box.stateFile, taskId);
        assert.equal(record.state, "accepted");
        assert.equal(record.officialStatus, "processing");
        assert.equal(record.lastObservedAt, "2026-08-13T00:00:02.000Z");
    } finally {
        releaseA();
        await Promise.all([left.dispose(), right.dispose()]);
        await box.cleanup();
    }
});

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for reconciler fixture");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
