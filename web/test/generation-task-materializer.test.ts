import { describe, expect, test } from "bun:test";
import localforage from "localforage";

import { createGenerationTaskSubscriptionService, type GenerationTask } from "../src/services/api/task-center";
import { createGenerationTaskMaterializer, createIdempotentMaterializeOutput, materializeEffectKey, type GenerationTaskEffectClaim, type GenerationTaskEffectStore } from "../src/services/generation-task-materializer";
import { createLocalDreaminaTaskEffectStore } from "../src/services/local-dreamina-generation";
import { applyCanvasGenerationTaskNodeEffect, persistCanvasAgentGenerationContinuationEffect, persistCanvasGenerationEffect } from "../src/services/canvas-generation-consumer";
import { canvasCinematicContinuationEntryAdapters } from "../src/components/canvas/canvas-assistant-panel";
import { applyGenerationConsumerEffect, generationEffectApplied } from "../src/services/generation-consumer-dedupe";
import { createProviderNeutralGenerationTaskEffectStore } from "../src/services/provider-neutral-generation-effects";
import { consumeGenerationTaskAgent, consumeGenerationTaskMessage, consumeGenerationTaskNode, materializeGenerationTaskAssets, retryCanvasAssetSyncAfterRateLimit } from "../src/services/project-asset-sync";
import { ApiError } from "../src/services/api/request";
import { flushCanvasStorePersistence, useCanvasStore, withCanvasStorePersistenceSuppressed, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence, useAssetStore, type NewAsset } from "../src/stores/use-asset-store";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasNodeData } from "../src/types/canvas";
import { recoverCanvasGenerationTaskNode } from "../src/pages/canvas/use-canvas-generation";
import { getActiveUserScope, setActiveUserScope } from "../src/lib/user-scope";
import { readImageMeta } from "../src/lib/image-utils";
import { consumeCanvasAgentGenerationContinuation } from "../src/pages/canvas/use-canvas-agent-operations";

function createEffectStore(): GenerationTaskEffectStore {
    const completed = new Map<string, { materializedAssetId?: string }>();
    const claimed = new Set<string>();

    return {
        async claim(effectKey): Promise<GenerationTaskEffectClaim> {
            const result = completed.get(effectKey);
            if (result) return { status: "completed", result };
            if (claimed.has(effectKey)) return { status: "busy" };
            claimed.add(effectKey);
            return { status: "claimed", fence: 1 };
        },
        async renew() {
            return { fence: 1 };
        },
        async complete(effectKey, _taskId, result) {
            claimed.delete(effectKey);
            completed.set(effectKey, result);
        },
        async release(effectKey) {
            claimed.delete(effectKey);
        },
    };
}

test("automatic canvas asset sync honors Retry-After before retrying a rate limit", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const result = await retryCanvasAssetSyncAfterRateLimit(
        async () => {
            attempts += 1;
            if (attempts === 1) throw new ApiError("请求过于频繁，请稍后再试", { status: 429, retryAfterMs: 60_000 });
            return "synced";
        },
        {
            wait: async (delayMs) => {
                delays.push(delayMs);
            },
        },
    );

    expect(result).toBe("synced");
    expect(attempts).toBe(2);
    expect(delays).toEqual([60_000]);
});

test("automatic canvas asset sync does not retry non-rate-limit failures", async () => {
    let attempts = 0;

    await expect(
        retryCanvasAssetSyncAfterRateLimit(async () => {
            attempts += 1;
            throw new ApiError("素材校验失败", { status: 400 });
        }),
    ).rejects.toThrow("素材校验失败");

    expect(attempts).toBe(1);
});

test("automatic canvas asset sync aborts promptly while waiting for the rate-limit window", async () => {
    const controller = new AbortController();
    const syncing = retryCanvasAssetSyncAfterRateLimit(
        async () => {
            throw new ApiError("请求过于频繁，请稍后再试", { status: 429, retryAfterMs: 60_000 });
        },
        { signal: controller.signal },
    );

    await Promise.resolve();
    controller.abort();

    await expect(syncing).rejects.toMatchObject({ name: "AbortError" });
});

type MetaImageHarnessImage = {
    naturalWidth: number;
    naturalHeight: number;
    onload: (() => void) | null;
    onerror: (() => void) | null;
};

function installImageMetaHarness(naturalWidth = 0, naturalHeight = 0) {
    const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
    const originalSetTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    const originalClearTimeout = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
    const images: MetaImageHarnessImage[] = [];
    const srcAssignments: string[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 0;

    Object.defineProperty(globalThis, "Image", {
        configurable: true,
        value: class FakeImage implements MetaImageHarnessImage {
            naturalWidth = naturalWidth;
            naturalHeight = naturalHeight;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;

            constructor() {
                images.push(this);
            }

            set src(value: string) {
                srcAssignments.push(value);
            }
        },
    });
    Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        value: (handler: () => void) => {
            nextTimer += 1;
            timers.set(nextTimer, handler);
            return nextTimer;
        },
    });
    Object.defineProperty(globalThis, "clearTimeout", {
        configurable: true,
        value: (timer: number) => {
            timers.delete(timer);
        },
    });

    return {
        images,
        srcAssignments,
        timers,
        fireNextTimer() {
            const handler = timers.values().next().value as (() => void) | undefined;
            handler?.();
        },
        restore() {
            if (originalImage) Object.defineProperty(globalThis, "Image", originalImage);
            else delete (globalThis as { Image?: unknown }).Image;
            if (originalSetTimeout) Object.defineProperty(globalThis, "setTimeout", originalSetTimeout);
            if (originalClearTimeout) Object.defineProperty(globalThis, "clearTimeout", originalClearTimeout);
        },
    };
}

function trackedAbortSignal() {
    let aborted = false;
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const signal = {
        get aborted() {
            return aborted;
        },
        addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
            if (type === "abort") listeners.add(listener);
        },
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
            if (type === "abort") listeners.delete(listener);
        },
    } as unknown as AbortSignal;

    return {
        signal,
        abort() {
            aborted = true;
            const event = new Event("abort");
            for (const listener of [...listeners]) {
                if (typeof listener === "function") listener(event);
                else listener.handleEvent(event);
            }
        },
        listenerCount: () => listeners.size,
    };
}

describe("readImageMeta", () => {
    test("success returns intrinsic metadata and releases every callback", async () => {
        const harness = installImageMetaHarness(2560, 1440);
        const abort = trackedAbortSignal();
        try {
            const result = readImageMeta("data:image/webp;base64,AA==", abort.signal);
            harness.images[0]?.onload?.();

            expect(await result).toEqual({ width: 2560, height: 1440, mimeType: "image/webp" });
            expect(harness.images[0]?.onload).toBeNull();
            expect(harness.images[0]?.onerror).toBeNull();
            expect(harness.timers.size).toBe(0);
            expect(abort.listenerCount()).toBe(0);
            expect(harness.srcAssignments).toEqual(["data:image/webp;base64,AA=="]);
        } finally {
            harness.restore();
        }
    });

    test("image error falls back once and releases every callback", async () => {
        const harness = installImageMetaHarness();
        const abort = trackedAbortSignal();
        try {
            const result = readImageMeta("data:image/png;base64,AA==", abort.signal);
            harness.images[0]?.onerror?.();

            expect(await result).toEqual({ width: 1024, height: 1024, mimeType: "image/png" });
            expect(harness.images[0]?.onload).toBeNull();
            expect(harness.images[0]?.onerror).toBeNull();
            expect(harness.timers.size).toBe(0);
            expect(abort.listenerCount()).toBe(0);
            expect(harness.srcAssignments).toEqual(["data:image/png;base64,AA=="]);
        } finally {
            harness.restore();
        }
    });

    test("timeout falls back once and releases every callback", async () => {
        const harness = installImageMetaHarness();
        const abort = trackedAbortSignal();
        try {
            const result = readImageMeta("opaque://image", abort.signal);
            harness.fireNextTimer();

            expect(await result).toEqual({ width: 1024, height: 1024, mimeType: "image/png" });
            expect(harness.images[0]?.onload).toBeNull();
            expect(harness.images[0]?.onerror).toBeNull();
            expect(harness.timers.size).toBe(0);
            expect(abort.listenerCount()).toBe(0);
            expect(harness.srcAssignments).toEqual(["opaque://image", ""]);
        } finally {
            harness.restore();
        }
    });

    test("abort rejects promptly and releases every callback", async () => {
        const harness = installImageMetaHarness();
        const abort = trackedAbortSignal();
        try {
            const result = readImageMeta("opaque://image", abort.signal);
            const outcome = result.then(
                () => "resolved",
                (error: DOMException) => error.name,
            );
            abort.abort();
            const promptOutcome = await Promise.race([outcome, new Promise<string>((resolve) => queueMicrotask(() => resolve("pending")))]);
            if (promptOutcome === "pending") harness.fireNextTimer();
            await outcome;

            expect(promptOutcome).toBe("AbortError");
            expect(harness.images[0]?.onload).toBeNull();
            expect(harness.images[0]?.onerror).toBeNull();
            expect(harness.timers.size).toBe(0);
            expect(abort.listenerCount()).toBe(0);
            expect(harness.srcAssignments).toEqual(["opaque://image", ""]);
        } finally {
            harness.restore();
        }
    });
});

describe("generation task materializer", () => {
    test("remote Backend Create uses the default production materializer without Dreamina authority", async () => {
        const previousAssets = useAssetStore.getState().assets;
        useAssetStore.getState().replaceAssets([
            {
                id: "asset-remote-default-wiring",
                kind: "image",
                title: "remote generated image",
                coverUrl: "opaque://remote-generated-image",
                tags: ["generated"],
                metadata: {},
                data: {
                    dataUrl: "opaque://remote-generated-image",
                    width: 1,
                    height: 1,
                    bytes: 1,
                    mimeType: "image/png",
                },
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z",
            },
        ]);
        const task: GenerationTask = {
            id: "backend-create-remote-default-wiring",
            provider: "remote-image-provider",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "image",
                    materializedAssetId: "asset-remote-default-wiring",
                },
            ],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        let attachments = 0;
        try {
            const materialized = await consumeGenerationTaskMessage(task, "message-remote-default-wiring", async ({ resultUrls }) => {
                attachments += 1;
                expect(resultUrls).toEqual(["opaque://remote-generated-image"]);
            });
            expect(materialized.id).toBe(task.id);
            expect(attachments).toBe(1);
        } finally {
            useAssetStore.getState().replaceAssets(previousAssets);
        }
    });

    test("image materialization decodes intrinsic Blob dimensions when provider metadata omits width and height", async () => {
        const previousAssets = useAssetStore.getState().assets;
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalImage = (globalThis as { Image?: unknown }).Image;
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const localStorageValues = new Map<string, string>();
        const durableValues = new Map<string, unknown>();
        const lockTails = new Map<string, Promise<void>>();
        const imageBlob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440" viewBox="0 0 2560 1440"></svg>'], { type: "image/svg+xml" });
        const imageUrl = URL.createObjectURL(imageBlob);
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
        setActiveUserScope("materializer-indexeddb");
        Object.defineProperty(navigator, "locks", {
            configurable: true,
            value: {
                async request<T>(name: string, callback: () => Promise<T>) {
                    const prior = lockTails.get(name) ?? Promise.resolve();
                    let release!: () => void;
                    const tail = new Promise<void>((resolve) => {
                        release = resolve;
                    });
                    const queued = prior.then(() => tail);
                    lockTails.set(name, queued);
                    await prior;
                    try {
                        return await callback();
                    } finally {
                        release();
                        if (lockTails.get(name) === queued) lockTails.delete(name);
                    }
                },
            },
        });
        localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: unknown) => {
            durableValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;
        Object.defineProperty(globalThis, "Image", {
            configurable: true,
            value: class FakeImage {
                naturalWidth = 2560;
                naturalHeight = 1440;
                onload: (() => void) | null = null;
                onerror: (() => void) | null = null;
                set src(_value: string) {
                    queueMicrotask(() => this.onload?.());
                }
            },
        });
        const task: GenerationTask = {
            id: "backend-image-intrinsic-dimensions",
            provider: "remote-image-provider",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            resultJson: JSON.stringify({
                images: [
                    {
                        dataUrl: imageUrl,
                        storageKey: "resource:intrinsic-dimensions-existing",
                        width: 1280,
                        bytes: imageBlob.size,
                        mimeType: imageBlob.type,
                    },
                ],
            }),
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        useAssetStore.getState().replaceAssets([]);

        try {
            const materialized = await materializeGenerationTaskAssets(task);
            const assetId = materialized.outputs?.[0]?.materializedAssetId;
            const asset = useAssetStore.getState().assets.find((candidate) => candidate.id === assetId);

            expect(asset).toMatchObject({
                kind: "image",
                data: {
                    width: 1280,
                    height: 1440,
                },
            });
            const assetStoreKey = "infinite-canvas:asset_store:user:materializer-indexeddb";
            expect(durableValues.has(assetStoreKey)).toBe(true);
            expect(localStorageValues.has(assetStoreKey)).toBe(false);
        } finally {
            URL.revokeObjectURL(imageUrl);
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
            else delete (navigator as { locks?: unknown }).locks;
            if (originalImage === undefined) delete (globalThis as { Image?: unknown }).Image;
            else Object.defineProperty(globalThis, "Image", { configurable: true, value: originalImage });
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
            useAssetStore.getState().replaceAssets(previousAssets);
        }
    });

    test("image materialization keeps its effect retryable when the IndexedDB catalog write fails", async () => {
        const previousAssets = useAssetStore.getState().assets;
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const durableValues = new Map<string, string>();
        const localStorageValues = new Map<string, string>();
        const localStorageCalls: string[] = [];
        let failWrites = true;
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: {
                localStorage: {
                    getItem: (key: string) => {
                        if (key.includes("infinite-canvas:asset_store")) localStorageCalls.push(`get:${key}`);
                        return localStorageValues.get(key) ?? null;
                    },
                    setItem: (key: string, value: string) => {
                        if (key.includes("infinite-canvas:asset_store")) localStorageCalls.push(`set:${key}`);
                        localStorageValues.set(key, value);
                    },
                    removeItem: (key: string) => {
                        if (key.includes("infinite-canvas:asset_store")) localStorageCalls.push(`remove:${key}`);
                        localStorageValues.delete(key);
                    },
                },
            },
        });
        setActiveUserScope("materializer-catalog-failure");
        Object.defineProperty(navigator, "locks", {
            configurable: true,
            value: {
                request<T>(_name: string, callback: () => Promise<T>) {
                    return callback();
                },
            },
        });
        localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: string) => {
            if (failWrites && key.includes("infinite-canvas:asset_store")) throw new Error("indexeddb catalog write failed");
            durableValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;
        const task: GenerationTask = {
            id: "backend-image-catalog-failure",
            provider: "remote-image-provider",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            resultJson: JSON.stringify({
                images: [
                    {
                        dataUrl: "opaque://catalog-failure",
                        storageKey: "resource:catalog-failure-existing",
                        width: 640,
                        height: 360,
                        bytes: 12,
                        mimeType: "image/png",
                    },
                ],
            }),
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        useAssetStore.getState().replaceAssets([]);

        try {
            await expect(materializeGenerationTaskAssets(task)).rejects.toThrow("indexeddb catalog write failed");
            const assetStoreKey = "infinite-canvas:asset_store:user:materializer-catalog-failure";
            expect(durableValues.has(assetStoreKey)).toBe(false);
            expect(localStorageCalls).toEqual([]);
            const releasedEffect = [...durableValues.entries()].find(([key]) => key.includes("generation-effect") && key.includes(task.id));
            expect(releasedEffect).toBeDefined();
            expect(JSON.parse(releasedEffect![1])).toMatchObject({ state: "released" });

            failWrites = false;
            const recovered = await materializeGenerationTaskAssets(task);
            const recoveredId = recovered.outputs?.[0]?.materializedAssetId;
            const persisted = JSON.parse(durableValues.get(assetStoreKey)!) as { state: { assets: Array<{ id: string }> } };
            expect(recovered.resultState).toBe("READY");
            expect(persisted.state.assets.filter((candidate) => candidate.id === recoveredId)).toHaveLength(1);
            expect(JSON.parse(durableValues.get(releasedEffect![0])!)).toMatchObject({ state: "completed", result: { materializedAssetId: recoveredId } });
        } finally {
            failWrites = false;
            useAssetStore.getState().replaceAssets(previousAssets);
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
            else delete (navigator as { locks?: unknown }).locks;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("two concurrent remote Web consumers use the default browser durable atomic authority", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const localStorageValues = new Map<string, string>();
        const durableValues = new Map<string, unknown>();
        const lockTails = new Map<string, Promise<void>>();
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
        Object.defineProperty(navigator, "locks", {
            configurable: true,
            value: {
                async request<T>(name: string, callback: () => Promise<T>) {
                    const prior = lockTails.get(name) ?? Promise.resolve();
                    let release!: () => void;
                    const tail = new Promise<void>((resolve) => {
                        release = resolve;
                    });
                    const queued = prior.then(() => tail);
                    lockTails.set(name, queued);
                    await prior;
                    try {
                        return await callback();
                    } finally {
                        release();
                        if (lockTails.get(name) === queued) lockTails.delete(name);
                    }
                },
            },
        });
        localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: unknown) => {
            durableValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;
        const task: GenerationTask = {
            id: "backend-cinematic-default-authority",
            provider: "remote-cinematic-provider",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        let continuations = 0;

        try {
            await Promise.all([
                consumeGenerationTaskAgent(task, "shared-continuation", async () => {
                    continuations += 1;
                }),
                consumeGenerationTaskAgent(task, "shared-continuation", async () => {
                    continuations += 1;
                }),
            ]);

            expect(continuations).toBe(1);
            expect([...durableValues.keys()].some((key) => key.includes("agent-resume:backend-cinematic-default-authority:shared-continuation"))).toBe(true);
        } finally {
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
            else delete (navigator as { locks?: unknown }).locks;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("provider-neutral lease renew complete and release stay bound to the claim account", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const localStorageValues = new Map<string, string>();
        const durableValues = new Map<string, unknown>();
        const lockTails = new Map<string, Promise<void>>();
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
        Object.defineProperty(navigator, "locks", {
            configurable: true,
            value: {
                async request<T>(name: string, callback: () => Promise<T>) {
                    const prior = lockTails.get(name) ?? Promise.resolve();
                    let release!: () => void;
                    const tail = new Promise<void>((resolve) => {
                        release = resolve;
                    });
                    const queued = prior.then(() => tail);
                    lockTails.set(name, queued);
                    await prior;
                    try {
                        return await callback();
                    } finally {
                        release();
                        if (lockTails.get(name) === queued) lockTails.delete(name);
                    }
                },
            },
        });
        localforage.getItem = (async (key: string) => durableValues.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: unknown) => {
            durableValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        try {
            setActiveUserScope("account-A");
            const store = createProviderNeutralGenerationTaskEffectStore({ leaseMs: 1_000 });
            const completeKey = "attach-message:backend-scope-bound:message-safe-id:0";
            const releaseKey = "attach-node:backend-scope-bound:node-safe-id:0";

            expect(await store.claim(completeKey, "backend-scope-bound")).toMatchObject({ status: "claimed" });
            setActiveUserScope("account-B");
            expect(await store.renew(completeKey, "backend-scope-bound")).toEqual({ fence: 1 });
            await store.complete(completeKey, "backend-scope-bound", {});

            setActiveUserScope("account-A");
            expect(await store.claim(releaseKey, "backend-scope-bound")).toMatchObject({ status: "claimed" });
            setActiveUserScope("account-B");
            expect(await store.renew(releaseKey, "backend-scope-bound")).toEqual({ fence: 1 });
            await store.release(releaseKey, "backend-scope-bound");

            const keys = [...durableValues.keys()];
            expect(keys.length).toBeGreaterThanOrEqual(2);
            expect(keys.every((key) => key.includes(":user:account-A"))).toBe(true);
            expect(keys.some((key) => key.includes(":user:account-B"))).toBe(false);
        } finally {
            setActiveUserScope(null);
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalLocks) Object.defineProperty(navigator, "locks", originalLocks);
            else delete (navigator as { locks?: unknown }).locks;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("aborting a busy effect waiter clears its timer and prevents later claim or sink", async () => {
        const originalSetTimeout = globalThis.setTimeout;
        const originalClearTimeout = globalThis.clearTimeout;
        let scheduledHandle: ReturnType<typeof setTimeout> | undefined;
        let clearedScheduledTimer = 0;
        let resolveScheduled!: () => void;
        const scheduled = new Promise<void>((resolve) => {
            resolveScheduled = resolve;
        });
        globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
            const handle = originalSetTimeout(handler, timeout, ...args);
            if (scheduledHandle === undefined && typeof timeout === "number" && timeout <= 250) {
                scheduledHandle = handle;
                resolveScheduled();
            }
            return handle;
        }) as typeof setTimeout;
        globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
            if (scheduledHandle !== undefined && handle === scheduledHandle) clearedScheduledTimer += 1;
            return originalClearTimeout(handle);
        }) as typeof clearTimeout;

        let claims = 0;
        let sinks = 0;
        let completes = 0;
        const task: GenerationTask = {
            id: "backend-abort-busy-waiter",
            provider: "remote-image-provider",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-abort-busy" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const effects: GenerationTaskEffectStore = {
            async claim() {
                claims += 1;
                return claims === 1 ? { status: "busy", retryAt: new Date(Date.now() + 25).toISOString() } : { status: "completed", result: {} };
            },
            async renew() {
                return { fence: 1 };
            },
            async complete() {
                completes += 1;
            },
            async release() {},
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });
        const controller = new AbortController();

        try {
            const run = materializer.attachNode(
                task,
                "node-abort-busy",
                0,
                async () => {
                    sinks += 1;
                },
                controller.signal,
            );
            await scheduled;
            controller.abort();
            await expect(run).rejects.toMatchObject({ name: "AbortError" });
            await new Promise<void>((resolve) => originalSetTimeout(resolve, 50));
            expect(clearedScheduledTimer).toBeGreaterThanOrEqual(1);
            expect(claims).toBe(1);
            expect(sinks).toBe(0);
            expect(completes).toBe(0);
        } finally {
            globalThis.setTimeout = originalSetTimeout;
            globalThis.clearTimeout = originalClearTimeout;
        }
    });

    test("Create message automatically resumes a stale remote effect lease after restart", async () => {
        let nowMs = Date.parse("2026-08-13T00:00:00.000Z");
        const now = () => new Date(nowMs);
        const task: GenerationTask = {
            id: "backend-create-stale-lease",
            provider: "remote-image-provider",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stale-create" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const effectKey = `attach-message:${task.id}:message-stale-create:0`;
        const crashedPage = createProviderNeutralGenerationTaskEffectStore({ now, leaseMs: 100 });
        expect((await crashedPage.claim(effectKey, task.id)).status).toBe("claimed");

        const restartedPage = createProviderNeutralGenerationTaskEffectStore({ now, leaseMs: 100 });
        const dependencies = {
            effects: restartedPage,
            async materializeOutput() {
                throw new Error("already materialized");
            },
            async waitUntil(retryAt: string) {
                nowMs = Date.parse(retryAt);
            },
        };
        const materializer = createGenerationTaskMaterializer(dependencies);
        let messageEffects = 0;

        await consumeGenerationTaskMessage(
            task,
            "message-stale-create",
            async () => {
                messageEffects += 1;
            },
            {
                materialize: async (input) => input,
                materializedUrls: () => ["opaque://materialized"],
                attachMessage: (input, messageId, outputIndex, consumer) => materializer.attachMessage(input, messageId, outputIndex, consumer),
            },
        );

        expect(messageEffects).toBe(1);
    });

    test("Canvas node automatically leaves loading after a stale remote effect lease expires", async () => {
        let nowMs = Date.parse("2026-08-13T00:01:00.000Z");
        const now = () => new Date(nowMs);
        const task: GenerationTask = {
            id: "backend-canvas-stale-lease",
            provider: "remote-image-provider",
            type: "canvas_image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stale-canvas" }],
            createdAt: "2026-08-13T00:01:00.000Z",
            updatedAt: "2026-08-13T00:01:00.000Z",
        };
        const effectKey = `attach-node:${task.id}:node-stale-canvas:0`;
        const crashedPage = createProviderNeutralGenerationTaskEffectStore({ now, leaseMs: 100 });
        expect((await crashedPage.claim(effectKey, task.id)).status).toBe("claimed");

        const restartedPage = createProviderNeutralGenerationTaskEffectStore({ now, leaseMs: 100 });
        const dependencies = {
            effects: restartedPage,
            async materializeOutput() {
                throw new Error("already materialized");
            },
            async waitUntil(retryAt: string) {
                nowMs = Date.parse(retryAt);
            },
        };
        const materializer = createGenerationTaskMaterializer(dependencies);
        let canvasStatus: "loading" | "success" = "loading";

        await consumeGenerationTaskNode(
            task,
            "node-stale-canvas",
            0,
            async () => {
                canvasStatus = "success";
            },
            {
                materialize: async (input) => input,
                attachNode: (input, nodeId, outputIndex, consumer) => materializer.attachNode(input, nodeId, outputIndex, consumer),
            },
        );

        expect(canvasStatus).toBe("success");
    });

    test("Create local and remote successes use the shared materializer and message consumer", async () => {
        const effects = createEffectStore();
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("outputs are already materialized");
            },
        });
        const base = {
            type: "image",
            status: "succeeded" as const,
            prompt: "redacted",
            attempts: 1,
            resultState: "READY" as const,
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "image" as const,
                    materializedAssetId: "asset-stable-id",
                },
            ],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const tasks: GenerationTask[] = [
            { ...base, id: "dreamina:create-local-task" },
            { ...base, id: "backend-create-remote-task" },
        ];
        let materializeCalls = 0;
        let messageEffects = 0;

        for (let replay = 0; replay < 3; replay += 1) {
            for (const task of tasks) {
                await consumeGenerationTaskMessage(
                    task,
                    "message-create-safe-id",
                    async () => {
                        messageEffects += 1;
                    },
                    {
                        async materialize(input) {
                            materializeCalls += 1;
                            return input;
                        },
                        materializedUrls: () => ["asset-url-redacted"],
                        attachMessage: (input, messageId, outputIndex, consumer) => materializer.attachMessage(input, messageId, outputIndex, consumer),
                    },
                );
            }
        }

        expect(materializeCalls).toBe(6);
        expect(messageEffects).toBe(2);
    });

    test("Canvas production node adapter replays three times with one attachment", async () => {
        const task: GenerationTask = {
            id: "dreamina:canvas-node-task",
            type: "canvas_image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "image",
                    materializedAssetId: "asset-node-id",
                },
            ],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const materializer = createGenerationTaskMaterializer({
            effects: createEffectStore(),
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });
        let attachments = 0;

        for (let replay = 0; replay < 3; replay += 1) {
            await consumeGenerationTaskNode(
                task,
                "node-safe-id",
                0,
                async () => {
                    attachments += 1;
                },
                {
                    materialize: async (input) => input,
                    attachNode: (input, nodeId, outputIndex, consumer) => materializer.attachNode(input, nodeId, outputIndex, consumer),
                },
            );
        }

        expect(attachments).toBe(1);
    });

    test("cinematic agent production adapter replays three times with one continuation", async () => {
        const task: GenerationTask = {
            id: "backend-cinematic-task",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const materializer = createGenerationTaskMaterializer({
            effects: createEffectStore(),
            async materializeOutput() {
                throw new Error("no media outputs");
            },
        });
        let continuations = 0;

        for (let replay = 0; replay < 3; replay += 1) {
            await consumeGenerationTaskAgent(
                task,
                "cinematic-continuation-id",
                async () => {
                    continuations += 1;
                },
                {
                    resumeAgent: (input, continuationId, consumer) => materializer.resumeAgent(input, continuationId, consumer),
                },
            );
        }

        expect(continuations).toBe(1);
    });

    test("post-write aborted cinematic commit completes the agent effect claim before replay", async () => {
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
        let abortOnCommit = true;
        let parentController: AbortController | undefined;
        localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: string) => {
            values.set(key, value);
            if (abortOnCommit && currentEffectKey && value.includes(currentEffectKey)) {
                abortOnCommit = false;
                parentController?.abort();
            }
            return value;
        }) as typeof localforage.setItem;

        const scope = "cinematic-materializer-post-write-abort";
        const projectId = "canvas-cinematic-materializer-post-write-abort";
        const sessionId = "session-cinematic-materializer-post-write-abort";
        const messageId = "message-cinematic-materializer-post-write-abort";
        const continuationId = "cinematic-materializer-continuation";
        const pendingSession: CanvasAssistantSession = {
            id: sessionId,
            title: "pending",
            pendingBackendSession: { id: "backend-cinematic-materializer", kind: "cinematic", messageId, status: "pending", startedAt: "2026-08-14T00:00:00.000Z" },
            messages: [{ id: messageId, role: "assistant", text: "pending", detail: { kind: "cinematic", backendSessionId: "backend-cinematic-materializer", status: "pending" } }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const project: CanvasProject = {
            id: projectId,
            title: "cinematic materializer",
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            nodes: [],
            connections: [],
            chatSessions: [pendingSession],
            activeChatId: sessionId,
            backgroundMode: "dots",
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        const task: GenerationTask = {
            id: "backend-cinematic-post-write-abort-task",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const materializer = createGenerationTaskMaterializer({
            effects: createEffectStore(),
            async materializeOutput() {
                throw new Error("agent task has no media outputs");
            },
        });
        let mountedSessions = [pendingSession];
        let consumerCalls = 0;
        let executeCalls = 0;

        try {
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [project] });
            await flushCanvasStorePersistence();

            for (let replay = 0; replay < 3; replay += 1) {
                const controller = new AbortController();
                parentController = controller;
                await consumeGenerationTaskAgent(
                    task,
                    continuationId,
                    async ({ effectKey, signal }) => {
                        consumerCalls += 1;
                        if (mountedSessions[0]?.generationEffectKeys?.includes(effectKey)) return;
                        currentEffectKey = effectKey;
                        await canvasCinematicContinuationEntryAdapters["online-tool"]({
                            projectId,
                            effectKey,
                            signal,
                            readSnapshot: () => ({ projectId, title: "cinematic materializer", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }),
                            executeOps: async () => {
                                executeCalls += 1;
                            },
                            completeSession: (key) => {
                                mountedSessions = [
                                    {
                                        ...pendingSession,
                                        pendingBackendSession: undefined,
                                        generationEffectKeys: key ? [key] : undefined,
                                        messages: [{ id: messageId, role: "assistant", text: "completed", detail: { kind: "cinematic", backendSessionId: "backend-cinematic-materializer", status: "completed" } }],
                                        updatedAt: "2026-08-14T00:01:00.000Z",
                                    },
                                ];
                                useCanvasStore.getState().updateProject(projectId, { chatSessions: mountedSessions });
                                return mountedSessions;
                            },
                            readLiveSessionState: () => ({ sessions: mountedSessions, activeChatId: sessionId }),
                            restoreLiveSessions: (sessions) => {
                                mountedSessions = sessions;
                            },
                            restoreLiveSnapshot: () => undefined,
                            failProvider: () => {
                                throw new Error("post-write abort must not become a provider failure");
                            },
                        });
                    },
                    {
                        signal: controller.signal,
                        resumeAgent: (input, id, consumer) => materializer.resumeAgent(input, id, consumer, controller.signal),
                    },
                );
            }

            expect(consumerCalls).toBe(1);
            expect(executeCalls).toBe(1);
            expect(mountedSessions[0]?.generationEffectKeys?.length).toBe(1);
            expect(mountedSessions[0]?.pendingBackendSession).toBeUndefined();
        } finally {
            setActiveUserScope(previousScope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("online and local agents refresh-reconnect the original scoped task and resume once", async () => {
        for (const provider of ["backend-online", "dreamina-cli"] as const) {
            const effects = createEffectStore();
            const materializer = createGenerationTaskMaterializer({
                effects,
                async materializeOutput() {
                    throw new Error("agent task has no media output");
                },
            });
            let queryCalls = 0;
            let waitCalls = 0;
            let continuations = 0;
            let release!: () => void;
            const gate = new Promise<void>((resolveGate) => {
                release = resolveGate;
            });
            const running: GenerationTask = {
                id: provider === "dreamina-cli" ? "dreamina:agent-refresh-task-0001" : "backend-agent-refresh-task-0001",
                provider,
                projectId: "agent-project-0001",
                type: "agent_storyboard_rows",
                status: "running",
                prompt: "fixture",
                attempts: 1,
                clientContext: {
                    conversationId: "conversation-agent-0001",
                    messageId: "message-agent-0001",
                    nodeId: "node-agent-0001",
                },
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z",
            };
            const terminal = { ...running, status: "succeeded" as const, updatedAt: "2026-08-13T00:01:00.000Z" };
            const service = createGenerationTaskSubscriptionService({
                async queryTask() {
                    queryCalls += 1;
                    return running;
                },
                async waitTask() {
                    waitCalls += 1;
                    await gate;
                    return terminal;
                },
            });
            let continuationChain = Promise.resolve();
            const observe = (task: GenerationTask) => {
                if (task.status !== "succeeded") return;
                continuationChain = continuationChain.then(() =>
                    consumeGenerationTaskAgent(
                        task,
                        `${task.clientContext?.conversationId}:${task.clientContext?.messageId}:${task.clientContext?.nodeId}`,
                        async () => {
                            continuations += 1;
                        },
                        {
                            resumeAgent: (input, continuationId, consumer) => materializer.resumeAgent(input, continuationId, consumer),
                        },
                    ),
                );
            };

            const disconnect = service.subscribe([running.id], observe);
            await Promise.resolve();
            disconnect();
            const reconnect = service.subscribe([running.id], observe);
            release();
            await new Promise((resolveTick) => setTimeout(resolveTick, 0));
            await continuationChain;
            reconnect();
            await consumeGenerationTaskAgent(
                terminal,
                "conversation-agent-0001:message-agent-0001:node-agent-0001",
                async () => {
                    continuations += 1;
                },
                {
                    resumeAgent: (input, continuationId, consumer) => materializer.resumeAgent(input, continuationId, consumer),
                },
            );

            expect({ provider, queryCalls, waitCalls, continuations }).toEqual({
                provider,
                queryCalls: 1,
                waitCalls: 1,
                continuations: 1,
            });
            expect(terminal).toMatchObject({
                projectId: "agent-project-0001",
                clientContext: {
                    conversationId: "conversation-agent-0001",
                    messageId: "message-agent-0001",
                    nodeId: "node-agent-0001",
                },
            });
        }
    });

    test("two Web clients use the Agent atomic effect authority", async () => {
        const leaseToken = "11111111-1111-4111-8111-111111111111";
        let state: "available" | "claimed" | "completed" = "available";
        const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
        const request = async (path: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
            requests.push({ path, body });
            let result: Record<string, unknown>;
            if (path.endsWith("/claim")) {
                result =
                    state === "completed"
                        ? { status: "completed", result: { materializedAssetId: "asset-agent-durable" } }
                        : state === "claimed"
                          ? { status: "busy", retryAt: "2026-08-13T00:00:30.000Z" }
                          : ((state = "claimed"),
                            {
                                status: "claimed",
                                leaseToken,
                                leaseExpiresAt: "2026-08-13T00:00:30.000Z",
                                fence: 1,
                            });
            } else if (path.endsWith("/renew")) {
                result = {
                    leaseExpiresAt: "2026-08-13T00:00:40.000Z",
                    fence: 1,
                };
            } else if (path.endsWith("/complete")) {
                const completed = state === "claimed" && body.leaseToken === leaseToken;
                if (completed) state = "completed";
                result = { completed };
            } else {
                state = "available";
                result = { released: true };
            }
            return new Response(JSON.stringify({ ok: true, result }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        };
        const client = () => ({
            connect: async () => ({ state: "connected" }) as never,
            request,
        });
        const first = createLocalDreaminaTaskEffectStore({ client: client() });
        const second = createLocalDreaminaTaskEffectStore({ client: client() });
        const effectKey = "materialize:dreamina:task-cross-tab:0";
        const taskId = "dreamina:task-cross-tab";

        const claims = await Promise.all([first.claim(effectKey, taskId), second.claim(effectKey, taskId)]);

        expect(claims.map((claim) => claim.status).sort()).toEqual(["busy", "claimed"]);
        await first.complete(effectKey, taskId, { materializedAssetId: "asset-agent-durable" });
        expect(requests.find((entry) => entry.path.endsWith("/complete"))?.body).toEqual({
            consumerId: "web-generation-materializer",
            taskId,
            effectKey,
            leaseToken,
            fence: 1,
            result: { materializedAssetId: "asset-agent-durable" },
        });
        expect(await second.claim(effectKey, taskId)).toEqual({
            status: "completed",
            result: { materializedAssetId: "asset-agent-durable" },
        });
    });

    test("Web effect renewal carries the full task lease binding", async () => {
        const leaseToken = "22222222-2222-4222-8222-222222222222";
        const taskId = "dreamina:web-renew-task";
        const effectKey = "attach-message:dreamina:web-renew-task:message-safe-id:0";
        const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
        const client = {
            connect: async () => ({ state: "connected" }) as never,
            request: async (path: string, init?: RequestInit) => {
                const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
                requests.push({ path, body });
                const result = path.endsWith("/claim") ? { status: "claimed", leaseToken, leaseExpiresAt: "2026-08-13T00:00:30.000Z", fence: 7 } : { leaseExpiresAt: "2026-08-13T00:00:40.000Z", fence: 7 };
                return new Response(JSON.stringify({ ok: true, result }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        };
        const store = createLocalDreaminaTaskEffectStore({ client });

        expect(await store.claim(effectKey, taskId)).toEqual({ status: "claimed", fence: 7 });
        expect(await store.renew(effectKey, taskId)).toEqual({ fence: 7 });
        expect(requests.at(-1)).toEqual({
            path: "/dreamina/generate/effects/renew",
            body: {
                consumerId: "web-generation-materializer",
                taskId,
                effectKey,
                leaseToken,
                fence: 7,
            },
        });
    });

    test("a rejected release remains an explicit ownership error and keeps the local lease", async () => {
        const leaseToken = "33333333-3333-4333-8333-333333333333";
        const taskId = "dreamina:web-release-task";
        const effectKey = "agent-resume:dreamina:web-release-task:continuation-safe-id";
        let releaseCalls = 0;
        const releaseBodies: Record<string, unknown>[] = [];
        const client = {
            connect: async () => ({ state: "connected" }) as never,
            request: async (path: string, init?: RequestInit) => {
                if (path.endsWith("/release")) {
                    releaseBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
                }
                const result = path.endsWith("/claim") ? { status: "claimed", leaseToken, leaseExpiresAt: "2026-08-13T00:00:30.000Z", fence: 3 } : ((releaseCalls += 1), { released: false });
                return new Response(JSON.stringify({ ok: true, result }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                });
            },
        };
        const store = createLocalDreaminaTaskEffectStore({ client });
        await store.claim(effectKey, taskId);

        await expect(store.release(effectKey, taskId)).rejects.toMatchObject({ code: "local_runtime_effect_lease_lost" });
        await expect(store.release(effectKey, taskId)).rejects.toMatchObject({ code: "local_runtime_effect_lease_lost" });
        expect(releaseCalls).toBe(2);
        expect(releaseBodies).toEqual(
            [0, 1].map(() => ({
                consumerId: "web-generation-materializer",
                taskId,
                effectKey,
                leaseToken,
                fence: 3,
            })),
        );
    });

    test("a slow consumer renews its lease across the original TTL and blocks a second instance", async () => {
        const task: GenerationTask = {
            id: "dreamina:slow-effect-task",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-slow-effect" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        let now = 0;
        let fence = 0;
        let active: { token: number; fence: number; expiresAt: number } | undefined;
        let completed = false;
        let resolveRenewed!: () => void;
        const renewed = new Promise<void>((resolve) => {
            resolveRenewed = resolve;
        });
        let resolveStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            resolveStarted = resolve;
        });
        let resolveFinish!: () => void;
        const finish = new Promise<void>((resolve) => {
            resolveFinish = resolve;
        });

        const effectClient = (): GenerationTaskEffectStore => {
            let owned: { token: number; fence: number } | undefined;
            return {
                async claim() {
                    if (completed) return { status: "completed", result: {} };
                    if (active && active.expiresAt > now) return { status: "busy", retryAt: new Date(active.expiresAt).toISOString() };
                    active = { token: (active?.token ?? 0) + 1, fence: ++fence, expiresAt: now + 100 };
                    owned = { token: active.token, fence: active.fence };
                    return { status: "claimed", fence: active.fence };
                },
                async renew() {
                    if (!owned || !active || active.token !== owned.token || active.fence !== owned.fence || active.expiresAt <= now) {
                        throw new Error("lease lost");
                    }
                    active.expiresAt = now + 100;
                    resolveRenewed();
                    return { fence: active.fence };
                },
                async complete() {
                    if (!owned || !active || active.token !== owned.token || active.fence !== owned.fence || active.expiresAt <= now) {
                        throw new Error("stale complete");
                    }
                    completed = true;
                    active = undefined;
                },
                async release() {
                    if (owned && active?.token === owned.token && active.fence === owned.fence) active = undefined;
                },
            } as GenerationTaskEffectStore;
        };
        const first = createGenerationTaskMaterializer({
            effects: effectClient(),
            leaseHeartbeatMs: 1,
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });
        let firstRun!: ReturnType<typeof first.attachNode>;
        const second = createGenerationTaskMaterializer({
            effects: effectClient(),
            leaseHeartbeatMs: 1,
            async waitUntil() {
                await firstRun;
            },
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });
        const applied = new Set<string>();
        let sideEffects = 0;
        const sink = async ({ effectKey }: { effectKey: string }) => {
            if (!applied.has(effectKey)) {
                applied.add(effectKey);
                sideEffects += 1;
            }
            resolveStarted();
            await finish;
        };

        firstRun = first.attachNode(task, "node-slow-effect", 0, sink);
        await started;
        now = 80;
        await Promise.race([renewed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lease was not renewed")), 100))]);
        now = 120;
        const secondRun = second.attachNode(task, "node-slow-effect", 0, sink);
        resolveFinish();
        expect(await Promise.all([firstRun, secondRun])).toEqual(["applied", "completed"]);
        expect(sideEffects).toBe(1);
    });

    test("lease renewal failure aborts an in-flight consumer before its later durable write and never completes the claim", async () => {
        const task: GenerationTask = {
            id: "task-renew-fencing",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-renew-fencing" }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        let renewCalls = 0;
        let completeCalls = 0;
        let releaseCalls = 0;
        let durableWrites = 0;
        const parentController = new AbortController();
        let consumerSignal: AbortSignal | undefined;
        let resolveRenewAttempted!: () => void;
        const renewAttempted = new Promise<void>((resolve) => {
            resolveRenewAttempted = resolve;
        });
        let releaseDurableWrite!: () => void;
        const durableWriteAllowed = new Promise<void>((resolve) => {
            releaseDurableWrite = resolve;
        });
        const effects: GenerationTaskEffectStore = {
            async claim() {
                return { status: "claimed", fence: 1 };
            },
            async renew() {
                renewCalls += 1;
                resolveRenewAttempted();
                throw new Error("lease lost during consumer");
            },
            async complete() {
                completeCalls += 1;
            },
            async release() {
                releaseCalls += 1;
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            leaseHeartbeatMs: 1,
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });

        const run = materializer.attachNode(
            task,
            "node-renew-fencing",
            0,
            async ({ signal }) => {
                consumerSignal = signal;
                await durableWriteAllowed;
                if (!signal?.aborted) durableWrites += 1;
            },
            parentController.signal,
        );

        await renewAttempted;
        await new Promise<void>((resolve) => {
            if (consumerSignal?.aborted) resolve();
            else consumerSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        releaseDurableWrite();
        await expect(run).rejects.toThrow("lease lost during consumer");
        expect(renewCalls).toBeGreaterThan(0);
        expect(consumerSignal).toBeDefined();
        expect(consumerSignal?.aborted).toBe(true);
        expect(parentController.signal.aborted).toBe(false);
        expect(durableWrites).toBe(0);
        expect(completeCalls).toBe(0);
        expect(releaseCalls).toBe(1);
    });

    test("replaying one materialize effect three times inserts the asset once", async () => {
        const task: GenerationTask = {
            id: "task-safe-id",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "image",
                    providerArtifactRef: "provider-artifact-opaque",
                },
            ],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const effects = createEffectStore();
        let inserts = 0;
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput({ effectKey, output }) {
                inserts += 1;
                expect(effectKey).toBe(materializeEffectKey(task.id, output.outputIndex));
                return { materializedAssetId: "asset-stable-id" };
            },
        });

        const results = [];
        for (let replay = 0; replay < 3; replay += 1) {
            results.push(await materializer.materialize(task));
        }

        expect(inserts).toBe(1);
        expect(results.every((result) => result.outputs[0]?.materializedAssetId === "asset-stable-id")).toBe(true);
        expect(results.at(-1)?.resultState).toBe("READY");
    });

    test("a download crash keeps provider success orthogonal and remains retryable", async () => {
        const task: GenerationTask = {
            id: "task-download-crash",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            outputs: [{ outputIndex: 0, mediaType: "image", providerArtifactRef: "provider-artifact-opaque" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const effects = createEffectStore();
        let attempts = 0;
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                attempts += 1;
                if (attempts === 1) throw new Error("download interrupted");
                return { materializedAssetId: "asset-after-retry" };
            },
        });

        await expect(materializer.materialize(task)).rejects.toThrow("download interrupted");
        expect(task.status).toBe("succeeded");
        expect(task.resultState).toBe("PENDING_MATERIALIZATION");

        const recovered = await materializer.materialize(task);
        expect(attempts).toBe(2);
        expect(recovered.status).toBe("succeeded");
        expect(recovered.resultState).toBe("READY");
    });

    test("two materializer instances atomically insert or return one asset for the same effect key", async () => {
        const task: GenerationTask = {
            id: "dreamina:concurrent-asset-task",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            outputs: [{ outputIndex: 0, mediaType: "image", providerArtifactRef: "provider-artifact-opaque" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const previousAssets = useAssetStore.getState().assets;
        useAssetStore.getState().replaceAssets([]);
        const asset: NewAsset = {
            kind: "image",
            title: "redacted generated image",
            coverUrl: "opaque://materialized",
            tags: ["generated"],
            metadata: {},
            data: {
                dataUrl: "opaque://materialized",
                width: 1,
                height: 1,
                bytes: 1,
                mimeType: "image/png",
            },
        };
        try {
            const materializeOutput = createIdempotentMaterializeOutput({
                insertOrReturnAsset: ({ effectKey }) => useAssetStore.getState().addGenerationAsset(effectKey, asset),
            });
            const first = createGenerationTaskMaterializer({ effects: createEffectStore(), materializeOutput });
            const second = createGenerationTaskMaterializer({ effects: createEffectStore(), materializeOutput });

            const results = await Promise.all([first.materialize(task), second.materialize(task)]);
            const effectKey = materializeEffectKey(task.id, 0);
            const stored = useAssetStore.getState().assets.filter((candidate) => candidate.metadata?.generationEffectKey === effectKey);
            const assetIds = results.map((result) => result.outputs?.[0]?.materializedAssetId);

            expect(stored).toHaveLength(1);
            expect(assetIds[0]).toMatch(/^generation_[0-9a-f]{64}$/);
            expect(assetIds[1]).toBe(assetIds[0]);
            expect(stored[0]?.id).toBe(assetIds[0]);
        } finally {
            useAssetStore.getState().replaceAssets(previousAssets);
        }
    });

    test("a crash after asset insert reuses the asset before acknowledging the effect", async () => {
        const task: GenerationTask = {
            id: "task-insert-crash",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            outputs: [{ outputIndex: 0, mediaType: "image", providerArtifactRef: "provider-artifact-opaque" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const completed = new Map<string, { materializedAssetId?: string }>();
        const claimed = new Set<string>();
        let firstAck = true;
        const effects: GenerationTaskEffectStore = {
            async claim(effectKey) {
                const result = completed.get(effectKey);
                if (result) return { status: "completed", result };
                if (claimed.has(effectKey)) return { status: "busy" };
                claimed.add(effectKey);
                return { status: "claimed", fence: 1 };
            },
            async renew() {
                return { fence: 1 };
            },
            async complete(effectKey, _taskId, result) {
                if (firstAck) {
                    firstAck = false;
                    throw new Error("crash before effect ack");
                }
                claimed.delete(effectKey);
                completed.set(effectKey, result);
            },
            async release(effectKey) {
                claimed.delete(effectKey);
            },
        };
        const assets = new Map<string, string>();
        let inserts = 0;
        const materializer = createGenerationTaskMaterializer({
            effects,
            materializeOutput: createIdempotentMaterializeOutput({
                async insertOrReturnAsset({ effectKey }) {
                    const existing = assets.get(effectKey);
                    if (existing) return existing;
                    inserts += 1;
                    const assetId = "asset-inserted-once";
                    assets.set(effectKey, assetId);
                    return assetId;
                },
            }),
        });

        await expect(materializer.materialize(task)).rejects.toThrow("crash before effect ack");
        const recovered = await materializer.materialize(task);
        const replayed = await materializer.materialize(task);

        expect(inserts).toBe(1);
        expect(recovered.outputs[0]?.materializedAssetId).toBe("asset-inserted-once");
        expect(replayed.outputs[0]?.materializedAssetId).toBe("asset-inserted-once");
    });

    test("replaying node message and agent effects three times applies each once", async () => {
        const task: GenerationTask = {
            id: "task-consumers",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [
                {
                    outputIndex: 0,
                    mediaType: "image",
                    providerArtifactRef: "provider-artifact-opaque",
                    materializedAssetId: "asset-stable-id",
                },
            ],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const effects = createEffectStore();
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("unexpected materialization");
            },
        });
        const calls = { node: 0, message: 0, agent: 0 };

        for (let replay = 0; replay < 3; replay += 1) {
            await materializer.attachNode(task, "node-safe-id", 0, async () => {
                calls.node += 1;
            });
            await materializer.attachMessage(task, "message-safe-id", 0, async () => {
                calls.message += 1;
            });
            await materializer.resumeAgent(task, "continuation-safe-id", async () => {
                calls.agent += 1;
            });
        }

        expect(calls).toEqual({ node: 1, message: 1, agent: 1 });
    });

    test("attachment failures before side effects stay retryable without duplicates", async () => {
        const task: GenerationTask = {
            id: "task-attachment-crash",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stable-id" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const materializer = createGenerationTaskMaterializer({
            effects: createEffectStore(),
            async materializeOutput() {
                throw new Error("unexpected materialization");
            },
        });
        let nodeAttempts = 0;
        let messageAttempts = 0;
        let nodeAttachments = 0;
        let messageAttachments = 0;

        const attachNode = async () => {
            nodeAttempts += 1;
            if (nodeAttempts === 1) throw new Error("crash before node attachment");
            nodeAttachments += 1;
        };
        const attachMessage = async () => {
            messageAttempts += 1;
            if (messageAttempts === 1) throw new Error("crash before message attachment");
            messageAttachments += 1;
        };

        await expect(materializer.attachNode(task, "node-safe-id", 0, attachNode)).rejects.toThrow("crash before node attachment");
        await expect(materializer.attachMessage(task, "message-safe-id", 0, attachMessage)).rejects.toThrow("crash before message attachment");
        for (let replay = 0; replay < 3; replay += 1) {
            await materializer.attachNode(task, "node-safe-id", 0, attachNode);
            await materializer.attachMessage(task, "message-safe-id", 0, attachMessage);
        }

        expect(nodeAttachments).toBe(1);
        expect(messageAttachments).toBe(1);
    });

    test("agent continuation ack crash replays without resuming twice", async () => {
        const task: GenerationTask = {
            id: "task-agent-ack-crash",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stable-id" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const completed = new Map<string, { materializedAssetId?: string }>();
        const claimed = new Set<string>();
        let failFirstAgentAck = true;
        const effects: GenerationTaskEffectStore = {
            async claim(effectKey) {
                const result = completed.get(effectKey);
                if (result) return { status: "completed", result };
                if (claimed.has(effectKey)) return { status: "busy" };
                claimed.add(effectKey);
                return { status: "claimed", fence: 1 };
            },
            async renew() {
                return { fence: 1 };
            },
            async complete(effectKey, _taskId, result) {
                if (effectKey.startsWith("agent-resume:") && failFirstAgentAck) {
                    failFirstAgentAck = false;
                    throw new Error("crash before continuation ack");
                }
                claimed.delete(effectKey);
                completed.set(effectKey, result);
            },
            async release(effectKey) {
                claimed.delete(effectKey);
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("unexpected materialization");
            },
        });
        const resumed = new Set<string>();
        let resumes = 0;
        const resume = async ({ effectKey }: { effectKey: string }) => {
            if (resumed.has(effectKey)) return;
            resumes += 1;
            resumed.add(effectKey);
        };

        await expect(materializer.resumeAgent(task, "continuation-safe-id", resume)).rejects.toThrow("crash before continuation ack");
        for (let replay = 0; replay < 3; replay += 1) {
            await materializer.resumeAgent(task, "continuation-safe-id", resume);
        }

        expect(resumes).toBe(1);
    });

    test("Canvas node effect completes only after its stamped project snapshot is durable", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const indexedValues = new Map<string, string>();
        const persistedPayloads: string[] = [];
        let releasePersistence!: () => void;
        const persistenceGate = new Promise<void>((resolve) => {
            releasePersistence = resolve;
        });
        let persistenceStartedResolve!: () => void;
        const persistenceStarted = new Promise<void>((resolve) => {
            persistenceStartedResolve = resolve;
        });
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
            if (key.includes("infinite-canvas:canvas_store")) {
                persistedPayloads.push(value);
                persistenceStartedResolve();
                await persistenceGate;
            }
            indexedValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        const previousProjects = useCanvasStore.getState().projects;
        const previousAssets = useAssetStore.getState().assets;
        const node: CanvasNodeData = {
            id: "node-durable-barrier",
            type: CanvasNodeType.Image,
            title: "result",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { taskId: "backend-node-durable-barrier", status: "loading" },
        };
        const task: GenerationTask = {
            id: "backend-node-durable-barrier",
            provider: "remote-image-provider",
            type: "canvas_image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            resultJson: JSON.stringify({ images: [{ dataUrl: "opaque://durable-node", width: 1, height: 1, mimeType: "image/png" }] }),
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-durable-node" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        useAssetStore.getState().replaceAssets([
            {
                id: "asset-durable-node",
                kind: "image",
                title: "result",
                coverUrl: "opaque://durable-node",
                tags: [],
                metadata: {},
                data: { dataUrl: "opaque://durable-node", storageKey: "resource:durable-node", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z",
            },
        ]);
        useCanvasStore.setState({
            projects: [
                {
                    id: "canvas-durable-barrier",
                    title: "canvas",
                    createdAt: "2026-08-13T00:00:00.000Z",
                    updatedAt: "2026-08-13T00:00:00.000Z",
                    nodes: [node],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    viewport: { x: 0, y: 0, k: 1 },
                    directorScenes: [],
                },
            ],
        });
        let visibleNodes = [node];
        let completeCalls = 0;
        let completeResolve!: () => void;
        const completed = new Promise<void>((resolve) => {
            completeResolve = resolve;
        });
        const baseEffects = createEffectStore();
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effectKey, taskId, result) {
                completeCalls += 1;
                await baseEffects.complete(effectKey, taskId, result);
                completeResolve();
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("already materialized");
            },
        });
        const effectKey = `attach-node:${task.id}:${node.id}:0`;

        try {
            const run = materializer.attachNode(task, node.id, 0, async ({ output }) => {
                await applyCanvasGenerationTaskNodeEffect({
                    projectId: "canvas-durable-barrier",
                    nodeId: node.id,
                    task,
                    output: output!,
                    effectKey,
                    nodesRef: {
                        get current() {
                            return visibleNodes;
                        },
                        set current(value) {
                            visibleNodes = value;
                        },
                    },
                    setNodes: (value) => {
                        visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
                    },
                });
            });
            expect(await Promise.race([persistenceStarted.then(() => "persistence"), completed.then(() => "complete")])).toBe("persistence");
            expect(completeCalls).toBe(0);
            releasePersistence();
            await run;
            expect(completeCalls).toBe(1);
            expect(persistedPayloads.at(-1)).toContain(effectKey);
            const restarted = JSON.parse(persistedPayloads.at(-1)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            expect(restarted.state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toEqual([effectKey]);
        } finally {
            releasePersistence();
            withCanvasStorePersistenceSuppressed(() => {
                useCanvasStore.setState({ projects: previousProjects });
            });
            useAssetStore.getState().replaceAssets(previousAssets);
            await flushAssetStorePersistence();
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("Canvas first durable write failure releases the claim and retry persists the effect before completion", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const previousProjects = useCanvasStore.getState().projects;
        const previousAssets = useAssetStore.getState().assets;
        const scope = "canvas-first-write-retry";
        const storageKey = `infinite-canvas:canvas_store:user:${scope}`;
        const values = new Map<string, string>();
        let failCanvasWrite = true;
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
            if (key === storageKey && failCanvasWrite) throw new Error("canvas first durable write failed");
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        const node: CanvasNodeData = {
            id: "node-first-write-retry",
            type: CanvasNodeType.Image,
            title: "result",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { taskId: "backend-first-write-retry", status: "loading" },
        };
        const project = {
            id: "canvas-first-write-retry",
            title: "canvas",
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            nodes: [node],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "dots" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        const task: GenerationTask = {
            id: "backend-first-write-retry",
            provider: "remote-image-provider",
            type: "canvas_image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            resultJson: JSON.stringify({ images: [{ dataUrl: "https://example.invalid/retry-node.png", storageKey: "resource:retry-node", width: 1, height: 1, mimeType: "image/png" }] }),
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-first-write-retry" }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const effectKey = `attach-node:${task.id}:${node.id}:0`;
        values.set(storageKey, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 1 }));
        setActiveUserScope(scope);
        withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
        useAssetStore.getState().replaceAssets([
            {
                id: "asset-first-write-retry",
                kind: "image",
                title: "result",
                coverUrl: "https://example.invalid/retry-node.png",
                tags: [],
                metadata: {},
                data: { dataUrl: "https://example.invalid/retry-node.png", storageKey: "resource:retry-node", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
                createdAt: "2026-08-14T00:00:00.000Z",
                updatedAt: "2026-08-14T00:00:00.000Z",
            },
        ]);
        let visibleNodes = [node];
        let releases = 0;
        let completes = 0;
        const baseEffects = createEffectStore();
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effect, taskId, result, binding) {
                completes += 1;
                await baseEffects.complete(effect, taskId, result, binding);
            },
            async release(effect, taskId, binding) {
                releases += 1;
                await baseEffects.release(effect, taskId, binding);
            },
        };
        const materializer = createGenerationTaskMaterializer({ effects, materializeOutput: async () => ({}) });
        const apply = () =>
            materializer.attachNode(task, node.id, 0, async ({ output }) => {
                await applyCanvasGenerationTaskNodeEffect({
                    projectId: project.id,
                    nodeId: node.id,
                    task,
                    output: output!,
                    effectKey,
                    nodesRef: {
                        get current() {
                            return visibleNodes;
                        },
                        set current(value) {
                            visibleNodes = value;
                        },
                    },
                    setNodes: (value) => {
                        visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
                    },
                });
            });

        try {
            await expect(apply()).rejects.toThrow("canvas first durable write failed");
            expect(releases).toBe(1);
            expect(completes).toBe(0);
            expect(generationEffectApplied(visibleNodes[0]?.metadata || {}, effectKey)).toBe(false);
            expect(values.get(storageKey)).not.toContain(effectKey);

            failCanvasWrite = false;
            await apply();
            expect(completes).toBe(1);
            const durable = JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            expect(generationEffectApplied(durable.state.projects[0]?.nodes[0]?.metadata || {}, effectKey)).toBe(true);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: durable.state.projects as never }));
            expect(generationEffectApplied(useCanvasStore.getState().projects[0]?.nodes[0]?.metadata || {}, effectKey)).toBe(true);
        } finally {
            failCanvasWrite = false;
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            useAssetStore.getState().replaceAssets(previousAssets);
            await flushAssetStorePersistence();
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("Canvas node effect keeps a newer mounted ordinary edit when the post-commit ordinary flush fails", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const previousScope = getActiveUserScope();
        const previousProjects = useCanvasStore.getState().projects;
        const previousAssets = useAssetStore.getState().assets;
        const scope = "canvas-node-post-commit-mounted-edit";
        const storageKey = `infinite-canvas:canvas_store:user:${scope}`;
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

        const node: CanvasNodeData = {
            id: "node-post-commit-mounted-edit",
            type: CanvasNodeType.Image,
            title: "base node",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { taskId: "backend-post-commit-mounted-edit", status: "loading" },
        };
        const project = {
            id: "canvas-node-post-commit-mounted-edit",
            title: "canvas",
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            nodes: [node],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "dots" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        const task: GenerationTask = {
            id: "backend-post-commit-mounted-edit",
            provider: "remote-image-provider",
            type: "canvas_image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            resultJson: JSON.stringify({ images: [{ dataUrl: "https://example.invalid/post-commit.png", storageKey: "resource:post-commit", width: 1, height: 1, mimeType: "image/png" }] }),
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-post-commit-mounted-edit" }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const effectKey = `attach-node:${task.id}:${node.id}:0`;
        let visibleNodes = [node];
        let generationCommitted = false;
        let failOrdinaryWrite = true;
        localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: string) => {
            if (key === storageKey && !generationCommitted && value.includes(effectKey)) {
                values.set(key, value);
                generationCommitted = true;
                const committed = JSON.parse(value) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
                const committedNode = committed.state.projects[0]!.nodes[0]!;
                visibleNodes = [{ ...committedNode, title: "newer ordinary node edit", position: { x: 88, y: 44 }, metadata: { ...committedNode.metadata, ordinaryNote: "newer" } }];
                useCanvasStore.getState().updateProject(project.id, { nodes: visibleNodes });
                return value;
            }
            if (key === storageKey && generationCommitted && failOrdinaryWrite) {
                failOrdinaryWrite = false;
                throw new Error("post-commit ordinary flush failed");
            }
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        try {
            setActiveUserScope(scope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
            values.set(storageKey, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 1, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} } }));
            useAssetStore.getState().replaceAssets([
                {
                    id: "asset-post-commit-mounted-edit",
                    kind: "image",
                    title: "result",
                    coverUrl: "https://example.invalid/post-commit.png",
                    tags: [],
                    metadata: {},
                    data: { dataUrl: "https://example.invalid/post-commit.png", storageKey: "resource:post-commit", width: 1, height: 1, bytes: 1, mimeType: "image/png" },
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                },
            ]);

            await applyCanvasGenerationTaskNodeEffect({
                projectId: project.id,
                nodeId: node.id,
                task,
                output: task.outputs![0]!,
                effectKey,
                nodesRef: {
                    get current() {
                        return visibleNodes;
                    },
                    set current(value) {
                        visibleNodes = value;
                    },
                },
                setNodes: (value) => {
                    visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
                },
            });

            expect(generationCommitted).toBe(true);
            expect(visibleNodes[0]?.title).toBe("newer ordinary node edit");
            expect(visibleNodes[0]?.position).toEqual({ x: 88, y: 44 });
            expect(visibleNodes[0]?.metadata?.ordinaryNote).toBe("newer");
            expect(generationEffectApplied(visibleNodes[0]?.metadata || {}, effectKey)).toBe(true);
            expect((JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } }).state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toContain(effectKey);

            await flushCanvasStorePersistence();
            const retried = JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            expect(retried.state.projects[0]?.nodes[0]?.title).toBe("newer ordinary node edit");
            expect(retried.state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toContain(effectKey);
        } finally {
            failOrdinaryWrite = false;
            setActiveUserScope(previousScope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            useAssetStore.getState().replaceAssets(previousAssets);
            await flushAssetStorePersistence();
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("Canvas Agent continuation keeps a newer mounted ordinary edit when the post-commit ordinary flush fails", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const previousScope = getActiveUserScope();
        const previousProjects = useCanvasStore.getState().projects;
        const scope = "canvas-agent-post-commit-mounted-edit";
        const storageKey = `infinite-canvas:canvas_store:user:${scope}`;
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

        const effectKey = "agent-resume:backend-agent-post-commit:continuation-post-commit";
        const continuation = { id: "continuation-post-commit", taskId: "backend-agent-post-commit", status: "completed" as const, effectKey };
        const node: CanvasNodeData = {
            id: "node-agent-post-commit",
            type: CanvasNodeType.Text,
            title: "agent base",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { content: "base", agentGenerationContinuation: { id: continuation.id, taskId: continuation.taskId, status: "pending" } },
        };
        const project = {
            id: "canvas-agent-post-commit-mounted-edit",
            title: "canvas",
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            nodes: [node],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "dots" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        let visibleNodes = [node];
        let generationCommitted = false;
        let failOrdinaryWrite = true;
        localforage.getItem = (async (key: string) => values.get(key) ?? null) as typeof localforage.getItem;
        localforage.setItem = (async (key: string, value: string) => {
            if (key === storageKey && !generationCommitted && value.includes(effectKey)) {
                values.set(key, value);
                generationCommitted = true;
                const committed = JSON.parse(value) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
                const committedNode = committed.state.projects[0]!.nodes[0]!;
                visibleNodes = [{ ...committedNode, title: "newer ordinary agent edit", position: { x: 55, y: 66 }, metadata: { ...committedNode.metadata, ordinaryNote: "newer-agent" } }];
                useCanvasStore.getState().updateProject(project.id, { nodes: visibleNodes });
                return value;
            }
            if (key === storageKey && generationCommitted && failOrdinaryWrite) {
                failOrdinaryWrite = false;
                throw new Error("post-commit ordinary agent flush failed");
            }
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        try {
            setActiveUserScope(scope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
            values.set(storageKey, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 1, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} } }));

            await persistCanvasAgentGenerationContinuationEffect({
                projectId: project.id,
                nodeId: node.id,
                continuation,
                effectKey,
                previousNodes: [node],
                nodesRef: {
                    get current() {
                        return visibleNodes;
                    },
                    set current(value) {
                        visibleNodes = value;
                    },
                },
                setNodes: (value) => {
                    visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
                },
            });

            expect(generationCommitted).toBe(true);
            expect(visibleNodes[0]?.title).toBe("newer ordinary agent edit");
            expect(visibleNodes[0]?.position).toEqual({ x: 55, y: 66 });
            expect(visibleNodes[0]?.metadata?.ordinaryNote).toBe("newer-agent");
            expect(visibleNodes[0]?.metadata?.agentGenerationContinuation).toMatchObject({ status: "completed", effectKey });
            expect(generationEffectApplied(visibleNodes[0]?.metadata || {}, effectKey)).toBe(true);

            await flushCanvasStorePersistence();
            const retried = JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            expect(retried.state.projects[0]?.nodes[0]?.title).toBe("newer ordinary agent edit");
            expect(retried.state.projects[0]?.nodes[0]?.metadata?.generationEffectKeys).toContain(effectKey);
        } finally {
            failOrdinaryWrite = false;
            setActiveUserScope(previousScope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("Canvas agent continuation waits for its async completion callback before completing the effect", async () => {
        const task: GenerationTask = {
            id: "backend-agent-callback-ack",
            provider: "remote-cinematic-provider",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const continuation = {
            id: "continuation-callback-ack",
            taskId: task.id,
            status: "pending" as const,
        };
        let completeCalls = 0;
        const baseEffects = createEffectStore();
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effectKey, taskId, result) {
                completeCalls += 1;
                await baseEffects.complete(effectKey, taskId, result);
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("no outputs");
            },
        });
        let callbackStartedResolve!: () => void;
        const callbackStarted = new Promise<void>((resolve) => {
            callbackStartedResolve = resolve;
        });
        let releaseCallback!: () => void;
        const callbackGate = new Promise<void>((resolve) => {
            releaseCallback = resolve;
        });

        const run = consumeCanvasAgentGenerationContinuation(
            task,
            continuation,
            async () => {
                callbackStartedResolve();
                await callbackGate;
            },
            {
                consumeAgent: ((input, continuationId, consumer) => materializer.resumeAgent(input, continuationId, consumer)) as typeof consumeGenerationTaskAgent,
            },
        );

        await callbackStarted;
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(completeCalls).toBe(0);
        releaseCallback();
        await run;
        expect(completeCalls).toBe(1);
    });

    test("production Canvas agent continuation is durably completed before the materializer acknowledges the effect", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const previousScope = getActiveUserScope();
        const previousProjects = useCanvasStore.getState().projects;
        const values = new Map<string, string>();
        const localStorageValues = new Map<string, string>();
        let failDedicatedWrite = false;
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
            if (failDedicatedWrite && key.includes("infinite-canvas:canvas_store") && value.includes("agent-resume:backend-agent-production-durable:continuation-agent-production-durable")) {
                throw new Error("continuation durable write failed");
            }
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        const scope = "canvas-agent-production-durable";
        const storageKey = `infinite-canvas:canvas_store:user:${scope}`;
        const projectId = "canvas-agent-production-durable";
        const nodeId = "node-agent-production-durable";
        const task: GenerationTask = {
            id: "backend-agent-production-durable",
            provider: "remote-cinematic-provider",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const continuation = {
            id: "continuation-agent-production-durable",
            taskId: task.id,
            status: "pending" as const,
        };
        const pendingNode: CanvasNodeData = {
            id: nodeId,
            type: CanvasNodeType.Text,
            title: "agent node",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { content: "base", agentGenerationContinuation: continuation },
        };
        const project = {
            id: projectId,
            title: "canvas",
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
            nodes: [pendingNode],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "dots" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        let completeCalls = 0;
        const baseEffects = createEffectStore();
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effectKey, taskId, result) {
                completeCalls += 1;
                await baseEffects.complete(effectKey, taskId, result);
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("no outputs");
            },
        });
        const nodesRef = { current: [pendingNode] };
        let completionCallbacks = 0;
        const consume = () =>
            consumeCanvasAgentGenerationContinuation(
                task,
                continuation,
                (nextContinuation) => {
                    completionCallbacks += 1;
                    const nextNodes = nodesRef.current.map((node) =>
                        node.id === nodeId
                            ? {
                                  ...node,
                                  metadata: {
                                      ...node.metadata,
                                      agentGenerationContinuation: nextContinuation,
                                      ...(nextContinuation.effectKey ? { generationEffectKeys: [nextContinuation.effectKey] } : {}),
                                  },
                              }
                            : node,
                    );
                    nodesRef.current = nextNodes;
                    useCanvasStore.getState().updateProject(projectId, { nodes: nextNodes });
                },
                {
                    consumeAgent: ((input, continuationId, consumer) => materializer.resumeAgent(input, continuationId, consumer)) as typeof consumeGenerationTaskAgent,
                    projectId,
                    nodeId,
                    nodesRef,
                    setNodes: (value: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => {
                        nodesRef.current = typeof value === "function" ? value(nodesRef.current) : value;
                    },
                } as never,
            );

        try {
            setActiveUserScope(scope);
            useCanvasStore.setState({ projects: [project] });
            await flushCanvasStorePersistence();

            failDedicatedWrite = true;
            await expect(consume()).rejects.toThrow("continuation durable write failed");
            expect(completeCalls).toBe(0);
            expect(completionCallbacks).toBe(0);
            expect((JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } }).state.projects[0]?.nodes[0]?.metadata?.agentGenerationContinuation?.status).toBe("pending");

            failDedicatedWrite = false;
            await consume();
            await flushCanvasStorePersistence();
            await consume();
            await consume();

            const effectKey = `agent-resume:${task.id}:${continuation.id}`;
            const durable = JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            const durableNode = durable.state.projects[0]?.nodes[0];
            const liveNode = useCanvasStore.getState().projects[0]?.nodes[0];
            expect(completeCalls).toBe(1);
            expect(completionCallbacks).toBe(1);
            expect(durableNode?.metadata?.agentGenerationContinuation).toMatchObject({ status: "completed", effectKey });
            expect(durableNode?.metadata?.generationEffectKeys).toEqual([effectKey]);
            expect(liveNode?.metadata?.agentGenerationContinuation).toMatchObject({ status: "completed", effectKey });
        } finally {
            setActiveUserScope(previousScope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("refresh recovery keeps a failed local Canvas ack retryable and durably preserves storyboard plus continuation on replay", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const previousProjects = useCanvasStore.getState().projects;
        const previousScope = getActiveUserScope();
        const scope = "canvas-refresh-storyboard-ack-retry";
        const storageKey = `infinite-canvas:canvas_store:user:${scope}`;
        const values = new Map<string, string>();
        const localStorageValues = new Map<string, string>();
        let failCanvasWrite = false;
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
            if (key === storageKey && failCanvasWrite) throw new Error("canvas continuation durable ack failed");
            values.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        const task: GenerationTask = {
            id: "backend-refresh-storyboard-ack-retry",
            projectId: "canvas-refresh-storyboard-ack-retry",
            provider: "remote-cinematic-provider",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultJson: JSON.stringify({ title: "Recovered storyboard", rows: [{ plotDescription: "Recovered shot", dialogue: "Hello" }] }),
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:01:00.000Z",
        };
        const continuation = { id: "continuation-refresh-storyboard-ack-retry", taskId: task.id, status: "pending" as const };
        const pendingNode: CanvasNodeData = {
            id: "node-refresh-storyboard-ack-retry",
            type: CanvasNodeType.Script,
            title: "Script",
            position: { x: 0, y: 0 },
            width: 640,
            height: 480,
            metadata: { status: "loading", taskId: task.id, agentGenerationContinuation: continuation },
        };
        const project = {
            id: task.projectId!,
            title: "canvas",
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
            nodes: [pendingNode],
            connections: [],
            chatSessions: [],
            activeChatId: null,
            backgroundMode: "dots" as const,
            showImageInfo: false,
            viewport: { x: 0, y: 0, k: 1 },
            directorScenes: [],
        };
        const baseEffects = createEffectStore();
        let completeCalls = 0;
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effectKey, taskId, result, binding) {
                completeCalls += 1;
                await baseEffects.complete(effectKey, taskId, result, binding);
            },
        };
        const materializer = createGenerationTaskMaterializer({ effects, materializeOutput: async () => ({}) });
        let visibleNodes = [pendingNode];
        const nodesRef = { current: [pendingNode] };
        const setNodes = (value: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => {
            visibleNodes = typeof value === "function" ? value(visibleNodes) : value;
        };
        const consumeContinuation = (
            inputTask: GenerationTask,
            inputContinuation: typeof continuation,
            onCompleted: (next: typeof continuation & { effectKey?: string }, signal?: AbortSignal) => Promise<void> | void,
            dependencies: Parameters<typeof consumeCanvasAgentGenerationContinuation>[3],
            signal?: AbortSignal,
        ) =>
            consumeCanvasAgentGenerationContinuation(
                inputTask,
                inputContinuation,
                onCompleted as Parameters<typeof consumeCanvasAgentGenerationContinuation>[2],
                {
                    ...dependencies,
                    consumeAgent: ((materialized, continuationId, consumer) => materializer.resumeAgent(materialized, continuationId, consumer)) as NonNullable<Parameters<typeof consumeCanvasAgentGenerationContinuation>[3]>["consumeAgent"],
                },
                signal,
            );
        const recover = () =>
            recoverCanvasGenerationTaskNode({
                projectId: project.id,
                node: pendingNode,
                completed: task,
                continuationOnly: false,
                nodesRef,
                setNodes: setNodes as never,
                applyGenerationTaskResult: async () => undefined,
                signal: new AbortController().signal,
                consumeContinuation: consumeContinuation as never,
            });

        try {
            setActiveUserScope(scope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [project] }));
            values.set(storageKey, JSON.stringify({ state: { projects: [project] }, version: 0, storageRevision: 1, tombstones: { projects: {}, nodes: {}, connections: {}, sessions: {}, messages: {} } }));

            failCanvasWrite = true;
            await recover();
            expect(completeCalls).toBe(0);
            expect(visibleNodes[0]?.metadata?.storyboard?.rows).toHaveLength(1);
            expect(visibleNodes[0]?.metadata?.agentGenerationContinuation?.status).toBe("pending");
            expect(nodesRef.current[0]?.metadata?.storyboard?.rows).toHaveLength(1);
            expect(nodesRef.current[0]?.metadata?.agentGenerationContinuation?.status).toBe("pending");

            failCanvasWrite = false;
            await recover();
            await recover();
            await recover();
            const effectKey = `agent-resume:${task.id}:${continuation.id}`;
            const durable = JSON.parse(values.get(storageKey)!) as { state: { projects: Array<{ nodes: CanvasNodeData[] }> } };
            const durableNode = durable.state.projects[0]?.nodes[0];
            expect(completeCalls).toBe(1);
            expect(durableNode?.metadata?.storyboard?.rows).toHaveLength(1);
            expect(durableNode?.metadata?.storyboard?.rows[0]?.plotDescription).toBe("Recovered shot");
            expect(durableNode?.metadata?.agentGenerationContinuation).toMatchObject({ status: "completed", effectKey });
            expect(durableNode?.metadata?.generationEffectKeys).toEqual([effectKey]);
            expect(visibleNodes[0]?.metadata?.storyboard?.rows[0]?.plotDescription).toBe("Recovered shot");
            expect(visibleNodes[0]?.metadata?.agentGenerationContinuation).toMatchObject({ status: "completed", effectKey });
        } finally {
            failCanvasWrite = false;
            setActiveUserScope(previousScope);
            withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: previousProjects }));
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("agent continuation acknowledgement waits for the durable stamped Canvas snapshot", async () => {
        const originalWindow = (globalThis as { window?: unknown }).window;
        const originalGetItem = localforage.getItem.bind(localforage);
        const originalSetItem = localforage.setItem.bind(localforage);
        const indexedValues = new Map<string, string>();
        const persistedPayloads: string[] = [];
        let releasePersistence!: () => void;
        const persistenceGate = new Promise<void>((resolve) => {
            releasePersistence = resolve;
        });
        let persistenceStartedResolve!: () => void;
        const persistenceStarted = new Promise<void>((resolve) => {
            persistenceStartedResolve = resolve;
        });
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
            if (key.includes("infinite-canvas:canvas_store")) {
                persistedPayloads.push(value);
                persistenceStartedResolve();
                await persistenceGate;
            }
            indexedValues.set(key, value);
            return value;
        }) as typeof localforage.setItem;

        const previousProjects = useCanvasStore.getState().projects;
        const session = {
            id: "session-agent-durable",
            title: "agent",
            messages: [],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        useCanvasStore.setState({
            projects: [
                {
                    id: "canvas-agent-durable",
                    title: "canvas",
                    createdAt: "2026-08-13T00:00:00.000Z",
                    updatedAt: "2026-08-13T00:00:00.000Z",
                    nodes: [],
                    connections: [],
                    chatSessions: [session],
                    activeChatId: session.id,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    viewport: { x: 0, y: 0, k: 1 },
                    directorScenes: [],
                },
            ],
        });
        const task: GenerationTask = {
            id: "backend-agent-durable",
            provider: "remote-cinematic-provider",
            type: "agent_storyboard_rows",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        let completeCalls = 0;
        let completeResolve!: () => void;
        const completed = new Promise<void>((resolve) => {
            completeResolve = resolve;
        });
        const baseEffects = createEffectStore();
        const effects: GenerationTaskEffectStore = {
            ...baseEffects,
            async complete(effectKey, taskId, result) {
                completeCalls += 1;
                await baseEffects.complete(effectKey, taskId, result);
                completeResolve();
            },
        };
        const materializer = createGenerationTaskMaterializer({
            effects,
            async materializeOutput() {
                throw new Error("no outputs");
            },
        });
        const effectKey = `agent-resume:${task.id}:continuation-agent-durable`;
        let sideEffects = 0;

        const consume = () =>
            materializer.resumeAgent(task, "continuation-agent-durable", async () => {
                const current = useCanvasStore.getState().projects.find((project) => project.id === "canvas-agent-durable")!;
                const currentSession = current.chatSessions[0]!;
                if (generationEffectApplied(currentSession, effectKey)) return;
                sideEffects += 1;
                const durableSession = applyGenerationConsumerEffect(currentSession, effectKey, (value) => value).value;
                const node: CanvasNodeData = {
                    id: "agent-created-node",
                    type: CanvasNodeType.Text,
                    title: "agent result",
                    position: { x: 0, y: 0 },
                    width: 320,
                    height: 180,
                    metadata: { content: "durable" },
                };
                await persistCanvasGenerationEffect({
                    projectId: current.id,
                    effectKey,
                    previousNodes: current.nodes,
                    nodes: [...current.nodes, node],
                    previousConnections: current.connections,
                    connections: current.connections,
                    previousChatSessions: current.chatSessions,
                    chatSessions: [durableSession],
                    previousActiveChatId: current.activeChatId,
                    activeChatId: currentSession.id,
                });
            });

        try {
            const run = consume();
            expect(await Promise.race([persistenceStarted.then(() => "persistence"), completed.then(() => "complete")])).toBe("persistence");
            expect(completeCalls).toBe(0);
            releasePersistence();
            await run;
            expect(completeCalls).toBe(1);
            const persisted = JSON.parse(persistedPayloads.at(-1)!) as { state: { projects: typeof previousProjects } };
            useCanvasStore.setState({ projects: persisted.state.projects });
            await consume();
            await consume();
            await consume();
            const restarted = useCanvasStore.getState().projects[0]!;
            expect(sideEffects).toBe(1);
            expect(restarted.nodes.filter((node) => node.id === "agent-created-node")).toHaveLength(1);
            expect(restarted.chatSessions[0]?.generationEffectKeys).toEqual([effectKey]);
        } finally {
            releasePersistence();
            withCanvasStorePersistenceSuppressed(() => {
                useCanvasStore.setState({ projects: previousProjects });
            });
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
        }
    });

    test("production consumer adapters preserve deterministic effect keys", async () => {
        const task: GenerationTask = {
            id: "task-production-effect-key",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stable-id" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const seen: string[] = [];

        await consumeGenerationTaskNode(
            task,
            "node-safe-id",
            0,
            async ({ effectKey }) => {
                seen.push(effectKey);
            },
            {
                materialize: async (input) => input,
                attachNode: async (input, _nodeId, _outputIndex, consumer) => {
                    await consumer({ task: input, output: input.outputs?.[0], effectKey: "attach-node:task-production-effect-key:node-safe-id:0" });
                    return "applied";
                },
            },
        );
        await consumeGenerationTaskMessage(
            task,
            "message-safe-id",
            async ({ effectKey }) => {
                seen.push(effectKey);
            },
            {
                materialize: async (input) => input,
                materializedUrls: () => ["opaque://materialized"],
                attachMessage: async (input, _messageId, _outputIndex, consumer) => {
                    await consumer({ task: input, output: input.outputs?.[0], effectKey: "attach-message:task-production-effect-key:message-safe-id:0" });
                    return "applied";
                },
            },
        );
        await consumeGenerationTaskAgent(
            task,
            "continuation-safe-id",
            async ({ effectKey }) => {
                seen.push(effectKey);
            },
            {
                resumeAgent: async (input, _continuationId, consumer) => {
                    await consumer({ task: input, effectKey: "agent-resume:task-production-effect-key:continuation-safe-id" });
                    return "applied";
                },
            },
        );

        expect(seen).toEqual(["attach-node:task-production-effect-key:node-safe-id:0", "attach-message:task-production-effect-key:message-safe-id:0", "agent-resume:task-production-effect-key:continuation-safe-id"]);
    });

    test("production consumer adapters forward one abort signal through materialization and attachment", async () => {
        const task: GenerationTask = {
            id: "task-production-abort-signal",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stable-id" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };
        const controller = new AbortController();
        const seen: Array<AbortSignal | undefined> = [];

        await consumeGenerationTaskNode(task, "node-abort", 0, async () => {}, {
            signal: controller.signal,
            materialize: async (input, signal) => {
                seen.push(signal);
                return input;
            },
            attachNode: async (input, _nodeId, _outputIndex, consumer, signal) => {
                seen.push(signal);
                await consumer({ task: input, output: input.outputs?.[0], effectKey: "attach-node:abort" });
                return "applied";
            },
        });
        await consumeGenerationTaskMessage(task, "message-abort", async () => {}, {
            signal: controller.signal,
            materialize: async (input, signal) => {
                seen.push(signal);
                return input;
            },
            materializedUrls: () => ["opaque://materialized"],
            attachMessage: async (input, _messageId, _outputIndex, consumer, signal) => {
                seen.push(signal);
                await consumer({ task: input, output: input.outputs?.[0], effectKey: "attach-message:abort" });
                return "applied";
            },
        });
        await consumeGenerationTaskAgent(task, "agent-abort", async () => {}, {
            signal: controller.signal,
            materialize: async (input, signal) => {
                seen.push(signal);
                return input;
            },
            resumeAgent: async (input, _continuationId, consumer, signal) => {
                seen.push(signal);
                await consumer({ task: input, effectKey: "agent-resume:abort" });
                return "applied";
            },
        });

        expect(seen).toHaveLength(6);
        expect(seen.every((signal) => signal instanceof AbortSignal)).toBe(true);
        expect(seen[0]).toBe(seen[1]);
        expect(seen[2]).toBe(seen[3]);
        expect(seen[4]).toBe(seen[5]);
    });

    test("production node consumer receives the attachment lease signal", async () => {
        const task: GenerationTask = {
            id: "task-production-lease-signal",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "READY",
            outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-production-lease-signal" }],
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        };
        const parentController = new AbortController();
        const leaseController = new AbortController();
        let consumerSignal: AbortSignal | undefined;

        await consumeGenerationTaskNode(
            task,
            "node-production-lease-signal",
            0,
            async ({ signal }) => {
                consumerSignal = signal;
            },
            {
                signal: parentController.signal,
                materialize: async (input) => input,
                attachNode: async (input, _nodeId, _outputIndex, consumer) => {
                    await consumer({ task: input, output: input.outputs?.[0], effectKey: "attach-node:production-lease-signal", signal: leaseController.signal });
                    return "applied";
                },
            },
        );

        expect(consumerSignal).toBe(leaseController.signal);
        expect(consumerSignal).not.toBe(parentController.signal);
    });

    test("Canvas asset sync freezes its account key and is aborted by account lifecycle cleanup", async () => {
        const source = await Bun.file(new URL("../src/services/project-asset-sync.ts", import.meta.url)).text();
        expect(source).toContain("const scope = getActiveUserScope();");
        expect(source).toContain("const key = [scope,");
        expect(source).toContain("runGenerationConsumer(options.signal");
        expect(source.match(/readImageMeta\(url, signal\)/g)).toHaveLength(2);
    });

    test("generic task materialization never treats a local Canvas id as a backend project id", async () => {
        const source = await Bun.file(new URL("../src/services/project-asset-sync.ts", import.meta.url)).text();
        expect(source).not.toContain("if (input.task.projectId) await syncAssetToProject(assetId, input.task.projectId");
        expect(source).toContain("if (!options.domainProjectId) {");
        expect(source).toContain("linkedToProject: false");
        expect(source).toContain("await syncAssetToProject(asset.id, options.domainProjectId");
    });

    test("production materialization forwards parent abort into its lease-owned output sink", async () => {
        const controller = new AbortController();
        let sinkSignal: AbortSignal | undefined;
        let sinkStartedResolve!: () => void;
        const sinkStarted = new Promise<void>((resolve) => {
            sinkStartedResolve = resolve;
        });
        const materializer = createGenerationTaskMaterializer({
            effects: createEffectStore(),
            async materializeOutput(input) {
                sinkSignal = input.signal;
                sinkStartedResolve();
                await new Promise<void>((resolve) => input.signal?.addEventListener("abort", () => resolve(), { once: true }));
                throw new DOMException("The operation was aborted", "AbortError");
            },
        });
        const task: GenerationTask = {
            id: "task-materialize-signal",
            type: "image",
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            outputs: [{ outputIndex: 0, mediaType: "image" }],
            createdAt: "2026-08-13T00:00:00.000Z",
            updatedAt: "2026-08-13T00:00:00.000Z",
        };

        const materializing = materializer.materialize(task, controller.signal);
        await sinkStarted;
        expect(sinkSignal).toBeDefined();
        expect(sinkSignal).not.toBe(controller.signal);
        controller.abort();
        await expect(materializing).rejects.toMatchObject({ name: "AbortError" });
        expect(sinkSignal?.aborted).toBe(true);
    });
});
