import { expect, test } from "bun:test";
import localforage from "localforage";

import { rebaseCanvasProjects } from "../src/lib/canvas/canvas-storage-revision";
import { localForageStorageForScope } from "../src/lib/localforage-storage";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { applyUserSession, switchUserStorageScope } from "../src/lib/user-session";
import { canvasCinematicContinuationEntryAdapters } from "../src/components/canvas/canvas-assistant-panel";
import { activeGenerationConsumerController, beginGenerationConsumer, runGenerationConsumer } from "../src/services/generation-consumer-lifecycle";
import { createCanvasGenerationLiveProjectAdapter, persistCanvasCinematicSessionContinuationEffect, persistCanvasGenerationEffect, registerCanvasGenerationLiveProject } from "../src/services/canvas-generation-consumer";
import { CREATION_CONVERSATIONS_KEY, loadCreationConversations, pendingCreationTaskIds, pendingCreationTaskKey, saveCreationConversations } from "../src/services/creation-conversation-store";
import { recoverCreationTextTask } from "../src/services/creation-text-task-recovery";
import { ASSET_STORE_KEY, flushAssetStorePersistence, useAssetStore, type Asset, type NewAsset } from "../src/stores/use-asset-store";
import { withGenerationAssetStorageLock } from "../src/services/generation-asset-repository";
import { CANVAS_STORE_KEY, flushCanvasStorePersistence, useCanvasStore, withCanvasStorePersistenceLock, withCanvasStorePersistenceSuppressed, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import { deleteAssetWithRemoteSync, deleteCanvasProjectsWithRemoteSync, installRemoteUserDataAutoSync, resetRemoteUserDataSync, saveRemoteUserDataNow, syncRemoteUserData, withRemoteUserDataSyncExclusive } from "../src/services/user-data-sync";
import { apiClient } from "../src/services/api/request";
import { useUserStore } from "../src/stores/use-user-store";

test("creation recovery observes streaming text tasks after reload", () => {
    const conversations = [{
        id: "conversation-text-recovery",
        messages: [
            { id: "text-streaming", role: "assistant" as const, mode: "text", status: "streaming", taskIds: ["task-text"] },
            { id: "text-done", role: "assistant" as const, mode: "text", status: "done", taskIds: ["task-text-done"] },
            { id: "image-pending", role: "assistant" as const, mode: "image", status: "pending", taskIds: ["task-image"] },
        ],
    }];

    expect(pendingCreationTaskIds(conversations)).toEqual(["task-text", "task-image"]);
    expect(pendingCreationTaskKey(conversations)).toContain("conversation-text-recovery:text-streaming:task-text");
});

test("creation recovery restores completed text and terminal status", () => {
    const message = { mode: "text", status: "streaming", content: "", taskIds: ["task-text"] };
    const baseTask = {
        id: "task-text",
        type: "canvas_text",
        prompt: "写一篇小说",
        attempts: 1,
        createdAt: "2026-08-19T22:47:51.000Z",
        updatedAt: "2026-08-19T22:48:39.000Z",
    };

    expect(recoverCreationTextTask(message, [{ ...baseTask, status: "running" }])).toBeNull();
    expect(recoverCreationTextTask(message, [{ ...baseTask, status: "succeeded", resultJson: JSON.stringify({ mode: "text", text: "恢复后的正文" }) }])).toEqual({
        status: "done",
        content: "恢复后的正文",
        error: undefined,
        taskIds: ["task-text"],
    });
    expect(recoverCreationTextTask(message, [{ ...baseTask, status: "failed", error: "渠道请求失败" }])).toEqual({
        status: "error",
        content: "生成失败",
        error: "渠道请求失败",
        taskIds: ["task-text"],
    });
});

function generatedAsset(title: string): NewAsset {
    return {
        kind: "image",
        title,
        coverUrl: "opaque://asset",
        tags: [],
        metadata: {},
        data: {
            dataUrl: "opaque://asset",
            width: 1,
            height: 1,
            bytes: 1,
            mimeType: "image/png",
        },
    };
}

function storedAsset(id: string, title: string): Asset {
    return {
        ...generatedAsset(title),
        id,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    } as Asset;
}

function storedCanvasProject(id: string, title: string): CanvasProject {
    return {
        id,
        title,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}

test("localforage catalog adapter propagates IndexedDB failures without touching localStorage", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalRemoveItem = localforage.removeItem.bind(localforage);
    const localStorageCalls: string[] = [];
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => {
                    localStorageCalls.push(`get:${key}`);
                    return null;
                },
                setItem: (key: string) => {
                    localStorageCalls.push(`set:${key}`);
                },
                removeItem: (key: string) => {
                    localStorageCalls.push(`remove:${key}`);
                },
            },
        },
    });
    const unavailable = () => {
        throw new Error("indexeddb unavailable");
    };
    localforage.getItem = (async () => unavailable()) as typeof localforage.getItem;
    localforage.setItem = (async () => unavailable()) as typeof localforage.setItem;
    localforage.removeItem = (async () => unavailable()) as typeof localforage.removeItem;

    try {
        const storage = localForageStorageForScope("adapter-failure");
        await expect(storage.getItem("catalog")).rejects.toThrow("indexeddb unavailable");
        await expect(storage.setItem("catalog", "value")).rejects.toThrow("indexeddb unavailable");
        await expect(storage.removeItem("catalog")).rejects.toThrow("indexeddb unavailable");
        expect(localStorageCalls).toEqual([]);
    } finally {
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        localforage.removeItem = originalRemoveItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas flush rejects a failed catalog write and retries the retained C1 snapshot", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const durableValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    const localStorageCalls: string[] = [];
    let failWrites = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => {
                    if (key.includes(CANVAS_STORE_KEY)) localStorageCalls.push(`get:${key}`);
                    return localStorageValues.get(key) ?? null;
                },
                setItem: (key: string, value: string) => {
                    if (key.includes(CANVAS_STORE_KEY)) localStorageCalls.push(`set:${key}`);
                    localStorageValues.set(key, value);
                },
                removeItem: (key: string) => {
                    if (key.includes(CANVAS_STORE_KEY)) localStorageCalls.push(`remove:${key}`);
                    localStorageValues.delete(key);
                },
            },
        },
    });
    localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (failWrites) throw new Error("canvas catalog write failed");
        durableValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    const scope = "canvas-write-retry";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;

    try {
        setActiveUserScope(scope);
        useCanvasStore.setState({ projects: [storedCanvasProject("canvas-C0", "C0")] });
        await flushCanvasStorePersistence();
        const baseline = JSON.parse(durableValues.get(key)!) as { state: { projects: CanvasProject[] }; storageRevision: number };

        failWrites = true;
        useCanvasStore.setState({ projects: [storedCanvasProject("canvas-C0", "C1")] });
        await expect(flushCanvasStorePersistence()).rejects.toThrow("canvas catalog write failed");
        const afterFailure = JSON.parse(durableValues.get(key)!) as { state: { projects: CanvasProject[] }; storageRevision: number };
        expect(afterFailure.state.projects[0]?.title).toBe("C0");
        expect(afterFailure.storageRevision).toBe(baseline.storageRevision);
        expect(localStorageCalls).toEqual([]);

        failWrites = false;
        await flushCanvasStorePersistence();
        const recovered = JSON.parse(durableValues.get(key)!) as { state: { projects: CanvasProject[] }; storageRevision: number };
        expect(recovered.state.projects[0]?.title).toBe("C1");
        expect(recovered.storageRevision).toBeGreaterThan(baseline.storageRevision);

        withCanvasStorePersistenceSuppressed(() => {
            useCanvasStore.setState({ projects: [storedCanvasProject("canvas-C0", "stale memory")] });
        });
        await useCanvasStore.persist.rehydrate();
        expect(useCanvasStore.getState().projects[0]?.title).toBe("C1");
    } finally {
        failWrites = false;
        await flushCanvasStorePersistence();
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => {
            useCanvasStore.setState({ projects: previousProjects });
        });
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("ordinary Asset add update and remove survive a failed catalog flush and retry", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousAssets = useAssetStore.getState().assets;
    const durableValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    const localStorageCalls: string[] = [];
    let failWrites = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: {
                getItem: (key: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`get:${key}`);
                    return localStorageValues.get(key) ?? null;
                },
                setItem: (key: string, value: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`set:${key}`);
                    localStorageValues.set(key, value);
                },
                removeItem: (key: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`remove:${key}`);
                    localStorageValues.delete(key);
                },
            },
        },
    });
    localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (failWrites) throw new Error("asset catalog write failed");
        durableValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    const scope = "asset-write-retry";
    const key = `${ASSET_STORE_KEY}:user:${scope}`;

    try {
        setActiveUserScope(scope);
        useAssetStore.getState().replaceAssets([storedAsset("asset-keep", "A0"), storedAsset("asset-remove", "remove me")]);
        await flushAssetStorePersistence();
        const baseline = JSON.parse(durableValues.get(key)!) as { storageRevision: number };

        failWrites = true;
        useAssetStore.getState().updateAsset("asset-keep", { title: "A1" });
        const addedId = useAssetStore.getState().addAsset(generatedAsset("new asset"));
        void useAssetStore.getState().removeAsset("asset-remove");
        await expect(flushAssetStorePersistence()).rejects.toThrow("asset catalog write failed");
        const afterFailure = JSON.parse(durableValues.get(key)!) as { state: { assets: Asset[] }; storageRevision: number };
        expect(afterFailure.state.assets.map((asset) => asset.id).sort()).toEqual(["asset-keep", "asset-remove"]);
        expect(afterFailure.storageRevision).toBe(baseline.storageRevision);
        expect(localStorageCalls).toEqual([]);

        failWrites = false;
        await flushAssetStorePersistence();
        const recovered = JSON.parse(durableValues.get(key)!) as {
            state: { assets: Asset[] };
            storageRevision: number;
            tombstones: { assets: Record<string, number> };
        };
        expect(recovered.state.assets.find((asset) => asset.id === "asset-keep")?.title).toBe("A1");
        expect(recovered.state.assets.some((asset) => asset.id === addedId)).toBe(true);
        expect(recovered.state.assets.some((asset) => asset.id === "asset-remove")).toBe(false);
        expect(recovered.tombstones.assets["asset-remove"]).toBeGreaterThan(0);
        expect(recovered.storageRevision).toBeGreaterThan(baseline.storageRevision);
    } finally {
        failWrites = false;
        await flushAssetStorePersistence();
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("generation Asset catalog failure stays retryable by the same effect key without losing tombstones", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousAssets = useAssetStore.getState().assets;
    const durableValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    const localStorageCalls: string[] = [];
    let failWrites = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`get:${key}`);
                    return localStorageValues.get(key) ?? null;
                },
                setItem: (key: string, value: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`set:${key}`);
                    localStorageValues.set(key, value);
                },
                removeItem: (key: string) => {
                    if (key.includes(ASSET_STORE_KEY)) localStorageCalls.push(`remove:${key}`);
                    localStorageValues.delete(key);
                },
            },
        },
    });
    localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (failWrites) throw new Error("generation catalog write failed");
        durableValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    const scope = "generation-asset-write-retry";
    const key = `${ASSET_STORE_KEY}:user:${scope}`;
    const effectKey = "materialize:catalog-retry:0";

    try {
        setActiveUserScope(scope);
        useAssetStore.getState().replaceAssets([storedAsset("asset-A0", "A0")]);
        await flushAssetStorePersistence();
        const baseline = JSON.parse(durableValues.get(key)!) as { storageRevision: number };
        durableValues.set(
            key,
            JSON.stringify({
                state: { assets: [storedAsset("asset-A0", "A0")] },
                version: 0,
                storageRevision: baseline.storageRevision + 1,
                tombstones: { assets: { "asset-user-deleted": baseline.storageRevision + 1 } },
            }),
        );

        failWrites = true;
        await expect(useAssetStore.getState().addGenerationAsset(effectKey, generatedAsset("A1"))).rejects.toThrow("generation catalog write failed");
        await expect(flushAssetStorePersistence()).rejects.toThrow("generation catalog write failed");
        const afterFailure = JSON.parse(durableValues.get(key)!) as { state: { assets: Asset[] } };
        expect(afterFailure.state.assets.map((asset) => asset.id)).toEqual(["asset-A0"]);
        expect(localStorageCalls).toEqual([]);

        failWrites = false;
        const recoveredId = await useAssetStore.getState().addGenerationAsset(effectKey, generatedAsset("A1"));
        await flushAssetStorePersistence();
        const recovered = JSON.parse(durableValues.get(key)!) as {
            state: { assets: Asset[] };
            tombstones: { assets: Record<string, number> };
        };
        expect(recovered.state.assets.map((asset) => asset.id).sort()).toEqual(["asset-A0", recoveredId].sort());
        expect(recovered.state.assets.filter((asset) => asset.metadata?.generationEffectKey === effectKey)).toHaveLength(1);
        expect(recovered.tombstones.assets["asset-user-deleted"]).toBeGreaterThan(0);
    } finally {
        failWrites = false;
        await flushAssetStorePersistence().catch(() => undefined);
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("account switching rejects a failed old-scope flush and retries it before changing scope", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousAssets = useAssetStore.getState().assets;
    const durableValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    let failWrites = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (failWrites) throw new Error("old scope catalog write failed");
        durableValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    const oldScope = "account-switch-write-retry";
    const oldKey = `${ASSET_STORE_KEY}:user:${oldScope}`;

    try {
        setActiveUserScope(oldScope);
        useAssetStore.getState().replaceAssets([storedAsset("asset-A0", "A0")]);
        await flushAssetStorePersistence();

        failWrites = true;
        const addedId = useAssetStore.getState().addAsset(generatedAsset("A1"));
        await expect(switchUserStorageScope("account-switch-next")).rejects.toThrow("old scope catalog write failed");
        expect(getActiveUserScope()).toBe(oldScope);
        const afterFailure = JSON.parse(durableValues.get(oldKey)!) as { state: { assets: Asset[] } };
        expect(afterFailure.state.assets.map((asset) => asset.id)).toEqual(["asset-A0"]);

        failWrites = false;
        await switchUserStorageScope("account-switch-next");
        expect(getActiveUserScope()).toBe("account-switch-next");
        const recovered = JSON.parse(durableValues.get(oldKey)!) as { state: { assets: Asset[] } };
        expect(recovered.state.assets.some((asset) => asset.id === addedId)).toBe(true);
    } finally {
        failWrites = false;
        if (getActiveUserScope() !== oldScope) setActiveUserScope(oldScope);
        await flushAssetStorePersistence().catch(() => undefined);
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Create pending conversations stay in their account and cannot be consumed after login switches", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const values = new Map<string, unknown>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        setActiveUserScope("account-A");
        await saveCreationConversations([
            {
                id: "conversation-account-A",
                messages: [
                    {
                        id: "message-account-A",
                        role: "assistant",
                        mode: "image",
                        status: "pending",
                        taskIds: ["backend-task-account-A"],
                    },
                ],
            },
        ]);
        values.set(CREATION_CONVERSATIONS_KEY, [
            {
                id: "legacy-unscoped",
                messages: [
                    {
                        id: "legacy-message",
                        role: "assistant",
                        mode: "image",
                        status: "pending",
                        taskIds: ["legacy-unscoped-task"],
                    },
                ],
            },
        ]);
        setActiveUserScope("account-B");
        const recovered = await loadCreationConversations();
        let queries = 0;
        let materializations = 0;
        for (const _taskId of pendingCreationTaskIds(recovered ?? [])) {
            queries += 1;
            materializations += 1;
        }

        expect(recovered ?? []).toEqual([]);
        expect(queries).toBe(0);
        expect(materializations).toBe(0);
        expect(values.get(CREATION_CONVERSATIONS_KEY)).toEqual([
            {
                id: "legacy-unscoped",
                messages: [
                    {
                        id: "legacy-message",
                        role: "assistant",
                        mode: "image",
                        status: "pending",
                        taskIds: ["legacy-unscoped-task"],
                    },
                ],
            },
        ]);
    } finally {
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("asset writes freeze account scope and user switching drains the previous account queue", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const indexedValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    setActiveUserScope("account-A");

    const assetKeys: string[] = [];
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
    });
    let firstWriteStartedResolve!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
        firstWriteStartedResolve = resolve;
    });
    let blocked = false;
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (key.includes("infinite-canvas:asset_store")) {
            assetKeys.push(key);
            if (!blocked) {
                blocked = true;
                firstWriteStartedResolve();
                await firstWriteGate;
            }
        }
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const previousAssets = useAssetStore.getState().assets;
    try {
        const firstWrite = useAssetStore.getState().addGenerationAsset("materialize:scope-freeze-first:0", generatedAsset("first"));
        await firstWriteStarted;
        const secondWrite = useAssetStore.getState().addGenerationAsset("materialize:scope-freeze-second:0", generatedAsset("second"));
        const switchScope = switchUserStorageScope("account-B");

        await new Promise<void>((resolve) => queueMicrotask(resolve));
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(getActiveUserScope()).toBe("account-A");

        releaseFirstWrite();
        await Promise.all([firstWrite, secondWrite, switchScope]);
        expect(getActiveUserScope()).toBe("account-B");
        expect(assetKeys.length).toBeGreaterThanOrEqual(2);
        expect(assetKeys.every((key) => key === "infinite-canvas:asset_store:user:account-A")).toBe(true);
        expect(localStorageValues.get("infinite-canvas:asset_store:user:account-B")).toBeUndefined();
    } finally {
        releaseFirstWrite();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        useAssetStore.getState().replaceAssets(previousAssets);
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("late asset snapshots rebase field deltas and preserve explicit deletion through IndexedDB", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAssets = useAssetStore.getState().assets;
    const previousScope = getActiveUserScope();
    const indexedValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const asset = (id: string, title: string, metadata: Record<string, unknown> = {}): Asset =>
        ({
            ...generatedAsset(title),
            id,
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            metadata,
        }) as Asset;
    const assetKey = `${ASSET_STORE_KEY}:user:account-asset-tabs`;
    const setDurable = (value: string) => indexedValues.set(assetKey, value);
    const getDurable = () => indexedValues.get(assetKey);

    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
    });
    let blockerEnteredResolve!: () => void;
    const blockerEntered = new Promise<void>((resolve) => {
        blockerEnteredResolve = resolve;
    });

    try {
        setActiveUserScope("account-asset-tabs");
        const baseAssets = [asset("asset-keep", "base title", { content: "base" }), asset("asset-deleted", "deleted base")];
        useAssetStore.getState().replaceAssets(baseAssets);
        await flushAssetStorePersistence();

        const blocker = withGenerationAssetStorageLock("account-asset-tabs", async () => {
            blockerEnteredResolve();
            await blockerGate;
        });
        await blockerEntered;

        useAssetStore.getState().replaceAssets([asset("asset-keep", "tab A title", { content: "base" }), asset("asset-deleted", "tab A stale edit")]);
        setDurable(
            JSON.stringify({
                state: { assets: [asset("asset-keep", "base title", { content: "base", remoteNote: "tab B edit" })] },
                version: 0,
                storageRevision: 2,
                tombstones: { assets: { "asset-deleted": 2 } },
            }),
        );

        releaseBlocker();
        await blocker;
        await flushAssetStorePersistence();

        const durable = JSON.parse(getDurable()!) as { state: { assets: Asset[] }; storageRevision?: number };
        expect(durable.state.assets).toHaveLength(1);
        expect(durable.state.assets[0]?.title).toBe("tab A title");
        expect(durable.state.assets[0]?.metadata).toEqual({ content: "base", remoteNote: "tab B edit" });
        expect(durable.state.assets.some((candidate) => candidate.id === "asset-deleted")).toBe(false);
        expect(durable.storageRevision).toBeGreaterThan(2);
    } finally {
        releaseBlocker();
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("generation asset insertion preserves a durable deletion and schedules no trailing snapshot", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAssets = useAssetStore.getState().assets;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    const writes: string[] = [];
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        writes.push(value);
        return value;
    }) as typeof localforage.setItem;

    const staleAsset = {
        ...generatedAsset("stale asset"),
        id: "asset-deleted",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    } as Asset;
    const assetKey = `${ASSET_STORE_KEY}:user:account-generation-asset-delete`;

    try {
        setActiveUserScope("account-generation-asset-delete");
        useAssetStore.getState().replaceAssets([staleAsset]);
        await flushAssetStorePersistence();
        values.set(
            assetKey,
            JSON.stringify({
                state: { assets: [] },
                version: 0,
                storageRevision: 2,
                tombstones: { assets: { "asset-deleted": 2 } },
            }),
        );
        writes.length = 0;

        await useAssetStore.getState().addGenerationAsset("materialize:after-durable-delete:0", generatedAsset("generated"));
        await flushAssetStorePersistence();

        const durable = JSON.parse(values.get(assetKey)!) as {
            state: { assets: Asset[] };
            storageRevision?: number;
            tombstones?: { assets?: Record<string, number> };
        };
        expect(durable.state.assets.some((asset) => asset.id === "asset-deleted")).toBe(false);
        expect(durable.state.assets.filter((asset) => asset.metadata?.generationEffectKey === "materialize:after-durable-delete:0")).toHaveLength(1);
        expect(durable.tombstones?.assets?.["asset-deleted"]).toBe(2);
        expect(durable.storageRevision).toBeGreaterThan(2);
        expect(writes).toHaveLength(1);
    } finally {
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("generation Asset publication preserves an ordinary edit queued behind its stale durable read", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAssets = useAssetStore.getState().assets;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    const scope = "generation-asset-stale-publication";
    const assetKey = `${ASSET_STORE_KEY}:user:${scope}`;
    const effectKey = "materialize:stale-publication:0";
    let gateGenerationRead = false;
    let markGenerationReadStarted!: () => void;
    const generationReadStarted = new Promise<void>((resolve) => { markGenerationReadStarted = resolve; });
    let releaseGenerationRead!: () => void;
    const generationReadGate = new Promise<void>((resolve) => { releaseGenerationRead = resolve; });
    localforage.getItem = (async (key: string) => {
        const snapshot = values.get(key) ?? null;
        if (key === assetKey && gateGenerationRead) {
            gateGenerationRead = false;
            markGenerationReadStarted();
            await generationReadGate;
        }
        return snapshot;
    }) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        setActiveUserScope(scope);
        const baseAsset = storedAsset("asset-stale-publication", "base title");
        useAssetStore.getState().replaceAssets([baseAsset]);
        await flushAssetStorePersistence();

        gateGenerationRead = true;
        const generation = useAssetStore.getState().addGenerationAsset(effectKey, generatedAsset("generated asset"));
        await generationReadStarted;

        useAssetStore.getState().updateAsset(baseAsset.id, { title: "ordinary edited" });
        expect(useAssetStore.getState().assets.find((asset) => asset.id === baseAsset.id)?.title).toBe("ordinary edited");
        releaseGenerationRead();

        const generationId = await generation;
        const liveAfterGeneration = useAssetStore.getState().assets;
        expect(liveAfterGeneration.find((asset) => asset.id === baseAsset.id)?.title).toBe("ordinary edited");
        expect(liveAfterGeneration.filter((asset) => asset.metadata?.generationEffectKey === effectKey)).toHaveLength(1);
        expect(liveAfterGeneration.some((asset) => asset.id === generationId)).toBe(true);

        await flushAssetStorePersistence();
        const durable = JSON.parse(values.get(assetKey)!) as { state: { assets: Asset[] } };
        expect(durable.state.assets.find((asset) => asset.id === baseAsset.id)?.title).toBe("ordinary edited");
        expect(durable.state.assets.filter((asset) => asset.metadata?.generationEffectKey === effectKey)).toHaveLength(1);
        expect(useAssetStore.getState().assets.find((asset) => asset.id === baseAsset.id)?.title).toBe("ordinary edited");
    } finally {
        releaseGenerationRead();
        await flushAssetStorePersistence().catch(() => undefined);
        setActiveUserScope(previousScope);
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("concurrent Canvas generation effects retain both results without crossing project or user scope", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousProjects = useCanvasStore.getState().projects;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    const project = (id: string, nodes: CanvasNodeData[], chatSessions: CanvasAssistantSession[] = []): CanvasProject => ({
        id,
        title: id,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions,
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    });
    const node = (id: string, effectKey?: string): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: effectKey ? { generationEffectKeys: [effectKey] } : {},
    });
    const session = (effectKey?: string, messageId?: string): CanvasAssistantSession => ({
        id: "session-main",
        title: "session-main",
        messages: messageId ? [{ id: messageId, role: "assistant", text: messageId }] : [],
        ...(effectKey ? { generationEffectKeys: [effectKey] } : {}),
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const canvasKey = (scope: string) => `${CANVAS_STORE_KEY}:user:${scope}`;
    const encode = (projects: CanvasProject[]) => JSON.stringify({ state: { projects }, version: 0 });

    let blockFirstWrite = false;
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
    });
    let firstWriteStartedResolve!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
        firstWriteStartedResolve = resolve;
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (blockFirstWrite && key === canvasKey("account-A")) {
            blockFirstWrite = false;
            firstWriteStartedResolve();
            await firstWriteGate;
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const baseNode = node("base");
    const otherProjectNode = node("other-project");
    const otherScopeNode = node("other-scope");
    const firstEffectKey = "canvas-effect:first";
    const secondEffectKey = "canvas-effect:second";

    try {
        setActiveUserScope("account-A");
        const accountAProjects = [project("canvas-main", [baseNode], [session()]), project("canvas-other", [otherProjectNode])];
        useCanvasStore.setState({ projects: accountAProjects });
        await flushCanvasStorePersistence();
        values.set(canvasKey("account-A"), encode(accountAProjects));
        values.set(canvasKey("account-B"), encode([project("canvas-main", [otherScopeNode])]));

        blockFirstWrite = true;
        const first = persistCanvasGenerationEffect({
            projectId: "canvas-main",
            effectKey: firstEffectKey,
            nodes: [baseNode, node("result-first", firstEffectKey)],
            chatSessions: [session(firstEffectKey, "message-first")],
        });
        await firstWriteStarted;
        let secondSettled = false;
        const second = persistCanvasGenerationEffect({
            projectId: "canvas-main",
            effectKey: secondEffectKey,
            nodes: [baseNode, node("result-second", secondEffectKey)],
            chatSessions: [session(secondEffectKey, "message-second")],
        }).then(() => {
            secondSettled = true;
        });
        let otherProjectSettled = false;
        const otherProject = persistCanvasGenerationEffect({
            projectId: "canvas-other",
            effectKey: "canvas-effect:other-project",
            nodes: [otherProjectNode, node("result-other-project", "canvas-effect:other-project")],
        }).then(() => {
            otherProjectSettled = true;
        });

        setActiveUserScope("account-B");
        useCanvasStore.setState({ projects: [project("canvas-main", [otherScopeNode])] });
        let otherScopeSettled = false;
        const otherScope = persistCanvasGenerationEffect({
            projectId: "canvas-main",
            effectKey: "canvas-effect:other-scope",
            nodes: [otherScopeNode, node("result-other-scope", "canvas-effect:other-scope")],
        }).then(() => {
            otherScopeSettled = true;
        });
        await otherScope;
        expect(otherScopeSettled).toBe(true);
        expect(secondSettled).toBe(false);
        expect(otherProjectSettled).toBe(false);

        releaseFirstWrite();
        await Promise.all([first, second, otherProject, otherScope]);

        const accountA = JSON.parse(values.get(canvasKey("account-A"))!) as { state: { projects: CanvasProject[] } };
        const accountB = JSON.parse(values.get(canvasKey("account-B"))!) as { state: { projects: CanvasProject[] } };
        const accountAMain = accountA.state.projects.find((candidate) => candidate.id === "canvas-main");
        expect(accountAMain?.nodes.map((item) => item.id).sort()).toEqual(["base", "result-first", "result-second"]);
        expect(accountAMain?.chatSessions[0]?.generationEffectKeys?.sort()).toEqual([firstEffectKey, secondEffectKey]);
        expect(accountAMain?.chatSessions[0]?.messages.map((message) => message.id).sort()).toEqual(["message-first", "message-second"]);
        expect(
            accountA.state.projects
                .find((candidate) => candidate.id === "canvas-other")
                ?.nodes.map((item) => item.id)
                .sort(),
        ).toEqual(["other-project", "result-other-project"]);
        expect(accountB.state.projects[0]?.nodes.map((item) => item.id).sort()).toEqual(["other-scope", "result-other-scope"]);
    } finally {
        releaseFirstWrite();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("queued regular Canvas writes cannot overwrite a completed generation effect", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousProjects = useCanvasStore.getState().projects;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    const node = (id: string, effectKey?: string): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: effectKey ? { generationEffectKeys: [effectKey] } : {},
    });
    const project = (nodes: CanvasNodeData[]): CanvasProject => ({
        id: "canvas-main",
        title: "canvas-main",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    });
    const canvasKey = `${CANVAS_STORE_KEY}:user:account-A`;
    const decodeProjects = (value: string) => (JSON.parse(value) as { state: { projects: CanvasProject[] } }).state.projects;
    const writes: CanvasProject[][] = [];
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        if (key === canvasKey) writes.push(decodeProjects(value));
        return value;
    }) as typeof localforage.setItem;

    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
    });
    let blockerEnteredResolve!: () => void;
    const blockerEntered = new Promise<void>((resolve) => {
        blockerEnteredResolve = resolve;
    });

    try {
        setActiveUserScope("account-A");
        const baseNode = node("base");
        useCanvasStore.setState({ projects: [project([baseNode])] });
        await flushCanvasStorePersistence();
        writes.length = 0;

        const blocker = withCanvasStorePersistenceLock("account-A", async () => {
            blockerEnteredResolve();
            await blockerGate;
        });
        await blockerEntered;

        useCanvasStore.getState().updateProject("canvas-main", { nodes: [baseNode, node("ordinary-edit")] });
        const effectKey = "canvas-effect:queued-writer";
        const generation = persistCanvasGenerationEffect({
            projectId: "canvas-main",
            effectKey,
            nodes: [baseNode, node("generation-result", effectKey)],
        });
        const flush = flushCanvasStorePersistence();

        releaseBlocker();
        await Promise.all([blocker, generation, flush]);

        const finalProjects = decodeProjects(values.get(canvasKey)!);
        expect(finalProjects[0]?.nodes.map((item) => item.id).sort()).toEqual(["base", "generation-result", "ordinary-edit"]);

        const firstEffectWrite = writes.findIndex((projects) => projects[0]?.nodes.some((item) => item.id === "generation-result"));
        expect(firstEffectWrite).toBeGreaterThanOrEqual(0);
        for (const projects of writes.slice(firstEffectWrite)) {
            expect(projects[0]?.nodes.map((item) => item.id).sort()).toEqual(["base", "generation-result", "ordinary-edit"]);
        }
    } finally {
        releaseBlocker();
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas generation final read preserves an ordinary edit queued after the queue drain", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousProjects = useCanvasStore.getState().projects;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    const scope = "canvas-generation-final-read-race";
    const canvasKey = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:final-read-race";
    const node = (id: string, generationEffectKey?: string): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: generationEffectKey ? { generationEffectKeys: [generationEffectKey] } : {},
    });
    const project = (nodes: CanvasNodeData[]): CanvasProject => ({
        id: "canvas-final-read-race",
        title: "canvas-final-read-race",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    });
    let canvasReads = 0;
    let releaseFinalRead!: () => void;
    const finalReadGate = new Promise<void>((resolve) => {
        releaseFinalRead = resolve;
    });
    let markFinalReadEntered!: () => void;
    const finalReadEntered = new Promise<void>((resolve) => {
        markFinalReadEntered = resolve;
    });
    localforage.getItem = (async (key: string) => {
        const value = values.get(key) ?? null;
        if (key === canvasKey && ++canvasReads === 2) {
            markFinalReadEntered();
            await finalReadGate;
        }
        return value;
    }) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        setActiveUserScope(scope);
        const baseNode = node("base");
        const generatedNode = node("generation-result", effectKey);
        const ordinaryNode = node("ordinary-edit");
        useCanvasStore.setState({ projects: [project([baseNode])] });
        await flushCanvasStorePersistence();
        canvasReads = 0;

        withCanvasStorePersistenceSuppressed(() => {
            useCanvasStore.setState({ projects: [project([baseNode, generatedNode])] });
        });
        const generation = persistCanvasGenerationEffect({
            projectId: "canvas-final-read-race",
            effectKey,
            previousNodes: [baseNode],
            nodes: [baseNode, generatedNode],
        });

        await finalReadEntered;
        const liveAtFinalRead = useCanvasStore.getState().projects.find((candidate) => candidate.id === "canvas-final-read-race")!;
        useCanvasStore.getState().updateProject("canvas-final-read-race", {
            nodes: [...liveAtFinalRead.nodes, ordinaryNode],
            showImageInfo: true,
        });
        releaseFinalRead();

        const persisted = await generation;
        const liveAfterPersist = useCanvasStore.getState().projects.find((candidate) => candidate.id === "canvas-final-read-race")!;
        expect(liveAfterPersist.nodes.some((candidate) => candidate.id === ordinaryNode.id)).toBe(true);
        expect(liveAfterPersist.nodes.find((candidate) => candidate.id === generatedNode.id)?.metadata?.generationEffectKeys).toContain(effectKey);
        expect(liveAfterPersist.showImageInfo).toBe(true);
        expect(persisted.nodes.some((candidate) => candidate.id === ordinaryNode.id)).toBe(true);
        expect(persisted.nodes.find((candidate) => candidate.id === generatedNode.id)?.metadata?.generationEffectKeys).toContain(effectKey);

        await flushCanvasStorePersistence();
        const durable = JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] } };
        const durableProject = durable.state.projects.find((candidate) => candidate.id === "canvas-final-read-race")!;
        expect(durableProject.nodes.some((candidate) => candidate.id === ordinaryNode.id)).toBe(true);
        expect(durableProject.nodes.find((candidate) => candidate.id === generatedNode.id)?.metadata?.generationEffectKeys).toContain(effectKey);
        expect(durableProject.showImageInfo).toBe(true);
    } finally {
        releaseFinalRead();
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("late Canvas snapshots rebase field deltas and preserve explicit deletions through IndexedDB", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousProjects = useCanvasStore.getState().projects;
    const previousScope = getActiveUserScope();
    const indexedValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const node = (id: string, title = id, metadata: Record<string, unknown> = {}): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Text,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata,
    });
    const connection = (ratio: number): CanvasConnection => ({
        id: "connection-deleted",
        fromNodeId: "node-keep",
        toNodeId: "node-deleted",
        fromAnchorRatio: ratio,
    });
    const session = (id: string, title = id, message: { text: string; meta?: string } = { text: id }): CanvasAssistantSession => ({
        id,
        title,
        messages: [{ id: `message-${id}`, role: "assistant", text: message.text, ...(message.meta ? { meta: message.meta } : {}) }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const project = (id: string, input: Partial<CanvasProject> = {}): CanvasProject => ({
        id,
        title: id,
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        ...input,
    });
    const canvasKey = `${CANVAS_STORE_KEY}:user:account-canvas-tabs`;
    const setDurable = (value: string) => indexedValues.set(canvasKey, value);
    const getDurable = () => indexedValues.get(canvasKey);

    const baseProjects = [
        project("canvas-main", {
            nodes: [node("node-keep", "base title", { content: "base" }), node("node-deleted")],
            connections: [connection(0.25)],
            chatSessions: [session("session-keep"), session("session-deleted")],
            activeChatId: "session-keep",
        }),
        project("project-deleted"),
    ];

    try {
        setActiveUserScope("account-canvas-tabs");
        useCanvasStore.setState({ projects: baseProjects });
        await flushCanvasStorePersistence();

        const staleTabA = [
            project("canvas-main", {
                title: "tab A project title",
                nodes: [node("node-keep", "tab A node title", { content: "base" }), node("node-deleted", "tab A stale edit")],
                connections: [connection(0.75)],
                chatSessions: [session("session-keep", "tab A session title", { text: "tab A message" }), session("session-deleted", "tab A stale session")],
                activeChatId: "session-keep",
            }),
            project("project-deleted", { title: "tab A stale project" }),
        ];
        useCanvasStore.setState({ projects: staleTabA });

        const tabBProjects = [
            project("canvas-main", {
                title: "canvas-main",
                backgroundMode: "solid",
                nodes: [node("node-keep", "base title", { content: "base", remoteNote: "tab B node edit" })],
                chatSessions: [session("session-keep", "session-keep", { text: "session-keep", meta: "tab B message edit" })],
                activeChatId: "session-keep",
            }),
        ];
        setDurable(
            JSON.stringify({
                state: { projects: tabBProjects },
                version: 0,
                storageRevision: 2,
                tombstones: {
                    projects: { "project-deleted": 2 },
                    nodes: { "canvas-main": { "node-deleted": 2 } },
                    connections: { "canvas-main": { "connection-deleted": 2 } },
                    sessions: { "canvas-main": { "session-deleted": 2 } },
                    messages: {},
                },
            }),
        );

        await flushCanvasStorePersistence();

        const durable = JSON.parse(getDurable()!) as { state: { projects: CanvasProject[] }; storageRevision?: number };
        const main = durable.state.projects.find((candidate) => candidate.id === "canvas-main");
        const keptNode = main?.nodes.find((candidate) => candidate.id === "node-keep");
        const keptSession = main?.chatSessions.find((candidate) => candidate.id === "session-keep");
        expect(main?.title).toBe("tab A project title");
        expect(main?.backgroundMode).toBe("solid");
        expect(keptNode?.title).toBe("tab A node title");
        expect(keptNode?.metadata).toMatchObject({ content: "base", remoteNote: "tab B node edit" });
        expect(keptSession?.title).toBe("tab A session title");
        expect(keptSession?.messages[0]).toMatchObject({ text: "tab A message", meta: "tab B message edit" });
        expect(main?.nodes.some((candidate) => candidate.id === "node-deleted")).toBe(false);
        expect(main?.connections.some((candidate) => candidate.id === "connection-deleted")).toBe(false);
        expect(main?.chatSessions.some((candidate) => candidate.id === "session-deleted")).toBe(false);
        expect(durable.state.projects.some((candidate) => candidate.id === "project-deleted")).toBe(false);
        expect(durable.storageRevision).toBeGreaterThan(2);
    } finally {
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas generation commits only its delta and rejects a concurrently deleted target", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousProjects = useCanvasStore.getState().projects;
    const previousScope = getActiveUserScope();
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const node = (title: string, effectKey?: string): CanvasNodeData => ({
        id: "node-target",
        type: CanvasNodeType.Text,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {
            content: effectKey ? "generated content" : "base content",
            ...(effectKey ? { generationEffectKeys: [effectKey] } : {}),
        },
    });
    const project = (nodes: CanvasNodeData[]): CanvasProject => ({
        id: "canvas-main",
        title: "canvas-main",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes,
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    });
    const canvasKey = `${CANVAS_STORE_KEY}:user:account-generation-delta`;
    const encode = (projects: CanvasProject[], storageRevision: number, tombstones: Record<string, unknown> = {}) =>
        JSON.stringify({
            state: { projects },
            version: 0,
            storageRevision,
            tombstones: {
                projects: {},
                nodes: {},
                connections: {},
                sessions: {},
                messages: {},
                ...tombstones,
            },
        });

    try {
        setActiveUserScope("account-generation-delta");
        const baseNode = node("base title");
        useCanvasStore.setState({ projects: [project([baseNode])] });
        await flushCanvasStorePersistence();

        values.set(canvasKey, encode([project([{ ...baseNode, title: "tab B title", metadata: { ...baseNode.metadata, remoteNote: "tab B edit" } }])], 2));
        const firstEffect = "canvas-effect:delta";
        await persistCanvasGenerationEffect({
            projectId: "canvas-main",
            effectKey: firstEffect,
            previousNodes: [baseNode],
            nodes: [node("base title", firstEffect)],
        } as never);

        let durable = JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] }; storageRevision: number };
        expect(durable.state.projects[0]?.nodes[0]?.title).toBe("tab B title");
        expect(durable.state.projects[0]?.nodes[0]?.metadata).toMatchObject({
            content: "generated content",
            remoteNote: "tab B edit",
            generationEffectKeys: [firstEffect],
        });

        const secondEffect = "canvas-effect:deleted";
        const previousNode = node("base title", firstEffect);
        values.set(canvasKey, encode([project([])], durable.storageRevision + 1, { nodes: { "canvas-main": { "node-target": durable.storageRevision + 1 } } }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-main",
                effectKey: secondEffect,
                previousNodes: [previousNode],
                nodes: [{ ...previousNode, metadata: { ...previousNode.metadata, generationEffectKeys: [firstEffect, secondEffect] } }],
            } as never),
        ).rejects.toThrow("画布生成副作用与已删除内容冲突");

        durable = JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] }; storageRevision: number };
        expect(durable.state.projects[0]?.nodes).toEqual([]);

        const connection: CanvasConnection = {
            id: "connection-target",
            fromNodeId: "node-target",
            toNodeId: "node-target",
            fromAnchorRatio: 0.25,
        };
        const connectionRevision = durable.storageRevision + 1;
        values.set(canvasKey, encode([{ ...project([baseNode]), connections: [] }], connectionRevision, { connections: { "canvas-main": { "connection-target": connectionRevision } } }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-main",
                effectKey: "canvas-effect:connection-deleted",
                previousNodes: [baseNode],
                nodes: [node("base title", "canvas-effect:connection-deleted")],
                previousConnections: [connection],
                connections: [{ ...connection, fromAnchorRatio: 0.75 }],
            }),
        ).rejects.toThrow("画布生成副作用与已删除内容冲突");
        expect((JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] } }).state.projects[0]?.connections).toEqual([]);

        const session: CanvasAssistantSession = {
            id: "session-target",
            title: "session target",
            messages: [{ id: "message-target", role: "assistant", text: "before" }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const sessionRevision = connectionRevision + 1;
        values.set(canvasKey, encode([{ ...project([baseNode]), chatSessions: [] }], sessionRevision, { sessions: { "canvas-main": { "session-target": sessionRevision } } }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-main",
                effectKey: "canvas-effect:session-deleted",
                previousChatSessions: [session],
                chatSessions: [{ ...session, generationEffectKeys: ["canvas-effect:session-deleted"] }],
            }),
        ).rejects.toThrow("画布生成副作用与已删除内容冲突");
        expect((JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] } }).state.projects[0]?.chatSessions).toEqual([]);

        const projectRevision = sessionRevision + 1;
        values.set(canvasKey, encode([], projectRevision, { projects: { "canvas-main": projectRevision } }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-main",
                effectKey: "canvas-effect:project-deleted",
                previousNodes: [baseNode],
                nodes: [node("base title", "canvas-effect:project-deleted")],
            }),
        ).rejects.toThrow("画布生成副作用与已删除内容冲突");
        expect((JSON.parse(values.get(canvasKey)!) as { state: { projects: CanvasProject[] } }).state.projects).toEqual([]);
    } finally {
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("concurrent Canvas effects that change the same node field fail closed instead of merging both effect stamps", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const effectA = "canvas-effect:same-field-a";
    const effectB = "canvas-effect:same-field-b";
    const node = (content: string, effectKey?: string): CanvasNodeData => ({
        id: "node-same-field",
        type: CanvasNodeType.Text,
        title: "same field",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content, ...(effectKey ? { generationEffectKeys: [effectKey] } : {}) },
    });
    const project = (currentNode: CanvasNodeData): CanvasProject => ({
        id: "canvas-same-field",
        title: "same field",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes: [currentNode],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    });
    const scope = "canvas-same-field-conflict";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;

    try {
        setActiveUserScope(scope);
        const baseNode = node("base");
        useCanvasStore.setState({ projects: [project(baseNode)] });
        await flushCanvasStorePersistence();
        const baseline = JSON.parse(values.get(key)!) as { storageRevision: number };
        values.set(
            key,
            JSON.stringify({
                state: { projects: [project(node("effect A", effectA))] },
                version: 0,
                storageRevision: baseline.storageRevision + 1,
                tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
            }),
        );

        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-same-field",
                effectKey: effectB,
                previousNodes: [baseNode],
                nodes: [node("effect B", effectB)],
            }),
        ).rejects.toThrow("画布生成副作用与并发修改冲突");

        const durable = JSON.parse(values.get(key)!) as { state: { projects: CanvasProject[] } };
        const durableNode = durable.state.projects[0]?.nodes[0];
        expect(durableNode?.metadata?.content).toBe("effect A");
        expect(durableNode?.metadata?.generationEffectKeys).toEqual([effectA]);
    } finally {
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas storage rebase reports concurrent field conflicts for every non-node entity", () => {
    const effectA = "canvas-effect:non-node-a";
    const effectB = "canvas-effect:non-node-b";
    const stampedNode = (effectKey?: string): CanvasNodeData => ({
        id: "node-non-node-stamp",
        type: CanvasNodeType.Text,
        title: "stamp",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "stable", ...(effectKey ? { generationEffectKeys: [effectKey] } : {}) },
    });
    const connection: CanvasConnection = {
        id: "connection-non-node",
        fromNodeId: "node-non-node-stamp",
        toNodeId: "node-non-node-stamp",
        fromAnchorRatio: 0,
    };
    const session: CanvasAssistantSession = {
        id: "session-non-node",
        title: "base session",
        messages: [{ id: "message-non-node", role: "assistant", text: "base message" }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const baseProject: CanvasProject = {
        ...storedCanvasProject("canvas-non-node-conflict", "base project"),
        nodes: [stampedNode()],
        connections: [connection],
        chatSessions: [session],
    };
    const cases = [
        {
            name: "connection",
            expectedConflict: { kind: "connection", id: connection.id, projectId: baseProject.id, reason: "concurrent-update" },
            mutate: (project: CanvasProject, value: "durable" | "local") => {
                project.connections[0]!.fromAnchorRatio = value === "durable" ? 0.25 : 0.75;
            },
            read: (project: CanvasProject) => project.connections[0]?.fromAnchorRatio,
            expectedDurable: 0.25,
        },
        {
            name: "project",
            expectedConflict: { kind: "project", id: baseProject.id, reason: "concurrent-update" },
            mutate: (project: CanvasProject, value: "durable" | "local") => {
                project.title = value === "durable" ? "effect A project" : "effect B project";
            },
            read: (project: CanvasProject) => project.title,
            expectedDurable: "effect A project",
        },
        {
            name: "session",
            expectedConflict: { kind: "session", id: session.id, projectId: baseProject.id, reason: "concurrent-update" },
            mutate: (project: CanvasProject, value: "durable" | "local") => {
                project.chatSessions[0]!.title = value === "durable" ? "effect A session" : "effect B session";
            },
            read: (project: CanvasProject) => project.chatSessions[0]?.title,
            expectedDurable: "effect A session",
        },
        {
            name: "message",
            expectedConflict: { kind: "message", id: session.messages[0]!.id, projectId: baseProject.id, sessionId: session.id, reason: "concurrent-update" },
            mutate: (project: CanvasProject, value: "durable" | "local") => {
                project.chatSessions[0]!.messages[0]!.text = value === "durable" ? "effect A message" : "effect B message";
            },
            read: (project: CanvasProject) => project.chatSessions[0]?.messages[0]?.text,
            expectedDurable: "effect A message",
        },
    ] as const;

    for (const scenario of cases) {
        const durable = structuredClone(baseProject);
        const local = structuredClone(baseProject);
        durable.nodes = [stampedNode(effectA)];
        local.nodes = [stampedNode(effectB)];
        scenario.mutate(durable, "durable");
        scenario.mutate(local, "local");

        const rebased = rebaseCanvasProjects({
            document: {
                state: { projects: [durable] },
                version: 0,
                storageRevision: 2,
                tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
            },
            baseProjects: [baseProject],
            localProjects: [local],
            baseRevision: 1,
        });
        const merged = rebased.document.state.projects[0]!;

        expect(rebased.conflicts, `${scenario.name} must report a conflict`).toContainEqual(scenario.expectedConflict);
        expect(scenario.read(merged)).toBe(scenario.expectedDurable);
        expect(merged.nodes[0]?.metadata?.generationEffectKeys).toEqual([effectA, effectB]);
    }
});

test("ordinary Canvas queue flush cannot publish a losing generation stamp before the dedicated conflict check", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-connection-field-conflict";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectA = "canvas-effect:connection-a";
    const effectB = "canvas-effect:connection-b";
    const node = (effectKey?: string): CanvasNodeData => ({
        id: "node-connection-conflict",
        type: CanvasNodeType.Text,
        title: "connection node",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "stable", ...(effectKey ? { generationEffectKeys: [effectKey] } : {}) },
    });
    const baseConnection: CanvasConnection = {
        id: "connection-conflict",
        fromNodeId: "node-connection-conflict",
        toNodeId: "node-connection-conflict",
        fromAnchorRatio: 0,
    };
    const session = (effectKey?: string, title = "connection session"): CanvasAssistantSession => ({
        id: "session-connection-conflict",
        title,
        messages: [],
        ...(effectKey ? { generationEffectKeys: [effectKey] } : {}),
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const ordinaryNode = (edited = false): CanvasNodeData => ({
        id: "node-ordinary-edit",
        type: CanvasNodeType.Text,
        title: edited ? "ordinary edited" : "ordinary base",
        position: edited ? { x: 88, y: 44 } : { x: 12, y: 8 },
        width: 320,
        height: 180,
        metadata: { content: "ordinary", ordinaryState: edited ? "edited" : "base" },
    });
    const ordinarySession = (edited = false): CanvasAssistantSession => ({
        id: "session-ordinary-edit",
        title: "ordinary session",
        messages: [{ id: "message-ordinary-edit", role: "user", text: edited ? "ordinary edited message" : "ordinary base message" }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const project = (currentNode: CanvasNodeData, currentConnection: CanvasConnection, currentSession = session(), currentOrdinaryNode = ordinaryNode(), currentOrdinarySession = ordinarySession()): CanvasProject => ({
        ...storedCanvasProject("canvas-connection-conflict", "connection conflict"),
        nodes: [currentNode, currentOrdinaryNode],
        connections: [currentConnection],
        chatSessions: [currentSession, currentOrdinarySession],
    });

    try {
        setActiveUserScope(scope);
        useCanvasStore.setState({ projects: [project(node(), baseConnection)] });
        await flushCanvasStorePersistence();
        const baseline = JSON.parse(values.get(key)!) as { storageRevision: number };
        const durableA = project(node(effectA), { ...baseConnection, fromAnchorRatio: 0.25 }, session(effectA, "winner session"));
        values.set(
            key,
            JSON.stringify({
                state: { projects: [durableA] },
                version: 0,
                storageRevision: baseline.storageRevision + 1,
                tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} },
            }),
        );

        useCanvasStore.getState().updateProject("canvas-connection-conflict", {
            nodes: [node(effectB), ordinaryNode()],
            connections: [{ ...baseConnection, fromAnchorRatio: 0.75 }],
            chatSessions: [session(effectB, "loser session"), ordinarySession()],
            showImageInfo: true,
        });

        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-connection-conflict",
                effectKey: effectB,
                previousNodes: [node()],
                nodes: [node(effectB)],
                previousConnections: [baseConnection],
                connections: [{ ...baseConnection, fromAnchorRatio: 0.75 }],
                previousChatSessions: [session()],
                chatSessions: [session(effectB, "loser session")],
            }),
        ).rejects.toThrow("画布生成副作用与并发修改冲突");

        const conflictDurable = JSON.parse(values.get(key)!) as { state: { projects: CanvasProject[] } };
        expect(conflictDurable.state.projects[0]?.connections[0]?.fromAnchorRatio).toBe(0.25);
        expect(conflictDurable.state.projects[0]?.showImageInfo).toBe(true);
        expect(conflictDurable.state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toEqual([effectA]);
        expect(conflictDurable.state.projects[0]?.chatSessions[0]?.generationEffectKeys).toEqual([effectA]);

        const conflictLive = useCanvasStore.getState().projects.find((candidate) => candidate.id === "canvas-connection-conflict")!;
        expect(conflictLive.connections[0]?.fromAnchorRatio).toBe(0.25);
        expect(conflictLive.chatSessions[0]?.title).toBe("winner session");
        expect(conflictLive.nodes[0]?.metadata?.generationEffectKeys).toEqual([effectA]);
        expect(conflictLive.chatSessions[0]?.generationEffectKeys).toEqual([effectA]);

        const failedWinnerSession: CanvasAssistantSession = {
            ...conflictLive.chatSessions[0]!,
            messages: [{ id: "message-generation-failed", role: "error", text: "generation failed after conflict" }],
            updatedAt: "2026-08-14T00:00:01.000Z",
        };
        useCanvasStore.getState().updateProject("canvas-connection-conflict", {
            nodes: [conflictLive.nodes[0]!, ordinaryNode(true)],
            connections: conflictLive.connections,
            chatSessions: [failedWinnerSession, ordinarySession(true)],
            showImageInfo: false,
        });
        await flushCanvasStorePersistence();

        const durable = JSON.parse(values.get(key)!) as { state: { projects: CanvasProject[] } };
        const ordinaryDurableNode = durable.state.projects[0]?.nodes.find((candidate) => candidate.id === "node-ordinary-edit");
        const ordinaryDurableSession = durable.state.projects[0]?.chatSessions.find((candidate) => candidate.id === "session-ordinary-edit");
        expect(durable.state.projects[0]?.connections[0]?.fromAnchorRatio).toBe(0.25);
        expect(durable.state.projects[0]?.chatSessions[0]?.title).toBe("winner session");
        expect(durable.state.projects[0]?.chatSessions[0]?.messages[0]?.text).toBe("generation failed after conflict");
        expect(durable.state.projects[0]?.showImageInfo).toBe(false);
        expect(durable.state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toEqual([effectA]);
        expect(durable.state.projects[0]?.chatSessions[0]?.generationEffectKeys).toEqual([effectA]);
        expect(ordinaryDurableNode?.title).toBe("ordinary edited");
        expect(ordinaryDurableNode?.position).toEqual({ x: 88, y: 44 });
        expect(ordinaryDurableNode?.metadata?.ordinaryState).toBe("edited");
        expect(ordinaryDurableSession?.messages[0]?.text).toBe("ordinary edited message");
    } finally {
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("dedicated Canvas conflict reconciles the mounted live page generation state without rolling back newer ordinary edits", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-live-conflict-reconcile";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectA = "canvas-effect:live-winner-a";
    const effectB = "canvas-effect:live-loser-b";
    const generationNode = (content: string, effectKey?: string): CanvasNodeData => ({
        id: "node-live-generation",
        type: CanvasNodeType.Text,
        title: "generation",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content, ...(effectKey ? { generationEffectKeys: [effectKey] } : {}) },
    });
    const ordinaryNode = (title: string): CanvasNodeData => ({
        id: "node-live-ordinary",
        type: CanvasNodeType.Text,
        title,
        position: { x: 40, y: 20 },
        width: 320,
        height: 180,
        metadata: { content: "ordinary" },
    });
    const connection = (ratio: number): CanvasConnection => ({ id: "connection-live-generation", fromNodeId: "node-live-generation", toNodeId: "node-live-generation", fromAnchorRatio: ratio });
    const generationSession = (title: string, effectKey?: string): CanvasAssistantSession => ({
        id: "session-live-generation",
        title,
        messages: [],
        ...(effectKey ? { generationEffectKeys: [effectKey] } : {}),
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const ordinarySession = (text: string): CanvasAssistantSession => ({
        id: "session-live-ordinary",
        title: "ordinary",
        messages: [{ id: "message-live-ordinary", role: "user", text }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const project = (
        node: CanvasNodeData,
        currentConnection: CanvasConnection,
        session: CanvasAssistantSession,
        ordinaryNodeValue = ordinaryNode("ordinary base"),
        ordinarySessionValue = ordinarySession("ordinary base"),
        activeChatId = session.id,
    ): CanvasProject => ({
        ...storedCanvasProject("canvas-live-conflict-reconcile", "live conflict"),
        nodes: [node, ordinaryNodeValue],
        connections: [currentConnection],
        chatSessions: [session, ordinarySessionValue],
        activeChatId,
    });
    let unregisterLive: (() => void) | undefined;

    try {
        setActiveUserScope(scope);
        const baseNode = generationNode("base");
        const baseConnection = connection(0);
        const baseSession = generationSession("base session");
        useCanvasStore.setState({ projects: [project(baseNode, baseConnection, baseSession)] });
        await flushCanvasStorePersistence();
        const baseline = JSON.parse(values.get(key)!) as { storageRevision: number };
        const durableWinner = project(generationNode("winner", effectA), connection(0.25), generationSession("winner session", effectA), ordinaryNode("ordinary base"), ordinarySession("ordinary base"), "session-live-ordinary");
        values.set(key, JSON.stringify({ state: { projects: [durableWinner] }, version: 0, storageRevision: baseline.storageRevision + 1, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} } }));

        const liveOrdinaryNode = ordinaryNode("ordinary newer before conflict");
        const liveOrdinarySession = ordinarySession("ordinary newer before conflict");
        let liveNodes = [generationNode("loser", effectB), liveOrdinaryNode];
        let liveConnections = [connection(0.75)];
        let liveSessions = [generationSession("loser session", effectB), liveOrdinarySession];
        let liveActiveChatId: string | null = "session-live-generation";
        unregisterLive = registerCanvasGenerationLiveProject({
            scope,
            projectId: durableWinner.id,
            adapter: createCanvasGenerationLiveProjectAdapter({
                nodesRef: {
                    get current() {
                        return liveNodes;
                    },
                    set current(value) {
                        liveNodes = value;
                    },
                },
                connectionsRef: {
                    get current() {
                        return liveConnections;
                    },
                    set current(value) {
                        liveConnections = value;
                    },
                },
                chatSessionsRef: {
                    get current() {
                        return liveSessions;
                    },
                    set current(value) {
                        liveSessions = value;
                    },
                },
                activeChatIdRef: {
                    get current() {
                        return liveActiveChatId;
                    },
                    set current(value) {
                        liveActiveChatId = value;
                    },
                },
                setNodes: (value) => {
                    liveNodes = typeof value === "function" ? value(liveNodes) : value;
                },
                setConnections: (value) => {
                    liveConnections = typeof value === "function" ? value(liveConnections) : value;
                },
                setChatSessions: (value) => {
                    liveSessions = typeof value === "function" ? value(liveSessions) : value;
                },
                setActiveChatId: (value) => {
                    liveActiveChatId = typeof value === "function" ? value(liveActiveChatId) : value;
                },
            }),
        });
        useCanvasStore.getState().updateProject(durableWinner.id, {
            nodes: [generationNode("loser", effectB), ordinaryNode("ordinary base")],
            connections: liveConnections,
            chatSessions: [generationSession("loser session", effectB), ordinarySession("ordinary base")],
            activeChatId: liveActiveChatId,
        });

        await expect(
            persistCanvasGenerationEffect({
                projectId: durableWinner.id,
                effectKey: effectB,
                previousNodes: [baseNode, ordinaryNode("ordinary base")],
                nodes: [generationNode("loser", effectB), ordinaryNode("ordinary base")],
                previousConnections: [baseConnection],
                connections: [connection(0.75)],
                previousChatSessions: [baseSession, ordinarySession("ordinary base")],
                chatSessions: [generationSession("loser session", effectB), ordinarySession("ordinary base")],
                previousActiveChatId: baseSession.id,
                activeChatId: "session-live-generation",
            }),
        ).rejects.toThrow("画布生成副作用与并发修改冲突");

        expect(liveConnections[0]?.fromAnchorRatio).toBe(0.25);
        expect(liveNodes[0]?.metadata?.content).toBe("winner");
        expect(liveSessions[0]?.title).toBe("winner session");
        expect(liveActiveChatId).toBe("session-live-ordinary");
        expect(liveNodes[1]?.title).toBe("ordinary newer before conflict");
        expect(liveSessions[1]?.messages[0]?.text).toBe("ordinary newer before conflict");
    } finally {
        unregisterLive?.();
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("failed Canvas generation rolls back its fields without losing a concurrent edit on the same node", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-generation-same-node-edit";
    const storageKey = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:same-node-edit";
    const node = (title: string, content: string, stamped = false): CanvasNodeData => ({
        id: "node-same-edit",
        type: CanvasNodeType.Text,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content, ...(stamped ? { generationEffectKeys: [effectKey] } : {}) },
    });
    const project = (currentNode: CanvasNodeData): CanvasProject => ({ ...storedCanvasProject("canvas-same-node-edit", "same node edit"), nodes: [currentNode] });

    try {
        setActiveUserScope(scope);
        const previousNode = node("原始标题", "原始内容");
        const attemptedNode = node("原始标题", "生成内容", true);
        useCanvasStore.setState({ projects: [project(previousNode)] });
        await flushCanvasStorePersistence();

        localforage.setItem = (async (key: string, value: string) => {
            if (value.includes(effectKey)) throw new Error("forced generation durable failure");
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;
        useCanvasStore.getState().updateProject("canvas-same-node-edit", {
            nodes: [{ ...attemptedNode, title: "生成期间修改的标题" }],
        });

        await expect(
            persistCanvasGenerationEffect({
                projectId: "canvas-same-node-edit",
                effectKey,
                previousNodes: [previousNode],
                nodes: [attemptedNode],
            }),
        ).rejects.toThrow("forced generation durable failure");

        const liveNode = useCanvasStore.getState().projects[0]?.nodes[0];
        expect(liveNode?.title).toBe("生成期间修改的标题");
        expect(liveNode?.metadata?.content).toBe("原始内容");
        expect(liveNode?.metadata?.generationEffectKeys).toBeUndefined();
        const durable = JSON.parse(values.get(storageKey)!) as { state: { projects: CanvasProject[] } };
        expect(durable.state.projects[0]?.nodes[0]?.title).toBe("生成期间修改的标题");
        expect(durable.state.projects[0]?.nodes[0]?.metadata?.content).toBe("原始内容");
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic continuation durable ack failure restores mounted pending sessions across all production entry modes", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    let ackFailureMode: "error" | "abort" = "error";
    let ackAbortController: AbortController | undefined;
    let beforeAckFailure: (() => void) | undefined;
    const unregisterLiveAdapters: Array<() => void> = [];
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (value.includes("cinematic-effect:")) {
            beforeAckFailure?.();
            if (ackFailureMode === "abort") {
                ackAbortController?.abort();
                throw ackAbortController?.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
            }
            throw new Error("cinematic durable ack failed");
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        for (const entry of ["online-tool", "submit-cinematic", "resume-cinematic"] as const) {
            const scope = `cinematic-ack-${entry}`;
            const projectId = `canvas-${entry}`;
            const backendSessionId = `backend-${entry}`;
            const effectKey = `cinematic-effect:${entry}`;
            const cinematicMessageId = `message-${entry}`;
            const pendingSession: CanvasAssistantSession = {
                id: `session-${entry}`,
                title: "cinematic",
                pendingBackendSession: { id: backendSessionId, kind: "cinematic", messageId: cinematicMessageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: cinematicMessageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId, status: "pending" } }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const ordinarySession = (text: string, updatedAt = "2026-08-14T00:00:00.000Z"): CanvasAssistantSession => ({
                id: `ordinary-${entry}`,
                title: "ordinary",
                messages: [{ id: `ordinary-message-${entry}`, role: "user", text }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt,
            });
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                messages: [{ id: cinematicMessageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId, status: "completed" } }],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const baseProject = { ...storedCanvasProject(projectId, entry), chatSessions: [pendingSession, ordinarySession("ordinary base")], activeChatId: pendingSession.id };
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            const previousSessions = [pendingSession, ordinarySession("ordinary edited")];
            let mountedSessions = [completedSession, ordinarySession("ordinary edited")];
            let mountedActiveChatId: string | null = pendingSession.id;
            const pageNodesRef = { current: [] as CanvasNodeData[] };
            const pageConnectionsRef = { current: [] as CanvasConnection[] };
            const pageSessionsRef = { current: mountedSessions };
            const pageActiveChatIdRef = { current: mountedActiveChatId };
            let pageReactSessions = mountedSessions;
            let pageReactActiveChatId = mountedActiveChatId;
            unregisterLiveAdapters.push(
                registerCanvasGenerationLiveProject({
                    scope,
                    projectId,
                    adapter: createCanvasGenerationLiveProjectAdapter({
                        nodesRef: pageNodesRef,
                        connectionsRef: pageConnectionsRef,
                        chatSessionsRef: pageSessionsRef,
                        activeChatIdRef: pageActiveChatIdRef,
                        setNodes: (value) => {
                            pageNodesRef.current = typeof value === "function" ? value(pageNodesRef.current) : value;
                        },
                        setConnections: (value) => {
                            pageConnectionsRef.current = typeof value === "function" ? value(pageConnectionsRef.current) : value;
                        },
                        setChatSessions: (value) => {
                            pageReactSessions = typeof value === "function" ? value(pageReactSessions) : value;
                            pageSessionsRef.current = pageReactSessions;
                        },
                        setActiveChatId: (value) => {
                            pageReactActiveChatId = typeof value === "function" ? value(pageReactActiveChatId) : value;
                            pageActiveChatIdRef.current = pageReactActiveChatId;
                        },
                    }),
                }),
            );
            useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions, activeChatId: mountedActiveChatId });
            beforeAckFailure = () => {
                mountedSessions = mountedSessions.map((session) => (session.id === ordinarySession("x").id ? ordinarySession("ordinary late during ack", "2026-08-14T00:02:00.000Z") : session));
                mountedActiveChatId = ordinarySession("x").id;
                pageSessionsRef.current = mountedSessions;
                pageReactSessions = mountedSessions;
                pageActiveChatIdRef.current = mountedActiveChatId;
                pageReactActiveChatId = mountedActiveChatId;
                useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions, activeChatId: mountedActiveChatId });
            };

            await expect(
                persistCanvasCinematicSessionContinuationEffect({
                    projectId,
                    effectKey,
                    previousNodes: [],
                    nodes: [],
                    previousConnections: [],
                    connections: [],
                    previousChatSessions: previousSessions,
                    chatSessions: mountedSessions,
                    previousActiveChatId: pendingSession.id,
                    activeChatId: pendingSession.id,
                    readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                    restoreLiveSessions: (sessions, activeChatId) => {
                        mountedSessions = sessions;
                        mountedActiveChatId = activeChatId;
                        pageSessionsRef.current = sessions;
                        pageReactSessions = sessions;
                        pageActiveChatIdRef.current = activeChatId;
                        pageReactActiveChatId = activeChatId;
                        useCanvasStore.getState().updateProject(projectId, { chatSessions: sessions, activeChatId });
                    },
                }),
            ).rejects.toThrow("cinematic durable ack failed");

            await flushCanvasStorePersistence();
            const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            const durableCinematic = durable.state.projects[0]?.chatSessions.find((session) => session.id === pendingSession.id);
            const durableOrdinary = durable.state.projects[0]?.chatSessions.find((session) => session.id === ordinarySession("x").id);
            const mountedCinematic = mountedSessions.find((session) => session.id === pendingSession.id);
            expect(durableCinematic?.pendingBackendSession?.status, entry).toBe("pending");
            expect(durableCinematic?.generationEffectKeys, entry).toBeUndefined();
            expect(durableOrdinary?.messages[0]?.text, entry).toBe("ordinary late during ack");
            expect(mountedCinematic?.pendingBackendSession?.status, entry).toBe("pending");
            expect(mountedCinematic?.updatedAt, entry).toBe(pendingSession.updatedAt);
            expect(mountedSessions.find((session) => session.id === ordinarySession("x").id)?.messages[0]?.text, entry).toBe("ordinary late during ack");
            expect(mountedActiveChatId, entry).toBe(ordinarySession("x").id);
            expect(pageActiveChatIdRef.current, entry).toBe(ordinarySession("x").id);
            expect(pageReactActiveChatId, entry).toBe(ordinarySession("x").id);
            expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.activeChatId, entry).toBe(ordinarySession("x").id);
            expect(durable.state.projects[0]?.activeChatId, entry).toBe(ordinarySession("x").id);
        }

        ackFailureMode = "abort";
        for (const entry of ["online-tool", "submit-cinematic", "resume-cinematic"] as const) {
            const scope = `cinematic-abort-${entry}`;
            const projectId = `canvas-abort-${entry}`;
            const backendSessionId = `backend-abort-${entry}`;
            const effectKey = `cinematic-effect:abort-${entry}`;
            const cinematicMessageId = `message-abort-${entry}`;
            const pendingSession: CanvasAssistantSession = {
                id: `session-abort-${entry}`,
                title: "cinematic",
                pendingBackendSession: { id: backendSessionId, kind: "cinematic", messageId: cinematicMessageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: cinematicMessageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId, status: "pending" } }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const ordinarySession = (text: string, updatedAt = "2026-08-14T00:00:00.000Z"): CanvasAssistantSession => ({
                id: `ordinary-abort-${entry}`,
                title: "ordinary",
                messages: [{ id: `ordinary-message-abort-${entry}`, role: "user", text }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt,
            });
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                messages: [{ id: cinematicMessageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId, status: "completed" } }],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const baseProject = { ...storedCanvasProject(projectId, entry), chatSessions: [pendingSession, ordinarySession("ordinary base")], activeChatId: pendingSession.id };
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            const previousSessions = [pendingSession, ordinarySession("ordinary edited")];
            let mountedSessions = [completedSession, ordinarySession("ordinary edited")];
            let mountedActiveChatId: string | null = pendingSession.id;
            const pageNodesRef = { current: [] as CanvasNodeData[] };
            const pageConnectionsRef = { current: [] as CanvasConnection[] };
            const pageSessionsRef = { current: mountedSessions };
            const pageActiveChatIdRef = { current: mountedActiveChatId };
            let pageReactSessions = mountedSessions;
            let pageReactActiveChatId = mountedActiveChatId;
            unregisterLiveAdapters.push(
                registerCanvasGenerationLiveProject({
                    scope,
                    projectId,
                    adapter: createCanvasGenerationLiveProjectAdapter({
                        nodesRef: pageNodesRef,
                        connectionsRef: pageConnectionsRef,
                        chatSessionsRef: pageSessionsRef,
                        activeChatIdRef: pageActiveChatIdRef,
                        setNodes: (value) => {
                            pageNodesRef.current = typeof value === "function" ? value(pageNodesRef.current) : value;
                        },
                        setConnections: (value) => {
                            pageConnectionsRef.current = typeof value === "function" ? value(pageConnectionsRef.current) : value;
                        },
                        setChatSessions: (value) => {
                            pageReactSessions = typeof value === "function" ? value(pageReactSessions) : value;
                            pageSessionsRef.current = pageReactSessions;
                        },
                        setActiveChatId: (value) => {
                            pageReactActiveChatId = typeof value === "function" ? value(pageReactActiveChatId) : value;
                            pageActiveChatIdRef.current = pageReactActiveChatId;
                        },
                    }),
                }),
            );
            useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions, activeChatId: mountedActiveChatId });
            beforeAckFailure = () => {
                mountedSessions = mountedSessions.map((session) => {
                    if (session.id === pendingSession.id) {
                        return {
                            ...session,
                            messages: [...session.messages, { id: `late-cinematic-message-${entry}`, role: "user", text: "late ordinary cinematic message" }],
                            updatedAt: "2026-08-14T00:03:00.000Z",
                        };
                    }
                    return session.id === ordinarySession("x").id ? ordinarySession("ordinary late during ack", "2026-08-14T00:02:00.000Z") : session;
                });
                mountedActiveChatId = ordinarySession("x").id;
                pageSessionsRef.current = mountedSessions;
                pageReactSessions = mountedSessions;
                pageActiveChatIdRef.current = mountedActiveChatId;
                pageReactActiveChatId = mountedActiveChatId;
                useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions, activeChatId: mountedActiveChatId });
            };
            ackAbortController = new AbortController();

            const thrown = await persistCanvasCinematicSessionContinuationEffect({
                projectId,
                effectKey,
                previousNodes: [],
                nodes: [],
                previousConnections: [],
                connections: [],
                previousChatSessions: previousSessions,
                chatSessions: mountedSessions,
                previousActiveChatId: pendingSession.id,
                activeChatId: pendingSession.id,
                signal: ackAbortController.signal,
                readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                restoreLiveSessions: (sessions, activeChatId) => {
                    mountedSessions = sessions;
                    mountedActiveChatId = activeChatId;
                    pageSessionsRef.current = sessions;
                    pageReactSessions = sessions;
                    pageActiveChatIdRef.current = activeChatId;
                    pageReactActiveChatId = activeChatId;
                    useCanvasStore.getState().updateProject(projectId, { chatSessions: sessions, activeChatId });
                },
            }).then(
                () => undefined,
                (error) => error,
            );

            expect(thrown, entry).toMatchObject({ name: "AbortError" });
            await flushCanvasStorePersistence();
            const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            const durableCinematic = durable.state.projects[0]?.chatSessions.find((session) => session.id === pendingSession.id);
            const durableOrdinary = durable.state.projects[0]?.chatSessions.find((session) => session.id === ordinarySession("x").id);
            const mountedCinematic = mountedSessions.find((session) => session.id === pendingSession.id);
            expect(durableCinematic?.pendingBackendSession?.status, entry).toBe("pending");
            expect(durableCinematic?.generationEffectKeys, entry).toBeUndefined();
            expect(durableOrdinary?.messages[0]?.text, entry).toBe("ordinary late during ack");
            expect(mountedCinematic?.pendingBackendSession?.status, entry).toBe("pending");
            expect(mountedCinematic?.generationEffectKeys, entry).toBeUndefined();
            expect(mountedCinematic?.messages[0]?.detail).toMatchObject({ status: "pending" });
            expect(
                mountedCinematic?.messages.some((message) => message.id === `late-cinematic-message-${entry}`),
                entry,
            ).toBe(true);
            expect(mountedCinematic?.updatedAt, entry).toBe("2026-08-14T00:03:00.000Z");
            expect(
                durableCinematic?.messages.some((message) => message.id === `late-cinematic-message-${entry}`),
                entry,
            ).toBe(true);
            expect(durableCinematic?.updatedAt, entry).toBe("2026-08-14T00:03:00.000Z");
            expect(mountedSessions.find((session) => session.id === ordinarySession("x").id)?.messages[0]?.text, entry).toBe("ordinary late during ack");
            expect(mountedActiveChatId, entry).toBe(ordinarySession("x").id);
            expect(pageActiveChatIdRef.current, entry).toBe(ordinarySession("x").id);
            expect(pageReactActiveChatId, entry).toBe(ordinarySession("x").id);
            expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.activeChatId, entry).toBe(ordinarySession("x").id);
            expect(durable.state.projects[0]?.activeChatId, entry).toBe(ordinarySession("x").id);
        }
    } finally {
        unregisterLiveAdapters.forEach((unregister) => unregister());
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic continuation rollback reverts only unacknowledged canvas entities and preserves later ordinary edits", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    let currentEffectKey = "";
    let failureMode: "error" | "abort" = "error";
    let abortController: AbortController | undefined;
    let beforeAckFailure: (() => void) | undefined;
    let ackTriggered = false;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (!ackTriggered && currentEffectKey && value.includes(currentEffectKey)) {
            ackTriggered = true;
            beforeAckFailure?.();
            if (failureMode === "abort") {
                abortController?.abort();
                throw abortController?.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
            }
            throw new Error("cinematic canvas durable ack failed");
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const node = (id: string, title: string): CanvasNodeData => ({
        id,
        type: CanvasNodeType.Text,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: title },
    });
    const connection = (id: string, ratio: number): CanvasConnection => ({ id, fromNodeId: "node-anchor-a", toNodeId: "node-anchor-b", fromAnchorRatio: ratio });

    try {
        for (const entry of ["online-tool", "submit-cinematic", "resume-cinematic"] as const) {
            for (const mode of ["error", "abort"] as const) {
                const scope = `cinematic-canvas-rollback-${entry}-${mode}`;
                const projectId = `canvas-cinematic-rollback-${entry}-${mode}`;
                const effectKey = `cinematic-effect:canvas-rollback-${entry}-${mode}`;
                const backendSessionId = `backend-cinematic-rollback-${entry}-${mode}`;
                const cinematicSessionId = `session-cinematic-rollback-${entry}-${mode}`;
                const cinematicMessageId = `message-cinematic-rollback-${entry}-${mode}`;
                const previousNodes = [
                    node("node-cinematic-update", "previous update"),
                    node("node-cinematic-delete", "previous delete"),
                    node("node-ordinary-update", "ordinary base"),
                    node("node-ordinary-delete", "ordinary delete base"),
                    node("node-anchor-a", "anchor a"),
                    node("node-anchor-b", "anchor b"),
                ];
                const attemptedNodes = [
                    node("node-cinematic-update", "cinematic update"),
                    node("node-ordinary-update", "ordinary base"),
                    node("node-ordinary-delete", "ordinary delete base"),
                    node("node-anchor-a", "anchor a"),
                    node("node-anchor-b", "anchor b"),
                    node("node-cinematic-add", "cinematic add"),
                ];
                const previousConnections = [connection("connection-cinematic-update", 0.1), connection("connection-cinematic-delete", 0.2), connection("connection-ordinary-update", 0.3), connection("connection-ordinary-delete", 0.4)];
                const attemptedConnections = [connection("connection-cinematic-update", 0.8), connection("connection-ordinary-update", 0.3), connection("connection-ordinary-delete", 0.4), connection("connection-cinematic-add", 0.5)];
                const pendingSession: CanvasAssistantSession = {
                    id: cinematicSessionId,
                    title: "cinematic pending",
                    pendingBackendSession: { id: backendSessionId, kind: "cinematic", messageId: cinematicMessageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                    messages: [{ id: cinematicMessageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId, status: "pending" } }],
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                };
                const ordinarySession = (text: string): CanvasAssistantSession => ({
                    id: `ordinary-session-${entry}-${mode}`,
                    title: "ordinary",
                    messages: [{ id: `ordinary-message-${entry}-${mode}`, role: "user", text }],
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                });
                const completedSession: CanvasAssistantSession = {
                    ...pendingSession,
                    pendingBackendSession: undefined,
                    generationEffectKeys: [effectKey],
                    messages: [{ id: cinematicMessageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId, status: "completed" } }],
                };
                const previousSessions = [pendingSession, ordinarySession("ordinary base")];
                const attemptedSessions = [completedSession, ordinarySession("ordinary base")];
                const baseProject: CanvasProject = {
                    ...storedCanvasProject(projectId, entry),
                    nodes: previousNodes,
                    connections: previousConnections,
                    chatSessions: previousSessions,
                    activeChatId: cinematicSessionId,
                };

                setActiveUserScope(scope);
                useCanvasStore.setState({ projects: [baseProject] });
                await flushCanvasStorePersistence();

                let mountedNodes = previousNodes;
                let mountedConnections = previousConnections;
                let mountedSessions = previousSessions;
                let mountedActiveChatId: string | null = cinematicSessionId;
                const nodesRef = { current: mountedNodes };
                const connectionsRef = { current: mountedConnections };
                const chatSessionsRef = { current: mountedSessions };
                const activeChatIdRef = { current: mountedActiveChatId };
                let snapshotRef = {
                    current: {
                        projectId,
                        title: entry,
                        nodes: mountedNodes,
                        connections: mountedConnections,
                        selectedNodeIds: [] as string[],
                        viewport: { x: 0, y: 0, k: 1 },
                    },
                };
                const unregister = registerCanvasGenerationLiveProject({
                    scope,
                    projectId,
                    adapter: createCanvasGenerationLiveProjectAdapter({
                        nodesRef,
                        connectionsRef,
                        chatSessionsRef,
                        activeChatIdRef,
                        setNodes: (value) => {
                            mountedNodes = typeof value === "function" ? value(mountedNodes) : value;
                            nodesRef.current = mountedNodes;
                        },
                        setConnections: (value) => {
                            mountedConnections = typeof value === "function" ? value(mountedConnections) : value;
                            connectionsRef.current = mountedConnections;
                        },
                        setChatSessions: (value) => {
                            mountedSessions = typeof value === "function" ? value(mountedSessions) : value;
                            chatSessionsRef.current = mountedSessions;
                        },
                        setActiveChatId: (value) => {
                            mountedActiveChatId = typeof value === "function" ? value(mountedActiveChatId) : value;
                            activeChatIdRef.current = mountedActiveChatId;
                        },
                    }),
                });

                const lateNodes = [
                    node("node-cinematic-update", "late same entity edit"),
                    node("node-ordinary-update", "ordinary late update"),
                    node("node-anchor-a", "anchor a"),
                    node("node-anchor-b", "anchor b"),
                    node("node-cinematic-add", "late same cinematic add"),
                    node("node-ordinary-add", "ordinary late add"),
                ];
                const lateConnections = [connection("connection-cinematic-update", 0.9), connection("connection-ordinary-update", 0.35), connection("connection-cinematic-add", 0.6), connection("connection-ordinary-add", 0.7)];
                const lateSessions = [completedSession, ordinarySession("ordinary late during ack")];
                currentEffectKey = effectKey;
                failureMode = mode;
                abortController = mode === "abort" ? new AbortController() : undefined;
                ackTriggered = false;
                beforeAckFailure = () => {
                    mountedNodes = lateNodes;
                    nodesRef.current = lateNodes;
                    mountedConnections = lateConnections;
                    connectionsRef.current = lateConnections;
                    mountedSessions = lateSessions;
                    chatSessionsRef.current = lateSessions;
                    snapshotRef.current = { ...snapshotRef.current, nodes: lateNodes, connections: lateConnections };
                    useCanvasStore.getState().updateProject(projectId, { nodes: lateNodes, connections: lateConnections, chatSessions: lateSessions });
                };

                let providerFailed = false;
                const thrown = await canvasCinematicContinuationEntryAdapters[entry]({
                    projectId,
                    effectKey,
                    signal: abortController?.signal,
                    readSnapshot: () => snapshotRef.current,
                    executeOps: async () => {
                        mountedNodes = attemptedNodes;
                        nodesRef.current = attemptedNodes;
                        mountedConnections = attemptedConnections;
                        connectionsRef.current = attemptedConnections;
                        snapshotRef.current = { ...snapshotRef.current, nodes: attemptedNodes, connections: attemptedConnections };
                        useCanvasStore.getState().updateProject(projectId, { nodes: attemptedNodes, connections: attemptedConnections });
                        return { entry, mode };
                    },
                    completeSession: (key) => {
                        expect(key, `${entry}/${mode} effect key`).toBe(effectKey);
                        mountedSessions = attemptedSessions;
                        chatSessionsRef.current = attemptedSessions;
                        useCanvasStore.getState().updateProject(projectId, { chatSessions: attemptedSessions });
                        return attemptedSessions;
                    },
                    readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                    restoreLiveSessions: (sessions: CanvasAssistantSession[], activeId: string | null) => {
                        mountedSessions = sessions;
                        chatSessionsRef.current = sessions;
                        mountedActiveChatId = activeId;
                        activeChatIdRef.current = activeId;
                    },
                    restoreLiveSnapshot: (state) => {
                        snapshotRef.current = { ...snapshotRef.current, ...state };
                    },
                    failProvider: () => {
                        providerFailed = true;
                    },
                }).then(
                    () => undefined,
                    (error) => error,
                );
                expect(providerFailed, `${entry}/${mode}`).toBe(false);
                expect(thrown, `${entry}/${mode}`).toBeDefined();
                if (mode === "abort") expect(thrown, entry).toMatchObject({ name: "AbortError" });
                else expect(thrown, entry).toMatchObject({ name: "CanvasGenerationDurableAckError" });

                await flushCanvasStorePersistence();
                const byNodeId = new Map(mountedNodes.map((item) => [item.id, item]));
                const byConnectionId = new Map(mountedConnections.map((item) => [item.id, item]));
                expect(byNodeId.get("node-cinematic-update")?.title, `${entry}/${mode}`).toBe("previous update");
                expect(byNodeId.get("node-cinematic-delete")?.title, `${entry}/${mode}`).toBe("previous delete");
                expect(byNodeId.has("node-cinematic-add"), `${entry}/${mode}`).toBe(false);
                expect(byNodeId.get("node-ordinary-update")?.title, `${entry}/${mode}`).toBe("ordinary late update");
                expect(byNodeId.has("node-ordinary-delete"), `${entry}/${mode}`).toBe(false);
                expect(byNodeId.get("node-ordinary-add")?.title, `${entry}/${mode}`).toBe("ordinary late add");
                expect(byConnectionId.get("connection-cinematic-update")?.fromAnchorRatio, `${entry}/${mode}`).toBe(0.1);
                expect(byConnectionId.get("connection-cinematic-delete")?.fromAnchorRatio, `${entry}/${mode}`).toBe(0.2);
                expect(byConnectionId.has("connection-cinematic-add"), `${entry}/${mode}`).toBe(false);
                expect(byConnectionId.get("connection-ordinary-update")?.fromAnchorRatio, `${entry}/${mode}`).toBe(0.35);
                expect(byConnectionId.has("connection-ordinary-delete"), `${entry}/${mode}`).toBe(false);
                expect(byConnectionId.get("connection-ordinary-add")?.fromAnchorRatio, `${entry}/${mode}`).toBe(0.7);
                expect(mountedSessions.find((session) => session.id === cinematicSessionId)?.pendingBackendSession?.status, `${entry}/${mode}`).toBe("pending");
                expect(mountedSessions.find((session) => session.id === ordinarySession("x").id)?.messages[0]?.text, `${entry}/${mode}`).toBe("ordinary late during ack");
                expect(snapshotRef.current.nodes, `${entry}/${mode}`).toEqual(mountedNodes);
                expect(snapshotRef.current.connections, `${entry}/${mode}`).toEqual(mountedConnections);
                expect(nodesRef.current, `${entry}/${mode}`).toEqual(mountedNodes);
                expect(connectionsRef.current, `${entry}/${mode}`).toEqual(mountedConnections);

                const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
                const durableProject = durable.state.projects.find((project) => project.id === projectId)!;
                const durableNodes = new Map(durableProject.nodes.map((item) => [item.id, item]));
                const durableConnections = new Map(durableProject.connections.map((item) => [item.id, item]));
                expect(durableNodes.get("node-cinematic-update")?.title, `${entry}/${mode} durable`).toBe("previous update");
                expect(durableNodes.has("node-cinematic-add"), `${entry}/${mode} durable`).toBe(false);
                expect(durableNodes.get("node-ordinary-update")?.title, `${entry}/${mode} durable`).toBe("ordinary late update");
                expect(durableNodes.get("node-ordinary-add")?.title, `${entry}/${mode} durable`).toBe("ordinary late add");
                expect(durableConnections.get("connection-cinematic-update")?.fromAnchorRatio, `${entry}/${mode} durable`).toBe(0.1);
                expect(durableConnections.has("connection-cinematic-add"), `${entry}/${mode} durable`).toBe(false);
                expect(durableConnections.get("connection-ordinary-update")?.fromAnchorRatio, `${entry}/${mode} durable`).toBe(0.35);
                expect(durableConnections.get("connection-ordinary-add")?.fromAnchorRatio, `${entry}/${mode} durable`).toBe(0.7);

                unregister();
                currentEffectKey = "";
                beforeAckFailure = undefined;
                abortController = undefined;
            }

            const providerError = new Error(`provider failed ${entry}`);
            let providerFailed = false;
            const providerThrown = await canvasCinematicContinuationEntryAdapters[entry]({
                projectId: `provider-project-${entry}`,
                readSnapshot: () => ({ projectId: `provider-project-${entry}`, title: entry, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
                executeOps: async () => {
                    throw providerError;
                },
                completeSession: () => [],
                readLiveSessionState: () => ({ sessions: [], activeChatId: null }),
                restoreLiveSessions: () => undefined,
                restoreLiveSnapshot: () => undefined,
                failProvider: (error) => {
                    expect(error, `${entry} provider error identity`).toBe(providerError);
                    providerFailed = true;
                },
            }).then(
                () => undefined,
                (error) => error,
            );
            expect(providerThrown, `${entry} provider throw identity`).toBe(providerError);
            expect(providerFailed, `${entry} provider failed`).toBe(true);
        }
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic active rollback restores previous only while live still equals attempted", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    let currentEffectKey = "";
    let beforeAckFailure: (() => void) | undefined;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (currentEffectKey && value.includes(currentEffectKey)) {
            beforeAckFailure?.();
            throw new Error("cinematic active reconcile durable ack failed");
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        for (const liveMode of ["attempted", "later"] as const) {
            const scope = `cinematic-active-reconcile-${liveMode}`;
            const projectId = `canvas-cinematic-active-reconcile-${liveMode}`;
            const effectKey = `cinematic-effect:active-reconcile-${liveMode}`;
            const sessionAId = `session-a-active-reconcile-${liveMode}`;
            const sessionBId = `session-b-active-reconcile-${liveMode}`;
            const sessionCId = `session-c-active-reconcile-${liveMode}`;
            const pendingSession: CanvasAssistantSession = {
                id: sessionAId,
                title: "cinematic pending",
                pendingBackendSession: { id: `backend-active-reconcile-${liveMode}`, kind: "cinematic", messageId: `message-active-reconcile-${liveMode}`, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: `message-active-reconcile-${liveMode}`, role: "assistant", text: "pending" }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const ordinarySession = (id: string): CanvasAssistantSession => ({ id, title: id, messages: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" });
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const previousSessions = [pendingSession, ordinarySession(sessionBId), ordinarySession(sessionCId)];
            const attemptedSessions = [completedSession, ordinarySession(sessionBId), ordinarySession(sessionCId)];
            const baseProject: CanvasProject = { ...storedCanvasProject(projectId, liveMode), chatSessions: previousSessions, activeChatId: sessionAId };

            currentEffectKey = "";
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            let mountedSessions = attemptedSessions;
            let mountedActiveChatId: string | null = sessionBId;
            const chatSessionsRef = { current: mountedSessions };
            const activeChatIdRef = { current: mountedActiveChatId };
            let reactSessions = mountedSessions;
            let reactActiveChatId = mountedActiveChatId;
            const unregister = registerCanvasGenerationLiveProject({
                scope,
                projectId,
                adapter: createCanvasGenerationLiveProjectAdapter({
                    nodesRef: { current: [] },
                    connectionsRef: { current: [] },
                    chatSessionsRef,
                    activeChatIdRef,
                    setNodes: () => undefined,
                    setConnections: () => undefined,
                    setChatSessions: (value) => {
                        reactSessions = typeof value === "function" ? value(reactSessions) : value;
                        chatSessionsRef.current = reactSessions;
                    },
                    setActiveChatId: (value) => {
                        reactActiveChatId = typeof value === "function" ? value(reactActiveChatId) : value;
                        activeChatIdRef.current = reactActiveChatId;
                    },
                }),
            });
            useCanvasStore.getState().updateProject(projectId, { chatSessions: attemptedSessions, activeChatId: sessionBId });

            beforeAckFailure = () => {
                if (liveMode !== "later") return;
                mountedActiveChatId = sessionCId;
                activeChatIdRef.current = sessionCId;
                reactActiveChatId = sessionCId;
                useCanvasStore.getState().updateProject(projectId, { activeChatId: sessionCId });
            };
            currentEffectKey = effectKey;

            await expect(
                persistCanvasCinematicSessionContinuationEffect({
                    projectId,
                    effectKey,
                    previousNodes: [],
                    nodes: [],
                    previousConnections: [],
                    connections: [],
                    previousChatSessions: previousSessions,
                    chatSessions: attemptedSessions,
                    previousActiveChatId: sessionAId,
                    activeChatId: sessionBId,
                    readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                    restoreLiveSessions: (sessions, activeChatId) => {
                        mountedSessions = sessions;
                        mountedActiveChatId = activeChatId;
                        chatSessionsRef.current = sessions;
                        reactSessions = sessions;
                        activeChatIdRef.current = activeChatId;
                        reactActiveChatId = activeChatId;
                    },
                }),
            ).rejects.toThrow("cinematic active reconcile durable ack failed");

            await flushCanvasStorePersistence();
            const expectedActiveChatId = liveMode === "attempted" ? sessionAId : sessionCId;
            const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            expect(mountedActiveChatId, `${liveMode} mounted`).toBe(expectedActiveChatId);
            expect(activeChatIdRef.current, `${liveMode} ref`).toBe(expectedActiveChatId);
            expect(reactActiveChatId, `${liveMode} react`).toBe(expectedActiveChatId);
            expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.activeChatId, `${liveMode} zustand`).toBe(expectedActiveChatId);
            expect(durable.state.projects.find((project) => project.id === projectId)?.activeChatId, `${liveMode} durable`).toBe(expectedActiveChatId);

            unregister();
            currentEffectKey = "";
            beforeAckFailure = undefined;
        }
    } finally {
        currentEffectKey = "";
        beforeAckFailure = undefined;
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic shared boundary derives attempted active chat from the completed live session state", async () => {
    const projectId = "canvas-cinematic-attempted-active";
    const effectKey = "cinematic-effect:attempted-active";
    const cinematicSessionId = "session-a-attempted-active";
    const activeSessionId = "session-b-attempted-active";
    const pendingSession: CanvasAssistantSession = {
        id: cinematicSessionId,
        title: "cinematic pending",
        pendingBackendSession: { id: "backend-attempted-active", kind: "cinematic", messageId: "message-attempted-active", status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
        messages: [{ id: "message-attempted-active", role: "assistant", text: "pending" }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const activeSession: CanvasAssistantSession = { id: activeSessionId, title: "active B", messages: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };
    const completedSession: CanvasAssistantSession = {
        ...pendingSession,
        pendingBackendSession: undefined,
        generationEffectKeys: [effectKey],
        updatedAt: "2026-08-14T00:01:00.000Z",
    };
    let liveState = { sessions: [pendingSession, activeSession], activeChatId: activeSessionId as string | null };
    let persistedActiveChatId: string | null | undefined;

    await canvasCinematicContinuationEntryAdapters["resume-cinematic"]({
        projectId,
        effectKey,
        readSnapshot: () => ({ projectId, title: "attempted active", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
        executeOps: async () => undefined,
        completeSession: () => {
            liveState = { sessions: [completedSession, activeSession], activeChatId: activeSessionId };
            return liveState.sessions;
        },
        readLiveSessionState: () => liveState,
        restoreLiveSessions: () => undefined,
        restoreLiveSnapshot: () => undefined,
        failProvider: () => {
            throw new Error("provider failure must not run");
        },
        persistContinuation: async (input) => {
            persistedActiveChatId = input.activeChatId;
            return { ...storedCanvasProject(projectId, "attempted active"), chatSessions: input.chatSessions, activeChatId: input.activeChatId };
        },
    });

    expect(persistedActiveChatId).toBe(activeSessionId);
});

test("resume cinematic continuation preserves a non-current active chat across failure switches", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    let currentEffectKey = "";
    let failureMode: "error" | "abort" = "error";
    let abortController: AbortController | undefined;
    let beforeGenerationWrite: (() => void) | undefined;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (currentEffectKey && value.includes(currentEffectKey)) {
            beforeGenerationWrite?.();
            if (failureMode === "abort") {
                abortController?.abort();
                throw abortController?.signal.reason ?? new DOMException("The operation was aborted", "AbortError");
            }
            throw new Error("resume cinematic durable ack failed");
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        for (const mode of ["error", "abort"] as const) {
            const scope = `resume-active-${mode}`;
            const projectId = `canvas-resume-active-${mode}`;
            const effectKey = `cinematic-effect:resume-active-${mode}`;
            const backendSessionId = `backend-resume-active-${mode}`;
            const cinematicSessionId = `session-a-${mode}`;
            const sessionBId = `session-b-${mode}`;
            const sessionCId = `session-c-${mode}`;
            const cinematicMessageId = `message-a-${mode}`;
            const pendingSession: CanvasAssistantSession = {
                id: cinematicSessionId,
                title: "cinematic pending",
                pendingBackendSession: { id: backendSessionId, kind: "cinematic", messageId: cinematicMessageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: cinematicMessageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId, status: "pending" } }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const ordinarySession = (id: string, title: string): CanvasAssistantSession => ({
                id,
                title,
                messages: [{ id: `${id}-message`, role: "user", text: title }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            });
            const sessionB = ordinarySession(sessionBId, "session B");
            const sessionC = ordinarySession(sessionCId, "session C");
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                messages: [{ id: cinematicMessageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId, status: "completed" } }],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const previousSessions = [pendingSession, sessionB, sessionC];
            const completedSessions = [completedSession, sessionB, sessionC];
            const baseProject: CanvasProject = { ...storedCanvasProject(projectId, mode), chatSessions: previousSessions, activeChatId: sessionBId };

            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            let panelSessions = previousSessions;
            let panelActiveChatId: string | null = sessionBId;
            const nodesRef = { current: [] as CanvasNodeData[] };
            const connectionsRef = { current: [] as CanvasConnection[] };
            const chatSessionsRef = { current: previousSessions };
            const activeChatIdRef = { current: sessionBId as string | null };
            let reactSessions = previousSessions;
            let reactActiveChatId: string | null = sessionBId;
            const snapshotRef = {
                current: { projectId, title: mode, nodes: [] as CanvasNodeData[], connections: [] as CanvasConnection[], selectedNodeIds: [] as string[], viewport: { x: 0, y: 0, k: 1 } },
            };
            const unregister = registerCanvasGenerationLiveProject({
                scope,
                projectId,
                adapter: createCanvasGenerationLiveProjectAdapter({
                    nodesRef,
                    connectionsRef,
                    chatSessionsRef,
                    activeChatIdRef,
                    setNodes: (value) => {
                        nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                    },
                    setConnections: (value) => {
                        connectionsRef.current = typeof value === "function" ? value(connectionsRef.current) : value;
                    },
                    setChatSessions: (value) => {
                        reactSessions = typeof value === "function" ? value(reactSessions) : value;
                        chatSessionsRef.current = reactSessions;
                    },
                    setActiveChatId: (value) => {
                        reactActiveChatId = typeof value === "function" ? value(reactActiveChatId) : value;
                        activeChatIdRef.current = reactActiveChatId;
                    },
                }),
            });

            currentEffectKey = effectKey;
            failureMode = mode;
            abortController = mode === "abort" ? new AbortController() : undefined;
            beforeGenerationWrite = () => {
                panelActiveChatId = sessionCId;
                activeChatIdRef.current = sessionCId;
                reactActiveChatId = sessionCId;
                useCanvasStore.getState().updateProject(projectId, { activeChatId: sessionCId });
            };

            let providerFailed = false;
            const thrown = await canvasCinematicContinuationEntryAdapters["resume-cinematic"]({
                projectId,
                effectKey,
                signal: abortController?.signal,
                readSnapshot: () => snapshotRef.current,
                executeOps: async () => undefined,
                completeSession: (key) => {
                    expect(key, mode).toBe(effectKey);
                    panelSessions = completedSessions;
                    return completedSessions;
                },
                readLiveSessionState: () => ({ sessions: panelSessions, activeChatId: panelActiveChatId }),
                restoreLiveSessions: (sessions, activeChatId) => {
                    panelSessions = sessions;
                    panelActiveChatId = activeChatId;
                },
                restoreLiveSnapshot: () => undefined,
                failProvider: () => {
                    providerFailed = true;
                },
            }).then(
                () => undefined,
                (error) => error,
            );

            expect(providerFailed, mode).toBe(false);
            if (mode === "abort") expect(thrown, mode).toMatchObject({ name: "AbortError" });
            else expect(thrown, mode).toMatchObject({ name: "CanvasGenerationDurableAckError" });
            await flushCanvasStorePersistence();

            const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            const durableProject = durable.state.projects.find((project) => project.id === projectId)!;
            expect(panelActiveChatId, `${mode} panel`).toBe(sessionCId);
            expect(activeChatIdRef.current, `${mode} page ref`).toBe(sessionCId);
            expect(reactActiveChatId, `${mode} react`).toBe(sessionCId);
            expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.activeChatId, `${mode} zustand`).toBe(sessionCId);
            expect(durableProject.activeChatId, `${mode} durable`).toBe(sessionCId);
            expect(panelSessions.find((session) => session.id === cinematicSessionId)?.pendingBackendSession?.status, mode).toBe("pending");
            expect(chatSessionsRef.current.find((session) => session.id === cinematicSessionId)?.pendingBackendSession?.status, mode).toBe("pending");
            expect(reactSessions.find((session) => session.id === cinematicSessionId)?.pendingBackendSession?.status, mode).toBe("pending");

            unregister();
            currentEffectKey = "";
            beforeGenerationWrite = undefined;
            abortController = undefined;
        }
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("resume cinematic continuation persists the real completed active chat on success", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "resume-active-success";
    const projectId = "canvas-resume-active-success";
    const effectKey = "cinematic-effect:resume-active-success";
    const cinematicSessionId = "session-a-success";
    const sessionBId = "session-b-success";
    const pendingSession: CanvasAssistantSession = {
        id: cinematicSessionId,
        title: "cinematic pending",
        pendingBackendSession: { id: "backend-resume-active-success", kind: "cinematic", messageId: "message-a-success", status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
        messages: [{ id: "message-a-success", role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId: "backend-resume-active-success", status: "pending" } }],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const sessionB: CanvasAssistantSession = { id: sessionBId, title: "session B", messages: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" };
    const completedSession: CanvasAssistantSession = {
        ...pendingSession,
        pendingBackendSession: undefined,
        generationEffectKeys: [effectKey],
        messages: [{ id: "message-a-success", role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId: "backend-resume-active-success", status: "completed" } }],
        updatedAt: "2026-08-14T00:01:00.000Z",
    };
    const previousSessions = [pendingSession, sessionB];
    const completedSessions = [completedSession, sessionB];
    const baseProject: CanvasProject = { ...storedCanvasProject(projectId, "resume success"), chatSessions: previousSessions, activeChatId: sessionBId };

    try {
        setActiveUserScope(scope);
        useCanvasStore.setState({ projects: [baseProject] });
        await flushCanvasStorePersistence();

        let mountedSessions = previousSessions;
        let mountedActiveChatId: string | null = sessionBId;
        const activeChatIdRef = { current: sessionBId as string | null };
        let reactActiveChatId: string | null = sessionBId;
        const unregister = registerCanvasGenerationLiveProject({
            scope,
            projectId,
            adapter: createCanvasGenerationLiveProjectAdapter({
                nodesRef: { current: [] },
                connectionsRef: { current: [] },
                chatSessionsRef: { current: previousSessions },
                activeChatIdRef,
                setNodes: () => undefined,
                setConnections: () => undefined,
                setChatSessions: () => undefined,
                setActiveChatId: (value) => {
                    reactActiveChatId = typeof value === "function" ? value(reactActiveChatId) : value;
                    activeChatIdRef.current = reactActiveChatId;
                },
            }),
        });

        await canvasCinematicContinuationEntryAdapters["resume-cinematic"]({
            projectId,
            effectKey,
            readSnapshot: () => ({ projectId, title: "resume success", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
            executeOps: async () => undefined,
            completeSession: () => {
                mountedSessions = completedSessions;
                return completedSessions;
            },
            readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
            restoreLiveSessions: (sessions, activeChatId) => {
                mountedSessions = sessions;
                mountedActiveChatId = activeChatId;
            },
            restoreLiveSnapshot: () => undefined,
            failProvider: () => {
                throw new Error("provider failure must not run on success");
            },
        });

        const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
        const durableProject = durable.state.projects.find((project) => project.id === projectId)!;
        expect(mountedActiveChatId).toBe(sessionBId);
        expect(activeChatIdRef.current).toBe(sessionBId);
        expect(reactActiveChatId).toBe(sessionBId);
        expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.activeChatId).toBe(sessionBId);
        expect(durableProject.activeChatId).toBe(sessionBId);
        expect(durableProject.chatSessions.find((session) => session.id === cinematicSessionId)?.generationEffectKeys).toContain(effectKey);

        unregister();
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic generation commit point survives an abort fired after the durable setItem resolves", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    let currentEffectKey = "";
    let postWriteAbortController: AbortController | undefined;
    let generationWrites = 0;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        if (currentEffectKey && value.includes(currentEffectKey)) {
            generationWrites += 1;
            postWriteAbortController?.abort();
        }
        return value;
    }) as typeof localforage.setItem;

    try {
        for (const entry of ["online-tool", "submit-cinematic", "resume-cinematic"] as const) {
            const scope = `cinematic-post-write-abort-${entry}`;
            const projectId = `canvas-post-write-abort-${entry}`;
            const effectKey = `cinematic-effect:post-write-abort-${entry}`;
            const sessionId = `session-post-write-abort-${entry}`;
            const messageId = `message-post-write-abort-${entry}`;
            const pendingSession: CanvasAssistantSession = {
                id: sessionId,
                title: "cinematic pending",
                pendingBackendSession: { id: `backend-${entry}`, kind: "cinematic", messageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: messageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId: `backend-${entry}`, status: "pending" } }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                messages: [{ id: messageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId: `backend-${entry}`, status: "completed" } }],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const baseProject: CanvasProject = { ...storedCanvasProject(projectId, entry), chatSessions: [pendingSession], activeChatId: sessionId };
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            let mountedSessions = [pendingSession];
            let mountedActiveChatId: string | null = sessionId;
            const chatSessionsRef = { current: mountedSessions };
            const activeChatIdRef = { current: mountedActiveChatId };
            let reactSessions = mountedSessions;
            let reactActiveChatId: string | null = mountedActiveChatId;
            const unregister = registerCanvasGenerationLiveProject({
                scope,
                projectId,
                adapter: createCanvasGenerationLiveProjectAdapter({
                    nodesRef: { current: [] },
                    connectionsRef: { current: [] },
                    chatSessionsRef,
                    activeChatIdRef,
                    setNodes: () => undefined,
                    setConnections: () => undefined,
                    setChatSessions: (value) => {
                        reactSessions = typeof value === "function" ? value(reactSessions) : value;
                        chatSessionsRef.current = reactSessions;
                    },
                    setActiveChatId: (value) => {
                        reactActiveChatId = typeof value === "function" ? value(reactActiveChatId) : value;
                        activeChatIdRef.current = reactActiveChatId;
                    },
                }),
            });

            currentEffectKey = effectKey;
            postWriteAbortController = new AbortController();
            const writesBefore = generationWrites;
            let executeCount = 0;
            let providerFailed = false;
            const result = await canvasCinematicContinuationEntryAdapters[entry]({
                projectId,
                effectKey,
                signal: postWriteAbortController.signal,
                readSnapshot: () => ({ projectId, title: entry, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
                executeOps: async () => {
                    executeCount += 1;
                    return `${entry}-completed`;
                },
                completeSession: () => {
                    mountedSessions = [completedSession];
                    chatSessionsRef.current = mountedSessions;
                    reactSessions = mountedSessions;
                    useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions });
                    return mountedSessions;
                },
                readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                restoreLiveSessions: (sessions, activeChatId) => {
                    mountedSessions = sessions;
                    mountedActiveChatId = activeChatId;
                },
                restoreLiveSnapshot: () => undefined,
                failProvider: () => {
                    providerFailed = true;
                },
            });

            expect(result, entry).toBe(`${entry}-completed`);
            expect(providerFailed, entry).toBe(false);
            expect(executeCount, entry).toBe(1);
            expect(generationWrites - writesBefore, entry).toBe(1);
            const durable = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            const durableSession = durable.state.projects.find((project) => project.id === projectId)?.chatSessions.find((session) => session.id === sessionId);
            expect(durableSession?.pendingBackendSession, entry).toBeUndefined();
            expect(durableSession?.generationEffectKeys, entry).toContain(effectKey);
            expect(durableSession?.messages[0]?.detail).toMatchObject({ status: "completed" });
            expect(mountedSessions[0]?.pendingBackendSession, entry).toBeUndefined();
            expect(mountedSessions[0]?.generationEffectKeys, entry).toContain(effectKey);
            expect(chatSessionsRef.current[0]?.generationEffectKeys, entry).toContain(effectKey);
            expect(reactSessions[0]?.generationEffectKeys, entry).toContain(effectKey);

            if (!mountedSessions[0]?.generationEffectKeys?.includes(effectKey)) {
                await canvasCinematicContinuationEntryAdapters[entry]({
                    projectId,
                    effectKey,
                    readSnapshot: () => ({ projectId, title: entry, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
                    executeOps: async () => {
                        executeCount += 1;
                        return `${entry}-replayed`;
                    },
                    completeSession: () => mountedSessions,
                    readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: mountedActiveChatId }),
                    restoreLiveSessions: () => undefined,
                    restoreLiveSnapshot: () => undefined,
                    failProvider: () => undefined,
                });
            }
            expect(executeCount, `${entry} replay`).toBe(1);

            unregister();
            currentEffectKey = "";
            postWriteAbortController = undefined;
        }
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("cinematic committed generation survives later ordinary persistence and final-read errors", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });

    let currentEffectKey = "";
    let generationCommitted = false;
    let generationWriteHandled = false;
    let failOrdinaryWrite = false;
    let failFinalRead = false;
    let projectIdForLateEdit = "";
    localforage.getItem = (async (key: string) => {
        if (generationCommitted && failFinalRead) {
            failFinalRead = false;
            throw new Error("post-commit final read failed");
        }
        return values.get(key) ?? null;
    }) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (!generationWriteHandled && currentEffectKey && value.includes(currentEffectKey)) {
            generationWriteHandled = true;
            values.set(key, value);
            generationCommitted = true;
            if (failOrdinaryWrite) useCanvasStore.getState().updateProject(projectIdForLateEdit, { showImageInfo: true });
            return value;
        }
        if (generationCommitted && failOrdinaryWrite) {
            failOrdinaryWrite = false;
            throw new Error("post-commit ordinary write failed");
        }
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    try {
        for (const mode of ["ordinary-write-error", "final-read-error"] as const) {
            const scope = `cinematic-post-commit-${mode}`;
            const projectId = `canvas-post-commit-${mode}`;
            const effectKey = `cinematic-effect:post-commit-${mode}`;
            const sessionId = `session-post-commit-${mode}`;
            const messageId = `message-post-commit-${mode}`;
            const pendingSession: CanvasAssistantSession = {
                id: sessionId,
                title: "pending",
                pendingBackendSession: { id: `backend-${mode}`, kind: "cinematic", messageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
                messages: [{ id: messageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId: `backend-${mode}`, status: "pending" } }],
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            };
            const completedSession: CanvasAssistantSession = {
                ...pendingSession,
                pendingBackendSession: undefined,
                generationEffectKeys: [effectKey],
                messages: [{ id: messageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId: `backend-${mode}`, status: "completed" } }],
                updatedAt: "2026-08-14T00:01:00.000Z",
            };
            const baseProject: CanvasProject = { ...storedCanvasProject(projectId, mode), chatSessions: [pendingSession], activeChatId: sessionId, showImageInfo: false };
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [baseProject] });
            await flushCanvasStorePersistence();

            let mountedSessions = [pendingSession];
            currentEffectKey = effectKey;
            generationCommitted = false;
            generationWriteHandled = false;
            projectIdForLateEdit = projectId;
            failOrdinaryWrite = mode === "ordinary-write-error";
            failFinalRead = mode === "final-read-error";

            const result = await canvasCinematicContinuationEntryAdapters["online-tool"]({
                projectId,
                effectKey,
                readSnapshot: () => ({ projectId, title: mode, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
                executeOps: async () => mode,
                completeSession: () => {
                    mountedSessions = [completedSession];
                    useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions });
                    return mountedSessions;
                },
                readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: sessionId }),
                restoreLiveSessions: (sessions) => {
                    mountedSessions = sessions;
                },
                restoreLiveSnapshot: () => undefined,
                failProvider: () => {
                    throw new Error("post-commit errors must not be classified as provider failures");
                },
            });

            expect(result, mode).toBe(mode);
            const committed = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
            const committedProject = committed.state.projects.find((project) => project.id === projectId)!;
            expect(committedProject.chatSessions[0]?.generationEffectKeys, mode).toContain(effectKey);
            expect(committedProject.chatSessions[0]?.pendingBackendSession, mode).toBeUndefined();

            if (mode === "ordinary-write-error") {
                expect(useCanvasStore.getState().projects.find((project) => project.id === projectId)?.showImageInfo).toBe(true);
                await flushCanvasStorePersistence();
                const retried = JSON.parse(values.get(`${CANVAS_STORE_KEY}:user:${scope}`)!) as { state: { projects: CanvasProject[] } };
                const retriedProject = retried.state.projects.find((project) => project.id === projectId)!;
                expect(retriedProject.showImageInfo).toBe(true);
                expect(retriedProject.chatSessions[0]?.generationEffectKeys).toContain(effectKey);
                expect(retriedProject.chatSessions[0]?.pendingBackendSession).toBeUndefined();
            }

            currentEffectKey = "";
            generationCommitted = false;
            generationWriteHandled = false;
            failOrdinaryWrite = false;
            failFinalRead = false;
        }
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("ordinary persistence never publishes generation stamps for a newly imported Canvas project", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-new-project-stamp-boundary";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:new-project-unconfirmed";

    try {
        setActiveUserScope(scope);
        const projectId = useCanvasStore.getState().importProject({
            title: "imported stamped project",
            nodes: [
                {
                    id: "node-new-project-stamped",
                    type: CanvasNodeType.Text,
                    title: "generated node",
                    position: { x: 0, y: 0 },
                    width: 320,
                    height: 180,
                    metadata: { content: "generated content", generationEffectKeys: [effectKey] },
                },
            ],
            chatSessions: [
                {
                    id: "session-new-project-stamped",
                    title: "generated session",
                    messages: [],
                    generationEffectKeys: [effectKey],
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                },
            ],
        });
        await flushCanvasStorePersistence();

        const durable = JSON.parse(values.get(key)!) as { state: { projects: CanvasProject[] } };
        const project = durable.state.projects.find((candidate) => candidate.id === projectId);
        expect(project?.title).toBe("imported stamped project");
        expect(project?.nodes[0]?.metadata?.content).toBe("generated content");
        expect(project?.nodes[0]?.metadata?.generationEffectKeys).toBeUndefined();
        expect(project?.chatSessions[0]?.generationEffectKeys).toBeUndefined();
    } finally {
        setActiveUserScope(previousScope);
        useCanvasStore.setState({ projects: previousProjects });
        await flushCanvasStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas generation persistence preserves an explicit null previous active chat id", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-explicit-null-active-chat";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:explicit-null-active-chat";
    const baseNode: CanvasNodeData = {
        id: "node-explicit-null-active-chat",
        type: CanvasNodeType.Text,
        title: "node",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "base" },
    };
    const durableProject = { ...storedCanvasProject("canvas-explicit-null-active-chat", "canvas"), nodes: [baseNode], activeChatId: null };
    const memoryProject = { ...durableProject, activeChatId: "memory-session" };
    values.set(key, JSON.stringify({ state: { projects: [durableProject] }, version: 0, storageRevision: 0, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} } }));

    try {
        setActiveUserScope(scope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [memoryProject] }));
        const persisted = await persistCanvasGenerationEffect({
            projectId: durableProject.id,
            effectKey,
            previousNodes: [baseNode],
            nodes: [{ ...baseNode, metadata: { ...baseNode.metadata, content: "generated", generationEffectKeys: [effectKey] } }],
            previousActiveChatId: null,
            activeChatId: "next-session",
        });
        expect(persisted.activeChatId).toBe("next-session");
        expect((JSON.parse(values.get(key)!) as { state: { projects: CanvasProject[] } }).state.projects[0]?.activeChatId).toBe("next-session");
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("Canvas generation persistence fails closed before durable writes when Web Locks are unavailable", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    let canvasWrites = 0;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        canvasWrites += 1;
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-no-web-locks";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:no-web-locks";
    const baseNode: CanvasNodeData = {
        id: "node-no-web-locks",
        type: CanvasNodeType.Text,
        title: "node",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "base" },
    };
    const project: CanvasProject = {
        id: "canvas-no-web-locks",
        title: "canvas",
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
        nodes: [baseNode],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
    values.set(key, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 0 }));

    try {
        setActiveUserScope(scope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: project.id,
                effectKey,
                previousNodes: [baseNode],
                nodes: [{ ...baseNode, metadata: { ...baseNode.metadata, content: "generated", generationEffectKeys: [effectKey] } }],
            }),
        ).rejects.toThrow("跨标签存储锁");
        expect(canvasWrites).toBe(0);
        expect(values.get(key)).not.toContain(effectKey);
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
        else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
        if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
        else Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
    }
});

test("an aborted Canvas generation fence prevents the durable write", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousScope = getActiveUserScope();
    const previousProjects = useCanvasStore.getState().projects;
    const values = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    delete (globalThis as { document?: unknown }).document;
    let canvasWrites = 0;
    localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        canvasWrites += 1;
        values.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const scope = "canvas-aborted-fence";
    const key = `${CANVAS_STORE_KEY}:user:${scope}`;
    const effectKey = "canvas-effect:aborted-fence";
    const baseNode: CanvasNodeData = {
        id: "node-aborted-fence",
        type: CanvasNodeType.Text,
        title: "node",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "base" },
    };
    const project = storedCanvasProject("canvas-aborted-fence", "canvas");
    project.nodes = [baseNode];
    values.set(key, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 0 }));
    const controller = new AbortController();
    controller.abort();

    try {
        setActiveUserScope(scope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
        await expect(
            persistCanvasGenerationEffect({
                projectId: project.id,
                effectKey,
                signal: controller.signal,
                previousNodes: [baseNode],
                nodes: [{ ...baseNode, metadata: { ...baseNode.metadata, content: "generated", generationEffectKeys: [effectKey] } }],
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(canvasWrites).toBe(0);
        expect(values.get(key)).not.toContain(effectKey);
    } finally {
        setActiveUserScope(previousScope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
        else Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    }
});

test("account switching aborts and drains generation consumers before activating the next account", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    setActiveUserScope("account-A");
    let consumerStartedResolve!: () => void;
    const consumerStarted = new Promise<void>((resolve) => {
        consumerStartedResolve = resolve;
    });
    let releaseConsumerResolve!: () => void;
    const releaseConsumer = new Promise<void>((resolve) => {
        releaseConsumerResolve = resolve;
    });
    let abortObserved = false;
    let sinkWrites = 0;

    const consumerResult = runGenerationConsumer(undefined, async (signal) => {
        consumerStartedResolve();
        await new Promise<void>((resolve) => {
            signal.addEventListener(
                "abort",
                () => {
                    abortObserved = true;
                    resolve();
                },
                { once: true },
            );
        });
        await releaseConsumer;
        if (!signal.aborted) sinkWrites += 1;
        throw new DOMException("The operation was aborted", "AbortError");
    }).catch((error) => error);

    try {
        await consumerStarted;
        const switchScope = switchUserStorageScope("account-B");
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        expect(abortObserved).toBe(true);
        expect(getActiveUserScope()).toBe("account-A");

        let lateConsumerCalls = 0;
        const lateConsumer = runGenerationConsumer(undefined, async () => {
            lateConsumerCalls += 1;
        }).catch((error) => error);
        expect((await lateConsumer).name).toBe("AbortError");
        expect(lateConsumerCalls).toBe(0);

        releaseConsumerResolve();
        const [consumerError] = await Promise.all([consumerResult, switchScope]);
        expect(consumerError.name).toBe("AbortError");
        expect(getActiveUserScope()).toBe("account-B");
        expect(sinkWrites).toBe(0);
    } finally {
        releaseConsumerResolve();
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("account switching keeps new generation consumers closed while old persistence is flushing", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const indexedValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    setActiveUserScope("account-A");

    let writeStartedResolve!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
        writeStartedResolve = resolve;
    });
    let releaseWriteResolve!: () => void;
    const releaseWrite = new Promise<void>((resolve) => {
        releaseWriteResolve = resolve;
    });
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (key.includes("infinite-canvas:asset_store")) {
            writeStartedResolve();
            await releaseWrite;
        }
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;

    const previousAssets = useAssetStore.getState().assets;
    try {
        const pendingWrite = useAssetStore.getState().addGenerationAsset("materialize:switch-flush-gate:0", generatedAsset("flush gate"));
        await writeStarted;
        const switchScope = switchUserStorageScope("account-B");
        await new Promise<void>((resolve) => queueMicrotask(resolve));

        let lateConsumerCalls = 0;
        const lateConsumerError = await runGenerationConsumer(undefined, async () => {
            lateConsumerCalls += 1;
        }).catch((error) => error);
        expect(lateConsumerError.name).toBe("AbortError");
        expect(lateConsumerCalls).toBe(0);
        expect(getActiveUserScope()).toBe("account-A");

        releaseWriteResolve();
        await Promise.all([pendingWrite, switchScope]);
        expect(getActiveUserScope()).toBe("account-B");
    } finally {
        releaseWriteResolve();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        useAssetStore.getState().replaceAssets(previousAssets);
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("an in-flight provider request is aborted and drained before the account changes", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    setActiveUserScope("account-A");
    const request = beginGenerationConsumer();
    let abortObserved = false;
    request.signal.addEventListener(
        "abort",
        () => {
            abortObserved = true;
        },
        { once: true },
    );
    try {
        const switchScope = switchUserStorageScope("account-B");
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(abortObserved).toBe(true);
        expect(getActiveUserScope()).toBe("account-A");
        request.release();
        await switchScope;
        expect(getActiveUserScope()).toBe("account-B");
    } finally {
        request.release();
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("StrictMode cleanup replaces only an already-aborted generation consumer controller", () => {
    const active = new AbortController();
    expect(activeGenerationConsumerController(active)).toBe(active);
    active.abort();
    const replacement = activeGenerationConsumerController(active);
    expect(replacement).not.toBe(active);
    expect(replacement.signal.aborted).toBe(false);
});

test("account scope transition can hold remote user-data sync paused for its full critical section", async () => {
    let releaseResolve!: () => void;
    const release = new Promise<void>((resolve) => {
        releaseResolve = resolve;
    });
    let entered = false;
    const transition = withRemoteUserDataSyncExclusive(async () => {
        entered = true;
        await release;
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(entered).toBe(true);
    let completed = false;
    transition.then(() => {
        completed = true;
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(completed).toBe(false);
    releaseResolve();
    await transition;
    expect(completed).toBe(true);
});

test("account scope transition drains an active remote deletion before entering its critical section", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalCreateInstance = localforage.createInstance.bind(localforage);
    const indexedValues = new Map<string, string>();
    const localStorageValues = new Map<string, string>();
    const previousAdapter = apiClient.defaults.adapter;
    const previousAssets = useAssetStore.getState().assets;
    const requestUrls: string[] = [];
    let releaseDelete!: () => void;
    const deleteReleased = new Promise<void>((resolve) => {
        releaseDelete = resolve;
    });
    let deleteStarted = false;
    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        requestUrls.push(url);
        if (config.method === "delete") {
            deleteStarted = true;
            await deleteReleased;
            return { data: { code: 0, data: { id: "shared-asset" }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        const data = url.includes("user-data/snapshot") ? { projects: [], assets: [] } : url.includes("canvas-projects") ? { projects: [] } : { assets: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: (handler: () => void, delay = 0) => {
                if (delay === 0) queueMicrotask(handler);
                return 1;
            },
            clearTimeout: () => undefined,
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.createInstance = (() => ({
        iterate: async () => undefined,
        removeItem: async () => undefined,
        getItem: async () => null,
        setItem: async (_key: string, value: unknown) => value,
    })) as typeof localforage.createInstance;
    try {
        useAssetStore.getState().replaceAssets([]);
        await syncRemoteUserData("account-A");
        expect(requestUrls.filter((url) => url.includes("user-data/snapshot"))).toHaveLength(1);
        expect(requestUrls.some((url) => /\/(assets|canvas-projects)\/[^/]+/.test(url))).toBe(false);
        useAssetStore.getState().replaceAssets([
            {
                id: "shared-asset",
                kind: "image",
                title: "account A asset",
                coverUrl: "opaque://account-a",
                tags: [],
                metadata: {},
                data: { dataUrl: "opaque://account-a", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z",
            },
        ]);
        const deletion = deleteAssetWithRemoteSync("shared-asset");
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(deleteStarted).toBe(true);
        let transitionEntered = false;
        const transition = withRemoteUserDataSyncExclusive(async () => {
            transitionEntered = true;
        });
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(transitionEntered).toBe(false);
        expect(useAssetStore.getState().assets.some((asset) => asset.id === "shared-asset")).toBe(true);
        releaseDelete();
        await Promise.all([deletion, transition]);
        expect(transitionEntered).toBe(true);
        expect(useAssetStore.getState().assets.some((asset) => asset.id === "shared-asset")).toBe(false);
        await flushAssetStorePersistence();
    } finally {
        releaseDelete();
        resetRemoteUserDataSync();
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        localforage.createInstance = originalCreateInstance;
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("canvas deletion removes the remote project before updating local state", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAdapter = apiClient.defaults.adapter;
    const previousProjects = useCanvasStore.getState().projects;
    const requestUrls: string[] = [];
    const project = storedCanvasProject("canvas-delete", "待删除画布");
    let remoteProjects = [project];

    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        requestUrls.push(`${String(config.method || "get").toLowerCase()} ${url}`);
        if (String(config.method || "").toLowerCase() === "delete") {
            remoteProjects = remoteProjects.filter((item) => item.id !== project.id);
            return { data: { code: 0, data: { id: project.id }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        const data = url.includes("user-data/snapshot") ? { projects: remoteProjects, assets: [] } : { projects: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        },
    });
    localforage.getItem = (async () => null) as typeof localforage.getItem;
    localforage.setItem = (async (_key: string, value: string) => value) as typeof localforage.setItem;
    try {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: [project] });
        await syncRemoteUserData("account-A");
        await deleteCanvasProjectsWithRemoteSync([project.id]);
        await syncRemoteUserData("account-A");

        expect(requestUrls).toContain(`delete /canvas-projects/${project.id}`);
        expect(useCanvasStore.getState().projects.some((item) => item.id === project.id)).toBe(false);
    } finally {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: previousProjects });
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("login replaces stale local entities instead of resurrecting remote deletions", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAdapter = apiClient.defaults.adapter;
    const previousProjects = useCanvasStore.getState().projects;
    const requestUrls: string[] = [];
    const staleProject = storedCanvasProject("canvas-stale-after-delete", "服务端已删除");

    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        requestUrls.push(`${String(config.method || "get").toLowerCase()} ${url}`);
        const data = url.includes("user-data/snapshot") ? { projects: [], assets: [] } : { projects: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        },
    });
    localforage.getItem = (async () => null) as typeof localforage.getItem;
    localforage.setItem = (async (_key: string, value: string) => value) as typeof localforage.setItem;
    try {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: [staleProject] });
        await syncRemoteUserData("account-A");
        expect(useCanvasStore.getState().projects).toEqual([]);
        expect(requestUrls.some((url) => url.startsWith("put ") || url.startsWith("post "))).toBe(false);
    } finally {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: previousProjects });
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("remote resource preparation never overwrites an edit made while upload is in flight", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAdapter = apiClient.defaults.adapter;
    const previousAssets = useAssetStore.getState().assets;
    const indexedValues = new Map<string, string>();
    const remoteWrites: Asset[] = [];
    let releaseUpload!: () => void;
    const uploadReleased = new Promise<void>((resolve) => {
        releaseUpload = resolve;
    });
    let uploadStartedResolve!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
        uploadStartedResolve = resolve;
    });

    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        },
    });
    localforage.getItem = (async (key: string) => indexedValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        indexedValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        const method = String(config.method || "get").toLowerCase();
        if (url.includes("user-data/snapshot")) {
            return { data: { code: 0, data: { projects: [], assets: [] }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        if (method === "post" && url === "/resources") {
            uploadStartedResolve();
            await uploadReleased;
            return {
                data: {
                    code: 0,
                    data: {
                        resource: {
                            id: "resource-uploaded",
                            userId: "account-sync-edit",
                            kind: "image",
                            status: "ready",
                            provider: "local",
                            endpoint: "",
                            bucket: "",
                            objectKey: "users/account-sync-edit/image.png",
                            publicUrl: "",
                            mimeType: "image/png",
                            size: 1,
                            createdAt: "2026-08-25T00:00:00.000Z",
                            updatedAt: "2026-08-25T00:00:00.000Z",
                        },
                    },
                    msg: "",
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
            };
        }
        if (method === "put" && url.startsWith("/assets/")) {
            const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
            remoteWrites.push(body.asset as Asset);
            return { data: { code: 0, data: { asset: body.asset }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        throw new Error(`unexpected request: ${method} ${url}`);
    };

    try {
        resetRemoteUserDataSync();
        installRemoteUserDataAutoSync();
        await syncRemoteUserData("account-sync-edit");
        const asset = {
            ...storedAsset("asset-sync-edit", "before upload"),
            coverUrl: "data:image/png;base64,iVBORw0KGgo=",
            data: {
                dataUrl: "data:image/png;base64,iVBORw0KGgo=",
                width: 1,
                height: 1,
                bytes: 1,
                mimeType: "image/png",
            },
        } as Asset;
        useAssetStore.getState().replaceAssets([asset]);

        const saving = saveRemoteUserDataNow();
        await uploadStarted;
        useAssetStore.getState().updateAsset(asset.id, { title: "edited during upload" });
        releaseUpload();
        await saving;

        expect(useAssetStore.getState().assets.find((item) => item.id === asset.id)?.title).toBe("edited during upload");
        expect(remoteWrites.at(-1)?.title).toBe("edited during upload");
    } finally {
        releaseUpload();
        resetRemoteUserDataSync();
        useAssetStore.getState().replaceAssets(previousAssets);
        await flushAssetStorePersistence();
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("failed remote baseline cannot upload stale local cache", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const previousAdapter = apiClient.defaults.adapter;
    const previousProjects = useCanvasStore.getState().projects;
    const requests: string[] = [];
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
        },
    });
    apiClient.defaults.adapter = async (config) => {
        const request = `${String(config.method || "get").toLowerCase()} ${String(config.url || "")}`;
        requests.push(request);
        if (String(config.url || "").includes("user-data/snapshot")) throw new Error("snapshot unavailable");
        return { data: { code: 0, data: {}, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };

    try {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: [storedCanvasProject("stale-local-project", "stale cache")] });
        await expect(syncRemoteUserData("account-baseline-failed")).rejects.toThrow("snapshot unavailable");
        useCanvasStore.getState().renameProject("stale-local-project", "edited without baseline");

        await expect(saveRemoteUserDataNow()).rejects.toThrow("云端数据基线尚未建立");
        expect(requests.some((request) => request.startsWith("put "))).toBe(false);
    } finally {
        resetRemoteUserDataSync();
        useCanvasStore.setState({ projects: previousProjects });
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("user session stays unhydrated until the remote baseline is durable", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const previousAdapter = apiClient.defaults.adapter;
    const previousUserState = useUserStore.getState();
    const localValues = new Map<string, string>();
    let releaseSnapshot!: () => void;
    const snapshotReleased = new Promise<void>((resolve) => {
        releaseSnapshot = resolve;
    });
    let snapshotStartedResolve!: () => void;
    const snapshotStarted = new Promise<void>((resolve) => {
        snapshotStartedResolve = resolve;
    });
    const localStorageValues = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => undefined,
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
        },
    });
    localforage.getItem = (async (key: string) => localValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => {
        localValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        if (url === "/model-catalog") {
            return { data: { code: 0, data: { source: "frontend", models: [] }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        if (url.includes("user-data/snapshot")) {
            snapshotStartedResolve();
            await snapshotReleased;
            return { data: { code: 0, data: { projects: [], assets: [] }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        throw new Error(`unexpected request: ${String(config.method || "get")} ${url}`);
    };

    let applying: Promise<void> | undefined;
    try {
        resetRemoteUserDataSync();
        useUserStore.setState({ user: null, hydrated: true });
        applying = applyUserSession({
            user: {
                id: "account-baseline-gate",
                username: "baseline-gate",
                displayName: "Baseline Gate",
                role: "user",
                status: "active",
                createdAt: "2026-08-25T00:00:00.000Z",
                updatedAt: "2026-08-25T00:00:00.000Z",
            },
        });
        await snapshotStarted;
        expect(useUserStore.getState().hydrated).toBe(false);
        releaseSnapshot();
        await applying;
        expect(useUserStore.getState().hydrated).toBe(true);
    } finally {
        releaseSnapshot();
        await applying?.catch(() => undefined);
        resetRemoteUserDataSync();
        useUserStore.setState(previousUserState);
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});
