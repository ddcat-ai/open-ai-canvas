import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DreaminaCliRuntime } from "../../canvas-agent/src/dreamina-cli-runtime";
import { createDreaminaHttpModule } from "../../canvas-agent/src/modules/dreamina-http";
import { cancelLocalDreaminaGenerationTask, deleteLocalDreaminaGenerationTask, queryLocalDreaminaGenerationTask, refreshLocalDreaminaGenerationTask, runLocalDreaminaGenerationTask, waitForLocalDreaminaGenerationTask } from "../src/services/local-dreamina-generation";
import { projectLocalDreaminaTask } from "../src/services/local-dreamina-task-projection";
import {
    LocalRuntimeSessionClient,
    type RuntimeBrowserKeyRecord,
    type RuntimeBrowserKeyStore,
} from "../src/services/local-runtime-session";

const trustedOrigin = "http://127.0.0.1:18630";

test("Dreamina cross-Runtime completion survives HTTP wait and the Web parser without a second provider query", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-web-cross-runtime-"));
    const stateFile = path.join(configDir, "dreamina-runtime-state.json");
    const id = "dreamina-web-cross-runtime-0001";
    const videoBytes = Buffer.from("00000018667479706d703432", "hex");
    await fs.writeFile(stateFile, JSON.stringify({
        version: 1,
        records: [{
            ownerId: "owner-web-cross-runtime-0001",
            idempotencyKey: id,
            requestHash: "a".repeat(64),
            state: "accepted",
            submitId: "receipt-web-cross-runtime",
            updatedAt: "2026-08-13T00:00:00.000Z",
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
    const common = {
        ownerId: "owner-web-cross-runtime-0001",
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => ({ installed: true as const, executable: "dreamina-fixture" }),
    };
    const winner = new DreaminaCliRuntime({
        ...common,
        generationRoot: path.join(configDir, "winner-runs"),
        runProcess: async (input) => {
            winnerQueries += 1;
            if (winnerQueries === 1) {
                markWinnerEntered();
                await winnerGate;
            }
            const output = input.args.find((arg) => arg.startsWith("--download_dir="))?.slice("--download_dir=".length);
            if (output) await fs.writeFile(path.join(output, "result.mp4"), videoBytes);
            return { exitCode: 0, stdout: '{"status":"completed"}', stderr: "" };
        },
    });
    const waiter = new DreaminaCliRuntime({
        ...common,
        generationRoot: path.join(configDir, "waiter-runs"),
        runProcess: async () => {
            waiterQueries += 1;
            return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
        },
    });
    const module = createDreaminaHttpModule({
        ownerId: common.ownerId,
        configDir,
        dreaminaRuntime: waiter,
    });
    try {
        await winner.start();
        await winnerEntered;
        const parsed = waitForLocalDreaminaGenerationTask(id, "video", {
            client: {
                async connect() { return connectedFixture(); },
                async request(route, init) {
                    expect(route).toBe("/dreamina/generate/wait");
                    const response = await invokeDreaminaHttp(module, route, Buffer.from(String(init?.body)));
                    return jsonResponse(response.status, response.body);
                },
            },
        });
        await Promise.resolve();
        releaseWinner();
        await expect(parsed).resolves.toEqual({
            id,
            provider: "dreamina-cli",
            mode: "video",
            operation: "text2video",
            model: "seedance2.0mini",
            status: "succeeded",
            stage: "succeeded",
            progress: 100,
            receiptRecorded: true,
            officialStatus: "completed",
            lifecycle: "TERMINAL",
            terminalOutcome: "SUCCEEDED",
            syncState: "SYNC_OK",
            resultState: "PENDING_MATERIALIZATION",
            outputs: [{
                outputIndex: 0,
                mediaType: "video",
                providerArtifactRef: expect.stringMatching(/^dreamina-provider-artifact:[a-f0-9-]{36}:0$/),
            }],
            context: { scope: "legacy_unscoped" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: expect.any(String),
            result: {
                mode: "video",
                video: {
                    dataUrl: `data:video/mp4;base64,${videoBytes.toString("base64")}`,
                    mimeType: "video/mp4",
                    bytes: videoBytes.byteLength,
                },
            },
        });
        expect(waiterQueries).toBe(0);
        expect(winnerQueries).toBe(2);
        const durableText = [
            await fs.readFile(stateFile, "utf8"),
            await fs.readFile(path.join(configDir, "dreamina-generation-task-store.json"), "utf8"),
        ].join("\n");
        expect(durableText).not.toContain("data:video/");
        expect(durableText).not.toContain(videoBytes.toString("base64"));
        expect(durableText).not.toContain(path.join(configDir, "winner-runs"));
        expect(durableText).not.toMatch(/stdout|stderr|token|cookie/i);
    } finally {
        releaseWinner();
        await Promise.allSettled([winner.dispose(), module.dispose?.()]);
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("deleting a Dreamina task removes only the local record through one signed mutation", async () => {
    const requests: Array<{ path: string; method: string; body: string }> = [];
    await deleteLocalDreaminaGenerationTask("dreamina-delete-local-0001", {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, method: String(init?.method), body: String(init?.body) });
                return jsonResponse(200, { ok: true, result: { deleted: true } });
            },
        },
    });

    expect(requests).toEqual([{
        path: "/dreamina/generate/delete",
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "dreamina-delete-local-0001" }),
    }]);
});

test("manual Dreamina status refresh sends exactly one signed status-only request", async () => {
    const requests: Array<{ path: string; method: string; body: string }> = [];
    const task = await refreshLocalDreaminaGenerationTask("dreamina-refresh-local-0001", {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, method: String(init?.method), body: String(init?.body) });
                return jsonResponse(200, taskEnvelope("dreamina-refresh-local-0001", "failed", {
                    officialStatus: "failed",
                    errorCode: "dreamina_official_failed",
                }));
            },
        },
    });

    expect(requests).toEqual([{
        path: "/dreamina/generate/refresh",
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "dreamina-refresh-local-0001" }),
    }]);
    expect(task).toMatchObject({ status: "failed", officialStatus: "failed", errorCode: "dreamina_official_failed" });
});

test("Dreamina official failure uses stable neutral copy without exposing provider details", async () => {
    await expect(runLocalDreaminaGenerationTask(videoInput(), {
        client: {
            async connect() { return connectedFixture(); },
            async request() {
                const envelope = taskEnvelope("dreamina-official-fail-0001", "failed", {
                    officialStatus: "failed",
                    errorCode: "dreamina_official_failed",
                });
                return jsonResponse(200, { ...envelope, message: "private provider detail" });
            },
        },
        idempotencyKey: () => "dreamina-official-fail-0001",
    })).rejects.toMatchObject({
        code: "dreamina_official_failed",
        message: "任务未成功。当前 Dreamina CLI 无法可靠判断是官网取消还是生成失败。",
        status: 502,
    });
});

test("Dreamina Web parsing preserves the shared orthogonal task contract while keeping the legacy DTO", async () => {
    const task = await queryLocalDreaminaGenerationTask("dreamina-contract-web-0001", "video", {
        client: {
            async connect() { return connectedFixture(); },
            async request() {
                return jsonResponse(200, {
                    ok: true,
                    result: {
                        ...taskEnvelope("dreamina-contract-web-0001", "failed").result,
                        officialStatus: "failed",
                        errorCode: "dreamina_official_failed",
                        lifecycle: "TERMINAL",
                        terminalOutcome: "FAILED_OR_CANCELLED",
                        syncState: "SYNC_OK",
                        resultState: "NOT_AVAILABLE",
                        outputs: [],
                        context: { scope: "legacy_unscoped" },
                        providerObservation: {
                            source: "query_result",
                            observedAt: "2026-08-13T00:00:00.000Z",
                            accountBinding: "account-binding-fixture",
                            fenceEpoch: 9,
                            status: "failed",
                        },
                    },
                });
            },
        },
    });
    const contract = task as unknown as Record<string, unknown>;
    expect(contract.lifecycle).toBe("TERMINAL");
    expect(contract.terminalOutcome).toBe("FAILED_OR_CANCELLED");
    expect(contract.syncState).toBe("SYNC_OK");
    expect(contract.resultState).toBe("NOT_AVAILABLE");
    expect(contract.context).toEqual({ scope: "legacy_unscoped" });

    const projected = projectLocalDreaminaTask(task, {
        projectId: "current-project-must-not-bind",
        prompt: "fixture",
        type: "canvas_video",
        attempts: 1,
    });
    expect(projected.projectId).toBeUndefined();
    expect(projected.status).toBe("failed");
    expect(projected.error).toBe("任务未成功。当前 Dreamina CLI 无法可靠判断是官网取消还是生成失败。");
});

test("Dreamina SUBMISSION_UNCERTAIN projects as failed attention without claiming official completion", () => {
    const projected = projectLocalDreaminaTask({
        id: "dreamina-submission-uncertain-web-0001",
        provider: "dreamina-cli",
        mode: "video",
        operation: "text2video",
        model: "seedance2.0mini",
        status: "failed",
        stage: "submission_unknown",
        receiptRecorded: false,
        lifecycle: "SUBMISSION_UNCERTAIN",
        syncState: "SYNC_UNCERTAIN",
        resultState: "NOT_AVAILABLE",
        outputs: [],
        context: { scope: "legacy_unscoped" },
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:01:00.000Z",
    });

    expect(projected.status).toBe("failed");
    expect(projected.stage).toBe("submission_unknown");
    expect(projected.receiptRecorded).toBe(false);
    expect(projected.completedAt).toBeUndefined();
});

test("Dreamina local generation posts only to its signed Runtime route and never to backend tasks", async () => {
    const requests: Array<{ path: string; method: string; body: string }> = [];
    const result = await runLocalDreaminaGenerationTask({
        model: "local:dreamina-cli:seedance2.0mini",
        mode: "video",
        prompt: "A short test clip",
        settings: { aspect: "16:9", resolution: "720", duration: 4 },
        references: [],
    }, {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, method: String(init?.method), body: String(init?.body) });
                return jsonResponse(200, path.endsWith("/wait")
                    ? taskEnvelope("seedance-web-route-0001", "succeeded")
                    : taskEnvelope("seedance-web-route-0001", "running"));
            },
        },
        idempotencyKey: () => "seedance-web-route-0001",
    });

    expect(result).toEqual({
        mode: "video",
        video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 },
    });
    expect(requests[0]).toEqual({
        path: "/dreamina/generate",
        method: "POST",
        body: JSON.stringify({
            idempotencyKey: "seedance-web-route-0001",
            clientOperationId: "seedance-web-route-0001",
            operation: "text-to-video",
            model: "seedance2.0mini",
            prompt: "A short test clip",
            settings: { aspect: "16:9", resolution: "720", duration: 4 },
            references: [],
            context: { scope: "scoped" },
        }),
    });
    expect(requests[1]).toEqual({
        path: "/dreamina/generate/wait",
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "seedance-web-route-0001", mode: "video" }),
    });
    expect(requests.some((request) => request.path.includes("/tasks"))).toBe(false);
});

test("Dreamina signed generation boundary serializes typed multimodal references and scoped task identity", async () => {
    const requests: Array<{ path: string; body: string }> = [];
    await runLocalDreaminaGenerationTask({
        model: "local:dreamina-cli:seedance2.5",
        mode: "video",
        prompt: "Multimodal signed fixture",
        settings: { aspect: "16:9", resolution: "720", duration: 4 },
        idempotencyKey: "retry-client-operation-0001",
        clientOperationId: "retry-client-operation-0001",
        context: {
            scope: "scoped",
            projectId: "project-signed-0001",
            nodeId: "node-signed-0001",
            retryOf: "dreamina:prior-signed-0001",
            attemptGroupId: "dreamina:prior-signed-0001",
        },
        references: [
            { kind: "image", mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), metadata: { name: "image.png", width: 16, height: 9 } },
            { kind: "video", mimeType: "video/mp4", bytes: new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70]), metadata: { name: "video.mp4", durationMs: 1000 } },
            { kind: "audio", mimeType: "audio/mpeg", bytes: new Uint8Array([0x49, 0x44, 0x33, 4]), metadata: { name: "audio.mp3", durationMs: 1000 } },
        ],
    } as Parameters<typeof runLocalDreaminaGenerationTask>[0], {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, body: String(init?.body) });
                return jsonResponse(200, path.endsWith("/wait")
                    ? taskEnvelope("retry-client-operation-0001", "succeeded")
                    : taskEnvelope("retry-client-operation-0001", "running"));
            },
        },
    });

    expect(JSON.parse(requests[0]!.body)).toEqual({
        idempotencyKey: "retry-client-operation-0001",
        clientOperationId: "retry-client-operation-0001",
        context: {
            scope: "scoped",
            projectId: "project-signed-0001",
            nodeId: "node-signed-0001",
            retryOf: "dreamina:prior-signed-0001",
            attemptGroupId: "dreamina:prior-signed-0001",
        },
        operation: "reference-to-video",
        model: "seedance2.5",
        prompt: "Multimodal signed fixture",
        settings: { aspect: "16:9", resolution: "720", duration: 4 },
        references: [
            { kind: "image", mimeType: "image/png", contentBase64: "iVBORw==", metadata: { name: "image.png", width: 16, height: 9 } },
            { kind: "video", mimeType: "video/mp4", contentBase64: "AAAAEGZ0eXA=", metadata: { name: "video.mp4", durationMs: 1000 } },
            { kind: "audio", mimeType: "audio/mpeg", contentBase64: "SUQzBA==", metadata: { name: "audio.mp3", durationMs: 1000 } },
        ],
    });
});

test("Dreamina Seedance 2.5 accepts 30 image, 10 video, and 10 audio references while every adapter limit stays strict", async () => {
    const makeReference = (kind: "image" | "video" | "audio", index: number) => ({
        kind,
        mimeType: kind === "image" ? "image/png" : kind === "video" ? "video/mp4" : "audio/mpeg",
        bytes: new Uint8Array([index + 1]),
        metadata: { name: `${kind}-${index + 1}` },
    });
    const references = [
        ...Array.from({ length: 30 }, (_, index) => makeReference("image", index)),
        ...Array.from({ length: 10 }, (_, index) => makeReference("video", index)),
        ...Array.from({ length: 10 }, (_, index) => makeReference("audio", index)),
    ];
    let requests = 0;

    await runLocalDreaminaGenerationTask({
        model: "local:dreamina-cli:seedance2.5",
        mode: "video",
        prompt: "Full multimodal boundary",
        settings: { aspect: "16:9", resolution: "720", duration: 4 },
        references,
    } as Parameters<typeof runLocalDreaminaGenerationTask>[0], {
        client: {
            async connect() { return connectedFixture(); },
            async request(path) {
                requests += 1;
                return jsonResponse(200, path.endsWith("/wait")
                    ? taskEnvelope("seedance-boundary-0001", "succeeded")
                    : taskEnvelope("seedance-boundary-0001", "running"));
            },
        },
        idempotencyKey: () => "seedance-boundary-0001",
    });

    expect(requests).toBe(2);

    const invalidCases = [
        {
            name: "Seedance 2.5 image limit",
            model: "local:dreamina-cli:seedance2.5",
            references: Array.from({ length: 31 }, (_, index) => makeReference("image", index)),
        },
        {
            name: "Seedance 2.5 video limit",
            model: "local:dreamina-cli:seedance2.5",
            references: Array.from({ length: 11 }, (_, index) => makeReference("video", index)),
        },
        {
            name: "Seedance 2.5 audio limit",
            model: "local:dreamina-cli:seedance2.5",
            references: Array.from({ length: 11 }, (_, index) => makeReference("audio", index)),
        },
        {
            name: "other model total limit",
            model: "local:dreamina-cli:seedance2.0mini",
            references: Array.from({ length: 31 }, (_, index) => makeReference("image", index)),
        },
    ];
    for (const fixture of invalidCases) {
        let invalidRequests = 0;
        await expect(runLocalDreaminaGenerationTask({
            model: fixture.model,
            mode: "video",
            prompt: fixture.name,
            settings: { aspect: "16:9", resolution: "720", duration: 4 },
            references: fixture.references,
        } as Parameters<typeof runLocalDreaminaGenerationTask>[0], {
            client: {
                async connect() { return connectedFixture(); },
                async request() {
                    invalidRequests += 1;
                    throw new Error("must not request");
                },
            },
            idempotencyKey: () => "seedance-invalid-0001",
        })).rejects.toMatchObject({ status: 400 });
        expect(invalidRequests).toBe(0);
    }
});

test("Dreamina local generation blocks Seedance mini below four seconds before a Runtime request", async () => {
    let requests = 0;
    await expect(runLocalDreaminaGenerationTask({
        model: "local:dreamina-cli:seedance2.0mini",
        mode: "video",
        prompt: "A short test clip",
        settings: { resolution: "720", duration: 3 },
        references: [],
    }, {
        client: {
            async connect() { return connectedFixture(); },
            async request() { requests += 1; throw new Error("must not request"); },
        },
        idempotencyKey: () => "seedance-web-route-0002",
    })).rejects.toMatchObject({ code: "local_generation_model_unavailable" });
    expect(requests).toBe(0);
});

test("Dreamina generation asks to reconnect without exposing origin authorization terminology", async () => {
    let requests = 0;
    await expect(runLocalDreaminaGenerationTask({
        model: "local:dreamina-cli:seedance2.0mini",
        mode: "video",
        prompt: "A short test clip",
        settings: { resolution: "720", duration: 4 },
        references: [],
    }, {
        client: {
            async connect() { return { state: "origin_not_trusted" as const, runtimeVersion: 2 }; },
            async request() { requests += 1; throw new Error("must not submit"); },
        },
        idempotencyKey: () => "seedance-reconnect-copy-0001",
    })).rejects.toMatchObject({
        code: "origin_not_trusted",
        message: "本机连接需要重新建立",
        status: 403,
    });
    expect(requests).toBe(0);
});

test("Dreamina generation never replays a paid POST after a 401 or 403 session failure", async () => {
    for (const status of [401, 403]) {
        let requests = 0;
        await expect(runLocalDreaminaGenerationTask({
            model: "local:dreamina-cli:seedance2.0mini",
            mode: "video",
            prompt: "A short test clip",
            settings: { resolution: "720", duration: 4 },
            references: [],
        }, {
            client: {
                async connect() { return connectedFixture(); },
                async request() {
                    requests += 1;
                    return new Response(JSON.stringify({ ok: false, code: "scope_denied" }), { status });
                },
            },
            idempotencyKey: () => `seedance-no-replay-${status}`,
        })).rejects.toMatchObject({ code: "local_generation_request_failed", status });
        expect(requests).toBe(1);
    }
});

test("Dreamina query-only recovery reconnects once after an expired session without replaying generate", async () => {
    let connects = 0;
    let queries = 0;
    let revocations = 0;
    const task = await queryLocalDreaminaGenerationTask("dreamina-query-reconnect-0001", "video", {
        client: {
            async connect() { connects += 1; return connectedFixture(); },
            revokeLocalSession() { revocations += 1; },
            async request(path) {
                expect(path).toBe("/dreamina/generate/query");
                queries += 1;
                return queries === 1
                    ? jsonResponse(403, { ok: false, code: "scope_denied" })
                    : jsonResponse(200, taskEnvelope("dreamina-query-reconnect-0001", "succeeded"));
            },
        },
    });
    expect(task.status).toBe("succeeded");
    expect({ connects, queries, revocations }).toEqual({ connects: 2, queries: 2, revocations: 1 });
});

test("Dreamina accepted background action preserves provider reconciliation and sends no generation replay", async () => {
    const requests: Array<{ path: string; method: string }> = [];
    const task = await cancelLocalDreaminaGenerationTask("dreamina-local-stop-only-0001", {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, method: String(init?.method) });
                return jsonResponse(200, taskEnvelope("dreamina-local-stop-only-0001", "running"));
            },
        },
    });

    expect(task).toMatchObject({
        status: "running",
        receiptRecorded: true,
    });
    expect(task.errorCode).toBeUndefined();
    expect(requests).toEqual([{ path: "/dreamina/generate/cancel", method: "POST" }]);
});

test("Dreamina generation establishes a signed session before exactly one paid POST", async () => {
    const runtime = signedRuntimeFixture();
    const client = new LocalRuntimeSessionClient({
        origin: trustedOrigin,
        keyStore: memoryKeyStore(),
        fetch: runtime.fetch,
        now: () => runtime.now,
    });

    const result = await runLocalDreaminaGenerationTask(videoInput(), {
        client,
        idempotencyKey: () => "seedance-session-preflight-0001",
    });

    expect(result.mode).toBe("video");
    expect(runtime.requests.map((request) => new URL(request.url).pathname)).toEqual([
        "/runtime/info",
        "/runtime/session/challenge",
        "/runtime/session/exchange",
        "/dreamina/generate",
        "/dreamina/generate/wait",
    ]);
    expect(runtime.requests.filter((request) => request.path === "/dreamina/generate")).toHaveLength(1);
});

test("Dreamina generation cancellation during signed session preflight prevents the paid POST", async () => {
    const runtime = signedRuntimeFixture({ blockInfoUntilAbort: true });
    const client = new LocalRuntimeSessionClient({
        origin: trustedOrigin,
        keyStore: memoryKeyStore(),
        fetch: runtime.fetch,
        now: () => runtime.now,
    });
    const controller = new AbortController();

    const pending = runLocalDreaminaGenerationTask(videoInput(), {
        client,
        idempotencyKey: () => "seedance-session-preflight-0002",
    }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.requests.filter((request) => request.path === "/dreamina/generate")).toHaveLength(0);
});

test("Dreamina generation cancellation during the paid POST propagates without retry", async () => {
    const runtime = signedRuntimeFixture({ blockGenerateUntilAbort: true });
    const client = new LocalRuntimeSessionClient({
        origin: trustedOrigin,
        keyStore: memoryKeyStore(),
        fetch: runtime.fetch,
        now: () => runtime.now,
    });
    await client.connect();
    runtime.requests.length = 0;
    const controller = new AbortController();

    const pending = runLocalDreaminaGenerationTask(videoInput(), {
        client,
        idempotencyKey: () => "seedance-session-preflight-0003",
    }, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "dreamina_submission_unknown" });
    expect(runtime.requests.filter((request) => request.path === "/dreamina/generate")).toHaveLength(1);
});

test("detaching a Dreamina wait never sends a provider cancellation", async () => {
    const controller = new AbortController();
    const requests: string[] = [];
    let waitStarted!: () => void;
    const waiting = new Promise<void>((resolve) => { waitStarted = resolve; });
    const pending = runLocalDreaminaGenerationTask(videoInput(), {
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push(path);
                if (path === "/dreamina/generate") return jsonResponse(200, taskEnvelope("dreamina-detached-wait-0001", "running"));
                if (path === "/dreamina/generate/wait") {
                    waitStarted();
                    return await new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
                    });
                }
                throw new Error(`unexpected mutation: ${path}`);
            },
        },
        idempotencyKey: () => "dreamina-detached-wait-0001",
    }, controller.signal);

    await waiting;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toEqual(["/dreamina/generate", "/dreamina/generate/wait"]);
});

test("Dreamina task listing uses one signed read and projects no request content", async () => {
    const module = await import("../src/services/local-dreamina-generation");
    expect(typeof module.listLocalDreaminaGenerationTasks).toBe("function");
    const requests: Array<{ path: string; method: string }> = [];
    const tasks = await module.listLocalDreaminaGenerationTasks({
        client: {
            async connect() { return connectedFixture(); },
            async request(path, init) {
                requests.push({ path, method: String(init?.method) });
                return jsonResponse(200, {
                    ok: true,
                    result: [taskEnvelope("dreamina-list-task-0001", "running").result],
                });
            },
        },
    });

    expect(requests).toEqual([{ path: "/dreamina/generate/tasks?limit=100", method: "GET" }]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: "dreamina-list-task-0001", status: "running", receiptRecorded: true });
    expect(JSON.stringify(tasks)).not.toMatch(/prompt|submitId|receipt-/i);
});

test("Dreamina task listing follows cursor pages", async () => {
    const module = await import("../src/services/local-dreamina-generation");
    const paths: string[] = [];
    const fixture = taskEnvelope("dreamina-page-task-0001", "running").result as Record<string, unknown>;
    const tasks = await module.listLocalDreaminaGenerationTasks({
        client: {
            async connect() { return connectedFixture(); },
            async request(path) {
                paths.push(path);
                return paths.length === 1
                    ? jsonResponse(200, { ok: true, result: { tasks: [{ ...fixture, id: "dreamina-page-task-0001" }], nextCursor: "cursor_page_2" } })
                    : jsonResponse(200, { ok: true, result: { tasks: [{ ...fixture, id: "dreamina-page-task-0002" }] } });
            },
        },
    });

    expect(paths).toEqual([
        "/dreamina/generate/tasks?limit=100",
        "/dreamina/generate/tasks?limit=100&cursor=cursor_page_2",
    ]);
    expect(tasks.map((task) => task.id)).toEqual(["dreamina-page-task-0001", "dreamina-page-task-0002"]);
});

test("Dreamina task listing reconnects once after an expired signed read", async () => {
    const module = await import("../src/services/local-dreamina-generation");
    let reads = 0;
    let revocations = 0;
    const tasks = await module.listLocalDreaminaGenerationTasks({
        client: {
            async connect() { return connectedFixture(); },
            revokeLocalSession() { revocations += 1; },
            async request() {
                reads += 1;
                return reads === 1
                    ? jsonResponse(403, { ok: false, code: "session_invalid" })
                    : jsonResponse(200, { ok: true, result: [taskEnvelope("dreamina-list-task-0002", "running").result] });
            },
        },
    });

    expect(reads).toBe(2);
    expect(revocations).toBe(1);
    expect(tasks.map((task) => task.id)).toEqual(["dreamina-list-task-0002"]);
});

async function invokeDreaminaHttp(
    module: ReturnType<typeof createDreaminaHttpModule>,
    routePath: string,
    body: Buffer,
): Promise<{ status: number; body: unknown }> {
    const route = module.routes.find((candidate) => candidate.path === routePath);
    if (!route) throw new Error(`missing Dreamina route ${routePath}`);
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
    let resolve!: (value: { status: number; body: unknown }) => void;
    const response = new Promise<{ status: number; body: unknown }>((done) => { resolve = done; });
    res.json = (value) => {
        res.writableEnded = true;
        resolve({ status: res.statusCode, body: value });
    };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    route.handler(req as never, res as never, (error?: unknown) => {
        if (error) resolve({ status: 500, body: { ok: false, code: "test_route_error" } });
    });
    return response;
}

function videoInput() {
    return {
        model: "local:dreamina-cli:seedance2.0mini" as const,
        mode: "video" as const,
        prompt: "A short test clip",
        settings: { resolution: "720", duration: 4 },
        references: [],
    };
}

function memoryKeyStore(): RuntimeBrowserKeyStore & { record?: RuntimeBrowserKeyRecord } {
    return {
        record: undefined,
        async load() { return this.record; },
        async save(record) { this.record = record; },
        async clear() { this.record = undefined; },
    };
}

function signedRuntimeFixture(options: { blockInfoUntilAbort?: boolean; blockGenerateUntilAbort?: boolean } = {}) {
    const requests: Array<{ url: string; path: string; method: string }> = [];
    const fixture = {
        now: Date.parse("2026-08-11T00:00:00.000Z"),
        keyId: "",
        requests,
        fetch: async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
            const url = String(input);
            const path = new URL(url).pathname;
            requests.push({ url, path, method: String(init.method ?? "GET") });
            if (path === "/runtime/info" && options.blockInfoUntilAbort) return await rejectOnAbort(init.signal);
            if (path === "/runtime/info") {
                return jsonResponse(200, {
                    runtime: "framefield-local-runtime",
                    apiVersion: 2,
                    protocolVersion: "framefield-runtime-session-v1",
                    runtimeInstanceId: "dreamina-generation-fixture",
                    originTrusted: true,
                });
            }
            if (path === "/runtime/session/challenge") {
                const body = JSON.parse(String(init.body)) as { keyId?: string; publicKeyJwk?: JsonWebKey };
                fixture.keyId = body.keyId ?? await keyIdForJwk(body.publicKeyJwk!);
                return jsonResponse(200, {
                    state: "challenge",
                    challengeId: "challenge-generation-000001",
                    nonce: "bm9uY2UtZ2VuZXJhdGlvbi0wMDAwMDAwMDAwMDAwMDAwMDAw",
                    runtimeInstanceId: "dreamina-generation-fixture",
                    expiresAt: new Date(fixture.now + 60_000).toISOString(),
                    keyId: fixture.keyId,
                });
            }
            if (path === "/runtime/session/exchange") {
                return jsonResponse(200, {
                    sessionId: "session-generation-0000000001",
                    keyId: fixture.keyId,
                    scopes: ["runtime:status", "dreamina:models", "dreamina:generate"],
                    expiresAt: new Date(fixture.now + 10 * 60_000).toISOString(),
                });
            }
            if (path === "/dreamina/generate" && options.blockGenerateUntilAbort) return await rejectOnAbort(init.signal);
            if (path === "/dreamina/generate") {
                return jsonResponse(200, taskEnvelope("seedance-session-preflight-0001", "running"));
            }
            if (path === "/dreamina/generate/wait") {
                return jsonResponse(200, taskEnvelope("seedance-session-preflight-0001", "succeeded"));
            }
            return jsonResponse(404, { ok: false });
        },
    };
    return fixture;
}

async function rejectOnAbort(signal: AbortSignal | null | undefined): Promise<Response> {
    if (!signal) throw new Error("expected AbortSignal");
    if (signal.aborted) throw signal.reason;
    return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

function jsonResponse(status: number, value: unknown) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function keyIdForJwk(jwk: JsonWebKey) {
    const canonical = JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
    let binary = "";
    for (const byte of digest) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function connectedFixture() {
    return {
        state: "connected" as const,
        runtimeVersion: 2,
        session: {
            sessionId: "session-test-000000000001",
            keyId: "browser-key-test",
            scopes: ["dreamina:generate"],
            expiresAt: "2099-01-01T00:00:00.000Z",
        },
    };
}

function taskEnvelope(id: string, status: "running" | "succeeded" | "failed", overrides: Record<string, unknown> = {}) {
    return {
        ok: true,
        result: {
            id,
            provider: "dreamina-cli",
            mode: "video",
            operation: "text2video",
            model: "seedance2.0mini",
            status,
            stage: status === "succeeded" ? "succeeded" : status === "failed" ? "failed" : "submitted",
            progress: status === "succeeded" ? 100 : 10,
            receiptRecorded: true,
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            ...(status === "succeeded" ? {
                result: {
                    mode: "video",
                    video: { dataUrl: "data:video/mp4;base64,AAAA", mimeType: "video/mp4", bytes: 3 },
                },
            } : {}),
            ...overrides,
        },
    };
}
