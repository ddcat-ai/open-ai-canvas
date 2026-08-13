import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DreaminaCliArbiter } from "../src/dreamina-cli-arbiter.js";
import { DreaminaCliRuntime } from "../src/dreamina-cli-runtime.js";
import { DreaminaCliService } from "../src/dreamina-cli.js";
import { DreaminaCliError } from "../src/dreamina-cli-process.js";

const ownerId = "owner-arbiter-fixture-0001";
const installation = { installed: true as const, executable: "dreamina-fixture" };


test("arbiter replacement recovery is revisioned and fail-closed for equal-revision divergence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-revision-recovery-"));
    const stateFile = path.join(root, "arbiter.json");
    const backupFile = `${stateFile}.replace-backup`;
    const base = {
        version: 1,
        revision: 5,
        nextTicket: 4,
        nextFenceEpoch: 7,
        sessionEpoch: 2,
        accountBinding: "a".repeat(64),
        queue: [],
    };
    try {
        await fs.writeFile(backupFile, JSON.stringify(base));
        await fs.writeFile(stateFile, JSON.stringify(base));
        const arbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1 });
        assert.equal((await arbiter.readSession()).sessionEpoch, 2);
        assert.equal(await exists(backupFile), false);

        await fs.writeFile(backupFile, JSON.stringify(base));
        await fs.writeFile(stateFile, JSON.stringify({
            ...base,
            queue: [{
                requestId: "11111111-1111-4111-8111-111111111111",
                ticket: 3,
                expiresAt: Date.now() + 60_000,
            }],
        }));
        await assert.rejects(arbiter.readSession(), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_arbiter_state_invalid"
        ));
        assert.equal(await exists(backupFile), true);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("arbiter recovery never rolls back or reuses durable ticket fence or session epochs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-revision-progress-"));
    const stateFile = path.join(root, "arbiter.json");
    const backupFile = `${stateFile}.replace-backup`;
    const durable = {
        version: 1,
        revision: 8,
        nextTicket: 9,
        nextFenceEpoch: 12,
        sessionEpoch: 3,
        queue: [],
    };
    try {
        await fs.writeFile(backupFile, JSON.stringify(durable));
        const arbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1 });
        const restored = await arbiter.acquire();
        assert.equal(restored.fenceEpoch, 12);
        await restored.release();
        assert.equal(await exists(backupFile), false);

        const current = JSON.parse(await fs.readFile(stateFile, "utf8")) as Record<string, unknown>;
        await fs.writeFile(backupFile, JSON.stringify({
            ...current,
            revision: Number(current.revision) + 2,
            nextTicket: Number(current.nextTicket) + 2,
            nextFenceEpoch: Number(current.nextFenceEpoch) + 4,
            sessionEpoch: Number(current.sessionEpoch) + 1,
        }));
        await assert.rejects(arbiter.readSession(), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_arbiter_state_invalid"
        ));
        assert.equal(await exists(backupFile), true);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("arbiter recovery scavenges orphan replacement temporaries without using them as committed state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-temp-recovery-"));
    const stateFile = path.join(root, "arbiter.json");
    const committed = {
        version: 1,
        revision: 3,
        nextTicket: 5,
        nextFenceEpoch: 6,
        sessionEpoch: 1,
        queue: [],
    };
    const temporary = `${stateFile}.${process.pid}.11111111-1111-4111-8111-111111111111.tmp`;
    try {
        await fs.writeFile(stateFile, JSON.stringify(committed));
        await fs.writeFile(temporary, JSON.stringify({
            ...committed,
            revision: 99,
            nextFenceEpoch: 999,
        }));
        const arbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1 });
        assert.equal((await arbiter.readSession()).sessionEpoch, 1);
        assert.equal(await exists(temporary), false);
        const lease = await arbiter.acquire();
        assert.equal(lease.fenceEpoch, 6);
        await lease.release();
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("arbiter Windows replacement cleanup faults preserve the committed mutation without reusing its fence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-windows-replace-fault-"));
    const stateFile = path.join(root, "arbiter.json");
    const backupFile = `${stateFile}.replace-backup`;
    const arbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1 });
    const first = await arbiter.acquire();
    const firstEpoch = first.fenceEpoch;
    await first.release();

    const mutableFs = fs as unknown as {
        rename: (...args: any[]) => Promise<void>;
        rm: (...args: any[]) => Promise<void>;
    };
    const originalRename = mutableFs.rename;
    const originalRm = mutableFs.rm;
    let forcedOverwriteDenial = false;
    let forcedBackupCleanupFailure = false;
    mutableFs.rename = async (...args: any[]) => {
        const source = String(args[0]);
        const destination = String(args[1]);
        if (!forcedOverwriteDenial && source.endsWith(".tmp") && destination === stateFile) {
            forcedOverwriteDenial = true;
            throw Object.assign(new Error("fixture overwrite denial"), { code: "EPERM" });
        }
        return originalRename(...args);
    };
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (!forcedBackupCleanupFailure && target === backupFile) {
            forcedBackupCleanupFailure = true;
            throw Object.assign(new Error("fixture backup cleanup denial"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    try {
        const second = await arbiter.acquire();
        assert.equal(second.fenceEpoch, firstEpoch + 1);
        await second.release();
        const third = await arbiter.acquire();
        assert.equal(third.fenceEpoch, firstEpoch + 2);
        await third.release();
        assert.equal(forcedOverwriteDenial, true);
        assert.equal(forcedBackupCleanupFailure, true);
        assert.equal(await exists(backupFile), false);
        assert.equal(await exists(`${stateFile}.lock`), false);
        assert.deepEqual((await fs.readdir(root)).filter((entry) => entry.endsWith(".tmp")), []);
    } finally {
        mutableFs.rename = originalRename;
        mutableFs.rm = originalRm;
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("arbiter session mutations use the injected clock consistently with acquisition", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-injected-clock-"));
    const stateFile = path.join(root, "arbiter.json");
    let now = 1_000;
    const arbiter = new DreaminaCliArbiter({
        stateFile,
        now: () => now,
        leaseMs: 1_000,
        heartbeatMs: 0,
        pollMs: 1,
    });
    try {
        const lease = await arbiter.acquire();
        const bound = await arbiter.commitSession(lease, "b".repeat(64));
        assert.equal(bound.accountBinding, "b".repeat(64));
        assert.equal(bound.sessionEpoch, 1);
        now = 2_001;
        await assert.rejects(arbiter.advanceSession(lease), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_cli_fenced"
        ));
        await lease.release();
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina lifecycle service and Runtime share one FIFO arbiter per physical CLI process", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-service-runtime-"));
    const arbiterFile = path.join(root, "arbiter.json");
    const stateFile = path.join(root, "runtime.json");
    const serviceArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const runtimeArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [acceptedRuntimeRecord("dreamina-service-runtime-query-0001", "receipt-service-runtime-query", "a", "2020-01-01T00:00:00.000Z")],
    }));
    let active = 0;
    let maxActive = 0;
    const events: string[] = [];
    let releaseVersion!: () => void;
    let markQueryIntent!: () => void;
    const versionGate = new Promise<void>((resolve) => { releaseVersion = resolve; });
    const queryIntent = new Promise<void>((resolve) => { markQueryIntent = resolve; });
    const runProcess = async (request: { args: string[] }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const command = request.args[0] ?? "";
        events.push(`start:${command}`);
        try {
            if (command === "--version") await versionGate;
            if (command === "--version") return { exitCode: 0, stdout: '{"version":"1.2.3"}', stderr: "" };
            if (command === "user_credit") return { exitCode: 0, stdout: '{"total_credit":100}', stderr: "" };
            if (command === "query_result") return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
            throw new Error(`unexpected command ${command}`);
        } finally {
            events.push(`end:${command}`);
            active -= 1;
        }
    };
    const service = new DreaminaCliService({
        ownerId,
        arbiter: serviceArbiter,
        discover: async () => installation,
        runProcess,
    });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: runtimeArbiter,
        ensureReady: async () => { markQueryIntent(); },
        discover: async () => installation,
        runProcess,
    });
    try {
        const status = service.status();
        await waitFor(() => events.includes("start:--version"));
        await runtime.start();
        await queryIntent;
        await waitForAsync(async () => (await readArbiterQueueLength(arbiterFile)) === 1);
        releaseVersion();
        await status;
        await waitFor(() => events.includes("start:query_result"));
        assert.equal(maxActive, 1);
        assert.deepEqual(events.filter((event) => event.startsWith("start:")), [
            "start:--version",
            "start:query_result",
            "start:user_credit",
        ]);
    } finally {
        releaseVersion();
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("authenticated status establishes one opaque stable account binding without using provider output identity", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-binding-"));
    const stateFile = path.join(root, "arbiter.json");
    const serviceA = new DreaminaCliService({
        ownerId,
        arbiter: new DreaminaCliArbiter({ stateFile, pollMs: 1 }),
        discover: async () => installation,
        runProcess: async (request) => request.args[0] === "--version"
            ? { exitCode: 0, stdout: '{"version":"1.2.3"}', stderr: "" }
            : { exitCode: 0, stdout: '{"total_credit":100,"account":"must-not-be-used"}', stderr: "" },
    });
    const serviceB = new DreaminaCliService({
        ownerId,
        arbiter: new DreaminaCliArbiter({ stateFile, pollMs: 1 }),
        discover: async () => installation,
        runProcess: async (request) => request.args[0] === "--version"
            ? { exitCode: 0, stdout: '{"version":"1.2.3"}', stderr: "" }
            : { exitCode: 0, stdout: '{"total_credit":999,"account":"different-raw-value"}', stderr: "" },
    });
    try {
        const first = await serviceA.statusWithSession();
        const second = await serviceB.statusWithSession();
        assert.equal(first.status.authenticated, true);
        assert.match(first.session.accountBinding ?? "", /^[a-f0-9]{64}$/);
        assert.equal(second.session.accountBinding, first.session.accountBinding);
        assert.equal(second.session.sessionEpoch, first.session.sessionEpoch);
        assert.equal(JSON.stringify(first.status).includes(first.session.accountBinding!), false);
        assert.equal(first.session.accountBinding, (await new DreaminaCliArbiter({ stateFile }).readSession()).accountBinding);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("logout commits a session fence before releasing the CLI lease so an old-session queued query never spawns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-logout-session-"));
    const arbiterFile = path.join(root, "arbiter.json");
    const stateFile = path.join(root, "runtime.json");
    const serviceArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const runtimeArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    let logoutEntered = false;
    let releaseLogout!: () => void;
    const logoutGate = new Promise<void>((resolve) => { releaseLogout = resolve; });
    const service = new DreaminaCliService({
        ownerId,
        arbiter: serviceArbiter,
        discover: async () => installation,
        runProcess: async (request) => {
            if (request.args[0] === "--version") return { exitCode: 0, stdout: '{"version":"1.2.3"}', stderr: "" };
            if (request.args[0] === "user_credit") return { exitCode: 0, stdout: '{"total_credit":100}', stderr: "" };
            if (request.args[0] === "logout") {
                logoutEntered = true;
                await logoutGate;
                return { exitCode: 0, stdout: "", stderr: "" };
            }
            throw new Error("unexpected lifecycle command");
        },
    });
    const authenticated = await service.statusWithSession();
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-logout-bound-query-0001",
            requestHash: "e".repeat(64),
            state: "accepted",
            submitId: "receipt-old-session-query",
            accountBinding: authenticated.session.accountBinding,
            sessionEpoch: authenticated.session.sessionEpoch,
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z"
        }],
    }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: runtimeArbiter,
        ensureReady: async () => authenticated.session,
        discover: async () => installation,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const logout = service.logout();
        await waitFor(() => logoutEntered);
        const query = runtime.waitForTask("dreamina-logout-bound-query-0001", "video");
        await new Promise((resolve) => setTimeout(resolve, 20));
        releaseLogout();
        await logout;
        await assert.rejects(query, (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
        const after = await runtimeArbiter.readSession();
        assert.equal(after.accountBinding, undefined);
        assert.ok(after.sessionEpoch > authenticated.session.sessionEpoch);
    } finally {
        releaseLogout();
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina CLI invocation is exclusive across two Runtime instances", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-cross-runtime-"));
    const stateFile = path.join(root, "runtime-state.json");
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [
            acceptedRuntimeRecord("dreamina-arbiter-runtime-A-0001", "receipt-arbiter-A", "b", "2099-01-01T00:00:00.000Z"),
            acceptedRuntimeRecord("dreamina-arbiter-runtime-B-0001", "receipt-arbiter-B", "c", "2099-01-01T00:00:00.000Z"),
        ],
    }));
    let active = 0;
    let maxActive = 0;
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runProcess = async () => {
        active += 1;
        entered += 1;
        maxActive = Math.max(maxActive, active);
        try {
            if (entered === 1) await gate;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        } finally {
            active -= 1;
        }
    };
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess,
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess,
    });
    try {
        await Promise.all([
            runtimeA.refreshTask("dreamina-arbiter-runtime-A-0001"),
            runtimeB.refreshTask("dreamina-arbiter-runtime-B-0001"),
        ]);
        await waitFor(() => entered >= 1);
        await new Promise((resolve) => setTimeout(resolve, 40));
        assert.equal(maxActive, 1);
        release();
        await waitFor(() => entered >= 2);
    } finally {
        release();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("arbiter owner release hands off to a queued successor without leaving the state lock", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-release-handoff-"));
    const stateFile = path.join(root, "arbiter.json");
    const ownerArbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1, heartbeatMs: 25, leaseMs: 250 });
    const waiterArbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1, heartbeatMs: 25, leaseMs: 250 });
    try {
        for (let round = 0; round < 20; round += 1) {
            const events: string[] = [];
            const owner = await ownerArbiter.acquire();
            events.push(`owner:${owner.fenceEpoch}`);
            const controller = new AbortController();
            const successorPromise = waiterArbiter.acquire({ signal: controller.signal }).then((lease) => {
                events.push(`successor:${lease.fenceEpoch}`);
                return lease;
            });
            await waitForAsync(async () => (await readArbiterQueueLength(stateFile)) === 1);
            events.push("waiter_queued");
            await owner.release();
            events.push("owner_released");
            const successor = await promiseBeforeAbort(successorPromise, controller, 1_000);
            assert.equal(successor.fenceEpoch, owner.fenceEpoch + 1, JSON.stringify(events));
            await successor.release();
            events.push("successor_released");
            assert.equal(await exists(`${stateFile}.lock`), false, JSON.stringify(events));
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an aborted queued arbiter waiter releases its state-lock activity and does not block the next owner", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-abort-handoff-"));
    const stateFile = path.join(root, "arbiter.json");
    const ownerArbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1, heartbeatMs: 25, leaseMs: 250 });
    const waiterArbiter = new DreaminaCliArbiter({ stateFile, pollMs: 1, heartbeatMs: 25, leaseMs: 250 });
    try {
        for (let round = 0; round < 20; round += 1) {
            const owner = await ownerArbiter.acquire();
            const controller = new AbortController();
            const waiter = waiterArbiter.acquire({ signal: controller.signal });
            await waitForAsync(async () => (await readArbiterQueueLength(stateFile)) === 1);
            controller.abort();
            await assert.rejects(waiter, (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_cancelled");
            await owner.release();
            const nextController = new AbortController();
            const next = await promiseBeforeAbort(waiterArbiter.acquire({ signal: nextController.signal }), nextController, 1_000);
            await next.release();
            assert.equal(await exists(`${stateFile}.lock`), false);
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("expired owner cannot commit a late submit result after another arbiter takes over", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-fence-"));
    const arbiterFile = path.join(root, "arbiter.json");
    const stateA = path.join(root, "runtime-a.json");
    const stateB = path.join(root, "runtime-b.json");
    const arbiterA = new DreaminaCliArbiter({ stateFile: arbiterFile, leaseMs: 100, heartbeatMs: 0, pollMs: 5 });
    const arbiterB = new DreaminaCliArbiter({ stateFile: arbiterFile, leaseMs: 100, heartbeatMs: 0, pollMs: 5 });
    await fs.writeFile(stateB, JSON.stringify({
        version: 1,
        records: [acceptedRuntimeRecord("dreamina-fenced-owner-B-0001", "receipt-owner-B-query", "d", "2020-01-01T00:00:00.000Z")],
    }));
    let submitEntered = false;
    let releaseSubmit!: () => void;
    const submitGate = new Promise<void>((resolve) => { releaseSubmit = resolve; });
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile: stateA,
        arbiter: arbiterA,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            if (input.args[0] !== "text2image") throw new Error("unexpected owner-A command");
            submitEntered = true;
            input.onSpawn?.(4242);
            await submitGate;
            return { exitCode: 0, stdout: '{"submit_id":"receipt-fenced-owner-A"}', stderr: "" };
        },
    });
    let ownerBQueries = 0;
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile: stateB,
        arbiter: arbiterB,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            ownerBQueries += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const late = runtimeA.run({
            operation: "text2image",
            idempotencyKey: "dreamina-fenced-owner-A-0001",
            prompt: "fixture",
            resolutionType: "2k",
        });
        await waitFor(() => submitEntered);
        await new Promise((resolve) => setTimeout(resolve, 140));
        await runtimeB.start();
        await waitFor(() => ownerBQueries === 1);
        releaseSubmit();
        await assert.rejects(late, (error: unknown) => error instanceof DreaminaCliError);

        const disk = JSON.parse(await fs.readFile(stateA, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.state, "pending");
        assert.equal(disk.records[0]?.fenceEpoch, 1);
        assert.equal(disk.records[0]?.submitId, undefined);
        assert.equal(disk.records[0]?.officialStatus, undefined);
    } finally {
        releaseSubmit();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("submit receipt is durably accepted before the invocation lease is released", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-receipt-before-release-"));
    const stateFile = path.join(root, "runtime.json");
    const baseArbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 5 });
    let stateAtFirstRelease: Record<string, unknown> | undefined;
    const arbiter = new Proxy(baseArbiter, {
        get(target, property, receiver) {
            if (property !== "acquire") return Reflect.get(target, property, receiver);
            return async (...args: Parameters<DreaminaCliArbiter["acquire"]>) => {
                const lease = await target.acquire(...args);
                return {
                    ...lease,
                    release: async () => {
                        if (!stateAtFirstRelease) {
                            stateAtFirstRelease = await readJournalRecord(stateFile, "dreamina-receipt-before-release-0001");
                        }
                        await lease.release();
                    },
                };
            };
        },
    }) as DreaminaCliArbiter;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-before-release"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    try {
        const task = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-receipt-before-release-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(task.receiptRecorded, true);
        assert.equal(stateAtFirstRelease?.state, "accepted");
        assert.equal(stateAtFirstRelease?.submitId, "receipt-before-release");
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("a successor invocation can acquire only after the prior receipt is durably accepted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-receipt-successor-fence-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const arbiterA = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    const arbiterB = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    const originalAcquire = arbiterA.acquire.bind(arbiterA);
    let acceptedBeforeSuccessor = false;
    arbiterA.acquire = async (...args: Parameters<DreaminaCliArbiter["acquire"]>) => {
        const lease = await originalAcquire(...args);
        return {
            ...lease,
            release: async () => {
                const record = await readJournalRecord(stateFile, "dreamina-former-owner-0001");
                acceptedBeforeSuccessor = record?.state === "accepted" && record?.submitId === "receipt-former-owner";
                await lease.release();
                const successor = await arbiterB.acquire();
                await successor.release();
            },
        };
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: arbiterA,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-former-owner"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    try {
        const task = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-former-owner-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(task.receiptRecorded, true);
        assert.equal(acceptedBeforeSuccessor, true);
        const record = await readJournalRecord(stateFile, "dreamina-former-owner-0001");
        assert.equal(record?.state, "accepted");
        assert.equal(record?.submitId, "receipt-former-owner");
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("account-A query queued before a session switch never runs in account-B session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-account-"));
    const arbiterFile = path.join(root, "arbiter.json");
    const stateFile = path.join(root, "runtime.json");
    const accountA = "a".repeat(64);
    const accountB = "b".repeat(64);
    const arbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, leaseMs: 5_000, pollMs: 5 });
    const initLease = await arbiter.acquire();
    const sessionA = await arbiter.commitSession(initLease, accountA);
    await initLease.release();
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-account-query-0001",
            requestHash: "c".repeat(64),
            state: "accepted",
            submitId: "receipt-account-query-0001",
            accountBinding: accountA,
            sessionEpoch: sessionA.sessionEpoch,
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z"
        }],
    }));
    let readyEntered = false;
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => {
            readyEntered = true;
            return sessionA;
        },
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    const blocker = await arbiter.acquire();
    try {
        const pending = runtime.waitForTask("dreamina-account-query-0001", "video");
        await waitFor(() => readyEntered);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await arbiter.commitSession(blocker, accountB);
        await blocker.release();

        await assert.rejects(pending, (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.officialStatus, undefined);
    } finally {
        await blocker.release();
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("a second Runtime first load does not recover another Runtime's live pending reservation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-live-reservation-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const arbiterA = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    const arbiterB = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    const blocker = await arbiterB.acquire();
    let submitCalls = 0;
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: arbiterA,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submitCalls += 1;
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-live-reservation"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: arbiterB,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async () => { throw new Error("runtime B must not invoke provider"); },
    });
    try {
        const pending = runtimeA.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-live-reservation-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await waitForAsync(async () => {
            const disk = await readJournalRecord(stateFile, "dreamina-live-reservation-0001");
            return disk?.state === "pending";
        });

        const seenByB = await runtimeB.listTasks();
        assert.equal(seenByB.find((task) => task.id === "dreamina-live-reservation-0001")?.stage, "submitting");
        const afterBLoad = await readJournalRecord(stateFile, "dreamina-live-reservation-0001");
        assert.equal(afterBLoad?.state, "pending");
        assert.equal(typeof afterBLoad?.reservationId, "string");
        assert.equal(typeof afterBLoad?.reservationExpiresAt, "string");

        await blocker.release();
        const accepted = await pending;
        assert.equal(accepted.receiptRecorded, true);
        assert.equal(submitCalls, 1);
    } finally {
        await blocker.release();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an expired pending reservation becomes submission-uncertain and is never resubmitted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-expired-reservation-"));
    const stateFile = path.join(root, "runtime.json");
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-expired-reservation-0001",
            requestHash: "d".repeat(64),
            state: "pending",
            reservationId: "11111111-1111-4111-8111-111111111111",
            reservationExpiresAt: "2026-08-12T23:59:00.000Z",
            updatedAt: "2026-08-12T23:58:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T23:58:00.000Z"
        }],
    }));
    let submitCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        now: () => new Date("2026-08-13T00:00:00.000Z"),
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") submitCalls += 1;
            return { exitCode: 0, stdout: '{"submit_id":"receipt-must-not-replay"}', stderr: "" };
        },
    });
    try {
        const recovered = await runtime.getTask("dreamina-expired-reservation-0001");
        assert.equal(recovered.stage, "submission_unknown");
        assert.equal(submitCalls, 0);
        const sameRequest = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-expired-reservation-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        }, { requestFingerprint: "d".repeat(64) });
        assert.equal(sameRequest.stage, "submission_unknown");
        assert.equal(sameRequest.receiptRecorded, false);
        assert.equal(submitCalls, 0);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("a live reservation heartbeat survives beyond its TTL while waiting for the CLI arbiter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-reservation-heartbeat-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const blockerArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const runtimeArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const observerArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const blocker = await blockerArbiter.acquire();
    let submitCalls = 0;
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: runtimeArbiter,
        reservationLeaseMs: 500,
        reservationHeartbeatMs: 50,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submitCalls += 1;
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-heartbeat"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: observerArbiter,
        reservationLeaseMs: 500,
        reservationHeartbeatMs: 50,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => { throw new Error("observer must not invoke provider"); },
    });
    try {
        const pending = runtimeA.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-heartbeat-reservation-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await waitForAsync(async () => (await readJournalRecord(stateFile, "dreamina-heartbeat-reservation-0001"))?.state === "pending");
        const first = await readJournalRecord(stateFile, "dreamina-heartbeat-reservation-0001");
        const firstExpiry = Date.parse(String(first?.reservationExpiresAt));
        await new Promise((resolve) => setTimeout(resolve, 800));
        const observed = await runtimeB.listTasks();
        const after = await readJournalRecord(stateFile, "dreamina-heartbeat-reservation-0001");
        assert.equal(observed.find((task) => task.id === "dreamina-heartbeat-reservation-0001")?.stage, "submitting");
        assert.equal(after?.state, "pending");
        assert.ok(Date.parse(String(after?.reservationExpiresAt)) > firstExpiry);
        assert.equal(submitCalls, 0);
        await blocker.release();
        assert.equal((await pending).receiptRecorded, true);
        assert.equal(submitCalls, 1);
    } finally {
        await blocker.release();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an expired pre-spawn reservation releases its slot and fences the former owner before spawn", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-reservation-pre-spawn-expiry-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const blockerArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const blocker = await blockerArbiter.acquire();
    let submitCalls = 0;
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 }),
        reservationLeaseMs: 100,
        reservationHeartbeatMs: 0,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-must-not-spawn"}', stderr: "" };
        },
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 }),
        reservationLeaseMs: 100,
        reservationHeartbeatMs: 0,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => { throw new Error("recovery runtime must not invoke provider"); },
    });
    try {
        const attempt = runtimeA.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-expired-reserved-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await waitForAsync(async () => (await readJournalRecord(stateFile, "dreamina-expired-reserved-0001"))?.state === "pending");
        await new Promise((resolve) => setTimeout(resolve, 140));
        const recovered = await runtimeB.getTask("dreamina-expired-reserved-0001");
        assert.equal(recovered.status, "failed");
        assert.equal(recovered.errorCode, "dreamina_interrupted_before_submission");
        await blocker.release();
        await assert.rejects(attempt, (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_cli_fenced");
        assert.equal(submitCalls, 0);
    } finally {
        await blocker.release();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("an expired spawn-permitted reservation becomes submission-uncertain and keeps its slot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-reservation-post-fence-expiry-"));
    const stateFile = path.join(root, "runtime.json");
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-expired-spawn-permitted-0001",
            requestHash: "e".repeat(64),
            state: "pending",
            reservationId: "22222222-2222-4222-8222-222222222222",
            reservationOwnerId: "33333333-3333-4333-8333-333333333333",
            reservationExpiresAt: "2026-08-12T23:59:00.000Z",
            submissionPhase: "spawn_permitted",
            fenceEpoch: 7,
            updatedAt: "2026-08-12T23:58:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T23:58:00.000Z"
        }],
    }));
    let submitCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        now: () => new Date("2026-08-13T00:00:00.000Z"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") submitCalls += 1;
            return { exitCode: 0, stdout: '{"submit_id":"receipt-must-not-replay"}', stderr: "" };
        },
    });
    try {
        const recovered = await runtime.getTask("dreamina-expired-spawn-permitted-0001");
        assert.equal(recovered.stage, "submission_unknown");
        assert.equal(submitCalls, 0);
        const same = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-expired-spawn-permitted-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        }, { requestFingerprint: "e".repeat(64) });
        assert.equal(same.stage, "submission_unknown");
        assert.equal(submitCalls, 0);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("legacy run cannot cross the provider boundary while five durable slots are occupied", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-legacy-five-slots-"));
    const stateFile = path.join(root, "runtime.json");
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: Array.from({ length: 5 }, (_, index) => ({
            ownerId,
            idempotencyKey: `dreamina-legacy-capacity-existing-${index + 1}`,
            requestHash: String(index + 1).repeat(64),
            state: index === 0 ? "accepted" : "unknown",
            ...(index === 0 ? { submitId: "receipt-capacity-existing" } : { errorCode: "dreamina_submission_unknown" }),
            updatedAt: `2026-08-13T00:0${index}:00.000Z`,
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: `2026-08-13T00:0${index}:00.000Z`
        })),
    }));
    let providerCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            providerCalls += 1;
            return { exitCode: 0, stdout: '{"submit_id":"receipt-legacy-over-capacity"}', stderr: "" };
        },
    });
    try {
        await assert.rejects(runtime.run({
            operation: "text2image",
            idempotencyKey: "dreamina-legacy-capacity-new-0001",
            prompt: "fixture",
            resolutionType: "2k",
        }), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_generation_capacity_full");
        assert.equal(providerCalls, 0);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("two Runtime instances reserve at most five durable generation slots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-slots-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const arbiterA = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    const arbiterB = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 });
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: Array.from({ length: 4 }, (_, index) => ({
            ownerId,
            idempotencyKey: `dreamina-existing-slot-${index + 1}`,
            requestHash: String(index + 1).repeat(64),
            state: "unknown",
            updatedAt: `2026-08-13T00:0${index}:00.000Z`,
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: `2026-08-13T00:0${index}:00.000Z`,
            errorCode: "dreamina_submission_unknown"
        })),
    }));
    const submitted: string[] = [];
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const runProcess = async (input: { args: string[]; onSpawn?: (pid: number) => void }) => {
        if (input.args[0] === "text2video") {
            const prompt = input.args.find((arg) => arg.startsWith("--prompt="))!.slice("--prompt=".length);
            submitted.push(prompt);
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-slot-${prompt}` }), stderr: "" };
        }
        return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
    };
    const makeRuntime = (arbiter: DreaminaCliArbiter) => new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 5,
        maxPollAttempts: 2,
        sleep: async () => { await queryGate; },
        runProcess,
    });
    const runtimeA = makeRuntime(arbiterA);
    const runtimeB = makeRuntime(arbiterB);
    try {
        const calls = [runtimeA, runtimeB].map((runtime, index) => runtime.enqueue({
            operation: "text2video",
            idempotencyKey: `dreamina-cross-slot-${index + 5}`,
            prompt: `task-${index + 5}`,
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        }));
        const settled = await Promise.allSettled(calls);
        const outcomes = settled.map((result) => result.status === "fulfilled"
            ? "fulfilled"
            : `rejected:${(result.reason as { code?: string })?.code ?? String(result.reason)}`);
        const diagnosticDisk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const diagnosticRecords = diagnosticDisk.records
            .filter((record) => String(record.idempotencyKey).startsWith("dreamina-cross-slot-"))
            .map((record) => ({
                id: record.idempotencyKey,
                state: record.state,
                fenceEpoch: record.fenceEpoch,
                journalVersion: record.journalVersion,
                hasReceipt: record.submitId !== undefined,
            }));
        assert.deepEqual(outcomes, ["fulfilled", "fulfilled"], JSON.stringify({ outcomes, diagnosticRecords }));
        const tasks = settled.map((result) => {
            if (result.status !== "fulfilled") throw result.reason;
            return result.value;
        });
        assert.equal(submitted.length, 1);
        assert.equal(tasks.filter((task) => task.status === "running").length, 1);
        assert.equal(tasks.filter((task) => task.status === "queued").length, 1);
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const submittedRecord = disk.records.find((record) => record.submitId !== undefined);
        const queuedRecord = disk.records.find((record) => String(record.idempotencyKey).startsWith("dreamina-cross-slot-") && record.state === "queued");
        assert.equal(submittedRecord?.state, "accepted");
        assert.equal(typeof submittedRecord?.fenceEpoch, "number");
        assert.equal(queuedRecord?.fenceEpoch, undefined);
        assert.equal(typeof queuedRecord?.queueOwnerId, "string");
        assert.equal(Number.isFinite(Date.parse(String(queuedRecord?.queueExpiresAt))), true);
    } finally {
        releaseQuery();
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("different tasks may commit sequential increasing fence epochs without fencing each other", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-sequential-epochs-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const makeRuntime = () => new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter: new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 5 }),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2image") {
                const prompt = input.args.find((arg) => arg.startsWith("--prompt="))!.slice("--prompt=".length);
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-epoch-${prompt}` }), stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    const runtimeA = makeRuntime();
    const runtimeB = makeRuntime();
    try {
        await Promise.all([
            runtimeA.run({ operation: "text2image", idempotencyKey: "dreamina-epoch-task-0001", prompt: "one", resolutionType: "2k" }),
            runtimeB.run({ operation: "text2image", idempotencyKey: "dreamina-epoch-task-0002", prompt: "two", resolutionType: "2k" }),
        ]);
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const records = disk.records.filter((record) => String(record.idempotencyKey).startsWith("dreamina-epoch-task-"));
        assert.equal(records.length, 2);
        assert.equal(records.every((record) => record.state === "accepted" && typeof record.fenceEpoch === "number"), true);
        const epochs = records.map((record) => record.fenceEpoch as number).sort((left, right) => left - right);
        assert.equal(epochs[1], epochs[0]! + 1);
    } finally {
        await Promise.allSettled([runtimeA.dispose(), runtimeB.dispose()]);
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("five durable submission-uncertain records retain all slots after Runtime restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-uncertain-slots-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 5 });
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: Array.from({ length: 5 }, (_, index) => ({
            ownerId,
            idempotencyKey: `dreamina-uncertain-slot-${index + 1}`,
            requestHash: String(index + 1).repeat(64),
            state: "unknown",
            updatedAt: `2026-08-13T00:0${index}:00.000Z`,
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: `2026-08-13T00:0${index}:00.000Z`,
            errorCode: "dreamina_submission_unknown"
        })),
    }));
    let submitCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 5,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submitCalls += 1;
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-should-not-submit"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const sixth = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-uncertain-slot-6",
            prompt: "sixth",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(sixth.status, "queued");
        assert.equal(submitCalls, 0);
        assert.equal((await runtime.listTasks()).filter((task) => task.stage === "submission_unknown").length, 5);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

async function readArbiterQueueLength(stateFile: string) {
    try {
        const state = JSON.parse(await fs.readFile(stateFile, "utf8")) as { queue?: unknown[] };
        return state.queue?.length ?? 0;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
        throw error;
    }
}

async function promiseBeforeAbort<T>(promise: Promise<T>, controller: AbortController, timeoutMs: number) {
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await promise;
    } finally {
        globalThis.clearTimeout(timer);
    }
}

async function exists(target: string) {
    try {
        await fs.access(target);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function readJournalRecord(stateFile: string, idempotencyKey: string) {
    try {
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records?: Array<Record<string, unknown>> };
        return disk.records?.find((record) => record.idempotencyKey === idempotencyKey);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

test("legacy run persists its receipt before releasing the invocation lease", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-legacy-receipt-release-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 1 });
    const originalAcquire = arbiter.acquire.bind(arbiter);
    let stateAtRelease: string | undefined;
    (arbiter as unknown as { acquire: DreaminaCliArbiter["acquire"] }).acquire = async (options = {}) => {
        const lease = await originalAcquire(options);
        const originalRelease = lease.release.bind(lease);
        lease.release = async () => {
            const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
            stateAtRelease = String(disk.records[0]?.state);
            await originalRelease();
        };
        return lease;
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-legacy-before-release"}', stderr: "" };
        },
    });
    try {
        await runtime.run({
            operation: "text2image",
            idempotencyKey: "dreamina-legacy-before-release-0001",
            prompt: "fixture",
            resolutionType: "2k",
        });
        assert.equal(stateAtRelease, "accepted");
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("legacy run cannot commit a receipt after its released lease has a successor", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-legacy-successor-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiterFile = path.join(root, "arbiter.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const successorArbiter = new DreaminaCliArbiter({ stateFile: arbiterFile, pollMs: 1 });
    const originalAcquire = arbiter.acquire.bind(arbiter);
    let successor: Awaited<ReturnType<DreaminaCliArbiter["acquire"]>> | undefined;
    let stateWhenSuccessorAcquired: string | undefined;
    (arbiter as unknown as { acquire: DreaminaCliArbiter["acquire"] }).acquire = async (options = {}) => {
        const lease = await originalAcquire(options);
        const originalRelease = lease.release.bind(lease);
        lease.release = async () => {
            await originalRelease();
            successor = await successorArbiter.acquire();
            const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
            stateWhenSuccessorAcquired = String(disk.records[0]?.state);
        };
        return lease;
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-legacy-successor"}', stderr: "" };
        },
    });
    try {
        await runtime.run({
            operation: "text2image",
            idempotencyKey: "dreamina-legacy-successor-0001",
            prompt: "fixture",
            resolutionType: "2k",
        });
        assert.equal(stateWhenSuccessorAcquired, "accepted");
    } finally {
        await successor?.release();
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("accepted provider work persists its account binding and never exposes it in the public task DTO", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-task-binding-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 1 });
    const accountA = "a".repeat(64);
    const lease = await arbiter.acquire();
    const sessionA = await arbiter.commitSession(lease, accountA);
    await lease.release();
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => arbiter.readSession(),
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-account-bound-A"}', stderr: "" };
            }
            await queryGate;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const task = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-account-bound-submit-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const durable = disk.records.find((record) => record.idempotencyKey === "dreamina-account-bound-submit-0001");
        assert.equal(durable?.state, "accepted");
        assert.equal(durable?.accountBinding, accountA);
        assert.equal(durable?.sessionEpoch, sessionA.sessionEpoch);
        assert.equal(JSON.stringify(task).includes(accountA), false);
        assert.equal("accountBinding" in task, false);
    } finally {
        releaseQuery();
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("accepted work is queried only under its bound account across manual refresh and restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-bound-recovery-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 1 });
    const accountA = "a".repeat(64);
    const accountB = "b".repeat(64);
    let lease = await arbiter.acquire();
    const sessionA = await arbiter.commitSession(lease, accountA);
    await lease.release();
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-bound-recovery-0001",
            requestHash: "c".repeat(64),
            state: "accepted",
            submitId: "same-provider-task-id",
            accountBinding: accountA,
            sessionEpoch: sessionA.sessionEpoch,
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z"
        }],
    }));
    lease = await arbiter.acquire();
    await arbiter.commitSession(lease, accountB);
    await lease.release();
    let queryCalls = 0;
    const makeRuntime = () => new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => arbiter.readSession(),
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    const manual = makeRuntime();
    try {
        await assert.rejects(manual.waitForTask("dreamina-bound-recovery-0001", "video"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
        await manual.dispose();

        const restarted = makeRuntime();
        await restarted.getTask("dreamina-bound-recovery-0001");
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(queryCalls, 0);
        await restarted.dispose();

        lease = await arbiter.acquire();
        await arbiter.commitSession(lease, accountA);
        await lease.release();
        const restored = makeRuntime();
        await restored.refreshTask("dreamina-bound-recovery-0001");
        await waitFor(() => queryCalls === 1);
        assert.equal(queryCalls, 1);
        await restored.dispose();
    } finally {
        await manual.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("the same provider task id remains isolated by account binding", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-same-provider-id-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 1 });
    const accountA = "a".repeat(64);
    const accountB = "b".repeat(64);
    let lease = await arbiter.acquire();
    const sessionA = await arbiter.commitSession(lease, accountA);
    await lease.release();
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [accountA, accountB].map((accountBinding, index) => ({
            ownerId,
            idempotencyKey: `dreamina-same-provider-id-${index + 1}`,
            requestHash: String(index + 1).repeat(64),
            state: "accepted",
            submitId: "shared-provider-task-id",
            accountBinding,
            sessionEpoch: sessionA.sessionEpoch,
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z"
        })),
    }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => arbiter.readSession(),
        discover: async () => installation,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        await runtime.refreshTask("dreamina-same-provider-id-1");
        await waitFor(() => queryCalls === 1);
        assert.equal(queryCalls, 1);
        await assert.rejects(runtime.waitForTask("dreamina-same-provider-id-2", "video"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 1);

        lease = await arbiter.acquire();
        await arbiter.commitSession(lease, accountB);
        await lease.release();
        await runtime.refreshTask("dreamina-same-provider-id-2");
        await waitFor(() => queryCalls === 2);
        assert.equal(queryCalls, 2);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("legacy accepted work without an account binding fails closed before any provider query", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-arbiter-unbound-accepted-"));
    const stateFile = path.join(root, "runtime.json");
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(root, "arbiter.json"), pollMs: 1 });
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-unbound-accepted-0001",
            requestHash: "d".repeat(64),
            state: "accepted",
            submitId: "same-provider-task-id",
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z"
        }],
    }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => arbiter.readSession(),
        discover: async () => installation,
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        await assert.rejects(runtime.waitForTask("dreamina-unbound-accepted-0001", "video"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

function acceptedRuntimeRecord(idempotencyKey: string, submitId: string, hashDigit: string, nextPollAt: string) {
    return {
        ownerId,
        idempotencyKey,
        requestHash: hashDigit.repeat(64),
        state: "accepted",
        updatedAt: "2026-08-12T00:00:00.000Z",
        submitId,
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0mini",
        createdAt: "2026-08-12T00:00:00.000Z",
        nextPollAt,
    };
}

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina arbiter fixture");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

async function waitForAsync(condition: () => Promise<boolean>) {
    const deadline = Date.now() + 2_000;
    while (!(await condition())) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina arbiter fixture");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}
