import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DreaminaCliRuntime } from "../../canvas-agent/src/dreamina-cli-runtime";
import { createDreaminaHttpModule } from "../../canvas-agent/src/modules/dreamina-http";
import { waitForLocalDreaminaGenerationTask } from "../src/services/local-dreamina-generation";

test("Dreamina cross-Runtime completion survives HTTP wait and the Web parser without a second provider query", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-web-cross-runtime-"));
    const stateFile = path.join(configDir, "dreamina-runtime-state.json");
    const id = "dreamina-web-cross-runtime-0001";
    const videoBytes = Buffer.from("00000018667479706d703432", "hex");
    await fs.writeFile(
        stateFile,
        JSON.stringify({
            version: 1,
            records: [
                {
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
                },
            ],
        }),
    );
    let releaseWinner!: () => void;
    let markWinnerEntered!: () => void;
    const winnerGate = new Promise<void>((resolve) => {
        releaseWinner = resolve;
    });
    const winnerEntered = new Promise<void>((resolve) => {
        markWinnerEntered = resolve;
    });
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
                async connect() {
                    return connectedFixture();
                },
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
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "video",
                    providerArtifactRef: expect.stringMatching(/^dreamina-provider-artifact:[a-f0-9-]{36}:0$/),
                },
            ],
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
        const durableText = [await fs.readFile(stateFile, "utf8"), await fs.readFile(path.join(configDir, "dreamina-generation-task-store.json"), "utf8")].join("\n");
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

async function invokeDreaminaHttp(module: ReturnType<typeof createDreaminaHttpModule>, routePath: string, body: Buffer): Promise<{ status: number; body: unknown }> {
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
    const response = new Promise<{ status: number; body: unknown }>((done) => {
        resolve = done;
    });
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

function jsonResponse(status: number, value: unknown) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
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
