import localforage from "localforage";

import { getActiveUserScope, setActiveUserScope } from "../../src/lib/user-scope";

type InstanceHook = (storeName: string, key: string, value: unknown) => Promise<void> | void;

type Scenario = "image-cleanup" | "scope-cleanup-switch" | "scope-cleanup-late-canvas-reference" | "video-commit-race" | "audio-commit-race";

function installStorageHarness() {
    const originalCreateInstance = localforage.createInstance.bind(localforage);
    const originalGetItem = localforage.getItem.bind(localforage);
    const originalSetItem = localforage.setItem.bind(localforage);
    const originalRemoveItem = localforage.removeItem.bind(localforage);
    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    const originalDocument = (globalThis as { document?: unknown }).document;
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);

    const defaultValues = new Map<string, unknown>();
    const instanceValues = new Map<string, Map<string, unknown>>();
    const localStorageValues = new Map<string, string>();
    const scheduled: Promise<void>[] = [];
    const hooks: { onSet?: InstanceHook } = {};
    const lockTails = new Map<string, Promise<void>>();

    const storeValues = (storeName: string) => {
        let values = instanceValues.get(storeName);
        if (!values) {
            values = new Map<string, unknown>();
            instanceValues.set(storeName, values);
        }
        return values;
    };

    localforage.getItem = (async (key: string) => defaultValues.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        defaultValues.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = (async (key: string) => {
        defaultValues.delete(key);
    }) as typeof localforage.removeItem;
    localforage.createInstance = ((options: { storeName?: string }) => {
        const storeName = options.storeName || "default";
        const values = storeValues(storeName);
        return {
            getItem: async (key: string) => values.get(key) ?? null,
            setItem: async (key: string, value: unknown) => {
                values.set(key, value);
                await hooks.onSet?.(storeName, key, value);
                return value;
            },
            removeItem: async (key: string) => {
                values.delete(key);
            },
            iterate: async (iterator: (value: unknown, key: string, iterationNumber: number) => unknown) => {
                let index = 1;
                for (const [key, value] of values) {
                    const result = iterator(value, key, index);
                    index += 1;
                    if (result !== undefined) return result;
                }
                return undefined;
            },
            clear: async () => values.clear(),
            keys: async () => [...values.keys()],
            length: async () => values.size,
        } as never;
    }) as typeof localforage.createInstance;

    Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: {
            localStorage: {
                getItem: (key: string) => localStorageValues.get(key) ?? null,
                setItem: (key: string, value: string) => localStorageValues.set(key, value),
                removeItem: (key: string) => localStorageValues.delete(key),
            },
            setTimeout: (handler: () => unknown, delay = 0) => {
                const scheduledRun = new Promise<void>((resolve, reject) => {
                    realSetTimeout(() => {
                        Promise.resolve(handler()).then(() => resolve(), reject);
                    }, delay);
                });
                scheduled.push(scheduledRun);
                return scheduled.length;
            },
            clearTimeout: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        },
    });
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        writable: true,
        value: {
            locks: {
                request: async <T>(name: string, callback: () => Promise<T>) => {
                    const previous = lockTails.get(name) ?? Promise.resolve();
                    let release!: () => void;
                    const tail = new Promise<void>((resolve) => {
                        release = resolve;
                    });
                    const queued = previous.catch(() => undefined).then(() => tail);
                    lockTails.set(name, queued);
                    await previous.catch(() => undefined);
                    try {
                        return await callback();
                    } finally {
                        release();
                        if (lockTails.get(name) === queued) lockTails.delete(name);
                    }
                },
            },
        },
    });
    delete (globalThis as { document?: unknown }).document;

    return {
        hooks,
        scheduled,
        realSetTimeout,
        restore() {
            localforage.createInstance = originalCreateInstance as typeof localforage.createInstance;
            localforage.getItem = originalGetItem;
            localforage.setItem = originalSetItem;
            localforage.removeItem = originalRemoveItem;
            if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
            else Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: originalWindow });
            if (originalNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
            else Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: originalNavigator });
            if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
            else Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: originalDocument });
        },
    };
}

async function runImageCleanup() {
    const previousScope = getActiveUserScope();
    const harness = installStorageHarness();
    const scope = "generation-image-cleanup";
    const usedKey = `generation-image:${scope}:used`;
    const unusedKey = `generation-image:${scope}:unused`;
    const imageStorage = await import("../../src/services/image-storage.ts?generation-image-cleanup-contract-worker");

    try {
        setActiveUserScope(scope);
        await imageStorage.setImageBlob(usedKey, new Blob(["used"], { type: "image/png" }));
        await imageStorage.setImageBlob(unusedKey, new Blob(["unused"], { type: "image/png" }));
        await imageStorage.cleanupUnusedImages({ assets: [{ data: { storageKey: usedKey } }] });
        return {
            usedPresent: (await imageStorage.getImageBlob(usedKey)) instanceof Blob,
            unusedPresent: (await imageStorage.getImageBlob(unusedKey)) instanceof Blob,
        };
    } finally {
        setActiveUserScope(previousScope);
        harness.restore();
    }
}

async function runScopeCleanupAfterSwitch() {
    const previousScope = getActiveUserScope();
    const harness = installStorageHarness();
    const scopeA = "cleanup-account-a";
    const scopeB = "cleanup-account-b";
    const referencedKey = `image:${scopeA}:canvas-only`;
    const unusedKey = `image:${scopeA}:unused`;
    const otherScopeKey = `image:${scopeB}:unrelated`;

    try {
        setActiveUserScope(scopeA);
        const imageStorage = await import("../../src/services/image-storage.ts?scope-cleanup-switch-worker");
        const { useAssetStore } = await import("../../src/stores/use-asset-store");
        const { useCanvasStore } = await import("../../src/stores/canvas/use-canvas-store");
        await imageStorage.setImageBlob(referencedKey, new Blob(["account-a-referenced"], { type: "image/png" }));
        await imageStorage.setImageBlob(unusedKey, new Blob(["account-a-unused"], { type: "image/png" }));
        await imageStorage.setImageBlob(otherScopeKey, new Blob(["account-b-unrelated"], { type: "image/png" }));
        useAssetStore.setState({ assets: [] });
        useCanvasStore.setState({
            projects: [
                {
                    id: "canvas-account-a",
                    title: "account A",
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                    nodes: [
                        {
                            id: "node-account-a-image",
                            type: "image",
                            title: "account A image",
                            position: { x: 0, y: 0 },
                            width: 1,
                            height: 1,
                            metadata: { storageKey: referencedKey },
                        },
                    ],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    viewport: { x: 0, y: 0, k: 1 },
                    directorScenes: [],
                },
            ],
        } as never);

        useAssetStore.getState().cleanupImages({ assets: [] });
        const cleanupRun = harness.scheduled.at(-1);
        if (!cleanupRun) throw new Error("cleanup was not scheduled");

        setActiveUserScope(scopeB);
        useAssetStore.setState({ assets: [] });
        useCanvasStore.setState({
            projects: [
                {
                    id: "canvas-account-b",
                    title: "account B",
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
                },
            ],
        } as never);
        await cleanupRun;

        return {
            referencedPresent: (await imageStorage.getImageBlob(referencedKey)) instanceof Blob,
            unusedPresent: (await imageStorage.getImageBlob(unusedKey)) instanceof Blob,
            otherScopePresent: (await imageStorage.getImageBlob(otherScopeKey)) instanceof Blob,
        };
    } finally {
        setActiveUserScope(previousScope);
        harness.restore();
    }
}

async function runScopeCleanupAfterLateCanvasReference() {
    const previousScope = getActiveUserScope();
    const harness = installStorageHarness();
    const scope = "cleanup-late-canvas-reference";
    const referencedKey = `image:${scope}:late-canvas-only`;
    const unusedKey = `image:${scope}:unused`;

    try {
        setActiveUserScope(scope);
        const imageStorage = await import("../../src/services/image-storage.ts?scope-cleanup-late-canvas-reference-worker");
        const { useAssetStore } = await import("../../src/stores/use-asset-store");
        const { useCanvasStore } = await import("../../src/stores/canvas/use-canvas-store");
        await imageStorage.setImageBlob(referencedKey, new Blob(["late-canvas-reference"], { type: "image/png" }));
        await imageStorage.setImageBlob(unusedKey, new Blob(["still-unused"], { type: "image/png" }));
        useAssetStore.setState({ assets: [] });
        useCanvasStore.setState({ projects: [] });

        useAssetStore.getState().cleanupImages({ assets: [] });
        const cleanupRun = harness.scheduled.at(-1);
        if (!cleanupRun) throw new Error("cleanup was not scheduled");

        useCanvasStore.setState({
            projects: [
                {
                    id: "canvas-late-reference",
                    title: "late reference",
                    createdAt: "2026-08-14T00:00:00.000Z",
                    updatedAt: "2026-08-14T00:00:00.000Z",
                    nodes: [
                        {
                            id: "node-late-reference",
                            type: "image",
                            title: "late referenced image",
                            position: { x: 0, y: 0 },
                            width: 1,
                            height: 1,
                            metadata: { storageKey: referencedKey },
                        },
                    ],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "dots",
                    showImageInfo: false,
                    viewport: { x: 0, y: 0, k: 1 },
                    directorScenes: [],
                },
            ],
        } as never);

        await cleanupRun;

        return {
            referencedPresent: (await imageStorage.getImageBlob(referencedKey)) instanceof Blob,
            unusedPresent: (await imageStorage.getImageBlob(unusedKey)) instanceof Blob,
        };
    } finally {
        setActiveUserScope(previousScope);
        harness.restore();
    }
}

async function runMediaCommitRace(mediaType: "video" | "audio") {
    const previousScope = getActiveUserScope();
    const harness = installStorageHarness();
    const scope = `generation-media-commit-race-${mediaType}`;
    let releaseMediaWrite!: () => void;
    const mediaWriteGate = new Promise<void>((resolve) => {
        releaseMediaWrite = resolve;
    });
    let mediaWriteStartedResolve!: () => void;
    const mediaWriteStarted = new Promise<void>((resolve) => {
        mediaWriteStartedResolve = resolve;
    });
    let blocked = false;
    harness.hooks.onSet = async (storeName, key) => {
        if (!blocked && storeName === "media_files" && key.startsWith(`generation-${mediaType}:${scope}:`)) {
            blocked = true;
            mediaWriteStartedResolve();
            await mediaWriteGate;
        }
    };

    try {
        setActiveUserScope(scope);
        const { materializeGenerationTaskAssets } = await import("../../src/services/project-asset-sync.ts?generation-media-commit-race-worker");
        const { useAssetStore } = await import("../../src/stores/use-asset-store");
        await import("../../src/stores/canvas/use-canvas-store");
        const fileStorage = await import("../../src/services/file-storage");
        const task = {
            id: `remote-generation-media-race-${mediaType}`,
            provider: "remote-test-provider",
            type: mediaType,
            status: "succeeded",
            prompt: "redacted",
            attempts: 1,
            resultState: "PENDING_MATERIALIZATION",
            resultJson: JSON.stringify(
                mediaType === "video"
                    ? {
                          mode: "video",
                          video: {
                              dataUrl: "data:video/mp4;base64,AAAA",
                              width: 16,
                              height: 9,
                              mimeType: "video/mp4",
                          },
                      }
                    : {
                          mode: "audio",
                          audio: {
                              dataUrl: "data:audio/mpeg;base64,AAAA",
                              mimeType: "audio/mpeg",
                          },
                      },
            ),
            createdAt: "2026-08-14T00:00:00.000Z",
            updatedAt: "2026-08-14T00:00:00.000Z",
        } as const;

        const materializing = materializeGenerationTaskAssets(task as never);
        await mediaWriteStarted;
        useAssetStore.getState().cleanupImages({ assets: [] });
        const cleanupRun = harness.scheduled.at(-1);
        if (!cleanupRun) throw new Error("cleanup was not scheduled");
        await Promise.race([
            cleanupRun,
            new Promise<void>((resolve) => {
                harness.realSetTimeout(resolve, 20);
            }),
        ]);

        releaseMediaWrite();
        const materialized = await materializing;
        await cleanupRun;

        const assetId = materialized.outputs?.[0]?.materializedAssetId;
        const asset = useAssetStore.getState().assets.find((candidate) => candidate.id === assetId);
        const storageKey = asset?.kind === "video" || asset?.kind === "audio" ? asset.data.storageKey : undefined;
        const blobPresent = storageKey ? (await fileStorage.getMediaBlob(storageKey)) instanceof Blob : false;
        const generationAssetCount = useAssetStore.getState().assets.filter((candidate) => candidate.metadata?.generationEffectKey === `materialize:${task.id}:0`).length;
        return { kind: asset?.kind, storageKey, blobPresent, generationAssetCount };
    } finally {
        releaseMediaWrite();
        setActiveUserScope(previousScope);
        harness.restore();
    }
}

self.onmessage = async (event: MessageEvent<Scenario>) => {
    try {
        const result =
            event.data === "image-cleanup"
                ? await runImageCleanup()
                : event.data === "scope-cleanup-switch"
                  ? await runScopeCleanupAfterSwitch()
                  : event.data === "scope-cleanup-late-canvas-reference"
                    ? await runScopeCleanupAfterLateCanvasReference()
                    : await runMediaCommitRace(event.data === "audio-commit-race" ? "audio" : "video");
        self.postMessage({ ok: true, result });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
};
