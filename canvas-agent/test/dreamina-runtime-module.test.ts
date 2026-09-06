import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { dreaminaCliInputSchema } from "../src/dreamina-cli-contract.js";
import { DreaminaCliArbiter } from "../src/dreamina-cli-arbiter.js";
import { LocalDreaminaGenerationError } from "../src/dreamina-generation.js";
import { projectDreaminaModelCatalog } from "../src/dreamina-model-catalog.js";
import { DreaminaProviderArtifactStore } from "../src/dreamina-provider-artifacts.js";
import { DreaminaTaskProjector } from "../src/dreamina-task-projection.js";
import { DreaminaTaskStore } from "../src/dreamina-task-store.js";
import { createDreaminaHttpModule } from "../src/modules/dreamina-http.js";
import { DreaminaCliError } from "../src/dreamina-cli-process.js";
import type { DreaminaPublicStatus } from "../src/dreamina-cli.js";

const installed: DreaminaPublicStatus = {
    provider: "dreamina-cli",
    state: "installed",
    installed: true,
    authenticated: false,
    code: "dreamina_login_required",
    message: "Dreamina CLI 已安装，需要登录",
};

test("Dreamina module stages generated and configured references when another optional Canvas root is absent", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-reference-"));
    const canvasRoot = path.join(configDir, "canvas-workspace");
    const absentCanvasRoot = path.join(configDir, "canvas-not-created-yet");
    const canvasReference = path.join(canvasRoot, "reference.png");
    const calls: string[][] = [];
    let submitCalls = 0;
    await fs.mkdir(canvasRoot);
    await fs.writeFile(canvasReference, pngFixture());

    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        referenceRoots: () => [absentCanvasRoot, canvasRoot],
        dreamina: authenticatedLifecycleFixture(),
        runtimeDependencies: {
            discover: async () => ({ installed: true, executable: "dreamina-fixture" }),
            maxPollAttempts: 1,
            pollIntervalMs: 0,
            runProcess: async (input) => {
                calls.push([...input.args]);
                input.onSpawn?.(4242);
                if (input.args[0] === "query_result") {
                    const outputRoot = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
                    assert(outputRoot);
                    await fs.writeFile(path.join(outputRoot, "result.mp4"), mp4Fixture());
                    return { exitCode: 0, stdout: '{"submit_id":"receipt-1","gen_status":"success"}', stderr: "" };
                }
                submitCalls += 1;
                return { exitCode: 0, stdout: `{"submit_id":"receipt-submit-${submitCalls}"}`, stderr: "" };
            },
        },
    });

    try {
        const generated = await invoke(module, "/dreamina/generate", Buffer.from(JSON.stringify({
            idempotencyKey: "seedance-reference-route-0001",
            operation: "image-to-video",
            model: "seedance2.0mini",
            prompt: "Animate this reference",
            settings: { resolution: "720", duration: 4 },
            references: [{ kind: "image", mimeType: "image/png", contentBase64: pngFixture().toString("base64") }],
        })));
        assert.equal((generated as { ok?: boolean }).ok, true, JSON.stringify({ generated, calls }));
        assert.equal(calls[0]?.[0], "image2video");
        const generatedReference = calls[0]?.find((arg) => arg.startsWith("--image="))?.slice("--image=".length);
        assert(generatedReference && path.isAbsolute(generatedReference));
        assert(generatedReference.includes(`${path.sep}.dreamina-references-`));

        const accepted = await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
            operation: "image2image",
            idempotencyKey: "canvas-reference-route-0001",
            prompt: "Edit this Canvas reference",
            resolutionType: "2k",
            referenceImages: [canvasReference],
        })));
        assert.deepEqual(accepted, { ok: true, result: { state: "accepted", receiptRecorded: true } });
        assert.doesNotMatch(JSON.stringify(accepted), /submitId|receipt-submit-2/);
        const journal = JSON.parse(await fs.readFile(path.join(configDir, "dreamina-runtime-state.json"), "utf8")) as {
            records: Array<{ idempotencyKey?: string; submitId?: string }>;
        };
        assert.equal(journal.records.find((record) => record.idempotencyKey === "canvas-reference-route-0001")?.submitId, "receipt-submit-2");
        assert.equal(calls.filter((args) => args[0] !== "query_result")[1]?.[0], "image2image");
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina production module startup reconciles due accepted work without route traffic", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-startup-"));
    const journalFile = path.join(configDir, "dreamina-runtime-state.json");
    let queries = 0;
    await fs.writeFile(journalFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId: "owner-dreamina-module-0001",
            idempotencyKey: "dreamina-module-startup-0001",
            requestHash: "a".repeat(64),
            state: "accepted",
            updatedAt: "2026-08-13T00:00:00.000Z",
            submitId: "receipt-module-startup",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z",
            nextPollAt: "2020-01-01T00:00:00.000Z",
        }],
    }));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        runtimeDependencies: {
            pollIntervalMs: 5,
            discover: async () => ({ installed: true, executable: "dreamina-fixture" }),
            runProcess: async () => {
                queries += 1;
                return { exitCode: 0, stdout: '{"status":"cancelled"}', stderr: "" };
            },
        },
    });
    const startup = (module as typeof module & { start?: () => Promise<void> }).start;
    try {
        assert.equal(typeof startup, "function");
        await startup?.();
        await waitForCondition(async () => {
            const disk = JSON.parse(await fs.readFile(journalFile, "utf8"));
            return disk.records[0]?.state === "cancelled";
        });
        assert.equal(queries, 1);
        assert.deepEqual(await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
            operation: "query_result",
            submitId: "receipt-module-startup",
        }))), {
            ok: false,
            code: "dreamina_request_invalid",
            message: "Dreamina 请求参数无效",
        });
        assert.equal(queries, 1);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina module declares model reads without probing CLI or Canvas", () => {
    const calls: string[] = [];
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });

    assert.deepEqual(module.descriptor, {
        id: "dreamina",
        displayName: "Dreamina CLI",
        apiVersion: 1,
        scopes: ["dreamina:status", "dreamina:login", "dreamina:logout", "dreamina:run", "dreamina:models", "dreamina:generate"],
    });
    assert.deepEqual(module.routes.map((route) => [route.method, route.path, route.scope]), [
        ["GET", "/dreamina/status", "dreamina:status"],
        ["POST", "/dreamina/login", "dreamina:login"],
        ["POST", "/dreamina/logout", "dreamina:logout"],
        ["POST", "/dreamina/run", "dreamina:run"],
        ["GET", "/dreamina/models", "dreamina:models"],
        ["POST", "/dreamina/generate", "dreamina:generate"],
        ["GET", "/dreamina/generate/tasks", "dreamina:generate"],
        ["POST", "/dreamina/generate/query", "dreamina:generate"],
        ["POST", "/dreamina/generate/wait", "dreamina:generate"],
        ["POST", "/dreamina/generate/refresh", "dreamina:generate"],
        ["POST", "/dreamina/generate/cancel", "dreamina:generate"],
        ["POST", "/dreamina/generate/delete", "dreamina:generate"],
        ["POST", "/dreamina/generate/effects/claim", "dreamina:generate"],
        ["POST", "/dreamina/generate/effects/renew", "dreamina:generate"],
        ["POST", "/dreamina/generate/effects/complete", "dreamina:generate"],
        ["POST", "/dreamina/generate/effects/release", "dreamina:generate"],
    ]);
    assert.deepEqual(calls, []);
});

test("Dreamina module recovers product task projections from durable journal versions before task reads", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-task-store-"));
    const journalFile = path.join(configDir, "dreamina-runtime-state.json");
    const storeFile = path.join(configDir, "dreamina-generation-task-store.json");
    const calls: string[] = [];
    await fs.writeFile(journalFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId: "owner-dreamina-module-0001",
            idempotencyKey: "dreamina-module-projection-0001",
            requestHash: "f".repeat(64),
            state: "queued",
            journalVersion: 3,
            updatedAt: "2026-08-13T00:03:00.000Z",
            taskVersion: 1,
            operation: "text2video",
            mode: "video",
            model: "seedance2.0mini",
            createdAt: "2026-08-13T00:00:00.000Z",
        }],
    }));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });
    try {
        await invoke(module, "/dreamina/generate/tasks", undefined);
        const disk = JSON.parse(await fs.readFile(storeFile, "utf8")) as {
            tasks: Array<{ taskId: string; lifecycle: string; projectedJournalVersion: number; context: unknown; accountBinding?: string }>;
        };
        assert.equal(disk.tasks.length, 1);
        assert.equal(disk.tasks[0]?.taskId, "dreamina:dreamina-module-projection-0001");
        assert.equal(disk.tasks[0]?.lifecycle, "QUEUED_LOCAL");
        assert.equal(disk.tasks[0]?.projectedJournalVersion, 3);
        assert.deepEqual(disk.tasks[0]?.context, { scope: "legacy_unscoped" });
        assert.equal(disk.tasks[0]?.accountBinding, undefined);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina model reads require the official CLI login and never execute generation", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-model-logged-out-"));
    const calls: string[] = [];
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });

    const rejected = await invoke(module, "/dreamina/models", undefined);
    assert.deepEqual(rejected, {
        ok: false,
        code: "dreamina_login_required",
        message: "Dreamina CLI 需要先登录",
    });
    assert.deepEqual(calls, []);
    await module.dispose?.();
    await fs.rm(configDir, { recursive: true, force: true });
});

test("Dreamina model catalog returns the last authenticated account cache scope without another status read", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-model-scope-"));
    const calls: string[] = [];
    const accountBinding = "d".repeat(64);
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(configDir, "dreamina-cli-arbiter.json"), pollMs: 1 });
    const lease = await arbiter.acquire();
    const session = await arbiter.commitSession(lease, accountBinding);
    await lease.release();
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        arbiter,
        dreamina: {
            ...lifecycleFixture(calls),
            status: async () => {
                calls.push("status");
                return { ...installed, state: "authenticated" as const, authenticated: true, accountBinding, sessionEpoch: 7, message: "authenticated" };
            },
        },
        dreaminaRuntime: runtimeFixture(calls),
    });

    const response = await invoke(module, "/dreamina/models", undefined) as Record<string, unknown>;
    assert.equal(response.ok, true);
    assert.equal(response.accountBinding, accountBinding);
    assert.equal(response.sessionEpoch, session.sessionEpoch);
    assert.equal(Array.isArray(response.models), true);
    assert.deepEqual(calls, []);
    await module.dispose?.();
    await fs.rm(configDir, { recursive: true, force: true });
});

test("Dreamina model catalog uses the last authenticated session scope without spawning a CLI status check", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-model-session-"));
    const arbiter = new DreaminaCliArbiter({ stateFile: path.join(configDir, "dreamina-cli-arbiter.json"), pollMs: 1 });
    const lease = await arbiter.acquire();
    const accountBinding = "e".repeat(64);
    const session = await arbiter.commitSession(lease, accountBinding);
    await lease.release();
    let statusCalls = 0;
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        arbiter,
        dreamina: {
            ...lifecycleFixture([]),
            status: async () => {
                statusCalls += 1;
                throw new Error("model catalog must not spawn Dreamina CLI status");
            },
        },
        dreaminaRuntime: runtimeFixture([]),
    });
    try {
        const response = await invoke(module, "/dreamina/models", undefined) as Record<string, unknown>;
        assert.equal(response.ok, true);
        assert.equal(response.accountBinding, accountBinding);
        assert.equal(response.sessionEpoch, session.sessionEpoch);
        assert.equal(Array.isArray(response.models), true);
        assert.equal(statusCalls, 0);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina generation fails closed on projection recovery before crossing the paid submit boundary", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-projection-fail-"));
    const calls: string[] = [];
    let generationCalls = 0;
    await fs.writeFile(path.join(configDir, "dreamina-runtime-state.json"), JSON.stringify({ version: 1, records: "invalid" }));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
        generation: {
            async run() { throw new Error("synchronous generation must not run"); },
            async submit() {
                generationCalls += 1;
                return taskFixture("seedance-projection-fail-0001", "running", "submitted");
            },
        },
    });
    try {
        const result = await invoke(module, "/dreamina/generate", Buffer.from(JSON.stringify({
            idempotencyKey: "seedance-projection-fail-0001",
            operation: "text-to-video",
            model: "seedance2.0mini",
            prompt: "fixture",
            settings: { resolution: "720p", duration: 4 },
            references: [],
        })));
        assert.equal((result as { ok?: boolean }).ok, false);
        assert.equal(generationCalls, 0);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina post-submit projection failure returns the accepted task and recovers from the durable journal later", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-post-projection-fail-"));
    const journalFile = path.join(configDir, "dreamina-runtime-state.json");
    const storeFile = path.join(configDir, "dreamina-generation-task-store.json");
    const calls: string[] = [];
    let generationCalls = 0;
    await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [] }));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
        generation: {
            async run() { throw new Error("synchronous generation must not run"); },
            async submit() {
                generationCalls += 1;
                await fs.writeFile(journalFile, JSON.stringify({
                    version: 1,
                    records: [{
                        ownerId: "owner-dreamina-module-0001",
                        idempotencyKey: "seedance-post-projection-0001",
                        requestHash: "7".repeat(64),
                        state: "accepted",
                        journalVersion: 1,
                        submitId: "provider-task-post-projection-fixture",
                        updatedAt: "2026-08-13T00:01:00.000Z",
                        taskVersion: 1,
                        operation: "text2video",
                        mode: "video",
                        model: "seedance2.0mini",
                        createdAt: "2026-08-13T00:00:00.000Z",
                    }],
                }));
                await fs.mkdir(storeFile);
                return taskFixture("seedance-post-projection-0001", "running", "submitted");
            },
        },
    });
    try {
        const result = await invoke(module, "/dreamina/generate", Buffer.from(JSON.stringify({
            idempotencyKey: "seedance-post-projection-0001",
            operation: "text-to-video",
            model: "seedance2.0mini",
            prompt: "fixture",
            settings: { resolution: "720p", duration: 4 },
            references: [],
        })));
        assert.deepEqual(result, {
            ok: true,
            result: taskFixture("seedance-post-projection-0001", "running", "submitted"),
        });
        assert.equal(generationCalls, 1);

        await fs.rm(storeFile, { recursive: true, force: true });
        const laterRead = await invoke(module, "/dreamina/generate/tasks", undefined);
        assert.equal((laterRead as { ok?: boolean }).ok, true);
        const disk = JSON.parse(await fs.readFile(storeFile, "utf8")) as { tasks: Array<{ taskId: string; lifecycle: string }> };
        assert.deepEqual(disk.tasks.map((task) => [task.taskId, task.lifecycle]), [
            ["dreamina:seedance-post-projection-0001", "ACCEPTED"],
        ]);
        assert.equal(generationCalls, 1);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina task list returns the projected product Store contract instead of Runtime journal DTOs", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-list-authority-"));
    const id = "dreamina-store-list-authority-0001";
    const accountBinding = "a".repeat(64);
    const calls: string[] = [];
    await writeModuleJournal(configDir, moduleJournalRecord(id, {
        accountBinding,
        sessionEpoch: 1,
        context: { scope: "scoped", projectId: "project-store-authority-0001", nodeId: "node-store-authority-0001" },
    }));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });
    try {
        const response = await invoke(module, "/dreamina/generate/tasks", undefined) as { ok: true; result: unknown };
        const tasks = Array.isArray(response.result)
            ? response.result as Array<Record<string, unknown>>
            : (response.result as { tasks: Array<Record<string, unknown>> }).tasks;
        assert.equal(tasks.length, 1);
        assert.equal(tasks[0]?.id, id);
        assert.equal(tasks[0]?.lifecycle, "ACCEPTED");
        assert.equal(tasks[0]?.syncState, "SYNC_OK");
        assert.equal(tasks[0]?.resultState, "NOT_AVAILABLE");
        assert.equal(tasks[0]?.accountBinding, accountBinding);
        assert.deepEqual(tasks[0]?.context, { scope: "scoped", projectId: "project-store-authority-0001", nodeId: "node-store-authority-0001" });
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina task query keeps a Store terminal and restores its provider artifact result over a stale Runtime accepted view", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-query-authority-"));
    const id = "dreamina-store-query-authority-0001";
    const accountBinding = "b".repeat(64);
    const { journalFile, providerOutputs, result } = await seedSucceededProductStore(configDir, id, accountBinding);
    await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [moduleJournalRecord(id, {
        state: "accepted",
        journalVersion: 2,
        accountBinding,
        sessionEpoch: 1,
    })] }));
    const calls: string[] = [];
    const runtime = runtimeFixture(calls);
    runtime.getTask = async (idempotencyKey: string) => {
        calls.push(`get:${idempotencyKey}`);
        return taskFixture(idempotencyKey, "running", "submitted");
    };
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtime,
    });
    try {
        const response = await invoke(module, "/dreamina/generate/query", Buffer.from(JSON.stringify({ idempotencyKey: id, mode: "video" }))) as {
            ok: true; result: Record<string, unknown>;
        };
        assert.equal(response.result.id, id);
        assert.equal(response.result.lifecycle, "TERMINAL");
        assert.equal(response.result.terminalOutcome, "SUCCEEDED");
        assert.equal(response.result.syncState, "SYNC_OK");
        assert.equal(response.result.resultState, "PENDING_MATERIALIZATION");
        assert.deepEqual(response.result.outputs, providerOutputs);
        assert.deepEqual(response.result.result, result);
        assert.equal(response.result.accountBinding, accountBinding);
        assert.equal(JSON.stringify(response.result).includes("submitId"), false);
        assert.deepEqual(calls, [`get:${id}`]);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina task wait returns the Store terminal produced after provider completion", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-wait-authority-"));
    const id = "dreamina-store-wait-authority-0001";
    const accountBinding = "c".repeat(64);
    const artifactStore = new DreaminaProviderArtifactStore({ root: path.join(configDir, "dreamina-provider-artifacts") });
    const result = {
        mode: "video" as const,
        video: { dataUrl: `data:video/mp4;base64,${mp4Fixture().toString("base64")}`, mimeType: "video/mp4", bytes: mp4Fixture().byteLength },
    };
    const providerOutputs = await artifactStore.persistResult(result, {
        ownerId: "owner-dreamina-module-0001",
        idempotencyKey: id,
        accountBinding,
        mode: "video",
    });
    const journalFile = await writeModuleJournal(configDir, moduleJournalRecord(id, { accountBinding, sessionEpoch: 1 }));
    const calls: string[] = [];
    const runtime = runtimeFixture(calls);
    runtime.getTask = async (idempotencyKey: string) => {
        calls.push(`get:${idempotencyKey}`);
        return taskFixture(idempotencyKey, "running", "submitted");
    };
    runtime.waitForTask = async (idempotencyKey: string, mode: "image" | "video") => {
        calls.push(`wait:${idempotencyKey}:${mode}`);
        await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [moduleJournalRecord(id, {
            state: "succeeded",
            journalVersion: 2,
            officialStatus: "completed",
            providerOutputs,
            accountBinding,
            sessionEpoch: 1,
        })] }));
        return result;
    };
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtime,
    });
    try {
        const response = await invoke(module, "/dreamina/generate/wait", Buffer.from(JSON.stringify({ idempotencyKey: id, mode: "video" }))) as {
            ok: true; result: Record<string, unknown>;
        };
        assert.equal(response.result.lifecycle, "TERMINAL");
        assert.equal(response.result.terminalOutcome, "SUCCEEDED");
        assert.equal(response.result.resultState, "PENDING_MATERIALIZATION");
        assert.deepEqual(response.result.outputs, providerOutputs);
        assert.deepEqual(response.result.result, result);
        assert.deepEqual(calls, [`get:${id}`, `wait:${id}:video`, `get:${id}`]);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina task read fails closed when the post-action journal cannot be projected", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-post-action-projection-"));
    const id = "dreamina-store-post-action-projection-0001";
    const journalFile = await writeModuleJournal(configDir, moduleJournalRecord(id));
    const calls: string[] = [];
    const runtime = runtimeFixture(calls);
    runtime.refreshTask = async (idempotencyKey: string) => {
        calls.push(`refresh:${idempotencyKey}`);
        await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [moduleJournalRecord(id, {
            journalVersion: 2,
            requestHash: "e".repeat(64),
            updatedAt: "2026-08-13T00:02:00.000Z",
        })] }));
        return taskFixture(idempotencyKey, "running", "generating");
    };
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtime,
    });
    try {
        const response = await invoke(module, "/dreamina/generate/refresh", Buffer.from(JSON.stringify({ idempotencyKey: id }))) as {
            ok: boolean; result?: Record<string, unknown>; code?: string;
        };
        assert.equal(response.ok, false);
        assert.equal(response.code, "dreamina_internal_error");
        assert.equal(response.result, undefined);
        assert.deepEqual(calls, [`refresh:${id}`]);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina task refresh preserves a Store success and exposes a contradictory provider failure as sync conflict", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-refresh-conflict-"));
    const id = "dreamina-store-refresh-conflict-0001";
    const { journalFile, providerOutputs, result } = await seedSucceededProductStore(configDir, id);
    await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [moduleJournalRecord(id, {
        state: "failed",
        journalVersion: 2,
        officialStatus: "failed",
    })] }));
    const calls: string[] = [];
    const runtime = runtimeFixture(calls);
    runtime.refreshTask = async (idempotencyKey: string) => {
        calls.push(`refresh:${idempotencyKey}`);
        return taskFixture(idempotencyKey, "failed", "failed");
    };
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtime,
    });
    try {
        const response = await invoke(module, "/dreamina/generate/refresh", Buffer.from(JSON.stringify({ idempotencyKey: id }))) as {
            ok: true; result: Record<string, unknown>;
        };
        assert.equal(response.result.lifecycle, "TERMINAL");
        assert.equal(response.result.terminalOutcome, "SUCCEEDED");
        assert.equal(response.result.syncState, "SYNC_CONFLICT");
        assert.deepEqual(response.result.outputs, providerOutputs);
        assert.deepEqual(response.result.result, result);
        assert.deepEqual(calls, [`refresh:${id}`]);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina accepted cancel detaches local waiting without claiming official cancellation", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-store-cancel-authority-"));
    const id = "dreamina-store-cancel-authority-0001";
    const calls: string[] = [];
    await writeModuleJournal(configDir, moduleJournalRecord(id));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });
    try {
        const response = await invoke(module, "/dreamina/generate/cancel", Buffer.from(JSON.stringify({ idempotencyKey: id }))) as {
            ok: true; result: Record<string, unknown>;
        };
        assert.equal(response.result.lifecycle, "ACCEPTED");
        assert.equal(response.result.terminalOutcome, undefined);
        assert.equal(response.result.status, "running");
        assert.equal(response.result.stage, "submitted");
        assert.equal(response.result.officialStatus, undefined);
        assert.deepEqual(calls, [`cancel:${id}`]);
    } finally {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("Dreamina generation uses its signed route and query recovery never submits a second request", async () => {
    const calls: string[] = [];
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-route-contract-"));
    await writeModuleJournal(configDir, moduleJournalRecord("seedance-route-0001"));
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
        generation: {
            async run() { throw new Error("synchronous generation must not run"); },
            async submit(input) {
                calls.push(`generate:${(input as { operation?: string }).operation}`);
                return taskFixture("seedance-route-0001", "running", "submitted");
            },
        },
    });
    const request = Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
        operation: "text-to-video",
        model: "seedance2.0mini",
        prompt: "A short test clip",
        settings: { resolution: "720p", duration: 4 },
        references: [],
    }));

    const generated = await invoke(module, "/dreamina/generate", request) as { ok: true; result: Record<string, unknown> };
    assert.equal(generated.ok, true);
    assert.equal(generated.result.lifecycle, "ACCEPTED");
    const listed = await invoke(module, "/dreamina/generate/tasks", undefined) as { ok: true; result: { tasks: Array<Record<string, unknown>> } };
    assert.equal(listed.result.tasks[0]?.lifecycle, "ACCEPTED");
    const waited = await invoke(module, "/dreamina/generate/wait", Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
        mode: "video",
    }))) as { ok: true; result: Record<string, unknown> };
    assert.equal(waited.result.lifecycle, "ACCEPTED");
    const queried = await invoke(module, "/dreamina/generate/query", Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
        mode: "video",
    }))) as { ok: true; result: Record<string, unknown> };
    assert.equal(queried.result.lifecycle, "ACCEPTED");
    const refreshed = await invoke(module, "/dreamina/generate/refresh", Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
    }))) as { ok: true; result: Record<string, unknown> };
    assert.equal(refreshed.result.lifecycle, "ACCEPTED");
    const cancelled = await invoke(module, "/dreamina/generate/cancel", Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
    }))) as { ok: true; result: Record<string, unknown> };
    assert.equal(cancelled.result.lifecycle, "ACCEPTED");
    assert.deepEqual(await invoke(module, "/dreamina/generate/delete", Buffer.from(JSON.stringify({
        idempotencyKey: "seedance-route-0001",
    }))), { ok: true, result: { deleted: true } });
    assert.deepEqual(calls, ["generate:text-to-video", "get:seedance-route-0001", "wait:seedance-route-0001:video", "get:seedance-route-0001", "get:seedance-route-0001", "refresh:seedance-route-0001", "cancel:seedance-route-0001", "delete:seedance-route-0001"]);
    await module.dispose?.();
    await fs.rm(configDir, { recursive: true, force: true });
});

test("Dreamina catalog projects the official Seedance minimum from its execution contract", () => {
    const seedanceMini = projectDreaminaModelCatalog().find((model) => (
        model.id === "seedance2.0mini" && model.modality === "video"
    ));

    assert.deepEqual(seedanceMini, {
        provider: "dreamina-cli",
        id: "seedance2.0mini",
        displayName: "seedance2.0mini",
        modality: "video",
        operations: ["text-to-video", "image-to-video", "reference-to-video", "multi-frame-to-video"],
        adapterSupported: true,
        accountEntitlement: "unknown",
        currentlyObservedAvailable: "unknown",
        settings: {
            aliases: [],
            aspects: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
            maxReferenceImages: 20,
            minDuration: 4,
            maxDuration: 15,
            tiers: ["720p"],
        },
        source: "runtime-execution-contract",
    });
});

test("Seedance 2.5 accepts the complete legal 30 image 10 video 10 audio reference set", () => {
    const parsed = dreaminaCliInputSchema.safeParse({
        operation: "multimodal2video",
        idempotencyKey: "seedance-2-5-complete-reference-set-0001",
        modelVersion: "seedance2.5",
        videoResolution: "720p",
        duration: 30,
        referenceImages: Array.from({ length: 30 }, (_, index) => `/fixture/image-${index}.png`),
        referenceVideos: Array.from({ length: 10 }, (_, index) => `/fixture/video-${index}.mp4`),
        referenceAudios: Array.from({ length: 10 }, (_, index) => `/fixture/audio-${index}.wav`),
    });

    assert.equal(parsed.success, true);
});

test("Dreamina module lifecycle routes work without a Canvas session and accept only empty JSON mutations", async () => {
    const calls: string[] = [];
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });

    const status = await invoke(module, "/dreamina/status", undefined);
    const login = await invoke(module, "/dreamina/login", Buffer.from("{}"));
    const logout = await invoke(module, "/dreamina/logout", Buffer.from("{}"));

    assert.deepEqual(calls, ["status", "login", "logout"]);
    assert.equal((status as { status: DreaminaPublicStatus }).status.state, "installed");
    assert.equal((login as { status: DreaminaPublicStatus }).status.state, "login_pending");
    assert.equal((logout as { status: DreaminaPublicStatus }).status.authenticated, false);

    const invalid = await invoke(module, "/dreamina/login", Buffer.from('{"ownerId":"other"}'));
    assert.deepEqual(invalid, {
        ok: false,
        code: "dreamina_request_invalid",
        message: "Dreamina 请求参数无效",
    });
    assert.deepEqual(calls, ["status", "login", "logout"]);
});

test("Dreamina module invokes generation only through the explicit strict run route", async (t) => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-strict-run-"));
    const calls: string[] = [];
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: lifecycleFixture(calls),
        dreaminaRuntime: runtimeFixture(calls),
    });
    t.after(async () => {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    });
    const body = Buffer.from(JSON.stringify({
        operation: "text2image",
        idempotencyKey: "attempt-module-0001",
        prompt: "fixture",
        resolutionType: "2k",
    }));

    const accepted = await invoke(module, "/dreamina/run", body);
    assert.deepEqual(accepted, {
        ok: true,
        result: { state: "accepted", receiptRecorded: true },
    });
    assert.deepEqual(calls, ["run:text2image"]);

    const rejected = await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
        operation: "text2image",
        idempotencyKey: "attempt-module-0002",
        prompt: "fixture",
        resolutionType: "2k",
        ownerId: "attacker-owner-0001",
    })));
    assert.deepEqual(rejected, {
        ok: false,
        code: "dreamina_request_invalid",
        message: "Dreamina 请求参数无效",
    });
    assert.deepEqual(calls, ["run:text2image"]);
});

test("Dreamina run HTTP boundary fences hostile accepted Runtime results as submission unknown", async (t) => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-hostile-result-"));
    let runCalls = 0;
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        dreaminaRuntime: {
            ...runtimeFixture([]),
            run: async () => {
                runCalls += 1;
                return ({
                    state: "accepted",
                    submitId: "receipt-must-not-cross",
                    prompt: "prompt-must-not-cross",
                    path: "C:\\private\\result.png",
                    token: "token-must-not-cross",
                }) as never;
            },
        },
    });
    t.after(async () => {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    });

    const response = await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
        operation: "text2image",
        idempotencyKey: "attempt-hostile-result-0001",
        prompt: "fixture",
        resolutionType: "2k",
    })));
    assert.deepEqual(response, {
        ok: false,
        code: "dreamina_submission_unknown",
        message: "Dreamina 提交结果不确定，已禁止自动重试；请按 receipt 查询或人工确认",
    });
    assert.equal(runCalls, 1);
    assert.doesNotMatch(JSON.stringify(response), /submitId|receipt-must-not-cross|prompt-must-not-cross|private|token-must-not-cross/);
});

test("Dreamina run HTTP boundary maps hostile unknown action failures to submission unknown after one invocation", async (t) => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-hostile-action-"));
    let runCalls = 0;
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        dreaminaRuntime: {
            ...runtimeFixture([]),
            run: async () => {
                runCalls += 1;
                throw Object.assign(new DreaminaCliError(
                    "hostile_transport_code",
                    "hostile action failure prompt-must-not-cross token-must-not-cross",
                    599,
                ), {
                    submitId: "receipt-must-not-cross",
                    prompt: "prompt-must-not-cross",
                    path: "C:\\private\\result.png",
                    token: "token-must-not-cross",
                });
            },
        },
    });
    t.after(async () => {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    });

    const response = await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
        operation: "text2image",
        idempotencyKey: "attempt-hostile-action-0001",
        prompt: "fixture",
        resolutionType: "2k",
    })));
    assert.deepEqual(response, {
        ok: false,
        code: "dreamina_submission_unknown",
        message: "Dreamina 提交结果不确定，已禁止自动重试；请按 receipt 查询或人工确认",
    });
    assert.equal(runCalls, 1);
    assert.doesNotMatch(JSON.stringify(response), /submitId|receipt-must-not-cross|prompt-must-not-cross|private|token-must-not-cross|hostile action failure/);
});

test("Dreamina run HTTP boundary uses fixed public errors and fences post-dispatch failures", async (t) => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-public-errors-"));
    const submissionUnknown = {
        expectedCode: "dreamina_submission_unknown",
        expectedMessage: "Dreamina 提交结果不确定，已禁止自动重试；请按 receipt 查询或人工确认",
        expectedStatus: 409,
    } as const;
    const cases: Array<{
        error: Error;
        expectedCode: string;
        expectedMessage: string;
        expectedStatus: number;
    }> = [
        {
            error: new DreaminaCliError("dreamina_request_invalid", "private request prompt token path", 599),
            expectedCode: "dreamina_request_invalid",
            expectedMessage: "Dreamina 请求参数无效",
            expectedStatus: 400,
        },
        {
            error: new DreaminaCliError("dreamina_idempotency_conflict", "private idempotency detail", 599),
            expectedCode: "dreamina_idempotency_conflict",
            expectedMessage: "同一幂等键不能用于不同 Dreamina 请求",
            expectedStatus: 409,
        },
        {
            error: new DreaminaCliError("dreamina_login_required", "private account detail", 599),
            expectedCode: "dreamina_login_required",
            expectedMessage: "Dreamina CLI 需要先登录",
            expectedStatus: 401,
        },
        {
            error: new DreaminaCliError("dreamina_missing", "private executable path", 599),
            expectedCode: "dreamina_missing",
            expectedMessage: "未检测到 Dreamina CLI",
            expectedStatus: 404,
        },
        {
            error: new DreaminaCliError("dreamina_reference_invalid", "private reference path", 599),
            expectedCode: "dreamina_reference_invalid",
            expectedMessage: "Dreamina 参考素材无效或不受信任",
            expectedStatus: 400,
        },
        {
            error: new DreaminaCliError("dreamina_reference_budget_exceeded", "private reference budget", 599),
            expectedCode: "dreamina_reference_budget_exceeded",
            expectedMessage: "Dreamina 参考素材超出大小限制",
            expectedStatus: 413,
        },
        {
            error: new DreaminaCliError("dreamina_generation_capacity_full", "private capacity detail", 599),
            expectedCode: "dreamina_generation_capacity_full",
            expectedMessage: "Dreamina 官方生成名额已满",
            expectedStatus: 409,
        },
        {
            error: new DreaminaCliError("dreamina_submit_spawn_failed", "private spawn path", 599),
            expectedCode: "dreamina_submit_spawn_failed",
            expectedMessage: "无法启动 Dreamina CLI 提交进程",
            expectedStatus: 503,
        },
        {
            error: new DreaminaCliError("dreamina_submission_unknown", "private uncertain receipt", 599),
            ...submissionUnknown,
        },
        {
            error: new DreaminaCliError("dreamina_internal_error", "prompt-must-not-cross token-must-not-cross path-must-not-cross", 500),
            ...submissionUnknown,
        },
        {
            error: new DreaminaCliError("dreamina_command_timeout", "private timeout detail", 504),
            ...submissionUnknown,
        },
        {
            error: new DreaminaCliError("dreamina_cancelled", "private cancel detail", 499),
            ...submissionUnknown,
        },
        {
            error: new LocalDreaminaGenerationError("local_generation_result_invalid", "private result path", 502),
            ...submissionUnknown,
        },
    ];
    let runCalls = 0;
    let nextError: Error = cases[0]!.error;
    const module = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        dreaminaRuntime: {
            ...runtimeFixture([]),
            run: async () => {
                runCalls += 1;
                throw nextError;
            },
        },
    });
    t.after(async () => {
        await module.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    });

    for (const [index, item] of cases.entries()) {
        nextError = item.error;
        const response = await invoke(module, "/dreamina/run", Buffer.from(JSON.stringify({
            operation: "text2image",
            idempotencyKey: `attempt-public-error-${String(index).padStart(4, "0")}`,
            prompt: "fixture",
            resolutionType: "2k",
        })), item.expectedStatus);
        assert.deepEqual(response, {
            ok: false,
            code: item.expectedCode,
            message: item.expectedMessage,
        });
        assert.equal(runCalls, index + 1);
        assert.doesNotMatch(JSON.stringify(response), /private|prompt-must-not-cross|token-must-not-cross|path-must-not-cross/);
    }
});

test("Dreamina module exposes atomic product effect claim renew complete and replay", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-module-effects-"));
    await fs.writeFile(path.join(configDir, "dreamina-runtime-state.json"), JSON.stringify({
        version: 1,
        records: [{
            ownerId: "owner-dreamina-module-0001",
            idempotencyKey: "dreamina-module-product-effect-0001",
            requestHash: "e".repeat(64),
            state: "queued",
            journalVersion: 1,
            updatedAt: "2026-08-13T00:00:00.000Z",
            taskVersion: 1,
            operation: "text2image",
            mode: "image",
            model: "dreamina-image-3.1",
            createdAt: "2026-08-13T00:00:00.000Z",
        }],
    }));
    const first = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        dreaminaRuntime: runtimeFixture([]),
    });
    const second = createDreaminaHttpModule({
        ownerId: "owner-dreamina-module-0001",
        configDir,
        dreamina: authenticatedLifecycleFixture(),
        dreaminaRuntime: runtimeFixture([]),
    });
    const claimBody = Buffer.from(JSON.stringify({
        consumerId: "web-generation-materializer",
        taskId: "dreamina:dreamina-module-product-effect-0001",
        effectKey: "materialize:dreamina:dreamina-module-product-effect-0001:0",
    }));
    try {
        await invoke(first, "/dreamina/generate/tasks", undefined);
        assert.deepEqual(await invoke(first, "/dreamina/generate/effects/claim", Buffer.from(JSON.stringify({
            consumerId: "web-generation-materializer",
            taskId: "dreamina:dreamina-module-product-effect-0001",
            effectKey: "materialize:dreamina:dreamina-module-product-effect-0001:strict-json",
            unexpected: true,
        }))), {
            ok: false,
            code: "dreamina_request_invalid",
            message: "Dreamina 请求参数无效",
        });
        const claims = await Promise.all([
            invoke(first, "/dreamina/generate/effects/claim", claimBody),
            invoke(second, "/dreamina/generate/effects/claim", claimBody),
        ]);
        const statuses = claims.map((value) => (value as { result: { status: string } }).result.status).sort();
        assert.deepEqual(statuses, ["busy", "claimed"]);
        const claimed = claims.find((value) => (value as { result: { status: string } }).result.status === "claimed") as {
            result: { leaseToken: string; fence: number };
        };
        const ownership = {
            consumerId: "web-generation-materializer",
            taskId: "dreamina:dreamina-module-product-effect-0001",
            effectKey: "materialize:dreamina:dreamina-module-product-effect-0001:0",
            leaseToken: claimed.result.leaseToken,
            fence: claimed.result.fence,
        };
        const renewed = await invoke(first, "/dreamina/generate/effects/renew", Buffer.from(JSON.stringify(ownership))) as {
            ok: true; result: { leaseExpiresAt: string; fence: number };
        };
        assert.equal(renewed.ok, true);
        assert.equal(renewed.result.fence, claimed.result.fence);
        assert.equal(Number.isFinite(Date.parse(renewed.result.leaseExpiresAt)), true);
        assert.deepEqual(await invoke(first, "/dreamina/generate/effects/complete", Buffer.from(JSON.stringify({
            ...ownership,
            result: { materializedAssetId: "asset-http-durable-id" },
        }))), { ok: true, result: { completed: true } });
        assert.deepEqual(await invoke(second, "/dreamina/generate/effects/claim", claimBody), {
            ok: true,
            result: {
                status: "completed",
                result: { materializedAssetId: "asset-http-durable-id" },
            },
        });
    } finally {
        await first.dispose?.();
        await second.dispose?.();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

async function invoke(
    module: ReturnType<typeof createDreaminaHttpModule>,
    path: string,
    body: Buffer | undefined,
    expectedStatus?: number,
) {
    const route = module.routes.find((item) => item.path === path);
    assert(route);
    const req = new EventEmitter() as EventEmitter & { body?: Buffer };
    req.body = body;
    const res = new EventEmitter() as EventEmitter & {
        destroyed: boolean;
        writableEnded: boolean;
        statusCode: number;
        json(value: unknown): void;
        status(code: number): typeof res;
    };
    res.destroyed = false;
    res.writableEnded = false;
    res.statusCode = 200;
    let resolve!: (value: unknown) => void;
    const result = new Promise<unknown>((done) => { resolve = done; });
    res.json = (value) => { res.writableEnded = true; resolve(value); };
    res.status = (code) => { res.statusCode = code; return res; };
    route.handler(req as never, res as never, (error?: unknown) => {
        if (error) resolve(Promise.reject(error));
    });
    const value = await result;
    if (expectedStatus !== undefined) assert.equal(res.statusCode, expectedStatus);
    return value;
}

async function waitForCondition(condition: () => Promise<boolean>) {
    const deadline = Date.now() + 2_000;
    while (!(await condition())) {
        if (Date.now() >= deadline) throw new Error("timed out waiting for Dreamina module state");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function writeModuleJournal(configDir: string, record: Record<string, unknown>) {
    const journalFile = path.join(configDir, "dreamina-runtime-state.json");
    await fs.writeFile(journalFile, JSON.stringify({ version: 1, records: [record] }));
    return journalFile;
}

function moduleJournalRecord(id: string, overrides: Record<string, unknown> = {}) {
    return {
        ownerId: "owner-dreamina-module-0001",
        idempotencyKey: id,
        requestHash: "f".repeat(64),
        state: "accepted",
        journalVersion: 1,
        submitId: `receipt-${id}`,
        updatedAt: "2026-08-13T00:01:00.000Z",
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0mini",
        createdAt: "2026-08-13T00:00:00.000Z",
        ...overrides,
    };
}

async function seedSucceededProductStore(configDir: string, id: string, accountBinding?: string) {
    const result = {
        mode: "video" as const,
        video: {
            dataUrl: `data:video/mp4;base64,${mp4Fixture().toString("base64")}`,
            mimeType: "video/mp4",
            bytes: mp4Fixture().byteLength,
        },
    };
    const artifactStore = new DreaminaProviderArtifactStore({ root: path.join(configDir, "dreamina-provider-artifacts") });
    const providerOutputs = await artifactStore.persistResult(result, {
        ownerId: "owner-dreamina-module-0001",
        idempotencyKey: id,
        ...(accountBinding ? { accountBinding } : {}),
        mode: "video",
    });
    const journalFile = await writeModuleJournal(configDir, moduleJournalRecord(id, {
        state: "succeeded",
        officialStatus: "completed",
        providerOutputs,
        ...(accountBinding ? { accountBinding, sessionEpoch: 1 } : {}),
    }));
    const store = new DreaminaTaskStore({ stateFile: path.join(configDir, "dreamina-generation-task-store.json") });
    const projector = new DreaminaTaskProjector({ store, ownerId: "owner-dreamina-module-0001", journalFile });
    await projector.recover();
    return { journalFile, providerOutputs, result };
}

function lifecycleFixture(calls: string[]) {
    return {
        status: async () => { calls.push("status"); return installed; },
        login: async () => {
            calls.push("login");
            return {
                ...installed,
                state: "login_pending" as const,
                verificationUri: "https://jimeng.jianying.com/ai-tool/cli-auth",
                userCode: "CODE",
            };
        },
        logout: async () => { calls.push("logout"); return installed; },
    };
}

function runtimeFixture(calls: string[]) {
    return {
        run: async (input: unknown) => {
            calls.push(`run:${(input as { operation?: string }).operation ?? "unknown"}`);
            return { state: "accepted" as const, submitId: "receipt-module" };
        },
        generateToResult: async () => ({ mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } }),
        resumeToResult: async () => ({ mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } }),
        enqueue: async () => taskFixture("seedance-route-0001", "running", "submitted"),
        listTasks: async () => [taskFixture("seedance-list-0001", "running", "submitted")],
        getTask: async (idempotencyKey: string) => {
            calls.push(`get:${idempotencyKey}`);
            return taskFixture(idempotencyKey, "succeeded", "succeeded", {
                mode: "video" as const,
                video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 },
            });
        },
        refreshTask: async (idempotencyKey: string) => {
            calls.push(`refresh:${idempotencyKey}`);
            return taskFixture(idempotencyKey, "running", "generating");
        },
        cancelTask: async (idempotencyKey: string) => {
            calls.push(`cancel:${idempotencyKey}`);
            return taskFixture(idempotencyKey, "cancelled", "cancelled");
        },
        deleteTask: async (idempotencyKey: string) => {
            calls.push(`delete:${idempotencyKey}`);
            return { deleted: true as const };
        },
        waitForTask: async (idempotencyKey: string, mode: "image" | "video") => {
            calls.push(`wait:${idempotencyKey}:${mode}`);
            return { mode: "video" as const, video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 } };
        },
    };
}

function taskFixture(
    id: string,
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled",
    stage: "queued" | "submitted" | "generating" | "succeeded" | "failed" | "cancelled" | "submission_unknown",
    result?: { mode: "video"; video: { dataUrl: string; mimeType: string; bytes: number } },
) {
    return {
        id,
        provider: "dreamina-cli" as const,
        mode: "video" as const,
        operation: "text2video" as const,
        model: "seedance2.0mini",
        status,
        stage,
        progress: status === "succeeded" ? 100 : 10,
        receiptRecorded: true,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
        ...(result ? { result } : {}),
    };
}

function authenticatedLifecycleFixture() {
    const authenticated: DreaminaPublicStatus = {
        provider: "dreamina-cli",
        state: "authenticated",
        installed: true,
        authenticated: true,
        version: "1.2.3",
        message: "Dreamina CLI authenticated",
    };
    return {
        status: async () => authenticated,
        statusWithSession: async () => ({ status: authenticated, session: undefined }),
        login: async () => authenticated,
        logout: async () => installed,
    };
}

function pngFixture() {
    return Buffer.from("89504e470d0a1a0a", "hex");
}

function mp4Fixture() {
    return Buffer.from("00000018667479706d703432", "hex");
}
