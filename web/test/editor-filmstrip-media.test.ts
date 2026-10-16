import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readTimelineFrames } from "../src/lib/plugins/builtin/editor/editor-filmstrip-media";

let videos: TestVideo[];
let drawnTime = 0;
let scope = "filmstrip-user-a";
let blocked = false;
const originals = new Map<string, PropertyDescriptor | undefined>();

class TestVideo extends EventTarget {
    src = "";
    crossOrigin = "";
    muted = false;
    playsInline = false;
    preload = "";
    videoWidth = 640;
    videoHeight = 360;
    duration = 20;
    private time = 0;
    get currentTime() {
        return this.time;
    }
    set currentTime(value: number) {
        this.time = value;
        queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
    }
    load() {
        if (this.src && !blocked) queueMicrotask(() => this.dispatchEvent(new Event("loadeddata")));
    }
    pause() {}
    removeAttribute() {
        this.src = "";
    }
}

function stub(name: string, value: unknown) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

beforeEach(() => {
    videos = [];
    blocked = false;
    scope = "filmstrip-user-a";
    stub("window", { localStorage: { getItem: () => scope } });
    stub("document", {
        createElement: (tag: string) => {
            if (tag === "video") {
                const video = new TestVideo();
                videos.push(video);
                return video;
            }
            return {
                width: 0,
                height: 0,
                getContext: () => ({
                    drawImage: (video: TestVideo) => {
                        drawnTime = video.currentTime;
                    },
                }),
                toDataURL: () => `data:image/jpeg;base64,frame-${drawnTime}`,
            };
        },
    });
});

afterEach(() => {
    for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
    }
    originals.clear();
});

test("提取指定源时间的画面并缓存，结束后释放独立视频解码器", async () => {
    const media = { id: "frame-test", kind: "video" as const, title: "Video", url: "https://example.invalid/frame-test.mp4" };
    const output: [number, string][] = [];
    await readTimelineFrames(media, [1000, 2500], new AbortController().signal, (time, frame) => output.push([time, frame]));
    expect(output).toEqual([
        [1000, "data:image/jpeg;base64,frame-1"],
        [2500, "data:image/jpeg;base64,frame-2.5"],
    ]);
    expect(videos[0].src).toBe("");
    const cached: string[] = [];
    await readTimelineFrames(media, [2500], new AbortController().signal, (_, frame) => cached.push(frame));
    expect(cached).toEqual(["data:image/jpeg;base64,frame-2.5"]);
    expect(videos).toHaveLength(1);
    scope = "filmstrip-user-b";
    await readTimelineFrames(media, [2500], new AbortController().signal, () => {});
    expect(videos).toHaveLength(2);
});

test("并发请求最多占两个解码器，取消时不发布旧帧并释放排队任务", async () => {
    blocked = true;
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const output: string[] = [];
    const jobs = controllers.map((controller, i) => readTimelineFrames({ id: `abort-${i}`, kind: "video", title: "Video", url: `https://example.invalid/abort-${i}.mp4` }, [0], controller.signal, (_, frame) => output.push(frame)));
    await Promise.resolve();
    expect(videos).toHaveLength(2);
    controllers.forEach((controller) => controller.abort());
    const results = await Promise.allSettled(jobs);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(output).toEqual([]);
    expect(videos.every((video) => video.src === "")).toBe(true);
});

test("资源访问请求挂起时，取消仍会释放解码名额", () => {
    // Keep module mocks in a child process so they cannot replace other tests' API modules.
    const result = spawnSync(
        process.execPath,
        [
            "-e",
            `
        import { mock } from "bun:test";
        let accesses = 0;
        mock.module("@/services/api/resources", () => ({
            resourceIdFromStorageKey: () => "id",
            getResourceAccess: () => { accesses++; return new Promise(() => {}); },
            resolveResourceAccessURL: (url) => url,
        }));
        mock.module("@/services/file-storage", () => ({ resolveMediaUrl: async () => "unused" }));
        mock.module("@/lib/user-scope", () => ({ getActiveUserScope: () => "scope" }));
        const { readTimelineFrames } = await import("./src/lib/plugins/builtin/editor/editor-filmstrip-media.ts");
        const controllers = Array.from({ length: 3 }, () => new AbortController());
        let settled = 0;
        const run = (i) => readTimelineFrames({ storageKey: "resource:" + i }, [0], controllers[i].signal, () => {})
            .catch(() => { settled++; });
        const first = run(0), second = run(1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        controllers[0].abort(); controllers[1].abort();
        const third = run(2);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (accesses !== 3 || settled !== 2) throw new Error(JSON.stringify({ accesses, settled }));
        controllers[2].abort();
        await Promise.all([first, second, third]);
        console.log("passed");
    `,
        ],
        { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", timeout: 5000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("passed");
});
