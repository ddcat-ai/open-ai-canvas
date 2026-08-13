import { expect, test } from "bun:test";
import localforage from "localforage";

import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { switchUserStorageScope } from "../src/lib/user-session";
import { activeGenerationConsumerController, beginGenerationConsumer, runGenerationConsumer } from "../src/services/generation-consumer-lifecycle";
import {
    CREATION_CONVERSATIONS_KEY,
    loadCreationConversations,
    pendingCreationTaskIds,
    saveCreationConversations,
} from "../src/services/creation-conversation-store";
import { useAssetStore, type NewAsset } from "../src/stores/use-asset-store";
import { flushAssetStorePersistence } from "../src/stores/use-asset-store";
import { deleteAssetWithRemoteSync, resetRemoteUserDataSync, syncRemoteUserData, withRemoteUserDataSyncPaused } from "../src/services/user-data-sync";
import { apiClient } from "../src/services/api/request";

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
        await saveCreationConversations([{
            id: "conversation-account-A",
            messages: [{
                id: "message-account-A",
                role: "assistant",
                mode: "image",
                status: "pending",
                taskIds: ["backend-task-account-A"],
            }],
        }]);
        values.set(CREATION_CONVERSATIONS_KEY, [{
            id: "legacy-unscoped",
            messages: [{
                id: "legacy-message",
                role: "assistant",
                mode: "image",
                status: "pending",
                taskIds: ["legacy-unscoped-task"],
            }],
        }]);
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
        expect(values.get(CREATION_CONVERSATIONS_KEY)).toEqual([{
            id: "legacy-unscoped",
            messages: [{
                id: "legacy-message",
                role: "assistant",
                mode: "image",
                status: "pending",
                taskIds: ["legacy-unscoped-task"],
            }],
        }]);
    } finally {
        localforage.getItem = originalGetItem;
        localforage.setItem = originalSetItem;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});

test("asset writes freeze account scope and user switching drains the previous account queue", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalSetItem = localforage.setItem.bind(localforage);
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
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let firstWriteStartedResolve!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => { firstWriteStartedResolve = resolve; });
    let blocked = false;
    localforage.setItem = (async (key: string, value: string) => {
        if (key.includes("infinite-canvas:asset_store")) {
            assetKeys.push(key);
            if (!blocked) {
                blocked = true;
                firstWriteStartedResolve();
                await firstWriteGate;
            }
        }
        return value;
    }) as typeof localforage.setItem;

    const previousAssets = useAssetStore.getState().assets;
    try {
        const firstWrite = useAssetStore.getState().addGenerationAsset(
            "materialize:scope-freeze-first:0",
            generatedAsset("first"),
        );
        await firstWriteStarted;
        const secondWrite = useAssetStore.getState().addGenerationAsset(
            "materialize:scope-freeze-second:0",
            generatedAsset("second"),
        );
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
        localforage.setItem = originalSetItem;
        useAssetStore.getState().replaceAssets(previousAssets);
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
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
    const consumerStarted = new Promise<void>((resolve) => { consumerStartedResolve = resolve; });
    let releaseConsumerResolve!: () => void;
    const releaseConsumer = new Promise<void>((resolve) => { releaseConsumerResolve = resolve; });
    let abortObserved = false;
    let sinkWrites = 0;

    const consumerResult = runGenerationConsumer(undefined, async (signal) => {
        consumerStartedResolve();
        await new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
                abortObserved = true;
                resolve();
            }, { once: true });
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
    const originalSetItem = localforage.setItem.bind(localforage);
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
    const writeStarted = new Promise<void>((resolve) => { writeStartedResolve = resolve; });
    let releaseWriteResolve!: () => void;
    const releaseWrite = new Promise<void>((resolve) => { releaseWriteResolve = resolve; });
    localforage.setItem = (async (key: string, value: string) => {
        if (key.includes("infinite-canvas:asset_store")) {
            writeStartedResolve();
            await releaseWrite;
        }
        return value;
    }) as typeof localforage.setItem;

    const previousAssets = useAssetStore.getState().assets;
    try {
        const pendingWrite = useAssetStore.getState().addGenerationAsset(
            "materialize:switch-flush-gate:0",
            generatedAsset("flush gate"),
        );
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
    request.signal.addEventListener("abort", () => { abortObserved = true; }, { once: true });
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
    const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
    let entered = false;
    const transition = withRemoteUserDataSyncPaused(async () => {
        entered = true;
        await release;
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(entered).toBe(true);
    let completed = false;
    transition.then(() => { completed = true; });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(completed).toBe(false);
    releaseResolve();
    await transition;
    expect(completed).toBe(true);
});

test("account scope transition drains an active remote deletion before entering its critical section", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    const localStorageValues = new Map<string, string>();
    const previousAdapter = apiClient.defaults.adapter;
    const previousAssets = useAssetStore.getState().assets;
    let releaseDelete!: () => void;
    const deleteReleased = new Promise<void>((resolve) => { releaseDelete = resolve; });
    let deleteStarted = false;
    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url || "");
        if (config.method === "delete") {
            deleteStarted = true;
            await deleteReleased;
            return { data: { code: 0, data: { id: "shared-asset" }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
        }
        const data = url.includes("canvas-projects") ? { projects: [] } : { assets: [] };
        return { data: { code: 0, data, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
    };
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
    try {
        useAssetStore.getState().replaceAssets([]);
        await syncRemoteUserData("account-A");
        useAssetStore.getState().replaceAssets([{
            id: "shared-asset",
            kind: "image",
            title: "account A asset",
            coverUrl: "opaque://account-a",
            tags: [],
            metadata: {},
            data: { dataUrl: "opaque://account-a", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        }]);
        const deletion = deleteAssetWithRemoteSync("shared-asset");
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(deleteStarted).toBe(true);
        let transitionEntered = false;
        const transition = withRemoteUserDataSyncPaused(async () => { transitionEntered = true; });
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
        apiClient.defaults.adapter = previousAdapter;
        if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
});
