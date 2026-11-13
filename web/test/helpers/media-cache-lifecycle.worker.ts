import assert from "node:assert/strict";
import { mock } from "bun:test";
import localforage from "localforage";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

self.onmessage = async (event: MessageEvent<string>) => {
    try {
        await run(event.data);
        self.postMessage({ ok: true });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) });
    }
};

async function run(scenario: string) {
    const storage = new Map<string, string>();
    const stores = new Map<string, Map<string, unknown>>();
    const windowEvents = new EventTarget();
    const revoked: string[] = [];
    const created: string[] = [];
    const stored = (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name)!;
    };
    const hooks: { read?: (name: string, key: string, value: unknown) => Promise<unknown>; write?: (name: string, key: string) => Promise<void> } = {};
    localforage.createInstance = ((options: { storeName: string }) => {
        const values = stored(options.storeName);
        return {
            getItem: async (key: string) => (hooks.read ? hooks.read(options.storeName, key, values.get(key) ?? null) : (values.get(key) ?? null)),
            setItem: async (key: string, value: unknown) => {
                await hooks.write?.(options.storeName, key);
                values.set(key, value);
                return value;
            },
            removeItem: async (key: string) => {
                values.delete(key);
            },
            length: async () => values.size,
            iterate: async (callback: (value: unknown, key: string) => unknown) => {
                for (const [key, value] of values) {
                    const result = callback(value, key);
                    if (result !== undefined) return result;
                }
            },
        };
    }) as typeof localforage.createInstance;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
            addEventListener: windowEvents.addEventListener.bind(windowEvents),
            removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
            dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
        },
    });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: { estimate: async () => ({ quota: 320 * 1024 * 1024 }) } } });
    URL.createObjectURL = () => {
        const url = `blob:test-${created.length}`;
        created.push(url);
        return url;
    };
    URL.revokeObjectURL = (url) => {
        revoked.push(url);
    };
    let downloadCalls = 0;
    let download = async () => new Blob(["remote"]);
    class UploadError extends Error {
        constructor(readonly permanent: boolean) {
            super("upload failed");
        }
    }
    let upload = async (): Promise<any> => {
        throw new UploadError(true);
    };
    mock.module("../../src/services/api/resources", () => ({
        resourceIdFromStorageKey: (key: string) => (key.startsWith("resource:") ? key.slice(9) : ""),
        resourceStorageKey: (id: string) => `resource:${id}`,
        resourceFileUrl: (id: string) => `/api/resources/${id}/file`,
        getResourceBlob: async () => {
            downloadCalls += 1;
            return download();
        },
        uploadResourceFile: () => upload(),
        ResourceUploadError: UploadError,
        getResourceAccess: async () => ({ url: "https://example.test/media" }),
        resolveResourceAccessURL: (url: string) => url,
        importResourceFromUrl: () => upload(),
        isResourceUrl: () => false,
    }));
    mock.module("../../src/lib/image-utils", () => ({ readImageMeta: async () => ({ width: 1, height: 1, mimeType: "image/png" }) }));
    let capture: (url: string, options?: { signal?: AbortSignal }) => Promise<unknown> = async () => ({});
    mock.module("../../src/lib/video-poster", () => ({ captureVideoPoster: (url: string, options?: { signal?: AbortSignal }) => capture(url, options), detectVideoAudioTrackFromBlob: async () => false }));
    const scope = await import("../../src/lib/user-scope");
    scope.setActiveUserScope("owner");
    const cache = await import("../../src/services/resource-blob-cache");
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const blob = new Blob(["image"], { type: "image/png" });
    // 模拟字节权重，验证策略，不分配百兆测试数据，也不把此测试当真实堆测量。
    const sized = (bytes: number) => {
        const value = new Blob(["x"]);
        Object.defineProperty(value, "size", { value: bytes });
        return value;
    };
    if (scenario === "leases") {
        assert.equal(await cache.primeResourceBlobCache("resource:a", blob), "/api/resources/a/file");
        assert.equal(created.length, 0);
        const a = cache.acquireCachedResourceObjectUrl("resource:a")!;
        const b = cache.acquireCachedResourceObjectUrl("resource:a")!;
        assert.equal(a.url, b.url);
        a.release();
        a.release();
        assert.deepEqual(revoked, []);
        b.release();
        assert.deepEqual(revoked, [a.url]);
        assert.equal(await cache.getCachedResourceBlob("resource:a"), blob);
        assert.equal(created.length, 1);
    } else if (scenario === "poster-leases") {
        const { hydrateCanvasVideoPreview } = await import("../../src/services/canvas-video-preview");
        const node = { id: "video", type: "video", title: "视频", width: 1, height: 1, position: { x: 0, y: 0 }, metadata: { storageKey: "resource:video" } } as import("../../src/types/canvas").CanvasNodeData;
        await cache.primeResourceBlobCache("resource:video", blob);
        capture = async (url) => {
            assert.equal(revoked.includes(url), false);
            throw new Error("decode failed");
        };
        assert.equal(await hydrateCanvasVideoPreview(node), null);
        assert.deepEqual(revoked, [created[0]]);
        const started = deferred<void>();
        capture = (url, options) =>
            new Promise((_resolve, reject) => {
                assert.equal(revoked.includes(url), false);
                options?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
                started.resolve();
            });
        const controller = new AbortController();
        const pending = hydrateCanvasVideoPreview(node, controller.signal);
        await started.promise;
        controller.abort();
        await assert.rejects(pending, { name: "AbortError" });
        await tick();
        assert.deepEqual(revoked, created);
    } else if (scenario === "memory-budget") {
        const huge = sized(33 * 1024 * 1024);
        await cache.primeResourceBlobCache("resource:a", huge);
        const lease = cache.acquireCachedResourceObjectUrl("resource:a")!;
        await cache.primeResourceBlobCache("resource:b", huge);
        assert.deepEqual(revoked, []);
        lease.release();
        assert.equal(cache.acquireCachedResourceObjectUrl("resource:a"), null);
        const b = cache.acquireCachedResourceObjectUrl("resource:b")!;
        assert.ok(b);
        b.release();
        await cache.primeResourceBlobCache("resource:too-large", sized(65 * 1024 * 1024));
        assert.equal(cache.acquireCachedResourceObjectUrl("resource:too-large"), null);
    } else if (scenario === "entry-budget") {
        for (let i = 0; i < 128; i++) await cache.primeResourceBlobCache(`resource:${i}`, blob);
        cache.acquireCachedResourceObjectUrl("resource:0")!.release();
        await cache.primeResourceBlobCache("resource:128", blob);
        assert.equal(cache.acquireCachedResourceObjectUrl("resource:1"), null);
        cache.acquireCachedResourceObjectUrl("resource:0")!.release();
    } else if (scenario === "disk-budget") {
        await cache.primeResourceBlobCache("resource:old", blob);
        await tick();
        const lease = cache.acquireCachedResourceObjectUrl("resource:old")!;
        const meta = stored("resource_blob_meta");
        const blobs = stored("resource_blobs");
        (meta.get("owner:old:file") as any).lastAccessedAt = 0;
        for (let i = 0; i < 1499; i++) {
            const key = `owner:disk-${i}:file`;
            meta.set(key, { key, size: 1, lastAccessedAt: i + 1 });
            blobs.set(key, blob);
        }
        await cache.primeResourceBlobCache("resource:new", blob);
        await tick();
        assert.equal(meta.size, 1500);
        assert.equal(blobs.has("owner:old:file"), false);
        assert.deepEqual(revoked, []);
        lease.release();
        assert.deepEqual(revoked, [lease.url]);
    } else if (scenario === "scope-races") {
        const gate = deferred<unknown>();
        hooks.read = async () => gate.promise;
        const pending = cache.loadCachedResourceObjectUrl("resource:old");
        cache.clearResourceBlobCache();
        scope.setActiveUserScope("other");
        gate.resolve(blob);
        assert.equal(await pending, null);
        assert.equal(created.length, 0);
        delete hooks.read;
        const network = deferred<Blob>();
        download = () => network.promise;
        const first = cache.getCachedResourceBlob("resource:download");
        const second = cache.getCachedResourceBlob("resource:download");
        await tick();
        assert.equal(downloadCalls, 1);
        cache.clearResourceBlobCache();
        scope.setActiveUserScope("third");
        network.resolve(blob);
        assert.equal(await first, null);
        assert.equal(await second, null);
        assert.equal(cache.acquireCachedResourceObjectUrl("resource:download"), null);
    } else if (scenario === "queue-budget") {
        const gate = deferred<void>();
        hooks.write = async (name) => {
            if (name === "resource_blobs") await gate.promise;
        };
        const large = sized(40 * 1024 * 1024);
        await cache.primeResourceBlobCache("resource:first", large);
        await tick();
        await cache.primeResourceBlobCache("resource:skipped", large);
        gate.resolve();
        await tick();
        assert.ok(stored("resource_blobs").has("owner:first:file"));
        assert.equal(stored("resource_blobs").has("owner:skipped:file"), false);
    } else if (scenario === "local-ownership" || scenario === "local-scope" || scenario === "upload-errors") {
        const images = await import("../../src/services/image-storage");
        const media = await import("../../src/services/file-storage");
        if (scenario === "local-ownership") {
            for (const [kind, set, resolve, cleanup, store] of [
                ["image", images.setImageBlob, images.resolveImageUrl, images.cleanupUnusedImages, "image_files"],
                ["video", media.setMediaBlob, media.resolveMediaUrl, media.cleanupUnusedMedia, "media_files"],
            ] as const) {
                const key = `${kind}:owner:replace`;
                const old = await set(key, blob);
                const next = await set(key, new Blob(["next"]));
                assert.notEqual(old, next);
                assert.equal(revoked.includes(old), false);
                assert.equal(await resolve(key), next);
                await cleanup({ storageKey: key }, "owner");
                assert.ok(stored(store).has(key));
                assert.equal(revoked.includes(next), false);
                await cleanup({}, "owner");
                assert.equal(stored(store).has(key), false);
                assert.ok(revoked.includes(old));
                assert.ok(revoked.includes(next));
            }
        } else if (scenario === "local-scope") {
            const key = "image:owner:pending";
            const url = await images.setImageBlob(key, blob);
            cache.clearResourceBlobCache();
            assert.ok(revoked.includes(url));
            assert.ok(stored("image_files").has(key));
            const gate = deferred<unknown>();
            hooks.read = () => gate.promise;
            const pending = images.resolveImageUrl(key);
            scope.setActiveUserScope("other");
            cache.clearResourceBlobCache();
            gate.resolve(blob);
            await assert.rejects(pending, { name: "AbortError" });
        } else {
            await assert.rejects(images.uploadImage(blob, undefined, { width: 1, height: 1 }));
            assert.deepEqual(revoked, [created[0]]);
            upload = async () => {
                throw new UploadError(false);
            };
            const pending = await images.uploadImage(blob, undefined, { width: 1, height: 1 });
            assert.equal(pending.pendingRemoteUpload, true);
            assert.ok(stored("image_files").has(pending.storageKey));
            assert.equal(revoked.includes(pending.url), false);
            hooks.write = async () => {
                throw new Error("disk unavailable");
            };
            await assert.rejects(images.uploadImage(blob, undefined, { width: 1, height: 1 }), /disk unavailable/);
            assert.ok(revoked.includes(created.at(-1)!));
        }
    } else if (scenario === "hook-lifecycle") {
        const { Window } = await import("happy-dom");
        const dom = new Window({ url: "http://localhost" });
        dom.localStorage.setItem("yingce:active-user-scope", "owner");
        Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
        Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const { createElement, act } = await import("react");
        const { createRoot } = await import("react-dom/client");
        const { useCachedResourceUrl } = await import("../../src/hooks/use-cached-resource-url");
        await cache.primeResourceBlobCache("resource:hook", blob);
        const host = dom.document.createElement("div");
        dom.document.body.append(host);
        const root = createRoot(host as any);
        function Image({ enabled }: { enabled: boolean }) {
            return createElement("img", { src: useCachedResourceUrl("resource:hook", enabled) || undefined });
        }
        await act(async () => root.render(createElement(Image, { enabled: true })));
        const url = host.querySelector("img")!.getAttribute("src");
        assert.ok(url);
        await act(async () => root.render(createElement(Image, { enabled: false })));
        assert.equal(host.querySelector("img")!.getAttribute("src"), url);
        assert.equal(revoked.includes(url), false);
        await act(async () => root.unmount());
        assert.ok(revoked.includes(url));
        await dom.happyDOM.close();
    } else throw new Error(`Unknown scenario: ${scenario}`);
    await tick();
    cache.clearResourceBlobCache();
}
