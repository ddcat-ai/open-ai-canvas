import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DreaminaCliRuntime } from "../src/dreamina-cli-runtime.js";

const ownerId = "owner-reconciler-runtime-0001";
const installation = { installed: true as const, executable: "dreamina-fixture" };

async function sandbox() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-reconciler-runtime-"));
    return {
        root,
        stateFile: path.join(root, "runtime.json"),
        cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
}

function acceptedRecord(id: string, overrides: Record<string, unknown> = {}) {
    return {
        ownerId,
        idempotencyKey: id,
        requestHash: "a".repeat(64),
        state: "accepted",
        submitId: `receipt-${id}`,
        updatedAt: "2026-08-13T00:00:00.000Z",
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0mini",
        createdAt: "2026-08-13T00:00:00.000Z",
        ...overrides,
    };
}

async function writeState(stateFile: string, records: Array<Record<string, unknown>>) {
    await fs.writeFile(stateFile, JSON.stringify({ version: 1, records }));
}

test("Dreamina manual refresh coalesces through one durable reconciler poll lease across Runtime instances", async () => {
    const box = await sandbox();
    const id = "dreamina-reconciler-manual-0001";
    await writeState(box.stateFile, [acceptedRecord(id, {
        submitId: "receipt-reconciler-manual",
        nextPollAt: "2026-08-13T23:59:59.000Z",
        retryCount: 0,
    })]);
    let queryCalls = 0;
    let sawPollLease = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runProcess = async () => {
        queryCalls += 1;
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        sawPollLease ||= Boolean(disk.records[0]?.pollLease);
        await gate;
        return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
    };
    const makeRuntime = () => new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess,
    });
    const left = makeRuntime();
    const right = makeRuntime();
    try {
        const refreshes = Promise.all([left.refreshTask(id), right.refreshTask(id)]);
        await waitFor(() => queryCalls >= 1);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(queryCalls, 1);
        assert.equal(sawPollLease, true);
        release();
        await refreshes;
    } finally {
        release();
        await Promise.allSettled([left.dispose(), right.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina accepted local background action never writes an official cancellation", async () => {
    const box = await sandbox();
    const id = "dreamina-background-only-0001";
    await writeState(box.stateFile, [acceptedRecord(id, {
        submitId: "receipt-background-only",
        nextPollAt: "2026-08-13T23:59:59.000Z",
        retryCount: 0,
    })]);
    let providerCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            providerCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const task = await runtime.cancelTask(id);
        assert.equal(task.status, "running");
        assert.notEqual(task.errorCode, "dreamina_local_wait_stopped");
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.state, "accepted");
        assert.notEqual(disk.records[0]?.errorCode, "dreamina_local_wait_stopped");
        assert.equal(providerCalls, 0);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina background reconciler converges an official cancellation without any page query", async () => {
    const box = await sandbox();
    const id = "dreamina-background-official-cancel-0001";
    await writeState(box.stateFile, [acceptedRecord(id, {
        submitId: "receipt-background-cancel",
        nextPollAt: "2000-01-01T00:00:00.000Z",
        retryCount: 0,
    })]);
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"cancelled"}', stderr: "" };
        },
    });
    try {
        await (runtime as unknown as { start(): Promise<void> }).start();
        await waitForAsync(async () => {
            const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
            return disk.records[0]?.state === "cancelled";
        });
        assert.equal(queryCalls, 1);
        const task = await runtime.getTask(id);
        assert.equal(task.status, "cancelled");
        assert.equal(task.officialStatus, "cancelled");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Runtime reconciler fixture");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function waitForAsync(condition: () => Promise<boolean>) {
    const deadline = Date.now() + 2_000;
    while (!(await condition())) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Runtime reconciler fixture");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
