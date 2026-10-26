import { expect, test } from "bun:test";

type Scenario =
    | "image-cleanup"
    | "scope-cleanup-switch"
    | "scope-cleanup-late-canvas-reference"
    | "video-commit-race"
    | "audio-commit-race"
    | "canvas-batch-commit-race"
    | "canvas-multi-output"
    | "canvas-copy-generation"
    | "canvas-mask-batch"
    | "canvas-asset-preparation"
    | "canvas-reentry-observation"
    | "canvas-video-reentry"
    | "canvas-local-media-backfill";

test("视频退出后重进可恢复已完成结果，并保留保存期间的新节点和编辑", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ live: Node[]; restored: Node[] }>("canvas-video-reentry");
    for (const nodes of [result.live, result.restored]) {
        const node = nodes.find((item) => item.id === "node-0")!;
        expect(node.metadata).toMatchObject({ status: "success", taskStatus: "succeeded", assetId: "asset-0", storageKey: "resource:image-0" });
        expect(node.metadata?.errorDetails).toBeUndefined();
        expect(node.metadata?.resourceReloadAvailable).not.toBe(true);
        expect(node.title).toBe("用户改名");
        expect(node.position).toEqual({ x: 700, y: 500 });
        expect(nodes.some((item) => item.id === "new-during-save")).toBe(true);
    }
});

test("重新进入画布后的加载状态不阻止同一已完成任务恢复结果", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ live: Node[]; restored: Node[] }>("canvas-reentry-observation");
    for (const nodes of [result.live, result.restored]) {
        const node = nodes.find((item) => item.id === "node-0")!;
        expect(node.metadata).toMatchObject({ status: "success", taskId: "task-0", taskStatus: "succeeded", assetId: "asset-0", storageKey: "resource:image-0" });
        expect(node.metadata?.errorDetails).toBeUndefined();
        expect(node.metadata?.resourceReloadAvailable).not.toBe(true);
        expect(node.position).toEqual({ x: 700, y: 500 });
        expect(nodes.some((item) => item.id === "new-during-save")).toBe(true);
    }
});

test("局部重绘并发完成时根节点复用主图资源和素材，重载后保持完整绑定", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ live: Node[]; restored: Node[] }>("canvas-mask-batch");
    for (const nodes of [result.live, result.restored]) {
        const root = nodes.find((node) => node.id === "mask-root")!;
        const primary = nodes.find((node) => node.id === root.metadata?.primaryImageId)!;
        expect(root.metadata).toMatchObject({ status: "success", assetId: primary.metadata!.assetId, storageKey: primary.metadata!.storageKey, batchFailedCount: 3 });
        expect(root.position).toEqual({ x: -400, y: 0 });
        expect(root.width).toBe(primary.width);
        expect(root.height).toBe(primary.height);
        expect(root.width / root.height).toBeCloseTo(640 / 360);
        expect(nodes.find((node) => node.id === "node-1")?.position).toEqual({ x: 400, y: 0 });
        expect(nodes.find((node) => node.id === "node-0")).toMatchObject({ title: "用户改名", position: { x: 700, y: 500 }, metadata: { assetId: "asset-0" } });
        expect(nodes.find((node) => node.id === "node-1")?.metadata?.assetId).toBe("asset-1");
    }
});

test("派生结果等待素材持久化且不提前发布，原始结果缺绑定及取消均阻止交付", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{
        resolvedBeforePersistence: boolean;
        nodesBeforePersistence: Node[];
        prepared: Node;
        persisted: string;
        countBeforeReuse: number;
        countAfterReuse: number;
        reusedSameNode: boolean;
        missingBindingError: boolean;
        aborted: boolean;
        finalAssetCount: number;
    }>("canvas-asset-preparation");
    expect(result.resolvedBeforePersistence).toBe(false);
    expect(result.nodesBeforePersistence[0].metadata).toEqual({ status: "loading" });
    expect(result.prepared.metadata?.assetId).toBeTruthy();
    expect(result.persisted).toContain(result.prepared.metadata!.assetId!);
    expect(result.persisted).toContain("resource:derived");
    expect(result.reusedSameNode).toBe(true);
    expect(result.countBeforeReuse).toBe(1);
    expect(result.countAfterReuse).toBe(1);
    expect(result.finalAssetCount).toBe(1);
    expect(result.missingBindingError).toBe(true);
    expect(result.aborted).toBe(true);
});

test("一次任务四图经真实消费链路堆叠并保存，刷新和重放保留四个独立资源", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ edited: boolean; live: Node[]; restored: Node[]; replayed: Node[] }>("canvas-multi-output");
    expect(result.edited).toBe(true);
    for (const nodes of [result.live, result.restored, result.replayed]) {
        expect(nodes).toHaveLength(9);
        const root = nodes.find((node) => node.id === "node-0")!;
        expect(root).toMatchObject({ title: "用户改名", position: { x: 700, y: 500 }, metadata: { isBatchRoot: true, imageBatchExpanded: false, generationOutputCount: 4, assetId: "asset-0" } });
        expect(root.metadata?.batchChildIds).toHaveLength(4);
        const children = nodes.filter((node) => node.metadata?.batchRootId === root.id);
        expect(children).toHaveLength(4);
        expect(children.map((node) => node.metadata?.storageKey)).toEqual([0, 1, 2, 3].map((index) => `resource:image-${index}`));
        expect(children.map((node) => node.metadata?.assetId)).toEqual([0, 1, 2, 3].map((index) => `asset-${index}`));
        expect(children.map((node) => node.metadata?.naturalWidth)).toEqual([640, 641, 642, 643]);
        expect(nodes.filter((node) => node.metadata?.status === "error")).toHaveLength(3);
    }
});
type ScenarioResponse<T> = { ok: true; result: T } | { ok: false; error: string };

test("已生成图片的副本在普通保存和新生成结果持久化后仍保留，原节点不受影响", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{ beforeGeneration: Node[]; restored: Node[] }>("canvas-copy-generation");
    expect(result.beforeGeneration.map((node) => node.id)).toEqual(["source", "copy"]);
    expect(result.beforeGeneration.find((node) => node.id === "copy")?.metadata?.generationEffectKeys).toBeUndefined();
    expect(result.restored.map((node) => node.id)).toEqual(["source", "copy"]);
    expect(result.restored.find((node) => node.id === "source")?.metadata).toMatchObject({ content: "original-image", generationEffectKeys: ["attach-node:old-task:source:0"] });
    expect(result.restored.find((node) => node.id === "copy")?.metadata).toMatchObject({ content: "new-image", status: "success", generationEffectKeys: ["attach-node:new-task:copy:0"] });
    expect(result.restored.find((node) => node.id === "copy")).toMatchObject({ title: "Latest user title", position: { x: 700, y: 500 } });
});

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

test("本机生成的视频经 materialize 回填时保留本地存储键并绑定素材，远端缓存缺失不得判成功", async () => {
    type Node = import("../src/types/canvas").CanvasNodeData;
    const result = await runScenario<{
        videoError: string;
        imageError: string;
        audioError: string;
        remoteVideoError: string;
        missingVideoError: string;
        emptyVideoError: string;
        missingVideo: Node["metadata"];
        emptyVideo: Node["metadata"];
        adapterCalls: number;
        liveVideo: Node["metadata"];
        restoredVideo: Node["metadata"];
        restoredImage: Node["metadata"];
        restoredAudio: Node["metadata"];
        remoteVideo: Node["metadata"];
    }>("canvas-local-media-backfill");
    // 本地 storageKey 不能被送进只认 resource: 的远程 Blob 校验（真实 getCachedResourceBlob）。
    expect(result.videoError).toBe("");
    expect(result.imageError).toBe("");
    expect(result.audioError).toBe("");
    expect(result.remoteVideoError).not.toBe("");
    for (const nodes of [result.liveVideo, result.restoredVideo]) {
        expect(nodes).toMatchObject({ status: "success", taskStatus: "succeeded", assetId: "asset-video", mimeType: "video/mp4" });
        expect(nodes?.storageKey?.startsWith("video:")).toBe(true);
        expect(nodes?.content).toBeTruthy();
        // 只有真实读到本机 Blob 才能得到这 4096 字节（asset/resultJson 的 bytes 都留空）。
        expect(nodes?.bytes).toBe(4096);
    }
    expect(result.restoredVideo?.storageKey).toBe(result.liveVideo?.storageKey);
    expect(result.restoredImage).toMatchObject({ status: "success", assetId: "asset-image", naturalWidth: 640, naturalHeight: 480 });
    expect(result.restoredImage?.storageKey?.startsWith("image:")).toBe(true);
    expect(result.restoredAudio).toMatchObject({ status: "success", assetId: "asset-audio" });
    expect(result.restoredAudio?.storageKey?.startsWith("audio:")).toBe(true);
    // 负向对照：已物化的远端 resource: 视频在浏览器没有可用 Blob 时必须失败，不能硬判成功。
    expect(result.remoteVideo?.status).not.toBe("success");
    expect(result.remoteVideo?.assetId).toBeUndefined();
    for (const [error, node] of [
        [result.missingVideoError, result.missingVideo],
        [result.emptyVideoError, result.emptyVideo],
    ] as const) {
        expect(error).toContain("生成视频文件尚未可靠保存");
        expect(node?.status).not.toBe("success");
        expect(node?.assetId).toBeUndefined();
        expect(node?.generationEffectKeys?.length || 0).toBe(0);
    }
    expect(result.adapterCalls).toBeGreaterThan(0);
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
