import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DreaminaCliArbiter } from "../src/dreamina-cli-arbiter.js";
import { dreaminaCliInputSchema } from "../src/dreamina-cli-contract.js";
import { acquireStateLock, DreaminaCliRuntime, generationArguments, type DreaminaCliRuntimeOptions } from "../src/dreamina-cli-runtime.js";
import { persistRuntimeDiskState, readRuntimeDiskState } from "../src/dreamina-cli-state.js";
import { DreaminaCliError, runDreaminaProcess, type DreaminaProcessRequest } from "../src/dreamina-cli-process.js";
import { DreaminaProviderArtifactStore } from "../src/dreamina-provider-artifacts.js";
import { stageReferences } from "../src/dreamina-cli-staging.js";

const ownerId = "owner-fixture-0001";
const installation = { installed: true as const, executable: "dreamina-fixture" };
const request = {
    operation: "text2image" as const,
    idempotencyKey: "attempt-0001",
    prompt: "a safe fixture",
    ratio: "1:1" as const,
    resolutionType: "2k" as const,
};

test("Dreamina runtime accepts only the operation contract and verified CLI argv", () => {
    assert.equal(dreaminaCliInputSchema.safeParse({ command: "powershell", args: ["whoami"] }).success, false);
    assert.equal(dreaminaCliInputSchema.safeParse({ operation: "text2image", prompt: "fixture" }).success, false);
    assert.equal(dreaminaCliInputSchema.safeParse({ ...request, rawArgs: ["--cookie=private"] }).success, false);

    const parsed = dreaminaCliInputSchema.parse({ ...request, modelVersion: "5.0Pro", generateNum: 2 });
    assert.notEqual(parsed.operation, "query_result");
    if (parsed.operation === "query_result") throw new Error("unexpected query fixture");
    assert.deepEqual(generationArguments(parsed), [
        "text2image",
        "--prompt=a safe fixture",
        "--model_version=5.0Pro",
        "--ratio=1:1",
        "--resolution_type=2k",
        "--generate_num=2",
    ]);
});

test("Dreamina image auto omits resolutionType while explicit tiers and upscale requirements stay strict", () => {
    for (const operation of ["text2image", "image2image"] as const) {
        const value = operation === "text2image"
            ? { operation, idempotencyKey: `attempt-auto-${operation}-0001`, prompt: "fixture", modelVersion: "5.0" as const }
            : { operation, idempotencyKey: `attempt-auto-${operation}-0001`, prompt: "fixture", modelVersion: "5.0" as const, referenceImages: ["C:\\fixture\\reference.png"] };
        const parsed = dreaminaCliInputSchema.parse(value);
        assert.notEqual(parsed.operation, "query_result");
        if (parsed.operation === "query_result") throw new Error("unexpected query fixture");
        assert.equal("resolutionType" in parsed, false);
        assert.equal(generationArguments(parsed).some((arg) => arg.startsWith("--resolution_type=")), false);
    }

    for (const resolutionType of ["1k", "2k", "4k"] as const) {
        const parsed = dreaminaCliInputSchema.parse({
            operation: "text2image",
            idempotencyKey: `attempt-tier-${resolutionType}-0001`,
            prompt: "fixture",
            modelVersion: "5.0Pro",
            resolutionType,
        });
        assert.notEqual(parsed.operation, "query_result");
        if (parsed.operation === "query_result") throw new Error("unexpected query fixture");
        assert.equal(generationArguments(parsed).includes(`--resolution_type=${resolutionType}`), true);
    }

    const imageEdit = dreaminaCliInputSchema.parse({
        operation: "image2image",
        idempotencyKey: "attempt-image-edit-tier-0001",
        prompt: "fixture",
        modelVersion: "5.0Pro",
        resolutionType: "4k",
        referenceImages: ["C:\\fixture\\reference.png"],
    });
    assert.notEqual(imageEdit.operation, "query_result");
    if (imageEdit.operation === "query_result") throw new Error("unexpected query fixture");
    assert.equal(generationArguments(imageEdit).includes("--resolution_type=4k"), true);

    assert.equal(dreaminaCliInputSchema.safeParse({
        operation: "image_upscale",
        idempotencyKey: "attempt-upscale-auto-0001",
        referenceImages: ["C:\\fixture\\reference.png"],
    }).success, false);
    assert.equal(dreaminaCliInputSchema.safeParse({
        operation: "text2image",
        idempotencyKey: "attempt-auto-string-0001",
        prompt: "fixture",
        modelVersion: "5.0",
        resolutionType: "auto",
    }).success, false);
    assert.equal(dreaminaCliInputSchema.safeParse({
        operation: "text2image",
        idempotencyKey: "attempt-tier-model-limit-0001",
        prompt: "fixture",
        modelVersion: "5.0",
        resolutionType: "1k",
    }).success, false);
});

test("Dreamina legacy query_result is rejected while the scheduler remains the only observation authority", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-scheduler-authority-0001",
            requestHash: "a".repeat(64),
            state: "accepted",
            updatedAt: "2026-08-12T00:00:00.000Z",
            submitId: "receipt-scheduler-authority",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T00:00:00.000Z",
            nextPollAt: "2020-01-01T00:00:00.000Z",
        }],
    }));
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    let queries = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            queries += 1;
            await queryGate;
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    try {
        await runtime.start();
        await waitFor(() => queries === 1);
        const outcome = await Promise.race([
            runtime.run({ operation: "query_result", submitId: "receipt-scheduler-authority" }).then(
                () => ({ kind: "resolved" as const }),
                (error: unknown) => ({
                    kind: "rejected" as const,
                    code: error && typeof error === "object" && "code" in error ? String(error.code) : "unexpected",
                }),
            ),
            new Promise<{ kind: "pending" }>((resolve) => setTimeout(() => resolve({ kind: "pending" }), 100)),
        ]);
        assert.deepEqual(outcome, { kind: "rejected", code: "local_generation_request_invalid" });
        assert.equal(queries, 1);
    } finally {
        releaseQuery();
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina runtime coalesces an owner request and persists no prompt", async () => {
    const box = await sandbox();
    let calls = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            calls += 1;
            input.onSpawn?.(4242);
            await waiting;
            return { exitCode: 0, stdout: '{"submit_id":"receipt-coalesced"}', stderr: "" };
        },
    });
    const pending: Promise<unknown>[] = [];
    try {
        const first = runtime.run(request);
        const replay = runtime.run(request);
        pending.push(first, replay);
        await waitFor(() => calls === 1);
        release();
        assert.deepEqual(await Promise.all([first, replay]), [
            { state: "accepted", submitId: "receipt-coalesced" },
            { state: "accepted", submitId: "receipt-coalesced" },
        ]);
        assert.equal(calls, 1);
        const disk = await fs.readFile(box.stateFile, "utf8");
        assert.equal(disk.includes(request.prompt), false);
        assert.equal(disk.includes("receipt-coalesced"), true);
    } finally {
        release();
        await Promise.allSettled(pending);
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina runtime keeps a coalesced submission alive while another owner waiter remains", async () => {
    const box = await sandbox();
    const firstController = new AbortController();
    let calls = 0;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            calls += 1;
            input.onSpawn?.(4242);
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => reject(new DreaminaCliError("dreamina_cancelled", "cancelled", 499));
                input.signal?.addEventListener("abort", onAbort, { once: true });
                waiting.then(() => {
                    input.signal?.removeEventListener("abort", onAbort);
                    resolve();
                });
            });
            return { exitCode: 0, stdout: '{"submit_id":"receipt-shared"}', stderr: "" };
        },
    });
    const pending: Promise<unknown>[] = [];
    try {
        const first = runtime.run(request, { signal: firstController.signal });
        pending.push(first);
        await waitFor(() => calls === 1);
        const second = runtime.run(request);
        pending.push(second);
        firstController.abort();
        await assert.rejects(
            first,
            (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_cancelled",
        );
        release();
        assert.deepEqual(await second, { state: "accepted", submitId: "receipt-shared" });
        assert.equal(calls, 1);
    } finally {
        firstController.abort();
        release();
        await Promise.allSettled(pending);
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina runtime retries only when the CLI process never spawned", async () => {
    const box = await sandbox();
    let calls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input: DreaminaProcessRequest) => {
            calls += 1;
            if (calls === 1) throw new DreaminaCliError("dreamina_spawn_failed", "not spawned", 503);
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-retry"}', stderr: "" };
        },
    });
    try {
        await assert.rejects(
            runtime.run(request),
            (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_spawn_failed",
        );
        assert.deepEqual(await runtime.run(request), { state: "accepted", submitId: "receipt-retry" });
        assert.equal(calls, 2);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina runtime fences a nonzero submit as a stable unknown outcome and never resubmits", async () => {
    const box = await sandbox();
    let calls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            calls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 1, stdout: "", stderr: "private provider failure" };
        },
    });
    try {
        await assert.rejects(
            runtime.run(request),
            (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_submit_exit_nonzero",
        );
        await assert.rejects(
            runtime.run(request),
            (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_submission_unknown",
        );
        assert.equal(calls, 1);
        assert.equal((await fs.readFile(box.stateFile, "utf8")).includes("private provider failure"), false);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina async submit exposes bounded failure categories without persisting process output", async (context) => {
    const scenarios = [
        {
            name: "spawn failed",
            id: "dreamina-submit-spawn-failed-0001",
            expectedCode: "dreamina_submit_spawn_failed",
            retryable: true,
            runProcess: async () => { throw new DreaminaCliError("dreamina_spawn_failed", "private spawn detail", 503); },
        },
        {
            name: "exit nonzero",
            id: "dreamina-submit-exit-nonzero-0001",
            expectedCode: "dreamina_submit_exit_nonzero",
            retryable: false,
            runProcess: async (input: DreaminaProcessRequest) => {
                input.onSpawn?.(4242);
                return { exitCode: 7, stdout: "private stdout", stderr: "private stderr" };
            },
        },
        {
            name: "deadline",
            id: "dreamina-submit-timeout-0001",
            expectedCode: "dreamina_submit_timeout",
            retryable: false,
            runProcess: async (input: DreaminaProcessRequest) => {
                assert.equal(input.timeoutMs, 45_000);
                input.onSpawn?.(4242);
                throw new DreaminaCliError("dreamina_command_timeout", "private timeout detail", 504);
            },
        },
        {
            name: "receipt missing",
            id: "dreamina-submit-receipt-missing-0001",
            expectedCode: "dreamina_submit_receipt_missing",
            retryable: false,
            runProcess: async (input: DreaminaProcessRequest) => {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"status":"submitted","private":"value"}', stderr: "" };
            },
        },
    ] as const;

    for (const scenario of scenarios) {
        await context.test(scenario.name, async () => {
            const box = await sandbox();
            let calls = 0;
            const runtime = new DreaminaCliRuntime({
                ownerId,
                stateFile: box.stateFile,
                ensureReady: async () => undefined,
                discover: async () => installation,
                runProcess: async (input) => {
                    calls += 1;
                    return scenario.runProcess(input);
                },
            });
            try {
                await assert.rejects(
                    runtime.enqueue({ ...request, idempotencyKey: scenario.id }),
                    (error: unknown) => error instanceof DreaminaCliError && error.code === scenario.expectedCode,
                );
                assert.equal(calls, 1);
                if (scenario.retryable) {
                    await assert.rejects(runtime.getTask(scenario.id), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_task_not_found");
                    await assert.rejects(runtime.enqueue({ ...request, idempotencyKey: scenario.id }), (error: unknown) => error instanceof DreaminaCliError && error.code === scenario.expectedCode);
                    assert.equal(calls, 2);
                } else {
                    const task = await runtime.getTask(scenario.id);
                    assert.equal(task.status, "failed");
                    assert.equal(task.errorCode, scenario.expectedCode);
                    assert.equal(task.receiptRecorded, false);
                }
                const disk = await fs.readFile(box.stateFile, "utf8");
                for (const secret of ["private spawn detail", "private stdout", "private stderr", "private timeout detail", '"private":"value"']) {
                    assert.equal(disk.includes(secret), false);
                }
            } finally {
                await runtime.dispose();
                await box.cleanup();
            }
        });
    }
});

test("Dreamina async submit preserves known pre-spawn failures and allows the same operation to retry", async () => {
    const box = await sandbox();
    let readinessChecks = 0;
    let processCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => {
            readinessChecks += 1;
            throw new DreaminaCliError("dreamina_login_required", "private login detail", 401);
        },
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            throw new Error("must not spawn");
        },
    });
    const input = { ...request, idempotencyKey: "dreamina-pre-spawn-login-0001" };
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await assert.rejects(
                runtime.enqueue(input),
                (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_login_required",
            );
            await assert.rejects(
                runtime.getTask(input.idempotencyKey),
                (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_task_not_found",
            );
        }
        assert.equal(readinessChecks, 2);
        assert.equal(processCalls, 0);
        assert.equal((await fs.readFile(box.stateFile, "utf8")).includes("private login detail"), false);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina async submit does not claim a pre-spawn retry when durable cleanup fails", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rename: (...args: any[]) => Promise<void> };
    const originalRename = mutableFs.rename;
    let processCalls = 0;
    let faultArmed = false;
    let durableFaultInjected = false;
    mutableFs.rename = async (...args: any[]) => {
        if (faultArmed && !durableFaultInjected && String(args[1]) === box.stateFile) {
            durableFaultInjected = true;
            await fs.rm(`${box.stateFile}.lock`, { recursive: true, force: true });
        }
        return originalRename(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => {
            faultArmed = true;
            throw new DreaminaCliError("dreamina_login_required", "private login detail", 401);
        },
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            throw new Error("must not spawn");
        },
    });
    try {
        await assert.rejects(
            runtime.enqueue({
                operation: "image2video",
                idempotencyKey: "dreamina-pre-spawn-persist-0001",
                prompt: "fixture",
                modelVersion: "seedance2.0",
                videoResolution: "720p",
                duration: 4,
                referenceImages: [reference],
            }),
            (error: unknown) => error instanceof DreaminaCliError
                && error.code === "dreamina_state_fenced"
                && !error.message.includes("private login detail"),
        );
        assert.equal(durableFaultInjected, true);
        assert.equal(processCalls, 0);
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), false);
    } finally {
        mutableFs.rename = originalRename;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina async pre-receipt cleanup is retained per attempt across a same-key retry", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let failedTarget = "";
    let allowDeferredCleanup = false;
    let readinessChecks = 0;
    let submitCalls = 0;
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (path.basename(target).startsWith(".dreamina-references-")) {
            if (!failedTarget) failedTarget = target;
            if (target === failedTarget && !allowDeferredCleanup) {
                throw Object.assign(new Error("private async cleanup fixture detail"), { code: "EACCES" });
            }
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => {
            readinessChecks += 1;
            if (readinessChecks === 1) throw new DreaminaCliError("dreamina_login_required", "private login detail", 401);
        },
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "query_result") {
                await queryGate;
                return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
            }
            submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-async-cleanup-retry"}', stderr: "" };
        },
    });
    const input = {
        operation: "image2video" as const,
        idempotencyKey: "dreamina-async-cleanup-retry-0001",
        prompt: "fixture",
        modelVersion: "seedance2.0" as const,
        videoResolution: "720p" as const,
        duration: 4,
        referenceImages: [reference],
    };
    try {
        await assert.rejects(runtime.enqueue(input), (error: unknown) => (
            error instanceof DreaminaCliError
            && error.code === "dreamina_login_required"
            && !error.message.includes("private async cleanup fixture detail")
        ));
        assert.equal(submitCalls, 0);
        assert.notEqual(failedTarget, "");
        await fs.access(failedTarget);

        const retry = await runtime.enqueue(input);
        assert.equal(retry.status, "running");
        assert.equal(submitCalls, 1);
        await fs.access(failedTarget);

        allowDeferredCleanup = true;
        releaseQuery();
        await runtime.dispose();
        await assert.rejects(fs.access(failedTarget), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
        const disk = await fs.readFile(box.stateFile, "utf8");
        assert.doesNotMatch(disk, /private async cleanup fixture detail|private login detail|\.dreamina-references-/i);
    } finally {
        allowDeferredCleanup = true;
        releaseQuery();
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina queued journal persist failure rolls back memory and retains failed staging cleanup per attempt", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as {
        rename: (...args: any[]) => Promise<void>;
        rm: (...args: any[]) => Promise<void>;
    };
    const originalRename = mutableFs.rename;
    const originalRm = mutableFs.rm;
    let failQueuedPersist = true;
    let allowCleanup = false;
    const stagingTargets = new Set<string>();
    let providerCalls = 0;
    mutableFs.rename = async (...args: any[]) => {
        if (failQueuedPersist && String(args[1]) === box.stateFile && String(args[0]).endsWith(".tmp")) {
            failQueuedPersist = false;
            throw Object.assign(new Error("private queued persist fixture detail"), { code: "EIO" });
        }
        return originalRename(...args);
    };
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (path.basename(target).startsWith(".dreamina-references-")) {
            stagingTargets.add(target);
            if (!allowCleanup) throw Object.assign(new Error("private queued cleanup fixture detail"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => { throw new DreaminaCliError("dreamina_login_required", "private login detail", 401); },
        discover: async () => installation,
        runProcess: async () => {
            providerCalls += 1;
            throw new Error("provider must not be called");
        },
    });
    const input = {
        operation: "image2video" as const,
        idempotencyKey: "dreamina-queued-persist-cleanup-0001",
        prompt: "fixture",
        modelVersion: "seedance2.0" as const,
        videoResolution: "720p" as const,
        duration: 4,
        referenceImages: [reference],
    };
    try {
        await assert.rejects(runtime.enqueue(input), (error: unknown) => (
            error instanceof DreaminaCliError
            && error.code === "dreamina_state_invalid"
            && !error.message.includes("private queued cleanup fixture detail")
        ));
        assert.equal(providerCalls, 0);
        await assert.rejects(runtime.getTask(input.idempotencyKey), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_task_not_found"
        ));
        await assert.rejects(runtime.enqueue(input), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_login_required"
        ));
        assert.equal(providerCalls, 0);
        await assert.rejects(runtime.getTask(input.idempotencyKey), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_task_not_found"
        ));
        assert.ok(stagingTargets.size >= 2);
        for (const target of stagingTargets) await fs.access(target);

        allowCleanup = true;
        await runtime.dispose();
        for (const target of stagingTargets) {
            await assert.rejects(fs.access(target), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
        }
        const durable = await fs.readFile(box.stateFile, "utf8").catch(() => "");
        assert.doesNotMatch(durable, /private queued persist fixture detail|private queued cleanup fixture detail|private login detail|\.dreamina-references-/i);
    } finally {
        allowCleanup = true;
        mutableFs.rename = originalRename;
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina queued tombstone retains failed staging cleanup until dispose without provider submission", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    let submitCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "query_result") {
                await queryGate;
                return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
            }
            submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-queued-delete-active"}', stderr: "" };
        },
    });
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let allowCleanup = false;
    let failedTarget = "";
    try {
        await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-queued-delete-active-0001",
            prompt: "active",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        mutableFs.rm = async (...args: any[]) => {
            const target = String(args[0]);
            if (path.basename(target).startsWith(".dreamina-references-")) {
                failedTarget ||= target;
                if (target === failedTarget && !allowCleanup) {
                    throw Object.assign(new Error("private queued delete cleanup fixture detail"), { code: "EACCES" });
                }
            }
            return originalRm(...args);
        };
        const queued = await runtime.enqueue({
            operation: "image2video",
            idempotencyKey: "dreamina-queued-delete-cleanup-0001",
            prompt: "queued",
            modelVersion: "seedance2.0",
            videoResolution: "720p",
            duration: 4,
            referenceImages: [reference],
        });
        assert.equal(queued.status, "queued");
        assert.equal(submitCalls, 1);
        assert.deepEqual(await runtime.deleteTask(queued.id), { deleted: true });
        assert.equal((runtime as unknown as { queueHeartbeats: Map<string, unknown> }).queueHeartbeats.size, 0);
        assert.equal(submitCalls, 1);
        assert.notEqual(failedTarget, "");
        await fs.access(failedTarget);
        assert.equal((await runtime.listTasks()).some((task) => task.id === queued.id), false);
        const deletedDisk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const deletedRecord = deletedDisk.records.find((record) => record.idempotencyKey === queued.id);
        assert.equal(deletedRecord?.state, "deleted");
        assert.equal(deletedRecord?.queueOwnerId, undefined);
        assert.equal(deletedRecord?.queueExpiresAt, undefined);

        allowCleanup = true;
        releaseQuery();
        await runtime.dispose();
        await assert.rejects(fs.access(failedTarget), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
        const durable = await fs.readFile(box.stateFile, "utf8");
        assert.doesNotMatch(durable, /private queued delete cleanup fixture detail|\.dreamina-references-/i);
    } finally {
        allowCleanup = true;
        releaseQuery();
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina receipt acceptance survives local staging cleanup failure without releasing its slot", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let failCleanup = true;
    let submitCalls = 0;
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (failCleanup && path.basename(target).startsWith(".dreamina-references-")) {
            throw Object.assign(new Error("private cleanup fixture detail"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        maxPollAttempts: 2,
        pollIntervalMs: 0,
        runProcess: async (input) => {
            if (input.args[0] === "query_result") {
                await queryGate;
                return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
            }
            submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: `{"submit_id":"provider-task-cleanup-000${submitCalls}"}`, stderr: "" };
        },
    });
    try {
        const first = runtime.enqueue({
            operation: "image2video",
            idempotencyKey: "dreamina-cleanup-after-receipt-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0",
            videoResolution: "720p",
            duration: 4,
            referenceImages: [reference],
        });
        const second = runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-cleanup-after-receipt-0002",
            prompt: "fixture",
            modelVersion: "seedance2.0",
            videoResolution: "720p",
            duration: 4,
        });
        const settled = await Promise.allSettled([first, second]);
        assert.equal(settled[0]?.status, "fulfilled");
        assert.equal(settled[1]?.status, "fulfilled");
        if (settled[0]?.status !== "fulfilled" || settled[1]?.status !== "fulfilled") throw new Error("expected accepted plus queued tasks");
        assert.equal(settled[0].value.status, "running");
        assert.equal(settled[0].value.stage, "submitted");
        assert.equal(settled[0].value.receiptRecorded, true);
        assert.equal(settled[0].value.errorCode, "dreamina_reference_cleanup_failed");
        assert.equal(settled[1].value.status, "queued");
        assert.equal(submitCalls, 1);

        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const durable = disk.records.find((record) => record.idempotencyKey === "dreamina-cleanup-after-receipt-0001");
        assert.equal(durable?.state, "accepted");
        assert.equal(typeof durable?.submitId, "string");
        const serialized = JSON.stringify(durable);
        assert.doesNotMatch(serialized, /private cleanup fixture detail|\.dreamina-references-|input\.png/i);

        failCleanup = false;
        releaseQuery();
        await runtime.dispose();
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), false);
    } finally {
        failCleanup = false;
        releaseQuery();
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina legacy run keeps a durable receipt accepted when post-receipt staging cleanup fails", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let failCleanup = true;
    let submitCalls = 0;
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (failCleanup && path.basename(target).startsWith(".dreamina-references-")) {
            throw Object.assign(new Error("private legacy cleanup fixture detail"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"provider-task-legacy-cleanup-0001"}', stderr: "" };
        },
    });
    const input = {
        operation: "image2image" as const,
        idempotencyKey: "dreamina-legacy-cleanup-0001",
        prompt: "fixture",
        resolutionType: "2k" as const,
        referenceImages: [reference],
    };
    try {
        assert.deepEqual(await runtime.run(input), {
            state: "accepted",
            submitId: "provider-task-legacy-cleanup-0001",
        });
        assert.equal(submitCalls, 1);

        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const durable = disk.records.find((record) => record.idempotencyKey === input.idempotencyKey);
        assert.equal(durable?.state, "accepted");
        assert.equal(durable?.submitId, "provider-task-legacy-cleanup-0001");
        assert.equal(durable?.errorCode, "dreamina_reference_cleanup_failed");
        assert.doesNotMatch(JSON.stringify(durable), /private legacy cleanup fixture detail|\.dreamina-references-|input\.png/i);
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), true);

        assert.deepEqual(await runtime.run(input), {
            state: "accepted",
            submitId: "provider-task-legacy-cleanup-0001",
        });
        assert.equal(submitCalls, 1);

        failCleanup = false;
        await runtime.dispose();
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), false);
    } finally {
        failCleanup = false;
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina legacy run preserves a pre-receipt login error when staging cleanup also fails", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let failCleanup = true;
    let processCalls = 0;
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (failCleanup && path.basename(target).startsWith(".dreamina-references-")) {
            throw Object.assign(new Error("private pre-receipt cleanup detail"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => {
            throw new DreaminaCliError("dreamina_login_required", "private login detail", 401);
        },
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            throw new Error("must not spawn");
        },
    });
    try {
        const error = await runtime.run({
            operation: "image2image",
            idempotencyKey: "dreamina-legacy-pre-receipt-cleanup-0001",
            prompt: "fixture",
            resolutionType: "2k",
            referenceImages: [reference],
        }).then(() => undefined, (failure) => failure as DreaminaCliError);
        assert(error instanceof DreaminaCliError);
        assert.equal(error.code, "dreamina_login_required");
        assert.equal(processCalls, 0);
        await assert.rejects(fs.readFile(box.stateFile, "utf8"), (failure: NodeJS.ErrnoException) => failure.code === "ENOENT");
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), true);

        failCleanup = false;
        await runtime.dispose();
        assert.equal((await fs.readdir(box.root)).some((entry) => entry.startsWith(".dreamina-references-")), false);
    } finally {
        failCleanup = false;
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina deferred staging cleanup is attempt-scoped across a same-key retry", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let firstStaging = "";
    let failFirstCleanup = true;
    let readinessChecks = 0;
    let submitCalls = 0;
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (path.basename(target).startsWith(".dreamina-references-")) {
            firstStaging ||= target;
            if (failFirstCleanup && target === firstStaging) {
                throw Object.assign(new Error("private first-attempt cleanup detail"), { code: "EACCES" });
            }
        }
        return originalRm(...args);
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => {
            readinessChecks += 1;
            if (readinessChecks === 1) {
                throw new DreaminaCliError("dreamina_login_required", "private first-attempt login detail", 401);
            }
        },
        discover: async () => installation,
        runProcess: async (input) => {
            submitCalls += 1;
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"provider-task-same-key-cleanup-0001"}', stderr: "" };
        },
    });
    const input = {
        operation: "image2image" as const,
        idempotencyKey: "dreamina-same-key-cleanup-0001",
        prompt: "fixture",
        resolutionType: "2k" as const,
        referenceImages: [reference],
    };
    try {
        await assert.rejects(runtime.run(input), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_login_required"
        ));
        assert.equal(submitCalls, 0);
        assert(firstStaging);
        await fs.access(firstStaging);

        assert.deepEqual(await runtime.run(input), {
            state: "accepted",
            submitId: "provider-task-same-key-cleanup-0001",
        });
        assert.equal(submitCalls, 1);
        assert.equal((await fs.readdir(box.root)).filter((entry) => entry.startsWith(".dreamina-references-")).length, 1);

        failFirstCleanup = false;
        await runtime.dispose();
        assert.equal((await fs.readdir(box.root)).filter((entry) => entry.startsWith(".dreamina-references-")).length, 0);
    } finally {
        failFirstCleanup = false;
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina staging cleanup remains an explicit failure when no earlier operation failed", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const reference = path.join(owned, "input.png");
    await fs.mkdir(owned);
    await writePng(reference);
    const staged = await stageReferences({
        operation: "image2image",
        idempotencyKey: "dreamina-cleanup-only-0001",
        prompt: "fixture",
        resolutionType: "2k",
        referenceImages: [reference],
    }, [owned], box.root);
    const mutableFs = fs as unknown as { rm: (...args: any[]) => Promise<void> };
    const originalRm = mutableFs.rm;
    let failCleanup = true;
    mutableFs.rm = async (...args: any[]) => {
        const target = String(args[0]);
        if (failCleanup && path.basename(target).startsWith(".dreamina-references-")) {
            throw Object.assign(new Error("private cleanup-only detail"), { code: "EACCES" });
        }
        return originalRm(...args);
    };
    try {
        await assert.rejects(staged.cleanup(), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_reference_cleanup_failed"
        ));
        failCleanup = false;
        await staged.cleanup();
    } finally {
        failCleanup = false;
        mutableFs.rm = originalRm;
        await staged.cleanup().catch(() => undefined);
        await box.cleanup();
    }
});

test("Dreamina runtime stages only real media inside server-owned roots", async () => {
    const box = await sandbox();
    const owned = path.join(box.root, "owned");
    const original = path.join(owned, "input.png");
    const outside = path.join(box.root, "outside.png");
    await fs.mkdir(owned);
    await writePng(original);
    await writePng(outside);
    let stagedPath = "";
    let calls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        referenceRoots: () => [owned],
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            calls += 1;
            input.onSpawn?.(4242);
            stagedPath = input.args.at(-1)?.slice("--images=".length) ?? "";
            assert.notEqual(stagedPath, original);
            assert.deepEqual(await fs.readFile(stagedPath), await fs.readFile(original));
            return { exitCode: 0, stdout: '{"submit_id":"receipt-media"}', stderr: "" };
        },
    });
    const base = { operation: "image2image" as const, prompt: "edit", resolutionType: "2k" as const };
    try {
        assert.deepEqual(
            await runtime.run({ ...base, idempotencyKey: "attempt-media-1", referenceImages: [original] }),
            { state: "accepted", submitId: "receipt-media" },
        );
        await assert.rejects(
            runtime.run({ ...base, idempotencyKey: "attempt-media-2", referenceImages: [outside] }),
            (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_reference_invalid",
        );
        assert.equal(calls, 1);
        await assert.rejects(fs.access(stagedPath), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina legacy query rejects before provider output can enter a public DTO", async () => {
    const box = await sandbox();
    let processCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            return { exitCode: 0, stdout: "{}", stderr: "" };
        },
    });
    try {
        await assert.rejects(
            runtime.run({ operation: "query_result", submitId: "receipt-query-1" }),
            (error: unknown) => error !== null
                && typeof error === "object"
                && "code" in error
                && error.code === "local_generation_request_invalid",
        );
        assert.equal(processCalls, 0);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina materializes an accepted Seedance receipt by query only without a second submission", async () => {
    const box = await sandbox();
    const calls: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            calls.push(input.args[0]);
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-seedance-mini"}', stderr: "" };
            }
            const download = input.args.find((arg) => arg.startsWith("--download_dir="));
            if (!download) return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
            const output = download.slice("--download_dir=".length);
            await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    const materialize = runtime as unknown as {
        generateToResult(input: unknown): Promise<unknown>;
    };
    try {
        assert.deepEqual(await materialize.generateToResult({
            operation: "text2video",
            idempotencyKey: "seedance-materialize-0001",
            prompt: "A short test clip",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        }), {
            mode: "video",
            video: {
                dataUrl: "data:video/mp4;base64,AAAAAGZ0eXAAAAAA",
                mimeType: "video/mp4",
                bytes: 12,
            },
        });
        await waitFor(() => calls.length === 3);
        assert.deepEqual(calls, ["text2video", "query_result", "query_result"]);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina async submit returns after the receipt while result polling continues", async () => {
    const box = await sandbox();
    let releaseQuery!: () => void;
    const queryReady = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const calls: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        pollIntervalMs: 60_000,
        runProcess: async (input) => {
            calls.push(input.args[0]);
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-async-one"}', stderr: "" };
            }
            await queryReady;
            const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
            if (!output) return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
            await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    try {
        const submitted = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-async-submit-0001",
            prompt: "A short async clip",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.deepEqual(submitted, {
            id: "dreamina-async-submit-0001",
            clientOperationId: "dreamina-async-submit-0001",
            context: { scope: "legacy_unscoped" },
            provider: "dreamina-cli",
            mode: "video",
            operation: "text2video",
            model: "seedance2.0mini",
            status: "running",
            stage: "submitted",
            progress: 10,
            receiptRecorded: true,
            createdAt: submitted.createdAt,
            updatedAt: submitted.updatedAt,
        });
        const completion = runtime.waitForTask("dreamina-async-submit-0001", "video");
        await waitFor(() => calls.length === 2);
        assert.deepEqual(calls, ["text2video", "query_result"]);
        releaseQuery();
        const completed = await completion;
        assert.equal(completed.mode, "video");
        assert.equal((await runtime.getTask("dreamina-async-submit-0001")).status, "succeeded");
    } finally {
        releaseQuery();
        await (runtime as unknown as { dispose?: () => Promise<void> }).dispose?.();
        await box.cleanup();
    }
});

test("Dreamina async submit completes on a bounded receipt object without waiting for CLI exit", async () => {
    const box = await sandbox();
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                assert.equal(input.completeOnJsonOutput?.({ submit_id: "receipt-streamed-submit" }), true);
                assert.equal(input.completeOnJsonOutput?.({ status: "starting" }), false);
                assert.equal(input.completeOnJsonOutput?.({ event: "progress", submit_id: "receipt-streamed-submit" }), false);
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-streamed-submit"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
        },
    });
    try {
        const task = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-streamed-submit-0001",
            prompt: "fixture",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(task.receiptRecorded, true);
        assert.equal(task.stage, "submitted");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina serializes submit with the shared login-state query process", async () => {
    const box = await sandbox();
    let activeCliProcesses = 0;
    let maxCliProcesses = 0;
    let submitCalls = 0;
    let releaseFirstQuery!: () => void;
    const firstQueryWaiting = new Promise<void>((resolve) => { releaseFirstQuery = resolve; });
    const events: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        pollIntervalMs: 1,
        runProcess: async (input) => {
            activeCliProcesses += 1;
            maxCliProcesses = Math.max(maxCliProcesses, activeCliProcesses);
            try {
                if (input.args[0] === "text2video") {
                    submitCalls += 1;
                    const prompt = input.args.find((arg) => arg.startsWith("--prompt="))!.slice("--prompt=".length);
                    events.push(`submit:${prompt}`);
                    input.onSpawn?.(4242);
                    return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-${prompt}` }), stderr: "" };
                }
                const receipt = input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=".length);
                events.push(`query:${receipt}`);
                if (receipt === "receipt-first") await firstQueryWaiting;
                return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
            } finally {
                activeCliProcesses -= 1;
            }
        },
    });
    try {
        await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-shared-cli-gate-0001",
            prompt: "first",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await waitFor(() => events.includes("query:receipt-first"));

        const second = runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-shared-cli-gate-0002",
            prompt: "second",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(submitCalls, 1);
        assert.equal(maxCliProcesses, 1);

        releaseFirstQuery();
        await second;
        assert.equal(submitCalls, 2);
        assert.equal(maxCliProcesses, 1);
        assert.deepEqual(events.slice(0, 3), ["submit:first", "query:receipt-first", "submit:second"]);
    } finally {
        releaseFirstQuery();
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina shared CLI gate does not let a later submit starve an already queued scheduler intent", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [1, 2].map((index) => ({
            ...acceptedVideoRecord(index),
            nextPollAt: "2099-01-01T00:00:00.000Z",
        })),
    }));
    let releaseActiveQuery!: () => void;
    let markQueuedIntent!: () => void;
    const activeQueryGate = new Promise<void>((resolve) => { releaseActiveQuery = resolve; });
    const queuedIntentReady = new Promise<void>((resolve) => { markQueuedIntent = resolve; });
    const events: string[] = [];
    const runProcess = async (input: DreaminaProcessRequest) => {
        if (input.args[0] === "text2video") {
            events.push("submit:later");
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-later"}', stderr: "" };
        }
        const receipt = input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=".length);
        events.push(`query:${receipt}`);
        if (receipt === "receipt-fifo-1") await activeQueryGate;
        return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
    };
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "runtime-a-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess,
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "runtime-b-runs"),
        ensureReady: async () => { markQueuedIntent(); },
        discover: async () => installation,
        runProcess,
    });
    try {
        await runtimeA.refreshTask("dreamina-query-fifo-0001");
        await waitFor(() => events.includes("query:receipt-fifo-1"));
        await runtimeB.refreshTask("dreamina-query-fifo-0002");
        await queuedIntentReady;

        const laterSubmit = runtimeA.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-shared-cli-fairness-0001",
            prompt: "later",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await waitForAsync(async () => (await runtimeA.listTasks())
            .some((task) => task.id === "dreamina-shared-cli-fairness-0001"));
        assert.deepEqual(events, ["query:receipt-fifo-1"]);

        releaseActiveQuery();
        await laterSubmit;
        await waitFor(() => events.length >= 3);
        assert.deepEqual(events.slice(0, 3), [
            "query:receipt-fifo-1",
            "query:receipt-fifo-2",
            "submit:later",
        ]);
    } finally {
        releaseActiveQuery();
        await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina async scheduler keeps five official tasks active and queues the sixth", async () => {
    const box = await sandbox();
    const releases = new Map<string, () => void>();
    const queried: string[] = [];
    const submitted: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        pollIntervalMs: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                const prompt = input.args.find((arg) => arg.startsWith("--prompt="))!.slice("--prompt=".length);
                submitted.push(prompt);
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-${prompt}` }), stderr: "" };
            }
            const receipt = input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=".length);
            const download = input.args.find((arg) => arg.startsWith("--download_dir="));
            if (!download) {
                queried.push(receipt);
                await new Promise<void>((resolve) => { releases.set(receipt, resolve); });
                return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
            }
            const output = download.slice("--download_dir=".length);
            await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    try {
        const tasks = await Promise.all(Array.from({ length: 6 }, (_, index) => runtime.enqueue({
            operation: "text2video",
            idempotencyKey: `dreamina-async-queue-${index + 1}`,
            prompt: `task-${index + 1}`,
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        })));
        assert.deepEqual(tasks.map((task) => task.status), ["running", "running", "running", "running", "running", "queued"]);
        assert.deepEqual(submitted, ["task-1", "task-2", "task-3", "task-4", "task-5"]);
        const released = new Set<string>();
        while (submitted.length < 6) {
            await waitFor(() => queried.some((receipt) => !released.has(receipt)));
            const receipt = queried.find((candidate) => !released.has(candidate))!;
            released.add(receipt);
            releases.get(receipt)?.();
        }
        assert.equal((await runtime.getTask("dreamina-async-queue-6")).status, "running");
    } finally {
        for (const release of releases.values()) release();
        await (runtime as unknown as { dispose?: () => Promise<void> }).dispose?.();
        await box.cleanup();
    }
});

test("Dreamina async tasks coalesce equal keys, reject conflicts, and cancel queued work without spawn", async () => {
    const box = await sandbox();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let submits = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submits += 1;
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: `{"submit_id":"receipt-coalesce-${submits}"}`, stderr: "" };
            }
            await waiting;
            return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
        },
    });
    const first = { operation: "text2video" as const, idempotencyKey: "dreamina-coalesce-task-0001", prompt: "same", modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        const [left, right] = await Promise.all([runtime.enqueue(first), runtime.enqueue(first)]);
        assert.deepEqual(left, right);
        assert.equal(submits, 1);
        await assert.rejects(runtime.enqueue({ ...first, prompt: "different" }), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_idempotency_conflict");

        const queued = await runtime.enqueue({ ...first, idempotencyKey: "dreamina-cancel-queued-0001", prompt: "queued" });
        assert.equal(queued.status, "queued");
        const cancelledTask = await runtime.cancelTask(queued.id);
        assert.equal((runtime as unknown as { queueHeartbeats: Map<string, unknown> }).queueHeartbeats.size, 0);
        assert.equal(cancelledTask.status, "cancelled");
        assert.equal(cancelledTask.errorCode, "dreamina_cancelled");
        assert.equal(submits, 1);
        const cancelledDisk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const cancelledRecord = cancelledDisk.records.find((record) => record.idempotencyKey === queued.id);
        assert.equal(cancelledRecord?.queueOwnerId, undefined);
        assert.equal(cancelledRecord?.queueExpiresAt, undefined);
    } finally {
        release();
        await (runtime as unknown as { dispose?: () => Promise<void> }).dispose?.();
        await box.cleanup();
    }
});

test("Dreamina accepted cancellation preserves provider reconciliation when the official CLI has no cancel command", async () => {
    const box = await sandbox();
    let queryStarted!: () => void;
    const queryEntered = new Promise<void>((resolve) => { queryStarted = resolve; });
    const commands: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            commands.push(input.args[0]);
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-local-stop-only"}', stderr: "" };
            }
            queryStarted();
            await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    try {
        const accepted = await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-local-stop-only-0001",
            prompt: "same prompt",
            modelVersion: "seedance2.0" as const,
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(accepted.receiptRecorded, true);
        await queryEntered;

        const detached = await runtime.cancelTask(accepted.id);

        assert.equal(detached.status, "running");
        assert.equal(detached.receiptRecorded, true);
        assert.equal(detached.errorCode, undefined);
        assert.deepEqual(commands, ["text2video", "query_result"]);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina cancellation classifies the fresh receipt state under the shared lock", async () => {
    const box = await sandbox();
    let releaseQuery!: () => void;
    const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-active-slot"}', stderr: "" };
            }
            await queryGate;
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    const first = {
        operation: "text2video" as const,
        prompt: "fixture",
        modelVersion: "seedance2.0mini" as const,
        ratio: "16:9" as const,
        videoResolution: "720p" as const,
        duration: 4,
    };
    try {
        await runtime.enqueue({ ...first, idempotencyKey: "dreamina-lock-active-0001" });
        const queued = await runtime.enqueue({ ...first, idempotencyKey: "dreamina-lock-cancel-0001" });
        assert.equal(queued.status, "queued");

        const releaseLock = await acquireStateLock(box.stateFile);
        const cancelling = runtime.cancelTask(queued.id);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const record = disk.records.find((candidate) => candidate.idempotencyKey === queued.id)!;
        Object.assign(record, { state: "accepted", submitId: "receipt-from-other-runtime" });
        delete record.queueOwnerId;
        delete record.queueExpiresAt;
        await fs.writeFile(box.stateFile, JSON.stringify(disk));
        await releaseLock();

        const detached = await cancelling;
        assert.equal(detached.status, "running");
        assert.equal(detached.receiptRecorded, true);
        assert.equal(detached.errorCode, undefined);
    } finally {
        releaseQuery();
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina cancellation preserves a peer receipt accepted after its initial load", async () => {
    const box = await sandbox();
    const taskId = "dreamina-cancel-peer-race-0001";
    const nextId = "dreamina-cancel-peer-next-0001";
    const now = () => new Date("2026-08-13T00:00:10.000Z");
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: taskId,
            requestHash: "c".repeat(64),
            state: "queued",
            queueOwnerId: "00000000-0000-4000-8000-000000000001",
            queueExpiresAt: "2026-08-13T00:01:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z",
        }],
    }));

    let initialLoadFinished!: () => void;
    const initialLoad = new Promise<void>((resolve) => { initialLoadFinished = resolve; });
    let releaseInitialLoad!: () => void;
    const initialLoadGate = new Promise<void>((resolve) => { releaseInitialLoad = resolve; });
    const reconciler = {
        async start() {
            initialLoadFinished();
            await initialLoadGate;
        },
        async dispose() {},
    } as unknown as NonNullable<DreaminaCliRuntimeOptions["reconciler"]>;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        reconciler,
        maxActiveTasks: 1,
        now,
    });
    let contender: DreaminaCliRuntime | undefined;
    let spawns = 0;
    try {
        const cancelling = runtime.cancelTask(taskId);
        await initialLoad;

        const peerLease = await acquireStateLock(box.stateFile);
        try {
            const disk = await readRuntimeDiskState(box.stateFile, ownerId);
            assert.ok(disk);
            const peer = disk.records.find((record) => record.idempotencyKey === taskId);
            assert.ok(peer);
            Object.assign(peer, {
                state: "accepted" as const,
                submitId: "receipt-from-peer-after-load",
                nextPollAt: "2026-08-13T00:10:00.000Z",
                updatedAt: "2026-08-13T00:00:05.000Z",
            });
            delete peer.queueOwnerId;
            delete peer.queueExpiresAt;
            await persistRuntimeDiskState(box.stateFile, ownerId, disk, peerLease);
        } finally {
            await peerLease();
        }
        releaseInitialLoad();

        const detached = await cancelling;
        assert.equal(detached.status, "running");
        assert.equal(detached.stage, "submitted");
        assert.equal(detached.receiptRecorded, true);
        assert.equal(detached.errorCode, undefined);

        const durable = await readRuntimeDiskState(box.stateFile, ownerId);
        const accepted = durable?.records.find((record) => record.idempotencyKey === taskId);
        assert.equal(accepted?.state, "accepted");
        assert.equal(accepted?.submitId, "receipt-from-peer-after-load");
        assert.equal(accepted?.nextPollAt, "2026-08-13T00:10:00.000Z");

        contender = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            generationRoot: path.join(box.root, "contender-generation-runs"),
            ensureReady: async () => undefined,
            discover: async () => installation,
            maxActiveTasks: 1,
            reservationHeartbeatMs: 0,
            now,
            runProcess: async () => {
                spawns += 1;
                return { exitCode: 0, stdout: '{"submit_id":"unexpected-receipt"}', stderr: "" };
            },
        });
        const queued = await contender.enqueue({
            operation: "text2video",
            idempotencyKey: nextId,
            prompt: "must remain queued behind the peer receipt",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        assert.equal(queued.status, "queued");
        assert.equal(spawns, 0);
    } finally {
        releaseInitialLoad();
        await Promise.allSettled([runtime.dispose(), contender?.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina pending submission cancellation never reports an official cancellation", async () => {
    const box = await sandbox();
    let submitStarted!: () => void;
    const submitEntered = new Promise<void>((resolve) => { submitStarted = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            submitStarted();
            await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
            return { exitCode: 1, stdout: "", stderr: "" };
        },
    });
    const id = "dreamina-pending-stop-unknown-0001";
    const submission = runtime.enqueue({
        operation: "text2video",
        idempotencyKey: id,
        prompt: "pending",
        modelVersion: "seedance2.0mini" as const,
        ratio: "16:9",
        videoResolution: "720p",
        duration: 4,
    });
    try {
        await submitEntered;
        await assert.rejects(runtime.cancelTask(id), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_submission_unknown");
        await assert.rejects(submission);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina durable task listing returns only bounded public correlation DTOs", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [
            {
                ownerId,
                idempotencyKey: "dreamina-list-public-0001",
                requestHash: "c".repeat(64),
                state: "cancelled",
                errorCode: "dreamina_local_wait_stopped",
                updatedAt: "2026-08-12T00:02:00.000Z",
                submitId: "private-receipt-one",
                taskVersion: 1,
                operation: "text2video",
                mode: "video",
                model: "seedance2.0",
                createdAt: "2026-08-12T00:01:00.000Z",
            },
            {
                ownerId,
                idempotencyKey: "dreamina-list-public-0002",
                requestHash: "d".repeat(64),
                state: "failed",
                errorCode: "dreamina_generation_failed",
                updatedAt: "2026-08-12T00:04:00.000Z",
                taskVersion: 1,
                operation: "text2image",
                mode: "image",
                model: "5.0",
                createdAt: "2026-08-12T00:03:00.000Z",
            },
        ],
    }));
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        runProcess: async () => { throw new Error("listing must not invoke CLI"); },
    });
    try {
        const listTasks = (runtime as unknown as { listTasks?: () => Promise<unknown[]> }).listTasks;
        assert.equal(typeof listTasks, "function");
        const tasks = await listTasks.call(runtime) as Array<{ id: string }>;
        assert.deepEqual(tasks.map((task) => task.id), ["dreamina-list-public-0002", "dreamina-list-public-0001"]);
        const serialized = JSON.stringify(tasks);
        assert.doesNotMatch(serialized, /ownerId|requestHash|submitId|private-receipt|prompt|argv|path/i);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina task cursor pagination reaches beyond 100 records and applies durable project filters", async () => {
    const box = await sandbox();
    const records = Array.from({ length: 130 }, (_, index) => ({
        ownerId,
        idempotencyKey: `dreamina-page-task-${String(index).padStart(4, "0")}`,
        requestHash: "f".repeat(64),
        state: "failed" as const,
        errorCode: "dreamina_generation_failed",
        updatedAt: new Date(Date.UTC(2026, 7, 13, 0, 0, index)).toISOString(),
        taskVersion: 1,
        operation: "text2video" as const,
        mode: "video" as const,
        model: "seedance2.5",
        context: { scope: "scoped" as const, projectId: index < 120 ? "project-page-a" : "project-page-b" },
        createdAt: "2026-08-13T00:00:00.000Z",
    }));
    await fs.writeFile(box.stateFile, JSON.stringify({ version: 1, records }));
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        runProcess: async () => { throw new Error("listing must not invoke CLI"); },
    });
    try {
        const first = await runtime.listTaskPage({ limit: 100, projectId: "project-page-a" });
        assert.equal(first.tasks.length, 100);
        assert.equal(typeof first.nextCursor, "string");
        const second = await runtime.listTaskPage({ limit: 100, projectId: "project-page-a", cursor: first.nextCursor });
        assert.equal(second.tasks.length, 20);
        assert.equal(second.nextCursor, undefined);
        assert.equal(new Set([...first.tasks, ...second.tasks].map((task) => task.id)).size, 120);
        assert.equal([...first.tasks, ...second.tasks].every((task) => task.context?.scope === "scoped" && task.context.projectId === "project-page-a"), true);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina cold task listing never starts receipt recovery or changes durable state", async () => {
    const box = await sandbox();
    const initial = JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-list-accepted-0001",
            requestHash: "e".repeat(64),
            state: "accepted",
            updatedAt: "2026-08-12T00:02:00.000Z",
            submitId: "private-receipt-list-only",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0",
            createdAt: "2026-08-12T00:01:00.000Z",
        }],
    });
    await fs.writeFile(box.stateFile, initial);
    let processCalls = 0;
    const generationRoot = path.join(box.root, "generation-runs");
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            throw new Error("listing must not invoke query_result");
        },
    });
    try {
        const tasks = await runtime.listTasks();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(processCalls, 0);
        assert.deepEqual(tasks, [{
            id: "dreamina-list-accepted-0001",
            provider: "dreamina-cli",
            mode: "video",
            operation: "text2video",
            model: "seedance2.0",
            status: "running",
            stage: "submitted",
            progress: 10,
            receiptRecorded: true,
            createdAt: "2026-08-12T00:01:00.000Z",
            updatedAt: "2026-08-12T00:02:00.000Z",
        }]);
        assert.equal(await fs.readFile(box.stateFile, "utf8"), initial);
        await assert.rejects(fs.stat(generationRoot), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina deletes an accepted task from the public list without querying or cancelling the official task", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [acceptedVideoRecord(1)],
    }));
    let processCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            processCalls += 1;
            throw new Error("deleting a local record must not invoke the official CLI");
        },
    });
    try {
        assert.deepEqual(await runtime.deleteTask("dreamina-query-fifo-0001"), { deleted: true });
        assert.equal(processCalls, 0);
        assert.deepEqual(await runtime.listTasks(), []);
        await assert.rejects(runtime.getTask("dreamina-query-fifo-0001"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_task_not_found"
        ));
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<{ state: string; submitId?: string; hidden?: boolean }> };
        assert.equal(disk.records[0]?.state, "accepted");
        assert.equal(disk.records[0]?.hidden, true);
        assert.equal(typeof disk.records[0]?.submitId, "string");
        await assert.rejects(runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-query-fifo-0001",
            prompt: "must not be submitted again",
            modelVersion: "seedance2.0",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        }), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_idempotency_conflict");
        assert.equal(processCalls, 0);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina can tombstone a completed task without weakening its receipt fence", async () => {
    const box = await sandbox();
    const completed = { ...acceptedVideoRecord(1), state: "succeeded" };
    await fs.writeFile(box.stateFile, JSON.stringify({ version: 1, records: [completed] }));
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        runProcess: async () => { throw new Error("deleting a completed record must not invoke the CLI"); },
    });
    try {
        assert.deepEqual(await runtime.deleteTask("dreamina-query-fifo-0001"), { deleted: true });
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<{ state: string; submitId?: string; journalVersion?: number; hidden?: boolean }> };
        assert.deepEqual(disk.records, [{
            ...completed,
            hidden: true,
            updatedAt: disk.records[0]?.updatedAt,
            journalVersion: 2,
        }]);
        await runtime.dispose();
        await fs.writeFile(`${box.stateFile}.replace-backup`, JSON.stringify({ version: 1, records: [completed] }));
        const recovered = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            runProcess: async () => { throw new Error("recovering a deletion must not invoke the CLI"); },
        });
        try {
            assert.deepEqual(await recovered.listTasks(), []);
        } finally {
            await recovered.dispose();
        }
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina recovery serializes lock-sensitive queries and reaches each receipt once", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [1, 2, 3].map(acceptedVideoRecord),
    }));
    const calls = new Map<number, number>();
    let activeQueries = 0;
    let maxActiveQueries = 0;
    let resolveQueryBatch!: () => void;
    const queryBatchCompleted = new Promise<void>((resolve) => { resolveQueryBatch = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 3,
        pollIntervalMs: 0,
        sleep: async () => undefined,
        runProcess: async (input) => {
            assert.equal(input.args[0], "query_result");
            assert.equal(input.timeoutMs, 30_000);
            const receipt = Number(input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=receipt-fifo-".length));
            calls.set(receipt, (calls.get(receipt) ?? 0) + 1);
            activeQueries += 1;
            maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
            try {
                if (activeQueries > 1) {
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    return { exitCode: 1, stdout: "", stderr: "simulated shared CLI lock" };
                }
                await new Promise((resolve) => setTimeout(resolve, receipt === 1 ? 2_100 : 10));
                return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
            } finally {
                activeQueries -= 1;
                if (activeQueries === 0 && calls.size === 3 && [...calls.values()].every((count) => count === 1)) {
                    resolveQueryBatch();
                }
            }
        },
    });
    try {
        await runtime.getTask("dreamina-query-fifo-0001");
        await waitForPromise(queryBatchCompleted, "Dreamina recovery query batch", 10_000);
        await waitForAsync(async () => (await runtime.listTasks()).every((task) => task.status === "failed"), 10_000);
        assert.equal(maxActiveQueries, 1);
        assert.deepEqual(Object.fromEntries(calls), { 1: 1, 2: 1, 3: 1 });
        assert.deepEqual((await runtime.listTasks()).map((task) => task.errorCode), [
            "dreamina_official_failed",
            "dreamina_official_failed",
            "dreamina_official_failed",
        ]);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina query FIFO is fair across pending receipts and shutdown aborts queued waiters", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [1, 2, 3].map(acceptedVideoRecord),
    }));
    const order: number[] = [];
    const attempts = new Map<number, number>();
    let activeQueries = 0;
    let maxActiveQueries = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 2,
        pollIntervalMs: 0,
        sleep: async () => undefined,
        runProcess: async (input) => {
            assert.equal(input.timeoutMs, 30_000);
            const receipt = Number(input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=receipt-fifo-".length));
            order.push(receipt);
            attempts.set(receipt, (attempts.get(receipt) ?? 0) + 1);
            activeQueries += 1;
            maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
            try {
                await new Promise<void>((resolve) => setTimeout(resolve, 10));
                return { exitCode: 0, stdout: attempts.get(receipt) === 1 ? '{"gen_status":"processing"}' : '{"gen_status":"failed"}', stderr: "" };
            } finally {
                activeQueries -= 1;
            }
        },
    });
    try {
        await runtime.getTask("dreamina-query-fifo-0001");
        await waitForAsync(async () => (await runtime.listTasks()).every((task) => task.status === "failed"), 15_000);
        assert.equal(maxActiveQueries, 1);
        assert.deepEqual([...new Set(order)].sort(), [1, 2, 3]);
        assert.deepEqual(Object.fromEntries([...attempts.entries()].sort(([left], [right]) => left - right)), {
            1: 2,
            2: 2,
            3: 2,
        });

        const shutdownBox = await sandbox();
        await fs.writeFile(shutdownBox.stateFile, JSON.stringify({ version: 1, records: [1, 2, 3].map(acceptedVideoRecord) }));
        let started = 0;
        let running = 0;
        const shutdownRuntime = new DreaminaCliRuntime({
            ownerId,
            stateFile: shutdownBox.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async (input) => {
                started += 1;
                running += 1;
                await new Promise<void>((resolve) => {
                    if (input.signal?.aborted) return resolve();
                    input.signal?.addEventListener("abort", () => resolve(), { once: true });
                });
                running -= 1;
                return { exitCode: 1, stdout: "", stderr: "cancelled" };
            },
        });
        try {
            await shutdownRuntime.getTask("dreamina-query-fifo-0001");
            await waitFor(() => started > 0);
            await shutdownRuntime.dispose();
            assert.equal(started, 1);
            assert.equal(running, 0);
        } finally {
            await shutdownRuntime.dispose();
            await shutdownBox.cleanup();
        }
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina scheduler intent survives a cancelled foreground refresh and starts after the active query", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [1, 2].map((index) => ({
            ...acceptedVideoRecord(index),
            nextPollAt: "2099-01-01T00:00:00.000Z",
        })),
    }));
    let releaseActive!: () => void;
    let markSuccessorIntent!: () => void;
    const activeGate = new Promise<void>((resolve) => { releaseActive = resolve; });
    const successorIntent = new Promise<void>((resolve) => { markSuccessorIntent = resolve; });
    const started: string[] = [];
    const runProcess = async (input: DreaminaProcessRequest) => {
        const receipt = input.args.find((arg) => arg.startsWith("--submit_id="))!.slice("--submit_id=".length);
        started.push(receipt);
        if (receipt === "receipt-fifo-1") await activeGate;
        return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
    };
    const runtimeA = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess,
    });
    const runtimeB = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => { markSuccessorIntent(); },
        discover: async () => installation,
        runProcess,
    });
    const foreground = new AbortController();
    try {
        await runtimeA.refreshTask("dreamina-query-fifo-0001");
        await waitFor(() => started.length === 1);
        await runtimeB.refreshTask("dreamina-query-fifo-0002", { signal: foreground.signal });
        await successorIntent;
        foreground.abort();
        assert.deepEqual(started, ["receipt-fifo-1"]);

        releaseActive();
        await waitFor(() => started.length === 2);
        assert.deepEqual(started, ["receipt-fifo-1", "receipt-fifo-2"]);
    } finally {
        foreground.abort();
        releaseActive();
        await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina query FIFO releases a timed-out process before the next receipt", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [1, 2].map((index) => ({
            ...acceptedVideoRecord(index),
            nextPollAt: "2026-08-12T00:00:00.000Z",
        })),
    }));
    let calls = 0;
    let activeQueries = 0;
    let maxActiveQueries = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async () => {
            calls += 1;
            activeQueries += 1;
            maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
            try {
                if (calls === 1) throw new DreaminaCliError("dreamina_command_timeout", "fixture timeout", 504);
                return { exitCode: 0, stdout: '{"gen_status":"failed"}', stderr: "" };
            } finally {
                activeQueries -= 1;
            }
        },
    });
    try {
        await runtime.getTask("dreamina-query-fifo-0001");
        await waitFor(() => calls === 2);
        await waitForAsync(async () => (await runtime.listTasks())
            .some((task) => task.id === "dreamina-query-fifo-0002" && task.status === "failed"));
        assert.equal(maxActiveQueries, 1);
        const tasks = await runtime.listTasks();
        const timedOut = tasks.find((task) => task.id === "dreamina-query-fifo-0001")!;
        const officialFailure = tasks.find((task) => task.id === "dreamina-query-fifo-0002")!;
        assert.equal(timedOut.status, "running");
        assert.equal(timedOut.errorCode, "dreamina_command_timeout");
        assert.equal(officialFailure.status, "failed");
        assert.equal(officialFailure.errorCode, "dreamina_official_failed");
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        const retrying = disk.records.find((record) => record.idempotencyKey === "dreamina-query-fifo-0001");
        assert.equal(retrying?.state, "accepted");
        assert.equal(retrying?.retryCount, 1);
        assert.equal(typeof retrying?.nextPollAt, "string");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina official singular gen_status fail becomes a neutral terminal after one query", async () => {
    const box = await sandbox();
    let queryCalls = 0;
    let sleepCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 3,
        pollIntervalMs: 0,
        sleep: async () => { sleepCalls += 1; },
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-gen-status-failed"}', stderr: "" };
            }
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"fail"}', stderr: "" };
        },
    });
    try {
        await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-gen-status-fail-0001",
            prompt: "fixture prompt",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await assert.rejects(
            runtime.waitForTask("dreamina-gen-status-fail-0001", "video"),
            (error: unknown) => error instanceof Error,
        );
        assert.equal(queryCalls, 1);
        assert.equal(sleepCalls, 0);
        const final = await runtime.getTask("dreamina-gen-status-fail-0001");
        assert.equal(final.status, "failed");
        assert.equal(final.stage, "failed");
        assert.equal(final.receiptRecorded, true);
        assert.equal(final.errorCode, "dreamina_official_failed");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina manual status refresh schedules the shared reconciler and normalizes singular fail", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({ version: 1, records: [acceptedVideoRecord(1)] }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => ({ installed: true, executable: "dreamina" }),
        runProcess: async (input) => {
            queryCalls += 1;
            assert.equal(input.args[0], "query_result");
            assert.equal(input.args.includes("--download_dir"), false);
            return { exitCode: 0, stdout: '{"gen_status":"fail","message":"must stay private"}', stderr: "" };
        },
    });
    try {
        const scheduled = await runtime.refreshTask("dreamina-query-fifo-0001");
        assert.equal(scheduled.status, "running");
        await waitForAsync(async () => (await runtime.listTasks())[0]?.status === "failed");

        const refreshed = (await runtime.listTasks())[0]!;
        assert.equal(queryCalls, 1);
        assert.equal(refreshed.status, "failed");
        assert.equal(refreshed.stage, "failed");
        assert.equal(refreshed.officialStatus, "failed");
        assert.equal(refreshed.errorCode, "dreamina_official_failed");
        assert.equal(JSON.stringify(refreshed).includes("must stay private"), false);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina manual status refresh schedules one shared processing observation without a page-owned loop", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({ version: 1, records: [acceptedVideoRecord(1)] }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => ({ installed: true, executable: "dreamina" }),
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
        },
    });
    try {
        const scheduled = await runtime.refreshTask("dreamina-query-fifo-0001");
        assert.equal(scheduled.status, "running");
        await waitForAsync(async () => (await runtime.listTasks())[0]?.officialStatus === "processing");

        const refreshed = (await runtime.listTasks())[0]!;
        assert.equal(queryCalls, 1);
        assert.equal(refreshed.status, "running");
        assert.equal(refreshed.stage, "generating");
        assert.equal(refreshed.officialStatus, "processing");
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(queryCalls, 1);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina manual status refresh normalizes official querying as processing", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({ version: 1, records: [acceptedVideoRecord(1)] }));
    let queryCalls = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => ({ installed: true, executable: "dreamina" }),
        runProcess: async () => {
            queryCalls += 1;
            return { exitCode: 0, stdout: '{"credit_count":23736,"gen_status":"querying","queue_info":{}}', stderr: "" };
        },
    });
    try {
        await runtime.refreshTask("dreamina-query-fifo-0001");
        await waitForAsync(async () => (await runtime.listTasks())[0]?.officialStatus === "processing");

        const refreshed = (await runtime.listTasks())[0]!;
        assert.equal(queryCalls, 1);
        assert.equal(refreshed.status, "running");
        assert.equal(refreshed.stage, "generating");
        assert.equal(refreshed.officialStatus, "processing");
        assert.equal(refreshed.errorCode, undefined);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina production query consumes one JSON status before a long-lived CLI exits", async () => {
    const box = await sandbox();
    let queryCalls = 0;
    let queryPid = 0;
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        pollIntervalMs: 0,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-streamed-failed"}', stderr: "" };
            }
            queryCalls += 1;
            assert.equal(input.args.some((value) => value.startsWith("--download_dir=")), false);
            return runDreaminaProcess({
                ...input,
                executable: process.execPath,
                args: ["-e", [
                    "process.stdout.write('{\"message\":\"starting\"}\\n')",
                    "setTimeout(()=>process.stdout.write('{\"gen_status\":\"failed\"}'),50)",
                    "setInterval(()=>{},1000)",
                ].join(";")],
                timeoutMs: 250,
                onSpawn: (pid) => { queryPid = pid; },
            } as DreaminaProcessRequest);
        },
    });
    try {
        await runtime.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-streamed-query-fail-0001",
            prompt: "fixture prompt",
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        await assert.rejects(
            runtime.waitForTask("dreamina-streamed-query-fail-0001", "video"),
            (error: unknown) => error instanceof DreaminaCliError
                && error.code === "dreamina_official_failed",
        );
        assert.equal(queryCalls, 1);
        assert.ok(queryPid > 0);
        assert.throws(() => process.kill(queryPid, 0));
        const final = await runtime.getTask("dreamina-streamed-query-fail-0001");
        assert.equal(final.status, "failed");
        assert.equal(final.errorCode, "dreamina_official_failed");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina async receipt recovery is query-only and durable state contains no request content", async () => {
    const box = await sandbox();
    const prompt = "sensitive prompt must stay memory only";
    const first = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-recovery-only"}', stderr: "" };
            }
            await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    try {
        await first.enqueue({
            operation: "text2video",
            idempotencyKey: "dreamina-recovery-query-0001",
            prompt,
            modelVersion: "seedance2.0mini",
            ratio: "16:9",
            videoResolution: "720p",
            duration: 4,
        });
        const disk = await fs.readFile(box.stateFile, "utf8");
        assert.equal(disk.includes(prompt), false);
        assert.equal(/prompt|argv|token|cookie|profile|reference|media/i.test(disk), false);
        await first.dispose();

        const calls: string[] = [];
        const recovered = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            generationRoot: path.join(box.root, "generation-runs"),
            ensureReady: async () => undefined,
            discover: async () => installation,
            maxPollAttempts: 1,
            runProcess: async (input) => {
                calls.push(input.args[0]);
                assert.equal(input.args[0], "query_result");
                const download = input.args.find((arg) => arg.startsWith("--download_dir="));
                if (!download) return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
                const output = download.slice("--download_dir=".length);
                await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
                return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
            },
        });
        try {
            const result = await recovered.waitForTask("dreamina-recovery-query-0001", "video");
            assert.equal(result.mode, "video");
            assert.deepEqual(calls, ["query_result", "query_result"]);
        } finally {
            await recovered.dispose();
        }
    } finally {
        await first.dispose();
        await box.cleanup();
    }
});

test("Dreamina succeeded task rematerializes media by query only after a later Runtime restart", async () => {
    const box = await sandbox();
    const completedState = {
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-rematerialize-0001",
            requestHash: "a".repeat(64),
            state: "succeeded",
            updatedAt: "2026-08-12T00:00:00.000Z",
            submitId: "receipt-rematerialize-0001",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T00:00:00.000Z",
        }],
    };
    await fs.writeFile(box.stateFile, JSON.stringify(completedState));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            calls.push(input.args[0]);
            assert.equal(input.args[0], "query_result");
            await gate;
            const download = input.args.find((arg) => arg.startsWith("--download_dir="));
            if (!download) return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
            const output = download.slice("--download_dir=".length);
            await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    try {
        const recovering = await runtime.getTask("dreamina-rematerialize-0001");
        assert.equal(recovering.status, "succeeded");
        assert.equal(recovering.stage, "succeeded");
        release();
        const result = await runtime.waitForTask("dreamina-rematerialize-0001", "video");
        assert.equal(result.mode, "video");
        assert.deepEqual(calls, ["query_result", "query_result"]);
        assert.equal((await runtime.getTask("dreamina-rematerialize-0001")).status, "succeeded");
    } finally {
        release();
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina restart fails queued work before submission and never replays its POST", async () => {
    const box = await sandbox();
    const first = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-holds-slot"}', stderr: "" };
            }
            await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    const base = { operation: "text2video" as const, modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        await first.enqueue({ ...base, idempotencyKey: "dreamina-restart-active-0001", prompt: "active" });
        const queued = await first.enqueue({ ...base, idempotencyKey: "dreamina-restart-queued-0001", prompt: "must not replay" });
        assert.equal(queued.status, "queued");
        await first.dispose();

        const calls: string[] = [];
        const recovered = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            generationRoot: path.join(box.root, "generation-runs"),
            ensureReady: async () => undefined,
            discover: async () => installation,
            maxPollAttempts: 1,
            runProcess: async (input) => {
                calls.push(input.args[0]);
                return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
            },
        });
        try {
            const interrupted = await recovered.getTask("dreamina-restart-queued-0001");
            assert.equal(interrupted.status, "failed");
            assert.equal(interrupted.errorCode, "dreamina_interrupted_before_submission");
            assert.equal(calls.includes("text2video"), false);
        } finally {
            await recovered.dispose();
        }
    } finally {
        await first.dispose();
        await box.cleanup();
    }
});

test("Dreamina official cancellation releases a scheduler slot without local cancellation authority", async () => {
    const box = await sandbox();
    let submits = 0;
    let markSecondSubmitStarted!: () => void;
    const secondSubmitStarted = new Promise<void>((resolve) => { markSecondSubmitStarted = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submits += 1;
                if (submits === 2) markSecondSubmitStarted();
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-release-${submits}` }), stderr: "" };
            }
            return { exitCode: 0, stdout: '{"status":"cancelled"}', stderr: "" };
        },
    });
    const base = { operation: "text2video" as const, modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        const active = await runtime.enqueue({ ...base, idempotencyKey: "dreamina-cancel-active-0001", prompt: "active" });
        const queuedPromise = runtime.enqueue({ ...base, idempotencyKey: "dreamina-after-cancel-0001", prompt: "next" });
        assert.equal((await queuedPromise).status, "queued");
        assert.equal((await runtime.refreshTask(active.id)).status, "running");
        await waitForPromise(secondSubmitStarted, "Dreamina queued task submission", 10_000);
        assert.equal((await runtime.getTask(active.id)).status, "cancelled");
        assert.equal((await runtime.getTask("dreamina-after-cancel-0001")).status, "running");
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina cross-Runtime queue head promotes after a peer reconciler releases durable capacity", async () => {
    const box = await sandbox();
    let releaseTerminal!: () => void;
    let markTerminalQueryStarted!: () => void;
    const terminalGate = new Promise<void>((resolve) => { releaseTerminal = resolve; });
    const terminalQueryStarted = new Promise<void>((resolve) => { markTerminalQueryStarted = resolve; });
    let markQueuedSubmitStarted!: () => void;
    const queuedSubmitStarted = new Promise<void>((resolve) => { markQueuedSubmitStarted = resolve; });
    let runtimeASubmits = 0;
    let runtimeBSubmits = 0;
    const sharedOptions = {
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        pollIntervalMs: 60_000,
        reservationLeaseMs: 500,
        reservationHeartbeatMs: 20,
    };
    const runtimeA = new DreaminaCliRuntime({
        ...sharedOptions,
        generationRoot: path.join(box.root, "runtime-a-runs"),
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                runtimeASubmits += 1;
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-runtime-a-slot"}', stderr: "" };
            }
            markTerminalQueryStarted();
            await terminalGate;
            return { exitCode: 0, stdout: '{"status":"cancelled"}', stderr: "" };
        },
    });
    const runtimeB = new DreaminaCliRuntime({
        ...sharedOptions,
        generationRoot: path.join(box.root, "runtime-b-runs"),
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                runtimeBSubmits += 1;
                markQueuedSubmitStarted();
                input.onSpawn?.(5252);
                return { exitCode: 0, stdout: '{"submit_id":"receipt-runtime-b-promoted"}', stderr: "" };
            }
            return { exitCode: 0, stdout: '{"status":"pending"}', stderr: "" };
        },
    });
    const base = { operation: "text2video" as const, modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        const active = await runtimeA.enqueue({ ...base, idempotencyKey: "dreamina-runtime-a-active-0001", prompt: "active" });
        const queued = await runtimeB.enqueue({ ...base, idempotencyKey: "dreamina-runtime-b-queued-0001", prompt: "queued" });
        assert.equal(active.status, "running");
        assert.equal(queued.status, "queued");
        assert.equal(runtimeASubmits, 1);
        assert.equal(runtimeBSubmits, 0);

        await runtimeA.refreshTask(active.id);
        await waitForPromise(terminalQueryStarted, "Runtime A terminal reconciliation", 2_000);
        releaseTerminal();
        await waitForRuntimeRecord(box.stateFile, active.id, (record) => record.state === "cancelled", 2_000);
        await waitForPromise(queuedSubmitStarted, "Runtime B queued promotion", 1_000);

        assert.equal(runtimeBSubmits, 1);
        assert.equal((await runtimeB.getTask(queued.id)).status, "running");
    } finally {
        releaseTerminal();
        await Promise.all([runtimeA.dispose(), runtimeB.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina durable scheduler preserves FIFO when a later Runtime heartbeat reaches the released slot first", async () => {
    const box = await sandbox();
    let releaseTerminal!: () => void;
    const terminalGate = new Promise<void>((resolve) => { releaseTerminal = resolve; });
    let markFirstQueuedSubmit!: (runtime: "B" | "C") => void;
    const firstQueuedSubmit = new Promise<"B" | "C">((resolve) => { markFirstQueuedSubmit = resolve; });
    let markSecondQueuedSubmit!: (runtime: "B" | "C") => void;
    const secondQueuedSubmit = new Promise<"B" | "C">((resolve) => { markSecondQueuedSubmit = resolve; });
    let observeQueuedHeartbeats = false;
    let firstQueuedSubmitRuntime: "B" | "C" | undefined;
    const queuedHeartbeatOrder: Array<"B" | "C"> = [];
    const queuedSubmitOrder: Array<"B" | "C"> = [];
    const shared = {
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 1,
        pollIntervalMs: 60_000,
        reservationLeaseMs: 5_000,
    };
    const runtimeA = new DreaminaCliRuntime({
        ...shared,
        reservationHeartbeatMs: 50,
        generationRoot: path.join(box.root, "fifo-runtime-a"),
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                input.onSpawn?.(4101);
                return { exitCode: 0, stdout: '{"submit_id":"fifo-active"}', stderr: "" };
            }
            await terminalGate;
            return { exitCode: 0, stdout: '{"status":"cancelled"}', stderr: "" };
        },
    });
    const queuedRuntime = (runtime: "B" | "C", heartbeatMs: number) => new DreaminaCliRuntime({
        ...shared,
        reservationHeartbeatMs: heartbeatMs,
        generationRoot: path.join(box.root, `fifo-runtime-${runtime.toLowerCase()}`),
        onQueueHeartbeatWait(event) {
            if (observeQueuedHeartbeats && event === "started") queuedHeartbeatOrder.push(runtime);
        },
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                queuedSubmitOrder.push(runtime);
                if (!firstQueuedSubmitRuntime) {
                    firstQueuedSubmitRuntime = runtime;
                    markFirstQueuedSubmit(runtime);
                } else if (queuedSubmitOrder.length === 2) markSecondQueuedSubmit(runtime);
                input.onSpawn?.(runtime === "B" ? 4202 : 4303);
                return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-fifo-${runtime.toLowerCase()}` }), stderr: "" };
            }
            return { exitCode: 0, stdout: '{"status":"cancelled"}', stderr: "" };
        },
    });
    const runtimeB = queuedRuntime("B", 1_000);
    const runtimeC = queuedRuntime("C", 20);
    const base = { operation: "text2video" as const, modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        const active = await runtimeA.enqueue({ ...base, idempotencyKey: "dreamina-durable-fifo-active-0001", prompt: "active" });
        const queuedB = await runtimeB.enqueue({ ...base, idempotencyKey: "dreamina-durable-fifo-b-0001", prompt: "queued-b" });
        const queuedC = await runtimeC.enqueue({ ...base, idempotencyKey: "dreamina-durable-fifo-c-0001", prompt: "queued-c" });
        assert.equal(queuedB.status, "queued");
        assert.equal(queuedC.status, "queued");

        await runtimeA.refreshTask(active.id);
        observeQueuedHeartbeats = true;
        releaseTerminal();
        await waitForRuntimeRecord(box.stateFile, active.id, (record) => record.state === "cancelled", 2_000);

        assert.equal(await waitForPromise(firstQueuedSubmit, "first durable FIFO queued submit", 3_000), "B");
        assert.equal(queuedHeartbeatOrder[0], "C");
        assert.deepEqual(queuedSubmitOrder, ["B"]);
        assert.equal((await runtimeC.getTask(queuedC.id)).status, "queued");

        await waitForRuntimeRecord(box.stateFile, queuedB.id, (record) => record.state === "accepted", 2_000);
        assert.equal((await runtimeB.refreshTask(queuedB.id)).status, "running");
        await waitForRuntimeRecord(box.stateFile, queuedB.id, (record) => record.state === "cancelled", 2_000);
        assert.equal(await waitForPromise(secondQueuedSubmit, "second durable FIFO queued submit", 2_000), "C");
        assert.deepEqual(queuedSubmitOrder, ["B", "C"]);
    } finally {
        releaseTerminal();
        await Promise.all([runtimeA.dispose(), runtimeB.dispose(), runtimeC.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina hides accepted work without releasing its official slot and keeps reconciling it", async () => {
    const box = await sandbox();
    let submits = 0;
    let hiddenOfficiallyCancelled = false;
    let markSixthSubmitStarted!: () => void;
    const sixthSubmitStarted = new Promise<void>((resolve) => { markSixthSubmitStarted = resolve; });
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "generation-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        maxActiveTasks: 5,
        pollIntervalMs: 5,
        runProcess: async (input) => {
            if (input.args[0] === "text2video") {
                submits += 1;
                if (submits === 6) markSixthSubmitStarted();
                input.onSpawn?.(4242);
                return { exitCode: 0, stdout: JSON.stringify({ submit_id: `receipt-hide-${submits}` }), stderr: "" };
            }
            const hiddenTask = input.args.includes("--submit_id=receipt-hide-1");
            return {
                exitCode: 0,
                stdout: JSON.stringify({ status: hiddenTask && hiddenOfficiallyCancelled ? "cancelled" : "pending" }),
                stderr: "",
            };
        },
    });
    const base = { operation: "text2video" as const, modelVersion: "seedance2.0mini" as const, ratio: "16:9" as const, videoResolution: "720p" as const, duration: 4 };
    try {
        const accepted = [];
        for (let index = 1; index <= 5; index += 1) {
            accepted.push(await runtime.enqueue({
                ...base,
                idempotencyKey: `dreamina-hide-accepted-000${index}`,
                prompt: `accepted-${index}`,
            }));
        }
        const sixth = await runtime.enqueue({
            ...base,
            idempotencyKey: "dreamina-hide-sixth-0001",
            prompt: "sixth",
        });
        assert.equal(sixth.status, "queued");
        assert.equal(submits, 5);

        assert.deepEqual(await runtime.deleteTask(accepted[0]!.id), { deleted: true });
        const hidden = await readRuntimeRecordWhenAvailable(box.stateFile, accepted[0]!.id);
        assert.equal(submits, 5);
        await assert.rejects(runtime.getTask(accepted[0]!.id), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_task_not_found"
        ));
        assert.equal(hidden?.state, "accepted");
        assert.equal(hidden?.hidden, true);

        hiddenOfficiallyCancelled = true;
        await waitForRuntimeRecord(
            box.stateFile,
            accepted[0]!.id,
            (record) => record.state === "cancelled",
            10_000,
        );
        await waitForPromise(sixthSubmitStarted, "Dreamina hidden task slot release", 10_000);
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina shared scheduler prevents a stale Runtime from overwriting terminal success", async () => {
    const box = await sandbox();
    const id = "dreamina-cross-runtime-0001";
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: id,
            requestHash: "b".repeat(64),
            state: "accepted",
            updatedAt: "2026-08-12T00:00:00.000Z",
            submitId: "receipt-cross-runtime-0001",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T00:00:00.000Z",
        }],
    }));
    let releaseSuccess!: () => void;
    let winnerEntered!: () => void;
    const successGate = new Promise<void>((resolve) => { releaseSuccess = resolve; });
    const winnerProviderEntered = new Promise<void>((resolve) => { winnerEntered = resolve; });
    let staleQueries = 0;
    const winner = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "success-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            assert.equal(input.args[0], "query_result");
            winnerEntered();
            await successGate;
            const download = input.args.find((arg) => arg.startsWith("--download_dir="));
            if (download) {
                const output = download.slice("--download_dir=".length);
                await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            }
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    const stale = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        generationRoot: path.join(box.root, "failure-runs"),
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            staleQueries += 1;
            return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
        },
    });
    try {
        await winner.refreshTask(id);
        await winnerProviderEntered;
        assert.equal((await stale.getTask(id)).status, "running");
        releaseSuccess();
        await winner.waitForTask(id, "video");

        const cancelledAfterWin = await stale.cancelTask(id);
        assert.equal(cancelledAfterWin.status, "succeeded");
        assert.equal(staleQueries, 0);
        const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8"));
        assert.equal(disk.records[0].state, "succeeded");
        assert.equal(disk.records[0].submitId, "receipt-cross-runtime-0001");
    } finally {
        releaseSuccess();
        await Promise.all([winner.dispose(), stale.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina cross-Runtime waiters reload durable completed and cancelled terminals without querying", async () => {
    for (const terminal of ["completed", "cancelled"] as const) {
        const box = await sandbox();
        const id = `dreamina-durable-wait-${terminal}-0001`;
        let markWaiterLoaded!: () => void;
        let releaseWaiterLoad!: () => void;
        const waiterLoaded = new Promise<void>((resolve) => { markWaiterLoaded = resolve; });
        const waiterLoadGate = new Promise<void>((resolve) => { releaseWaiterLoad = resolve; });
        const waiterArtifactStore = new DreaminaProviderArtifactStore({
            root: path.join(box.root, "dreamina-provider-artifacts"),
        });
        waiterArtifactStore.scavenge = async () => {
            markWaiterLoaded();
            await waiterLoadGate;
        };
        await fs.writeFile(box.stateFile, JSON.stringify({
            version: 1,
            records: [{
                ownerId,
                idempotencyKey: id,
                requestHash: terminal === "completed" ? "c".repeat(64) : "d".repeat(64),
                state: "accepted",
                updatedAt: "2026-08-12T00:00:00.000Z",
                submitId: `receipt-durable-wait-${terminal}`,
                taskVersion: 1,
                operation: "text2video",
                mode: "video",
                model: "seedance2.0mini",
                createdAt: "2026-08-12T00:00:00.000Z",
                nextPollAt: "2020-01-01T00:00:00.000Z",
            }],
        }));
        let releaseWinner!: () => void;
        let markWinnerEntered!: () => void;
        const winnerGate = new Promise<void>((resolve) => { releaseWinner = resolve; });
        const winnerEntered = new Promise<void>((resolve) => { markWinnerEntered = resolve; });
        let winnerQueries = 0;
        let waiterQueries = 0;
        const winner = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            generationRoot: path.join(box.root, "winner-runs"),
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async (input) => {
                winnerQueries += 1;
                if (winnerQueries === 1) {
                    markWinnerEntered();
                    await winnerGate;
                }
                const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
                if (terminal === "completed" && output) {
                    await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
                }
                return { exitCode: 0, stdout: JSON.stringify({ status: terminal }), stderr: "" };
            },
        });
        const waiter = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            generationRoot: path.join(box.root, "waiter-runs"),
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async () => {
                waiterQueries += 1;
                return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
            },
            artifactStore: waiterArtifactStore,
        });
        try {
            await winner.start();
            await winnerEntered;
            const waiting = waiter.waitForTask(id, "video");
            await waiterLoaded;
            assert.equal(waiterQueries, 0);
            releaseWinner();
            await waitForRuntimeRecord(box.stateFile, id, (record) => (
                terminal === "completed"
                    ? record.state === "succeeded" && record.providerOutputs?.length === 1
                    : record.state === "cancelled"
            ));
            await winner.dispose();
            releaseWaiterLoad();
            const outcome = await waiting.then(
                (result) => ({ kind: "resolved" as const, result }),
                (error: unknown) => ({
                    kind: "rejected" as const,
                    code: error && typeof error === "object" && "code" in error ? String(error.code) : "unexpected",
                }),
            );
            const videoBytes = Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]);
            assert.deepEqual(outcome, terminal === "completed"
                ? {
                    kind: "resolved",
                    result: {
                        mode: "video",
                        video: {
                            dataUrl: `data:video/mp4;base64,${videoBytes.toString("base64")}`,
                            mimeType: "video/mp4",
                            bytes: videoBytes.byteLength,
                        },
                    },
                }
                : { kind: "rejected", code: "dreamina_cancelled" });
            assert.equal(waiterQueries, 0);
            assert.equal(winnerQueries, terminal === "completed" ? 2 : 1);
        } finally {
            releaseWinner();
            releaseWaiterLoad();
            await Promise.all([winner.dispose(), waiter.dispose()]);
            await box.cleanup();
        }
    }
});

test("Dreamina cross-Runtime durable completion restores every image without querying from the waiter", async () => {
    const box = await sandbox();
    const id = "dreamina-durable-images-0001";
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: id,
            requestHash: "8".repeat(64),
            state: "accepted",
            updatedAt: "2026-08-13T00:00:00.000Z",
            submitId: "receipt-durable-images",
            taskVersion: 1,
            operation: "text2image",
            mode: "image",
            model: "5.0",
            createdAt: "2026-08-13T00:00:00.000Z",
            nextPollAt: "2000-01-01T00:00:00.000Z",
        }],
    }));
    let releaseWinner!: () => void;
    let markWinnerEntered!: () => void;
    const gate = new Promise<void>((resolve) => { releaseWinner = resolve; });
    const entered = new Promise<void>((resolve) => { markWinnerEntered = resolve; });
    let winnerQueries = 0;
    let waiterQueries = 0;
    let markWaiterLoaded!: () => void;
    let releaseWaiterLoad!: () => void;
    const waiterLoaded = new Promise<void>((resolve) => { markWaiterLoaded = resolve; });
    const waiterLoadGate = new Promise<void>((resolve) => { releaseWaiterLoad = resolve; });
    const waiterArtifactStore = new DreaminaProviderArtifactStore({
        root: path.join(box.root, "dreamina-provider-artifacts"),
    });
    waiterArtifactStore.scavenge = async () => {
        markWaiterLoaded();
        await waiterLoadGate;
    };
    const winner = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            winnerQueries += 1;
            if (winnerQueries === 1) {
                markWinnerEntered();
                await gate;
            }
            const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
            if (output) {
                await fs.writeFile(path.join(output, "01.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
                await fs.writeFile(path.join(output, "02.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]));
            }
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    const waiter = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => {
            waiterQueries += 1;
            return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
        },
        artifactStore: waiterArtifactStore,
    });
    const waiterReconciler = (waiter as unknown as {
        reconciler: { requestNow(idempotencyKey: string, signal?: AbortSignal): Promise<void> };
    }).reconciler;
    const requestWaiterReconcile = waiterReconciler.requestNow.bind(waiterReconciler);
    let waiterRequestNowCalls = 0;
    waiterReconciler.requestNow = async (...args) => {
        waiterRequestNowCalls += 1;
        await requestWaiterReconcile(...args);
    };
    try {
        await winner.start();
        await entered;
        const waiting = waiter.waitForTask(id, "image");
        await waiterLoaded;
        releaseWinner();
        await waitForRuntimeRecord(box.stateFile, id, (record) => (
            record.state === "succeeded" && record.providerOutputs?.length === 2
        ));
        await winner.dispose();
        releaseWaiterLoad();
        const result = await waiting;
        assert.equal(result.mode, "image");
        assert.deepEqual(result.images?.map((image) => ({ mimeType: image.mimeType, bytes: image.bytes })), [
            { mimeType: "image/png", bytes: 8 },
            { mimeType: "image/png", bytes: 9 },
        ]);
        assert.equal(waiterRequestNowCalls, 0);
        assert.equal(waiterQueries, 0);
        assert.equal(winnerQueries, 2);
    } finally {
        releaseWinner();
        releaseWaiterLoad();
        await Promise.allSettled([winner.dispose(), waiter.dispose()]);
        await box.cleanup();
    }
});

test("Dreamina durable wait fallback converges completed, cancelled, and failed when every watcher event is lost", async () => {
    for (const terminal of ["completed", "cancelled", "failed"] as const) {
        const box = await sandbox();
        const id = `dreamina-watch-fallback-${terminal}-0001`;
        await fs.writeFile(box.stateFile, JSON.stringify({
            version: 1,
            records: [{
                ownerId,
                idempotencyKey: id,
                requestHash: terminal === "completed" ? "1".repeat(64) : terminal === "cancelled" ? "2".repeat(64) : "3".repeat(64),
                state: "accepted",
                updatedAt: "2026-08-13T00:00:00.000Z",
                submitId: `receipt-watch-fallback-${terminal}`,
                taskVersion: 1,
                operation: "text2video",
                mode: "video",
                model: "seedance2.0mini",
                createdAt: "2026-08-13T00:00:00.000Z",
                nextPollAt: "2000-01-01T00:00:00.000Z",
            }],
        }));
        let releaseWinner!: () => void;
        let markWinnerEntered!: () => void;
        const winnerGate = new Promise<void>((resolve) => { releaseWinner = resolve; });
        const winnerEntered = new Promise<void>((resolve) => { markWinnerEntered = resolve; });
        let winnerQueries = 0;
        let waiterQueries = 0;
        const winner = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async (input) => {
                winnerQueries += 1;
                if (winnerQueries === 1) {
                    markWinnerEntered();
                    await winnerGate;
                }
                const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
                if (terminal === "completed" && output) {
                    await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
                }
                return { exitCode: 0, stdout: JSON.stringify({ status: terminal }), stderr: "" };
            },
        });
        const monitor = durableWaitMonitor();
        const waiter = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async () => {
                waiterQueries += 1;
                return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
            },
            ...monitor.options,
        } as DreaminaCliRuntimeOptions);
        try {
            await winner.start();
            await winnerEntered;
            const waiting = waiter.waitForTask(id, "video");
            await waitFor(() => monitor.counts().watchers === 1 && monitor.counts().timers === 1);
            releaseWinner();
            const outcome = await waiting.then(
                (result) => ({ kind: "resolved" as const, result }),
                (error: unknown) => ({
                    kind: "rejected" as const,
                    code: error && typeof error === "object" && "code" in error ? String(error.code) : "unexpected",
                }),
            );
            if (terminal === "completed") {
                assert.equal(outcome.kind, "resolved");
                assert.equal(outcome.kind === "resolved" ? outcome.result.video?.mimeType : undefined, "video/mp4");
            } else {
                assert.deepEqual(outcome, {
                    kind: "rejected",
                    code: terminal === "cancelled" ? "dreamina_cancelled" : "dreamina_official_failed",
                });
            }
            assert.equal(waiterQueries, 0);
            assert.equal(winnerQueries, terminal === "completed" ? 2 : 1);
            assert.deepEqual(monitor.counts(), { watchers: 0, timers: 0 });
            await waiter.dispose();
            assert.deepEqual(monitor.counts(), { watchers: 0, timers: 0 });
        } finally {
            releaseWinner();
            await Promise.allSettled([winner.dispose(), waiter.dispose()]);
            await box.cleanup();
        }
    }
});

test("Dreamina durable wait releases watcher, fallback timer, and reload work after abort or dispose", async () => {
    for (const stop of ["abort", "dispose"] as const) {
        const box = await sandbox();
        const id = `dreamina-watch-cleanup-${stop}-0001`;
        await fs.writeFile(box.stateFile, JSON.stringify({
            version: 1,
            records: [{
                ownerId,
                idempotencyKey: id,
                requestHash: stop === "abort" ? "4".repeat(64) : "5".repeat(64),
                state: "accepted",
                updatedAt: "2026-08-13T00:00:00.000Z",
                submitId: `receipt-watch-cleanup-${stop}`,
                taskVersion: 1,
                operation: "text2video",
                mode: "video",
                model: "seedance2.0mini",
                createdAt: "2026-08-13T00:00:00.000Z",
                nextPollAt: "2000-01-01T00:00:00.000Z",
            }],
        }));
        let markOwnerEntered!: () => void;
        const ownerEntered = new Promise<void>((resolve) => { markOwnerEntered = resolve; });
        const owner = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async (input) => {
                markOwnerEntered();
                return await new Promise((resolve) => input.signal?.addEventListener("abort", () => (
                    resolve({ exitCode: 0, stdout: '{"status":"pending"}', stderr: "" })
                ), { once: true }));
            },
        });
        const monitor = durableWaitMonitor();
        const waiter = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            runProcess: async () => {
                throw new Error("waiter must not query while another poll lease is live");
            },
            ...monitor.options,
        } as DreaminaCliRuntimeOptions);
        const controller = new AbortController();
        try {
            await owner.start();
            await ownerEntered;
            const waiting = waiter.waitForTask(id, "video", stop === "abort" ? { signal: controller.signal } : {});
            await waitFor(() => monitor.counts().watchers === 1 && monitor.counts().timers === 1);
            const rejected = assert.rejects(waiting, (error: unknown) => (
                error instanceof DreaminaCliError && error.code === "dreamina_cancelled"
            ));
            if (stop === "abort") controller.abort();
            else await waiter.dispose();
            await rejected;
            await waitFor(() => monitor.counts().watchers === 0 && monitor.counts().timers === 0);
            assert.deepEqual(monitor.counts(), { watchers: 0, timers: 0 });
        } finally {
            controller.abort();
            await Promise.allSettled([owner.dispose(), waiter.dispose()]);
            await box.cleanup();
        }
    }
});

test("Dreamina resumeToResult persists account-blocked without querying and recovers after switching back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-resume-account-blocked-"));
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
            idempotencyKey: "dreamina-resume-account-blocked-0001",
            requestHash: "e".repeat(64),
            state: "accepted",
            submitId: "receipt-resume-account-blocked",
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
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        arbiter,
        ensureReady: async () => arbiter.readSession(),
        discover: async () => installation,
        maxPollAttempts: 1,
        runProcess: async (input) => {
            queryCalls += 1;
            const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
            if (output) await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    try {
        await assert.rejects(runtime.resumeToResult("dreamina-resume-account-blocked-0001", "video"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
        let disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.state, "accepted");
        assert.equal(disk.records[0]?.errorCode, "dreamina_account_session_changed");

        lease = await arbiter.acquire();
        await arbiter.commitSession(lease, accountA);
        await lease.release();
        await runtime.resumeToResult("dreamina-resume-account-blocked-0001", "video");
        assert.ok(queryCalls >= 2);
        disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.ok(disk.records[0]?.state === "accepted" || disk.records[0]?.state === "succeeded");
        assert.equal(disk.records[0]?.errorCode, undefined);
    } finally {
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina succeeded rematerialization persists account-blocked without changing provider success and recovers after switching back", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-succeeded-account-blocked-"));
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
            idempotencyKey: "dreamina-succeeded-account-blocked-0001",
            requestHash: "f".repeat(64),
            state: "succeeded",
            submitId: "receipt-succeeded-account-blocked",
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
        runProcess: async (input) => {
            queryCalls += 1;
            const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
            if (output) await fs.writeFile(path.join(output, "result.mp4"), Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    const blocked = makeRuntime();
    try {
        await blocked.getTask("dreamina-succeeded-account-blocked-0001");
        await assert.rejects(blocked.waitForTask("dreamina-succeeded-account-blocked-0001", "video"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_account_session_changed"
        ));
        assert.equal(queryCalls, 0);
        let disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.state, "succeeded");
        assert.equal(disk.records[0]?.errorCode, "dreamina_account_session_changed");

        await blocked.dispose();
        lease = await arbiter.acquire();
        await arbiter.commitSession(lease, accountA);
        await lease.release();
        const restored = makeRuntime();
        await restored.getTask("dreamina-succeeded-account-blocked-0001");
        await restored.waitForTask("dreamina-succeeded-account-blocked-0001", "video");
        assert.equal(queryCalls, 2);
        disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
        assert.equal(disk.records[0]?.state, "succeeded");
        assert.equal(disk.records[0]?.errorCode, undefined);
        await restored.dispose();
    } finally {
        await blocked.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});

for (const operation of ["cancel", "delete", "dispose"] as const) {
    test(`Dreamina ${operation} aborts a queue-heartbeat state-lock waiter before lock expiry`, async () => {
        const box = await sandbox();
        let releaseQuery!: () => void;
        const queryGate = new Promise<void>((resolve) => { releaseQuery = resolve; });
        let lockHeld = false;
        let currentHeartbeatKey: string | undefined;
        let waitingKey: string | undefined;
        let heartbeatStarted!: (key: string) => void;
        const heartbeatWaiting = new Promise<string>((resolve) => { heartbeatStarted = resolve; });
        let heartbeatSettled!: () => void;
        const heartbeatStopped = new Promise<void>((resolve) => { heartbeatSettled = resolve; });
        let submits = 0;
        const runtime = new DreaminaCliRuntime({
            ownerId,
            stateFile: box.stateFile,
            ensureReady: async () => undefined,
            discover: async () => installation,
            maxActiveTasks: 1,
            reservationLeaseMs: 1_000,
            reservationHeartbeatMs: 10,
            runProcess: async (input) => {
                if (input.args[0] === "text2video") {
                    submits += 1;
                    input.onSpawn?.(4242);
                    return { exitCode: 0, stdout: `{"submit_id":"receipt-heartbeat-${operation}"}`, stderr: "" };
                }
                await queryGate;
                return { exitCode: 0, stdout: '{"gen_status":"processing"}', stderr: "" };
            },
            onQueueHeartbeatWait(event, key) {
                if (event === "started") {
                    currentHeartbeatKey = key;
                    if (lockHeld && !waitingKey) {
                        waitingKey = key;
                        heartbeatStarted(key);
                    }
                } else if (event === "settled") {
                    if (key === currentHeartbeatKey) currentHeartbeatKey = undefined;
                    if (key === waitingKey) heartbeatSettled();
                }
            },
        });
        let releaseStateLock: Awaited<ReturnType<typeof acquireStateLock>> | undefined;
        let action: Promise<unknown> | undefined;
        let disposing: Promise<void> | undefined;
        try {
            await runtime.enqueue({
                operation: "text2video",
                idempotencyKey: `dreamina-heartbeat-${operation}-active-0001`,
                prompt: "active",
                modelVersion: "seedance2.0mini",
                ratio: "16:9",
                videoResolution: "720p",
                duration: 4,
            });
            const queued = await runtime.enqueue({
                operation: "text2video",
                idempotencyKey: `dreamina-heartbeat-${operation}-queued-0001`,
                prompt: "queued",
                modelVersion: "seedance2.0mini",
                ratio: "16:9",
                videoResolution: "720p",
                duration: 4,
            });
            assert.equal(queued.status, "queued");

            releaseStateLock = await acquireStateLock(box.stateFile);
            lockHeld = true;
            if (currentHeartbeatKey && !waitingKey) {
                waitingKey = currentHeartbeatKey;
                heartbeatStarted(currentHeartbeatKey);
            }
            assert.equal(await heartbeatWaiting, `${ownerId}\u0000${queued.id}`);

            if (operation === "cancel") {
                action = runtime.cancelTask(queued.id);
            } else if (operation === "delete") {
                action = runtime.deleteTask(queued.id);
            } else {
                disposing = runtime.dispose();
                action = disposing;
            }
            let timeout: NodeJS.Timeout | undefined;
            try {
                await Promise.race([
                    heartbeatStopped,
                    new Promise<never>((_resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error(`${operation} waited for state-lock expiry before stopping queue heartbeat`)), 250);
                    }),
                ]);
            } finally {
                if (timeout) clearTimeout(timeout);
            }

            await releaseStateLock();
            releaseStateLock = undefined;
            releaseQuery();
            const result = await action;
            if (operation === "cancel") {
                assert.equal((result as { status: string }).status, "cancelled");
            } else if (operation === "delete") {
                assert.deepEqual(result, { deleted: true });
            }
            assert.equal(submits, 1);
            const disk = JSON.parse(await fs.readFile(box.stateFile, "utf8")) as { records: Array<Record<string, unknown>> };
            const durable = disk.records.find((record) => record.idempotencyKey === queued.id);
            assert.equal(durable?.queueOwnerId, undefined);
            assert.equal(durable?.queueExpiresAt, undefined);
        } finally {
            lockHeld = false;
            await releaseStateLock?.();
            releaseQuery();
            await action?.catch(() => undefined);
            await (disposing ?? runtime.dispose());
            await box.cleanup();
        }
    });
}

test("Dreamina accepted records carrying a queue lease remain invalid", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-accepted-queue-lease-0001",
            requestHash: "d".repeat(64),
            state: "accepted",
            submitId: "receipt-invalid-queue-lease",
            queueOwnerId: "11111111-1111-4111-8111-111111111111",
            queueExpiresAt: "2026-08-13T00:05:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z",
        }],
    }));
    const runtime = new DreaminaCliRuntime({ ownerId, stateFile: box.stateFile, ensureReady: async () => undefined });
    let disposing: Promise<void> | undefined;
    try {
        await assert.rejects(runtime.getTask("dreamina-accepted-queue-lease-0001"), (error: unknown) => (
            error instanceof DreaminaCliError && error.code === "dreamina_state_invalid"
        ));
        disposing = runtime.dispose();
        await assert.doesNotReject(disposing);
    } finally {
        await (disposing ?? runtime.dispose());
        await box.cleanup();
    }
});

test("Dreamina durable succeeded records require a receipt fence", async () => {
    const box = await sandbox();
    await fs.writeFile(box.stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId,
            idempotencyKey: "dreamina-success-no-receipt-0001",
            requestHash: "c".repeat(64),
            state: "succeeded",
            updatedAt: "2026-08-12T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-12T00:00:00.000Z",
        }],
    }));
    const runtime = new DreaminaCliRuntime({ ownerId, stateFile: box.stateFile, ensureReady: async () => undefined });
    try {
        await assert.rejects(runtime.getTask("dreamina-success-no-receipt-0001"), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_state_invalid");
        await assert.doesNotReject(runtime.dispose());
    } finally {
        await runtime.dispose();
        await box.cleanup();
    }
});

test("Dreamina shared task identity and scoped context survive a Runtime restart", async () => {
    const box = await sandbox();
    const idempotencyKey = "dreamina-context-restart-0001";
    const taskContext = {
        scope: "scoped" as const,
        projectId: "project-context-restart",
        nodeId: "node-context-restart",
        retryOf: "dreamina:prior-context-restart",
        attemptGroupId: "dreamina:prior-context-restart",
    };
    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        pollIntervalMs: 60_000,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async (input) => {
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-context-restart"}', stderr: "" };
        },
    });
    try {
        const submitted = await runtime.enqueue({ ...request, idempotencyKey }, {
            requestFingerprint: "d".repeat(64),
            clientOperationId: "retry-client-context-restart-0001",
            taskContext,
        } as unknown as Parameters<typeof runtime.enqueue>[1]);
        assert.equal(submitted.status, "running");
    } finally {
        await runtime.dispose();
    }

    const restarted = new DreaminaCliRuntime({
        ownerId,
        stateFile: box.stateFile,
        pollIntervalMs: 60_000,
        ensureReady: async () => undefined,
        discover: async () => installation,
        runProcess: async () => { throw new Error("restart read must not invoke CLI"); },
    });
    try {
        const tasks = await restarted.listTasks();
        assert.equal(tasks.length, 1);
        assert.equal((tasks[0] as unknown as { clientOperationId?: string }).clientOperationId, "retry-client-context-restart-0001");
        assert.deepEqual((tasks[0] as unknown as { context?: unknown }).context, taskContext);
    } finally {
        await restarted.dispose();
        await box.cleanup();
    }
});

async function sandbox() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-runtime-"));
    return {
        root,
        stateFile: path.join(root, "state.json"),
        cleanup: () => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 10 }),
    };
}

function durableWaitMonitor() {
    let watchers = 0;
    let timers = 0;
    const options = {
        durableReloadIntervalMs: 5,
        watchStateFile(_listener: (filename: string | null) => void) {
            watchers += 1;
            let closed = false;
            return {
                close() {
                    if (closed) return;
                    closed = true;
                    watchers -= 1;
                },
            };
        },
        scheduleDurableReload(callback: () => void, delayMs: number) {
            assert(delayMs >= 5 && delayMs <= 5_000);
            timers += 1;
            let active = true;
            const timer = setTimeout(() => {
                if (!active) return;
                active = false;
                timers -= 1;
                callback();
            }, delayMs);
            return {
                cancel() {
                    if (!active) return;
                    active = false;
                    clearTimeout(timer);
                    timers -= 1;
                },
            };
        },
    };
    return { options, counts: () => ({ watchers, timers }) };
}

async function waitFor(condition: () => boolean) {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina spawn");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function waitForAsync(condition: () => Promise<boolean>, timeoutMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina async state");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function waitForPromise<T>(promise: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

type RuntimeRecordFixture = {
    idempotencyKey?: string;
    state?: string;
    hidden?: boolean;
    providerOutputs?: unknown[];
};

async function readRuntimeRecordWhenAvailable(stateFile: string, idempotencyKey: string) {
    try {
        const disk = JSON.parse(await fs.readFile(stateFile, "utf8")) as {
            records?: RuntimeRecordFixture[];
        };
        return disk.records?.find((record) => record.idempotencyKey === idempotencyKey);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}

async function waitForRuntimeRecord(
    stateFile: string,
    idempotencyKey: string,
    condition: (record: RuntimeRecordFixture) => boolean,
    timeoutMs = 5_000,
) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const record = await readRuntimeRecordWhenAvailable(stateFile, idempotencyKey);
        if (record && condition(record)) return record;
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina durable record");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function acceptedVideoRecord(index: number) {
    return {
        ownerId,
        idempotencyKey: `dreamina-query-fifo-000${index}`,
        requestHash: String(index).repeat(64),
        state: "accepted",
        updatedAt: `2026-08-12T00:0${index}:00.000Z`,
        submitId: `receipt-fifo-${index}`,
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0",
        createdAt: `2026-08-12T00:0${index}:00.000Z`,
    };
}

async function writePng(file: string) {
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}
