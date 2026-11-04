import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import localforage from "localforage";

import { apiClient } from "@/services/api/request";
import { materializeGenerationTaskAssets } from "@/services/project-asset-sync";
import { initializeRemoteUserDataSession, resetRemoteUserDataSync } from "@/services/user-data-sync";
import { createProviderNeutralGenerationTaskEffectStore } from "@/services/provider-neutral-generation-effects";
import { ASSET_STORE_KEY, flushAssetStorePersistence, generationAssetId, useAssetStore, withAssetStorePersistenceSuppressed, type VideoAsset } from "@/stores/use-asset-store";
import { applyMaterializedGenerationTaskResultToNodes } from "@/lib/canvas/canvas-generation-task-sync";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalGetItem = localforage.getItem;
const originalSetItem = localforage.setItem;
const originalRemoveItem = localforage.removeItem;

const scope = "generation-asset-recovery";
let storageValues = new Map<string, unknown>();
const asset = (id: string): VideoAsset => ({
    id,
    kind: "video",
    title: "生成视频",
    coverUrl: "",
    tags: ["生成"],
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    metadata: { source: "generation-task", generationEffectKey: "materialize:task-recovery:0", taskId: "task-recovery", outputIndex: 0 },
    data: { url: "/api/resources/video-recovered/file", storageKey: "resource:video-recovered", width: 1280, height: 720, bytes: 100, mimeType: "video/mp4" },
});

const task = {
    id: "task-recovery",
    type: "canvas_video",
    status: "succeeded" as const,
    prompt: "恢复结果",
    attempts: 1,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:01.000Z",
    outputs: [{ outputIndex: 0, mediaType: "video" as const }],
    resultJson: JSON.stringify({ video: { dataUrl: "/api/resources/video-recovered/file", storageKey: "resource:video-recovered", width: 1280, height: 720, bytes: 100, mimeType: "video/mp4" } }),
};

function scopeStorageKey(name: string) {
    return `${name}:user:${scope}`;
}

function installStorage() {
    storageValues = new Map<string, unknown>();
    localforage.getItem = (async (key: string) => storageValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        storageValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = (async (key: string) => {
        storageValues.delete(key);
    }) as typeof localforage.removeItem;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => (key === "yingce:active-user-scope" ? scope : null),
                setItem: () => undefined,
                removeItem: () => undefined,
            },
            setTimeout,
            clearTimeout,
        },
    });
}

beforeEach(async () => {
    installStorage();
    storageValues.set(scopeStorageKey(ASSET_STORE_KEY), JSON.stringify({ state: { assets: [] }, version: 0, storageRevision: 0, tombstones: { assets: {} } }));
    withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [] }));
    await flushAssetStorePersistence();
    await initializeRemoteUserDataSession("recovery-user");
    const effectStore = createProviderNeutralGenerationTaskEffectStore();
    const effectKey = "materialize:task-recovery:0";
    const claim = await effectStore.claim(effectKey, task.id);
    if (claim.status !== "claimed") throw new Error("预期能创建已完成物化effect");
    await effectStore.complete(effectKey, task.id, { materializedAssetId: "asset-recovered" }, claim.binding);
});

afterEach(async () => {
    resetRemoteUserDataSync();
    apiClient.defaults.adapter = originalAdapter;
    withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [] }));
    await flushAssetStorePersistence();
    localforage.getItem = originalGetItem;
    localforage.setItem = originalSetItem;
    localforage.removeItem = originalRemoveItem;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
});

describe("已完成生成资产恢复", () => {
    test("完成effect中的资产ID尚未加载时，定点查询并用于真实画布结果投影", async () => {
        const requests: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            requests.push(config.url || "");
            if (config.url === "/assets/batch") return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { assets: [asset("asset-recovered")] }, msg: "ok" } };
            if (config.url === "/resources/access") return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ access: { url: "https://media.example.test/video.mp4", delivery: "origin" } }] }, msg: "ok" } };
            throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        };
        const materialized = await materializeGenerationTaskAssets(task);
        const node: CanvasNodeData = { id: "node-recovery", type: CanvasNodeType.Video, title: "镜头", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { taskId: task.id, status: "loading" } };
        const applied = await applyMaterializedGenerationTaskResultToNodes([node], materialized, materialized.outputs![0]!, "attach-node:task-recovery:node-recovery:0", node.id);
        expect(requests).toEqual(["/assets/batch", "/resources/access"]);
        expect(applied.node?.metadata).toMatchObject({ assetId: "asset-recovered", storageKey: "resource:video-recovered", content: "https://media.example.test/video.mp4", status: "success" });
        expect(useAssetStore.getState().assets.map((item) => item.id)).toEqual(["asset-recovered"]);
    });

    test("本地删除墓碑优先于远端同ID记录，不请求也不复活素材", async () => {
        storageValues.set(scopeStorageKey(ASSET_STORE_KEY), JSON.stringify({ state: { assets: [] }, version: 0, storageRevision: 4, tombstones: { assets: { "asset-recovered": 5 } } }));
        let requests = 0;
        apiClient.defaults.adapter = async (config) => {
            requests += 1;
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { assets: [asset("asset-recovered")] }, msg: "ok" } };
        };
        await expect(materializeGenerationTaskAssets(task)).rejects.toThrow("生成任务输出素材已被用户删除");
        expect(requests).toBe(0);
        expect(useAssetStore.getState().assets).toEqual([]);
    });

    test("远端查询没有来历不明的物化资产时报缺失，不随机创建素材", async () => {
        let requests = 0;
        apiClient.defaults.adapter = async (config) => {
            requests += 1;
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { assets: [] }, msg: "ok" } };
        };
        await expect(materializeGenerationTaskAssets(task)).rejects.toThrow("生成任务输出素材不存在");
        expect(requests).toBe(1);
        expect(useAssetStore.getState().assets).toEqual([]);
    });

    test("物化记录完成但素材从未落库时，按同一 effectKey 重新登记同 ID 素材", async () => {
        const reTask = { ...task, id: "task-rematerialize" };
        const effectKey = `materialize:${reTask.id}:0`;
        const derivedId = await generationAssetId(effectKey);
        const effectStore = createProviderNeutralGenerationTaskEffectStore();
        const claim = await effectStore.claim(effectKey, reTask.id);
        if (claim.status !== "claimed") throw new Error("预期能重建物化effect");
        await effectStore.complete(effectKey, reTask.id, { materializedAssetId: derivedId }, claim.binding);
        apiClient.defaults.adapter = async (config) => {
            if (config.url === "/assets/batch") return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { assets: [] }, msg: "ok" } };
            if (config.url === "/resources/access") return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ access: { url: "https://media.example.test/video.mp4", delivery: "origin" } }] }, msg: "ok" } };
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: {}, msg: "ok" } };
        };
        const materialized = await materializeGenerationTaskAssets(reTask);
        expect(materialized.outputs?.[0]?.materializedAssetId).toBe(derivedId);
        expect(useAssetStore.getState().assets.map((item) => item.id)).toContain(derivedId);
    });
});
