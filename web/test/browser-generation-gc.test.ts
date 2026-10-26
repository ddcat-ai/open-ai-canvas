import { expect, test } from "bun:test";

type MediaCheck = { kind: string; status: string; readable: boolean; blocked: boolean; sawPendingReceipt: boolean; allWritesLocked: boolean };
function runScenario<T>(scenario: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/browser-generation-gc.worker.ts", import.meta.url).href, { type: "module" });
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error(`Scenario timed out (possible lock deadlock): ${scenario}`)); }, 10000);
        const stop = () => { clearTimeout(timeout); worker.terminate(); };
        worker.onmessage = (event) => { stop(); if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error)); };
        worker.onerror = (event) => { stop(); reject(event.error ?? new Error(event.message)); };
        worker.postMessage(scenario);
    });
}

test("browser image/video/audio success without materialization survives deleting another asset, then is reclaimed after task deletion", async () => {
    const results = await runScenario<Array<{ kind: string; status: string; readable: string; unrelatedRemoved: boolean; noMaterializedAssets: boolean; reclaimed: boolean }>>("retention");
    expect(results.map((result) => result.kind)).toEqual(["image", "video", "audio"]);
    for (const result of results) {
        expect(result.status).toBe("succeeded");
        expect(result.readable).toBe(`${result.kind} bytes`);
        expect(result.unrelatedRemoved).toBe(true);
        expect(result.noMaterializedAssets).toBe(true);
        expect(result.reclaimed).toBe(true);
    }
}, 15000);

test("another tab's GC waits for browser media writes and preserves the receipt-to-result commit gap", async () => {
    for (const result of await runScenario<MediaCheck[]>("write-race")) {
        expect(result.blocked).toBe(true);
        expect(result.sawPendingReceipt).toBe(true);
        expect(result.allWritesLocked).toBe(true);
        expect(result.status).toBe("succeeded");
        expect(result.readable).toBe(true);
    }
}, 15000);

test("browser media writes wait for another tab's GC for image, video and audio", async () => {
    for (const result of await runScenario<MediaCheck[]>("gc-race")) {
        expect(result.blocked).toBe(true);
        expect(result.allWritesLocked).toBe(true);
        expect(result.status).toBe("succeeded");
        expect(result.readable).toBe(true);
    }
}, 15000);

test("browser task writes and removal share the cross-tab artifact commit lock", async () => {
    const results = await runScenario<Array<{ operation: string; blocked: boolean; stateUnchanged: boolean }>>("lifecycle");
    expect(results.map((result) => result.operation)).toEqual(["write", "remove"]);
    for (const result of results) { expect(result.blocked).toBe(true); expect(result.stateUnchanged).toBe(true); }
}, 15000);

test("delayed old-scope GC returns keys only, preserves task media and still collects orphan files", async () => {
    expect(await runScenario("scope")).toEqual({ keysOnly: true, readable: true, orphanRemoved: true, foreignUntouched: true });
}, 15000);

test("failed task result commits leave a durable receipt protecting written files for recovery", async () => {
    const results = await runScenario<Array<{ kind: string; rejected: boolean; durableReceipt: boolean; readableAfterFailure: boolean; status: string }>>("commit-failure");
    for (const result of results) {
        expect(result.rejected).toBe(true);
        expect(result.durableReceipt).toBe(true);
        expect(result.readableAfterFailure).toBe(true);
        expect(result.status).toBe("succeeded");
    }
}, 15000);

test("unreadable task storage and corrupt resultJson abort GC before removing files, with recovery after task deletion", async () => {
    expect(await runScenario("failure")).toEqual({ readError: "task storage unavailable", parseFailed: true, preservedOnError: true, reclaimedAfterRemoval: true });
}, 15000);
