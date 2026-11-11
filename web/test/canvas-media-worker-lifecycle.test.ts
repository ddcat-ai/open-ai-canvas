import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

// Isolate module singletons without mocking Bun's global import cache for other tests.
async function compile(entry: string, extra?: string) {
    const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "cjs",
        define: { "import.meta.url": JSON.stringify(new URL("../src/lib/canvas/canvas-face-detection.ts", import.meta.url).href) },
        plugins: [
            {
                name: "media-worker-boundaries",
                setup(build) {
                    if (extra) {
                        build.onResolve({ filter: /^media-worker-entry$/ }, () => ({ path: entry, namespace: "entry" }));
                        build.onLoad({ filter: /.*/, namespace: "entry" }, () => ({ contents: extra, loader: "ts" }));
                    }
                    build.onResolve({ filter: /^(@ffmpeg\/|@mediapipe\/tasks-vision|@\/services\/file-storage)/ }, ({ path }) => ({ path, namespace: "boundary" }));
                    build.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({
                        loader: "js",
                        contents:
                            path === "@ffmpeg/ffmpeg"
                                ? "export const FFmpeg = globalThis.FakeFFmpeg;"
                                : path === "@ffmpeg/util"
                                  ? "export async function fetchFile(blob) { return new Uint8Array(await blob.arrayBuffer()); }"
                                  : path === "@mediapipe/tasks-vision"
                                    ? "export const FaceDetector = globalThis.FaceDetector;"
                                    : path === "@/services/file-storage"
                                      ? "export const getMediaBlob = globalThis.getMediaBlob;"
                                      : "export default '/test-ffmpeg-asset';",
                    }));
                },
            },
        ],
    });
    if (!result.success) throw new AggregateError(result.logs, "Could not compile production media worker modules");
    return result.outputs[0].text();
}

const videoCode = await compile("media-worker-entry", ["canvas-video-merge", "canvas-video-segment"].map((name) => `export * from ${JSON.stringify(fileURLToPath(new URL(`../src/lib/canvas/${name}.ts`, import.meta.url)))};`).join("\n"));
const faceCode = await compile(fileURLToPath(new URL("../src/lib/canvas/canvas-face-detection.ts", import.meta.url)));
const detectorCode = await compile(fileURLToPath(new URL("../src/lib/canvas/canvas-face-detector.worker.ts", import.meta.url)));

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function settle() {
    for (let index = 0; index < 30; index++) await Promise.resolve();
}

function clock() {
    let now = 0;
    let id = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    return {
        setTimeout(callback: () => void, delay: number) {
            timers.set(++id, { at: now + delay, callback });
            return id;
        },
        clearTimeout(timer: number) {
            timers.delete(timer);
        },
        advance(ms: number) {
            const target = now + ms;
            while (true) {
                const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                timers.delete(next[0]);
                now = next[1].at;
                next[1].callback();
            }
            now = target;
        },
        get count() {
            return timers.size;
        },
    };
}

function videoHarness() {
    const timers = clock();
    const instances: FakeFFmpeg[] = [];
    const events: string[] = [];
    let loadFailure = false;
    let writeFailure = false;
    let execFailure = false;
    let execGate: ReturnType<typeof deferred> | undefined;
    let readGate: ReturnType<typeof deferred> | undefined;
    let sourceFailure = false;
    class FakeFFmpeg {
        files = new Map<string, Uint8Array | string>();
        listeners = new Set<(event: { message: string }) => void>();
        terminated = 0;
        constructor() {
            instances.push(this);
        }
        async load() {
            events.push("load");
            if (loadFailure) {
                loadFailure = false;
                throw new Error("load failure");
            }
        }
        terminate() {
            this.terminated++;
            events.push("terminate");
        }
        async writeFile(name: string, value: Uint8Array | string) {
            events.push(`write:${name}`);
            if (this.files.has(name)) throw new Error(`overlapping input ${name}`);
            this.files.set(name, value);
            if (writeFailure) {
                writeFailure = false;
                throw new Error("write failure");
            }
            return true;
        }
        async readFile(name: string) {
            events.push(`read:${name}`);
            const value = this.files.get(name);
            if (!value) throw new Error(`missing ${name}`);
            return value;
        }
        async deleteFile(name: string) {
            events.push(`delete:${name}`);
            this.files.delete(name);
            return true;
        }
        on(_name: string, listener: (event: { message: string }) => void) {
            this.listeners.add(listener);
        }
        off(_name: string, listener: (event: { message: string }) => void) {
            this.listeners.delete(listener);
        }
        async exec(args: string[]) {
            events.push(`exec:${args.at(-1)}`);
            const gate = execGate;
            execGate = undefined;
            if (gate) await gate.promise;
            if (execFailure) {
                execFailure = false;
                throw new Error("exec failure");
            }
            const name = args.at(-1)!;
            const source = this.files.get(args[args.indexOf("-i") + 1]) as Uint8Array;
            this.files.set(name, name.endsWith(".mp3") ? new Uint8Array([0x49, 0x44, 0x33, source[0]]) : source.slice());
            return 0;
        }
        async ffprobe(args: string[]) {
            const file = args.at(-1);
            const duration = file === "merged.mp4" ? 2 : 1;
            this.files.set(
                args[args.indexOf("-o") + 1],
                JSON.stringify({
                    streams: [
                        { codec_type: "video", width: 64, height: 36, duration: String(duration), avg_frame_rate: "30/1" },
                        { codec_type: "audio", duration: String(duration) },
                    ],
                }),
            );
            return 0;
        }
    }
    const module = { exports: {} as typeof import("../src/lib/canvas/canvas-video-merge") & typeof import("../src/lib/canvas/canvas-video-segment") };
    runInNewContext(videoCode, {
        module,
        exports: module.exports,
        FakeFFmpeg,
        Blob,
        Uint8Array,
        TextEncoder,
        TextDecoder,
        DOMException,
        console,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        getMediaBlob: async (key: string) => {
            if (sourceFailure) throw new Error("source failure");
            if (readGate) await readGate.promise;
            return new Blob([new Uint8Array([Number(key)])]);
        },
        fetch: async (_url: string, options: RequestInit) => {
            options.signal?.throwIfAborted();
            return { ok: true, blob: async () => new Blob([new Uint8Array([9])]) };
        },
    });
    return {
        api: module.exports,
        timers,
        instances,
        events,
        failLoad() {
            loadFailure = true;
        },
        failWrite() {
            writeFailure = true;
        },
        failExec() {
            execFailure = true;
        },
        failSource() {
            sourceFailure = true;
        },
        blockExec() {
            return (execGate = deferred());
        },
        blockSource() {
            return (readGate = deferred());
        },
    };
}

const range = { startMs: 0, endMs: 1000 };

describe("shared FFmpeg task lifetime", () => {
    test("stays lazy, reuses an idle worker and rebuilds after idle termination", async () => {
        const h = videoHarness();
        expect(h.instances).toHaveLength(0);
        await h.api.transcodeVideoToMp4(new Blob([new Uint8Array([1])]));
        expect(h.instances).toHaveLength(1);
        h.timers.advance(29_999);
        expect(h.instances[0].terminated).toBe(0);
        await h.api.trimVideoSegment({ storageKey: "2" }, range);
        h.timers.advance(1);
        expect(h.instances[0].terminated).toBe(0);
        h.timers.advance(29_999);
        expect(h.instances[0].terminated).toBe(1);
        await h.api.extractVideoAudio({ storageKey: "3" }, range);
        expect(h.instances).toHaveLength(2);
        expect(h.instances[1].files.size).toBe(0);
        expect(h.instances[1].listeners.size).toBe(0);
        h.timers.advance(30_000);
        expect(h.instances[1].terminated).toBe(1);
    });

    test("queued trim, audio and transcode cannot overwrite files or terminate active work", async () => {
        const h = videoHarness();
        const blocked = h.blockExec();
        const first = h.api.trimVideoSegment({ storageKey: "1" }, range);
        await settle();
        expect(h.events).toContain("exec:segment-output.mp4");
        const second = h.api.trimVideoSegment({ storageKey: "2" }, range);
        const audio = h.api.extractVideoAudio({ storageKey: "3" }, range);
        const transcode = h.api.transcodeVideoToMp4(new Blob([new Uint8Array([6])]));
        await settle();
        h.timers.advance(120_000);
        expect(h.instances).toHaveLength(1);
        expect(h.instances[0].terminated).toBe(0);
        expect(h.events.filter((value) => value.startsWith("write:"))).toHaveLength(1);
        blocked.resolve();
        const results = await Promise.all([first, second, audio, transcode]);
        expect(await Promise.all(results.map(async (blob) => [...new Uint8Array(await blob.arrayBuffer())]))).toEqual([[1], [2], [0x49, 0x44, 0x33, 3], [6]]);
        expect(h.instances[0].files.size).toBe(0);
        expect(h.instances[0].listeners.size).toBe(0);
        h.timers.advance(30_000);
        expect(h.instances[0].terminated).toBe(1);
    });

    test("an active source read also owns the lease", async () => {
        const h = videoHarness();
        const blocked = h.blockSource();
        const pending = h.api.trimVideoSegment({ storageKey: "1" }, range);
        await settle();
        h.timers.advance(90_000);
        expect(h.instances[0].terminated).toBe(0);
        blocked.resolve();
        await pending;
        h.timers.advance(30_000);
        expect(h.instances[0].terminated).toBe(1);
    });

    test("failed initialization does not poison queued retries", async () => {
        const h = videoHarness();
        h.failLoad();
        const failed = h.api.trimVideoSegment({ storageKey: "1" }, range);
        const failure = expect(failed).rejects.toThrow("加载失败");
        const retry = h.api.trimVideoSegment({ storageKey: "2" }, range);
        await failure;
        expect([...new Uint8Array(await (await retry).arrayBuffer())]).toEqual([2]);
        expect(h.instances).toHaveLength(2);
        expect(h.instances[0].terminated).toBe(1);
        h.timers.advance(30_000);
        expect(h.instances[1].terminated).toBe(1);
    });

    for (const fail of ["failWrite", "failExec", "failSource"] as const) {
        test(`${fail} cleans files/listeners and releases the worker`, async () => {
            const h = videoHarness();
            h[fail]();
            await expect(h.api.extractVideoAudio({ storageKey: "1" }, range)).rejects.toThrow();
            expect(h.instances[0].files.size).toBe(0);
            expect(h.instances[0].listeners.size).toBe(0);
            h.timers.advance(30_000);
            expect(h.instances[0].terminated).toBe(1);
        });
    }

    test("cancelling an active encode and a queued job preserves the following job", async () => {
        const h = videoHarness();
        const blocked = h.blockExec();
        const activeController = new AbortController();
        const queuedController = new AbortController();
        const active = h.api.trimVideoSegment({ storageKey: "1" }, range, undefined, undefined, activeController.signal);
        const activeRejected = active.catch((error: unknown) => error);
        await settle();
        const queued = h.api.trimVideoSegment({ storageKey: "2" }, range, undefined, undefined, queuedController.signal);
        const queuedRejected = queued.catch((error: unknown) => error);
        const following = h.api.trimVideoSegment({ storageKey: "3" }, range);
        activeController.abort();
        queuedController.abort();
        h.timers.advance(90_000);
        expect(h.instances[0].terminated).toBe(0);
        expect(h.events.filter((event) => event.startsWith("write:"))).toHaveLength(1);
        blocked.resolve();
        expect(await activeRejected).toMatchObject({ name: "AbortError" });
        expect(await queuedRejected).toMatchObject({ name: "AbortError" });
        expect([...new Uint8Array(await (await following).arrayBuffer())]).toEqual([3]);
        expect(h.events.filter((event) => event.startsWith("exec:"))).toHaveLength(2);
        expect(h.instances[0].files.size).toBe(0);
        h.timers.advance(30_000);
        expect(h.instances[0].terminated).toBe(1);
    });

    test("already cancelled or invalid requests never start the worker", async () => {
        const h = videoHarness();
        await expect(h.api.trimVideoSegment({ storageKey: "1" }, range, undefined, undefined, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
        await expect(h.api.extractVideoAudio({ storageKey: "1" }, { startMs: 1000, endMs: 1 })).rejects.toThrow();
        expect(h.instances).toHaveLength(0);
    });
});

function faceHarness() {
    const timers = clock();
    const workers: FakeWorker[] = [];
    const images: Array<{ width: number; height: number; close: () => void; closed: number }> = [];
    let decodeGate: ReturnType<typeof deferred> | undefined;
    let constructFailure = false;
    let transferFailure = false;
    class FakeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message: string }) => void) | null = null;
        onmessageerror: (() => void) | null = null;
        requests: Array<{ id: number; image: (typeof images)[number] }> = [];
        terminated = 0;
        constructor() {
            if (constructFailure) throw new Error("constructor failed");
            workers.push(this);
        }
        postMessage(request: (typeof this.requests)[number]) {
            if (transferFailure) throw new Error("transfer failed");
            this.requests.push(request);
        }
        terminate() {
            this.terminated++;
        }
        finish(index = 0, error?: string) {
            const request = this.requests[index];
            this.onmessage?.({ data: { id: request.id, imageWidth: 80, imageHeight: 60, faces: [], error } });
        }
    }
    const module = { exports: {} as typeof import("../src/lib/canvas/canvas-face-detection") };
    runInNewContext(faceCode, {
        module,
        exports: module.exports,
        URL,
        DOMException,
        Worker: FakeWorker,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        fetch: async (_url: string, options: RequestInit) => {
            options.signal?.throwIfAborted();
            return { ok: true, blob: async () => new Blob() };
        },
        createImageBitmap: async () => {
            if (decodeGate) await decodeGate.promise;
            const image = {
                width: 80,
                height: 60,
                closed: 0,
                close() {
                    this.closed++;
                },
            };
            images.push(image);
            return image;
        },
    });
    return {
        api: module.exports,
        timers,
        workers,
        images,
        blockDecode() {
            return (decodeGate = deferred());
        },
        failConstruct() {
            constructFailure = true;
        },
        failTransfer() {
            transferFailure = true;
        },
    };
}

describe("face detector worker lifetime", () => {
    test("keeps pending work alive, reuses the worker and recreates after idle", async () => {
        const h = faceHarness();
        expect(h.workers).toHaveLength(0);
        const first = h.api.detectCanvasFaces("/image");
        await settle();
        h.timers.advance(120_000);
        expect(h.workers[0].terminated).toBe(0);
        h.workers[0].finish();
        expect(await first).toMatchObject({ imageWidth: 80, imageHeight: 60 });
        h.timers.advance(29_999);
        const second = h.api.detectCanvasFaces("/image");
        await settle();
        h.timers.advance(1);
        expect(h.workers).toHaveLength(1);
        expect(h.workers[0].terminated).toBe(0);
        h.workers[0].finish(1);
        await second;
        h.timers.advance(30_000);
        expect(h.workers[0].terminated).toBe(1);
        const third = h.api.detectCanvasFaces("/image");
        await settle();
        expect(h.workers).toHaveLength(2);
        h.workers[1].finish();
        await third;
        h.timers.advance(30_000);
        expect(h.workers[1].terminated).toBe(1);
    });

    test("one cancelled consumer cannot terminate other pending work; last cancellation releases", async () => {
        const h = faceHarness();
        const a = new AbortController();
        const b = new AbortController();
        const first = h.api.detectCanvasFaces("/a", a.signal);
        const firstRejected = first.catch((error: unknown) => error);
        const second = h.api.detectCanvasFaces("/b", b.signal);
        const secondRejected = second.catch((error: unknown) => error);
        await settle();
        a.abort();
        expect(await firstRejected).toMatchObject({ name: "AbortError" });
        expect(h.workers[0].terminated).toBe(0);
        h.workers[0].finish(0); // late result for the cancelled consumer
        h.timers.advance(90_000);
        expect(h.workers[0].terminated).toBe(0);
        b.abort();
        expect(await secondRejected).toMatchObject({ name: "AbortError" });
        expect(h.workers[0].terminated).toBe(1);
        expect(h.timers.count).toBe(0);
    });

    test("cancellation during decoding closes the bitmap without creating a worker", async () => {
        const h = faceHarness();
        const gate = h.blockDecode();
        const controller = new AbortController();
        const pending = h.api.detectCanvasFaces("/image", controller.signal);
        const rejected = pending.catch((error: unknown) => error);
        await settle();
        controller.abort();
        gate.resolve();
        expect(await rejected).toMatchObject({ name: "AbortError" });
        expect(h.workers).toHaveLength(0);
        expect(h.images[0].closed).toBe(1);
    });

    for (const failure of ["failConstruct", "failTransfer"] as const) {
        test(`${failure} releases main-thread bitmaps and does not pin the worker`, async () => {
            const h = faceHarness();
            h[failure]();
            await expect(h.api.detectCanvasFaces("/image")).rejects.toThrow();
            expect(h.images[0].closed).toBe(1);
            h.timers.advance(30_000);
            expect(h.workers.every((worker) => worker.terminated === 1)).toBe(true);
        });
    }

    test("worker errors reject all consumers and stale callbacks cannot poison a rebuilt worker", async () => {
        const h = faceHarness();
        const first = h.api.detectCanvasFaces("/a");
        const firstRejected = first.catch((error: unknown) => error);
        const second = h.api.detectCanvasFaces("/b");
        const secondRejected = second.catch((error: unknown) => error);
        await settle();
        const oldError = h.workers[0].onerror!;
        oldError({ message: "worker crashed" });
        expect(await firstRejected).toMatchObject({ message: "worker crashed" });
        expect(await secondRejected).toMatchObject({ message: "worker crashed" });
        expect(h.workers[0].terminated).toBe(1);
        const retry = h.api.detectCanvasFaces("/c");
        await settle();
        oldError({ message: "late error" });
        h.workers[1].finish();
        await retry;
        h.timers.advance(30_000);
        expect(h.workers[1].terminated).toBe(1);
    });

    test("detection errors release the pending request and allow idle shutdown", async () => {
        const h = faceHarness();
        const pending = h.api.detectCanvasFaces("/image");
        const rejected = pending.catch((error: unknown) => error);
        await settle();
        h.workers[0].finish(0, "model failed");
        expect(await rejected).toMatchObject({ message: "model failed" });
        h.timers.advance(30_000);
        expect(h.workers[0].terminated).toBe(1);
    });
});

test("the detection worker retries failed model initialization and closes transferred images", async () => {
    let attempts = 0;
    let closed = 0;
    const replies: Array<{ id: number; error?: string; faces?: unknown[] }> = [];
    const self = { onmessage: undefined as undefined | ((event: unknown) => Promise<void>), postMessage: (reply: (typeof replies)[number]) => replies.push(reply) };
    runInNewContext(detectorCode, {
        module: { exports: {} },
        Error,
        self,
        FaceDetector: {
            async createFromOptions() {
                if (++attempts === 1) throw new Error("model failed");
                return { detect: () => ({ detections: [] }) };
            },
        },
    });
    const image = () => ({
        width: 80,
        height: 60,
        close() {
            closed++;
        },
    });
    await self.onmessage!({ data: { id: 1, image: image() } });
    expect(replies[0].error).toBe("model failed");
    await self.onmessage!({ data: { id: 2, image: image() } });
    expect(replies[1]).toMatchObject({ id: 2, faces: [] });
    expect(attempts).toBe(2);
    expect(closed).toBe(2);
});
