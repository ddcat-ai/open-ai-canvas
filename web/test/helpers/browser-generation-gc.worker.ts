import localforage from "localforage";
import axios from "axios";

type Kind = "image" | "video" | "audio";
type Scenario = "retention" | "write-race" | "gc-race" | "lifecycle" | "failure" | "scope" | "commit-failure";
const scope = "guest";
const artifactLock = `yingce:generation-artifact-commit-lock:${scope}`;
function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

async function run(scenario: Scenario) {
    const databases = new Map<string, Map<string, unknown>>();
    const hooks: {
        beforeSet?: (store: string, key: string, value: unknown) => Promise<void> | void;
        set?: (store: string, key: string, value: unknown) => Promise<void> | void;
        iterate?: (store: string) => Promise<void> | void;
    } = {};
    const values = (instance: LocalForage) => {
        const config = instance.config();
        const name = `${config.name}/${config.storeName}`;
        if (!databases.has(name)) databases.set(name, new Map());
        return databases.get(name)!;
    };
    // Exercise real localforage instances with a structured-clone driver, including default task storage.
    await localforage.defineDriver({
        _driver: localforage.INDEXEDDB,
        _support: true,
        async _initStorage() {},
        async getItem<T>(this: LocalForage, key: string) { return structuredClone(values(this).get(key) ?? null) as T | null; },
        async setItem<T>(this: LocalForage, key: string, value: T) {
            await hooks.beforeSet?.(this.config().storeName!, key, value);
            values(this).set(key, structuredClone(value));
            await hooks.set?.(this.config().storeName!, key, value);
            return value;
        },
        async removeItem(this: LocalForage, key: string) { values(this).delete(key); },
        async clear(this: LocalForage) { values(this).clear(); },
        async length(this: LocalForage) { return values(this).size; },
        async key(this: LocalForage, index: number) { return [...values(this).keys()][index]; },
        async keys(this: LocalForage) { return [...values(this).keys()]; },
        async iterate<T, U>(this: LocalForage, iterator: (value: T, key: string, iteration: number) => U) {
            await hooks.iterate?.(this.config().storeName!);
            let index = 1;
            for (const [key, value] of values(this)) {
                const result = iterator(structuredClone(value) as T, key, index++);
                if (result !== undefined) return result;
            }
            return undefined as U;
        },
    });
    await localforage.setDriver(localforage.INDEXEDDB);

    const storage = new Map<string, string>();
    const tails = new Map<string, Promise<void>>();
    const held = new Set<string>();
    let artifactRequests = 0;
    let onArtifactRequest: (() => void) | undefined;
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: {
        async request<T>(name: string, callback: () => Promise<T>) {
            const previous = tails.get(name) ?? Promise.resolve();
            const release = gate();
            const tail = previous.catch(() => {}).then(() => release.promise);
            tails.set(name, tail);
            if (name === artifactLock) { artifactRequests++; onArtifactRequest?.(); }
            await previous.catch(() => {});
            held.add(name);
            try { return await callback(); }
            finally { held.delete(name); release.resolve(); if (tails.get(name) === tail) tails.delete(name); }
        },
        async query() { return { held: [...held].map((name) => ({ name })), pending: [] }; },
    } } });
    const waitForArtifactRequest = (after: number) => {
        const requested = gate();
        onArtifactRequest = () => { if (artifactRequests > after) requested.resolve(); };
        if (artifactRequests > after) requested.resolve();
        return requested.promise;
    };

    const image = await import("../../src/services/image-storage");
    const media = await import("../../src/services/file-storage");
    const tasks = await import("../../src/services/browser-generation-store");
    const runner = await import("../../src/services/browser-generation-runner");
    const { useUserStore } = await import("../../src/stores/use-user-store");
    const { createModelChannel, defaultConfig, encodeChannelModel, useConfigStore } = await import("../../src/stores/use-config-store");
    // Separate module-local queues model another tab; only the shared Web Lock can coordinate them.
    const otherTab = await import("../../src/services/generation-asset-repository.ts?browser-gc-other-tab");
    useUserStore.setState({ user: null, hydrated: true });
    const channel = createModelChannel({ id: "gc-test", scope: "user", apiFormat: "openai", baseUrl: "https://provider.example/v1", apiKey: "test-key", models: ["test-model"], interfaceType: "newapi" });
    const config = { ...defaultConfig, channels: [channel], model: encodeChannelModel(channel.id, "test-model") };
    useConfigStore.setState({ config });
    axios.defaults.adapter = async (request) => {
        if (request.method !== "get") throw new Error("Unexpected provider submission");
        return { config: request, headers: {}, status: 200, statusText: "OK", data: { id: "provider-handle", status: "completed", video_url: "https://cdn.example/video.mp4" } };
    };
    globalThis.fetch = (async () => new Response(new Blob(["video bytes"], { type: "video/mp4" }))) as typeof fetch;

    const seed = async (kind: Kind, label: string) => {
        const id = `browser:${kind}-${label}`;
        const record: import("../../src/services/browser-generation-store").BrowserGenerationRecord = {
            task: { id, type: `canvas_${kind}`, model: config.model, status: "failed", createdAt: "now", updatedAt: "now", canRecoverMedia: true },
            channelId: channel.id, baseUrl: channel.baseUrl, protocol: "newapi",
            ...(kind === "video" ? { video: { id: "provider-handle", provider: "openai" as const, model: config.model } } : { pendingMedia: { mode: kind, sources: [new Blob([`${kind} bytes`], { type: `${kind}/${kind === "image" ? "png" : "mpeg"}` })] } }),
        };
        await tasks.writeBrowserGeneration(record, scope);
        return { id, key: `${kind}:${scope}:${id}:0`, record };
    };
    const get = (kind: Kind, key: string) => kind === "image" ? image.getImageBlob(key) : media.getMediaBlob(key);
    const set = (kind: Kind, key: string) => kind === "image" ? image.setImageBlob(key, new Blob(["unrelated"], { type: "image/png" })) : media.setMediaBlob(key, new Blob(["unrelated"], { type: `${kind}/mp4` }));
    const cleanup = async () => { await image.cleanupUnusedImages({}, scope); await media.cleanupUnusedMedia({}, scope); };
    const cleanupLocked = async () => { await image.cleanupUnusedImagesLocked({}, scope); await media.cleanupUnusedMediaLocked({}, scope); };

    if (scenario === "retention") {
        const { useAssetStore, flushAssetStorePersistence } = await import("../../src/stores/use-asset-store");
        const { useCanvasStore } = await import("../../src/stores/canvas/use-canvas-store");
        useCanvasStore.setState({ projects: [] });
        const results = [];
        for (const kind of ["image", "video", "audio"] as const) {
            const { id, key } = await seed(kind, "retention");
            const finished = await runner.queryBrowserGeneration(id);
            const unrelated = `image:${scope}:unrelated-${kind}`;
            await set("image", unrelated);
            const assetId = useAssetStore.getState().addAsset({ kind: "image", title: "delete me", coverUrl: "", tags: [], data: { dataUrl: "", storageKey: unrelated, width: 1, height: 1, bytes: 9, mimeType: "image/png" } });
            await flushAssetStorePersistence();
            await useAssetStore.getState().removeAsset(assetId);
            const readable = await (await get(kind, key))?.text();
            const unrelatedRemoved = !(await get("image", unrelated));
            const noMaterializedAssets = useAssetStore.getState().assets.length === 0;
            await tasks.removeBrowserGeneration(id);
            await cleanup();
            results.push({ kind, status: finished.status, readable, unrelatedRemoved, noMaterializedAssets, reclaimed: !(await get(kind, key)) });
        }
        return results;
    }
    if (scenario === "write-race" || scenario === "gc-race") {
        const results = [];
        for (const kind of ["image", "video", "audio"] as const) {
            const { id, key } = await seed(kind, scenario);
            const entered = gate();
            const release = gate();
            let sawFileWrite = false;
            let sawGc = false;
            let sawPendingReceipt = false;
            let allWritesLocked = true;
            hooks.set = async (store, writtenKey) => {
                if (writtenKey === key || writtenKey.includes(id)) allWritesLocked &&= held.has(artifactLock);
                if (writtenKey === key) {
                    sawFileWrite = true;
                    if (scenario === "write-race") { entered.resolve(); await release.promise; }
                }
            };
            let recovering: ReturnType<typeof runner.queryBrowserGeneration>;
            let collecting: Promise<void>;
            let blocked: boolean;
            if (scenario === "write-race") {
                recovering = runner.queryBrowserGeneration(id);
                await entered.promise;
                const count = artifactRequests;
                collecting = otherTab.withGenerationArtifactCommitLock(scope, async () => {
                    sawGc = true;
                    const record = await tasks.readBrowserGeneration(id, scope);
                    sawPendingReceipt = !record.task.resultJson && Boolean(record.pendingMedia || record.video);
                    await cleanupLocked();
                });
                await waitForArtifactRequest(count);
                blocked = !sawGc;
            } else {
                collecting = otherTab.withGenerationArtifactCommitLock(scope, async () => {
                    sawGc = true; entered.resolve(); await release.promise; await cleanupLocked();
                });
                await entered.promise;
                const count = artifactRequests;
                recovering = runner.queryBrowserGeneration(id);
                await waitForArtifactRequest(count);
                blocked = !sawFileWrite;
            }
            release.resolve();
            const [finished] = await Promise.all([recovering, collecting]);
            hooks.set = undefined;
            await cleanup();
            results.push({ kind, blocked, sawPendingReceipt, allWritesLocked, status: finished.status, readable: Boolean(await get(kind, key)) });
        }
        return results;
    }
    if (scenario === "lifecycle") {
        const { id, record } = await seed("image", "lifecycle");
        const checks = [];
        for (const operation of ["write", "remove"] as const) {
            const entered = gate();
            const release = gate();
            const holding = otherTab.withGenerationArtifactCommitLock(scope, async () => { entered.resolve(); await release.promise; });
            await entered.promise;
            const count = artifactRequests;
            record.task.updatedAt = "changed";
            let settled = false;
            const pending = (operation === "write" ? tasks.writeBrowserGeneration(record) : tasks.removeBrowserGeneration(id)).then(() => { settled = true; });
            await waitForArtifactRequest(count);
            const saved = await tasks.readBrowserGeneration(id);
            checks.push({ operation, blocked: !settled, stateUnchanged: saved.task.updatedAt === (operation === "write" ? "now" : "changed") });
            release.resolve();
            await Promise.all([holding, pending]);
        }
        return checks;
    }
    if (scenario === "commit-failure") {
        const results = [];
        for (const kind of ["image", "video", "audio"] as const) {
            const { id, key } = await seed(kind, "commit-failure");
            hooks.beforeSet = (_store, writtenKey, value) => {
                if (writtenKey.includes(id) && (value as { task?: { resultJson?: string } }).task?.resultJson) throw new Error("task commit quota exceeded");
            };
            let rejected = false;
            try { await runner.queryBrowserGeneration(id); } catch (error) { rejected = (error as Error).message === "task commit quota exceeded"; }
            hooks.beforeSet = undefined;
            const durable = await tasks.readBrowserGeneration(id);
            await cleanup();
            const readableAfterFailure = Boolean(await get(kind, key));
            const recovered = await runner.queryBrowserGeneration(id);
            results.push({ kind, rejected, durableReceipt: !durable.task.resultJson && Boolean(durable.pendingMedia || durable.video), readableAfterFailure, status: recovered.status });
        }
        return results;
    }
    if (scenario === "scope") {
        const { id, key, record } = await seed("image", "old-scope");
        await set("image", key);
        const orphan = `image:${scope}:orphan`;
        const foreign = "image:other-scope:unrelated";
        await set("image", orphan);
        await set("image", foreign);
        record.task.resultJson = JSON.stringify({ mode: "image", images: [{ storageKey: key }], text: "private result" });
        record.task.prompt = "private prompt";
        record.task.status = "succeeded";
        delete record.pendingMedia;
        await tasks.writeBrowserGeneration(record);
        const { setActiveUserScope, scopedStorageKey } = await import("../../src/lib/user-scope");
        await localforage.setItem(scopedStorageKey(`yingce:browser-generation:${id}`, "other-scope"), { task: { ...record.task, resultJson: "{foreign corrupt result" } });
        setActiveUserScope("other-scope");
        const keys = await tasks.readBrowserGenerationMediaStorageKeys(scope);
        await cleanup();
        return { keysOnly: keys instanceof Set && [...keys].join() === key, readable: Boolean(await get("image", key)), orphanRemoved: !(await get("image", orphan)), foreignUntouched: Boolean(await get("image", foreign)) };
    }
    const { id, key } = await seed("image", "failure");
    const unrelated = `image:${scope}:failure-unrelated`;
    await set("image", key);
    await set("image", unrelated);
    hooks.iterate = () => { throw new Error("task storage unavailable"); };
    let readError = "";
    try { await cleanup(); } catch (error) { readError = (error as Error).message; }
    hooks.iterate = undefined;
    const record = await tasks.readBrowserGeneration(id);
    delete record.pendingMedia;
    record.task.resultJson = "{broken";
    await tasks.writeBrowserGeneration(record);
    let parseFailed = false;
    try { await cleanup(); } catch (error) { parseFailed = error instanceof SyntaxError; }
    const preservedOnError = Boolean(await get("image", key)) && Boolean(await get("image", unrelated));
    await tasks.removeBrowserGeneration(id);
    await cleanup();
    return { readError, parseFailed, preservedOnError, reclaimedAfterRemoval: !(await get("image", key)) && !(await get("image", unrelated)) };
}

self.onmessage = async (event: MessageEvent<Scenario>) => {
    try { self.postMessage({ ok: true, result: await run(event.data) }); }
    catch (error) { self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) }); }
};
