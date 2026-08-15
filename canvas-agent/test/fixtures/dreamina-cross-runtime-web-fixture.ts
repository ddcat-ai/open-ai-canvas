import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { waitForLocalDreaminaGenerationTask } from "../../../web/src/services/local-dreamina-generation.ts";
import { DreaminaCliRuntime } from "../../src/dreamina-cli-runtime.js";
import { createDreaminaHttpModule } from "../../src/modules/dreamina-http.js";

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-node-web-cross-runtime-"));
const stateFile = path.join(configDir, "dreamina-runtime-state.json");
const id = "dreamina-node-web-cross-runtime-0001";
const ownerId = "owner-node-web-cross-runtime-0001";
const videoBytes = Buffer.from("00000018667479706d703432", "hex");
await fs.writeFile(stateFile, JSON.stringify({
    version: 1,
    records: [{
        ownerId,
        idempotencyKey: id,
        requestHash: "9".repeat(64),
        state: "accepted",
        submitId: "receipt-node-web-cross-runtime",
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
    ownerId,
    stateFile,
    ensureReady: async () => undefined,
    discover: async () => ({ installed: true as const, executable: "dreamina-fixture" }),
};
const winner = new DreaminaCliRuntime({
    ...common,
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
    runProcess: async () => {
        waiterQueries += 1;
        return { exitCode: 0, stdout: '{"status":"failed"}', stderr: "" };
    },
});
const module = createDreaminaHttpModule({ ownerId, configDir, dreaminaRuntime: waiter });
try {
    await winner.start();
    await winnerEntered;
    const parsed = waitForLocalDreaminaGenerationTask(id, "video", {
        client: {
            async connect() {
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
            },
            async request(route, init) {
                const response = await invoke(module, route, Buffer.from(String(init?.body)));
                return new Response(JSON.stringify(response.body), {
                    status: response.status,
                    headers: { "content-type": "application/json" },
                });
            },
        },
    });
    await Promise.resolve();
    releaseWinner();
    const task = await parsed;
    assert.equal(task.status, "succeeded");
    assert.deepEqual(task.result, {
        mode: "video",
        video: {
            dataUrl: `data:video/mp4;base64,${videoBytes.toString("base64")}`,
            mimeType: "video/mp4",
            bytes: videoBytes.byteLength,
        },
    });
    assert.equal(waiterQueries, 0);
    assert.equal(winnerQueries, 2);

    const journalText = await fs.readFile(stateFile, "utf8");
    const productText = await fs.readFile(path.join(configDir, "dreamina-generation-task-store.json"), "utf8");
    for (const durableText of [journalText, productText]) {
        assert.equal(durableText.includes("data:video/"), false);
        assert.equal(durableText.includes(videoBytes.toString("base64")), false);
        assert.equal(/stdout|stderr|token|cookie/i.test(durableText), false);
    }
    process.stdout.write("dreamina-cross-runtime-web-ok\n");
} finally {
    releaseWinner();
    await Promise.allSettled([winner.dispose(), module.dispose?.()]);
    await fs.rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 10 });
}

async function invoke(
    runtimeModule: ReturnType<typeof createDreaminaHttpModule>,
    routePath: string,
    body: Buffer,
): Promise<{ status: number; body: unknown }> {
    const route = runtimeModule.routes.find((candidate) => candidate.path === routePath);
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
    let resolve!: (value: { status: number; body: unknown }) => void;
    const result = new Promise<{ status: number; body: unknown }>((done) => { resolve = done; });
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
    return result;
}
