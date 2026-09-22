import { expect, test } from "bun:test";

type Scenario = "image-cleanup" | "scope-cleanup-switch" | "scope-cleanup-late-canvas-reference" | "video-commit-race" | "audio-commit-race" | "canvas-batch-commit-race";
type ScenarioResponse<T> = { ok: true; result: T } | { ok: false; error: string };

test("并发生成结果经真实持久化消费链路及重新读取后保留成功、失败和用户编辑", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ edited: boolean; live: Node[]; restored: Node[] }>("canvas-batch-commit-race");
    expect(result.edited).toBe(true);
    for (const nodes of [result.live, result.restored]) {
        expect(nodes).toHaveLength(6);
        expect(nodes.filter((node) => node.metadata?.status === "success")).toHaveLength(2);
        expect(nodes.filter((node) => node.metadata?.status === "error")).toHaveLength(3);
        expect(nodes.find((node) => node.id === "node-0")).toMatchObject({ title: "用户改名", position: { x: 700, y: 500 }, metadata: { assetId: "asset-0" } });
        expect(nodes.find((node) => node.id === "node-1")?.metadata?.assetId).toBe("asset-1");
    }
});

function runScenario<T>(scenario: Scenario): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const worker = new Worker(new URL("./helpers/generation-storage-consistency.worker.ts", import.meta.url).href, { type: "module" });
        const finish = () => {
            worker.terminate();
        };
        worker.onmessage = (event: MessageEvent<ScenarioResponse<T>>) => {
            finish();
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error));
        };
        worker.onerror = (event) => {
            finish();
            reject(event.error ?? new Error(event.message));
        };
        worker.postMessage(scenario);
    });
}

test("generation image cleanup removes unused generation-image blobs and preserves referenced ones", async () => {
    const result = await runScenario<{ usedPresent: boolean; unusedPresent: boolean }>("image-cleanup");
    expect(result.usedPresent).toBe(true);
    expect(result.unusedPresent).toBe(false);
});

test("delayed cleanup keeps account-A Canvas-only image references after switching the active account", async () => {
    const result = await runScenario<{ referencedPresent: boolean; unusedPresent: boolean; otherScopePresent: boolean }>("scope-cleanup-switch");
    expect(result.referencedPresent).toBe(true);
    expect(result.unusedPresent).toBe(false);
    expect(result.otherScopePresent).toBe(true);
});

test("delayed cleanup preserves a same-scope Canvas-only reference added after cleanup was queued", async () => {
    const result = await runScenario<{ referencedPresent: boolean; unusedPresent: boolean }>("scope-cleanup-late-canvas-reference");
    expect(result.referencedPresent).toBe(true);
    expect(result.unusedPresent).toBe(false);
});

test("generation video and audio materialization cannot race cleanup into a catalog row whose blob is missing", async () => {
    for (const mediaType of ["video", "audio"] as const) {
        const result = await runScenario<{ kind?: string; storageKey?: string; blobPresent: boolean; generationAssetCount: number }>(`${mediaType}-commit-race`);
        expect(result.kind).toBe(mediaType);
        expect(result.storageKey).toMatch(new RegExp(`^generation-${mediaType}:generation-media-commit-race-${mediaType}:`));
        expect(result.blobPresent).toBe(true);
        expect(result.generationAssetCount).toBe(1);
    }
});
