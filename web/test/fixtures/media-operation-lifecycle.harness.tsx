import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "@/types/canvas";
import type { ResourceUploadMeta } from "@/services/api/resources";

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, { window: dom, document: dom.document, navigator: dom.navigator, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { setActiveUserScope, getActiveUserScope } = await import("@/lib/user-scope");
const { CanvasNodeType } = await import("@/types/canvas");

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

const writes: string[] = [];
const uploads: { scope: string; meta?: ResourceUploadMeta }[] = [];
let uploadFailure: Error | undefined;
let deferredUpload = false;
let sharedRead = deferred<Blob>();
let reads = 0;
let inferCalls = 0;
let autoMetadata = false;
const audioElements: HTMLAudioElement[] = [];
const createElement = document.createElement.bind(document);
document.createElement = ((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag === "audio") {
        const audio = element as HTMLAudioElement;
        Object.defineProperty(audio, "duration", { configurable: true, value: 1 });
        audio.load = () => {};
        audioElements.push(audio);
        if (autoMetadata) queueMicrotask(() => audio.dispatchEvent(new dom.Event("loadedmetadata")));
    }
    return element;
}) as typeof document.createElement;

mock.module("localforage", () => ({
    default: {
        createInstance: () => ({
            getItem: async () => null,
            setItem: async (key: string, value: unknown) => {
                writes.push(key);
                return value;
            },
        }),
    },
}));
mock.module("@/lib/video-poster", () => ({ captureVideoPoster: async () => undefined, detectVideoAudioTrackFromBlob: async () => undefined }));
mock.module("@/services/image-storage", () => ({ uploadImage: async () => undefined }));
class ResourceUploadError extends Error {
    permanent = true;
}
mock.module("@/services/api/resources", () => ({
    ResourceUploadError,
    resourceIdFromStorageKey: (key: string) => (key.startsWith("resource:") ? key.slice(9) : ""),
    resourceStorageKey: (id: string) => `resource:${id}`,
    resourceFileUrl: (id: string) => `/api/resources/${id}/file`,
    resolveResourceAccessURL: (url: string) => url,
    getResourceAccess: async () => ({ url: "" }),
    uploadResourceFile: async (blob: Blob, _kind: string, meta?: ResourceUploadMeta) => {
        uploads.push({ scope: getActiveUserScope(), meta });
        if (deferredUpload) await new Promise((_resolve, reject) => meta?.signal?.addEventListener("abort", () => reject(meta.signal?.reason), { once: true }));
        if (uploadFailure) throw uploadFailure;
        return { id: `output-${uploads.length}`, size: blob.size, mimeType: blob.type };
    },
}));
mock.module("@/services/resource-blob-cache", () => ({
    getCachedResourceBlob: () => {
        reads++;
        return sharedRead.promise;
    },
    primeResourceBlobCache: async () => "",
}));
mock.module("antd", () => ({ App: { useApp: () => ({ message: { info: () => {}, success: () => {}, warning: () => {} } }) } }));
mock.module("@/constant/canvas", () => ({ NODE_DEFAULT_SIZE: { audio: { width: 320, height: 120 } } }));
mock.module("@/lib/canvas/canvas-project-domain", () => ({ createCanvasNode: (_type: string, position: unknown, metadata: unknown) => ({ id: `audio-${uploads.length}`, type: "audio", position, metadata, width: 320, height: 120 }) }));
mock.module("@/lib/canvas/canvas-generation-task-sync", () => ({ audioMetadata: (uploaded: { url: string; storageKey: string }) => ({ content: uploaded.url, storageKey: uploaded.storageKey, status: "success" }) }));
mock.module("@/services/project-asset-sync", () => ({ ensureCanvasNodeAsset: async () => ({ assetId: "asset", syncPending: false }) }));
mock.module("@/services/audio-stem", () => ({
    separateAudioLocally: async (_blob: Blob, _selection: string, signal: AbortSignal) => {
        signal.throwIfAborted();
        inferCalls++;
        return [
            { stem: "vocals", blob: new Blob(["wav"], { type: "audio/wav" }) },
            { stem: "instrumental", blob: new Blob(["wav"], { type: "audio/wav" }) },
        ];
    },
}));

const { uploadMediaFile, getMediaBlob } = await import("@/services/file-storage");
const { useCanvasAudioStem } = await import("@/pages/canvas/use-canvas-audio-stem");
const { CanvasAudioStemTask } = await import("@/components/canvas/canvas-audio-stem-task");
const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Audio, title: "原音频", position: { x: 0, y: 0 }, width: 320, height: 120, metadata: { storageKey: "resource:input", status: "success" } };
const nodesRef = { current: [source] };
let api: ReturnType<typeof useCanvasAudioStem>;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLElement | undefined;
const viewed: string[] = [];
function Harness() {
    api = useCanvasAudioStem({
        projectId: "canvas",
        nodesRef,
        setNodes: (update) => {
            nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update;
        },
        setConnections: () => {},
    });
    return (
        <>
            <input aria-label="画布节点名称" defaultValue="继续编辑" />
            {api.task ? <CanvasAudioStemTask task={api.task} onCancel={api.cancel} onRetry={api.retry} onDismiss={api.dismissTask} onView={(id) => viewed.push(id)} /> : null}
        </>
    );
}
const input = () => new File(["wav"], "result.wav", { type: "audio/wav" });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
    setActiveUserScope("account-a");
    uploads.length = 0;
    writes.length = 0;
    audioElements.length = 0;
    uploadFailure = undefined;
    deferredUpload = false;
    autoMetadata = false;
    sharedRead = deferred<Blob>();
    reads = 0;
    inferCalls = 0;
    nodesRef.current = [source];
    viewed.length = 0;
});
afterEach(() => {
    if (root) act(() => root?.unmount());
    root = undefined;
    container?.remove();
});
afterAll(() => dom.happyDOM.abort());

test("元数据读取期间切换账号，不发出上传或写入本地缓存", async () => {
    const promise = uploadMediaFile(input(), "audio", undefined, { expectedUserId: "account-a" });
    const outcome = promise.catch((error) => error);
    expect(audioElements).toHaveLength(1);
    setActiveUserScope("account-b");
    expect(await outcome).toHaveProperty("name", "AbortError");
    audioElements[0].dispatchEvent(new dom.Event("loadedmetadata"));
    expect(uploads).toBeEmpty();
    expect(writes).toBeEmpty();
    expect(audioElements[0].getAttribute("src")).toBeNull();
});

test("元数据读取期间取消，不降级为本地暂存", async () => {
    const controller = new AbortController();
    const promise = uploadMediaFile(input(), "audio", undefined, { signal: controller.signal, expectedUserId: "account-a" });
    const outcome = promise.catch((error) => error);
    controller.abort();
    expect(await outcome).toHaveProperty("name", "AbortError");
    expect(uploads).toBeEmpty();
    expect(writes).toBeEmpty();
});

test("预期账号不匹配或已取消时，不启动元数据读取", async () => {
    await expect(uploadMediaFile(input(), "audio", undefined, { expectedUserId: "account-b" })).rejects.toHaveProperty("name", "AbortError");
    const controller = new AbortController();
    controller.abort();
    await expect(uploadMediaFile(input(), "audio", undefined, { signal: controller.signal })).rejects.toHaveProperty("name", "AbortError");
    expect(audioElements).toBeEmpty();
    expect(uploads).toBeEmpty();
});

test("实际上传携带任务账号和取消信号，取消中断请求且不本地兜底", async () => {
    autoMetadata = true;
    deferredUpload = true;
    const controller = new AbortController();
    const promise = uploadMediaFile(input(), "audio", undefined, { signal: controller.signal, expectedUserId: "account-a" });
    const outcome = promise.catch((error) => error);
    await tick();
    expect(uploads[0].meta?.expectedUserId).toBe("account-a");
    expect(uploads[0].meta?.signal?.aborted).toBe(false);
    controller.abort();
    expect(await outcome).toHaveProperty("name", "AbortError");
    expect(uploads[0].meta?.signal?.aborted).toBe(true);
    expect(writes).toBeEmpty();
});

test("上传中的账号切换中断旧请求，不创建新账号上传", async () => {
    autoMetadata = true;
    deferredUpload = true;
    const promise = uploadMediaFile(input(), "audio");
    const outcome = promise.catch((error) => error);
    await tick();
    setActiveUserScope("account-b");
    expect(await outcome).toHaveProperty("name", "AbortError");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].scope).toBe("account-a");
    expect(uploads[0].meta?.signal?.aborted).toBe(true);
    expect(writes).toBeEmpty();
});

test("真正的瞬时上传失败仍保留本机缓存", async () => {
    autoMetadata = true;
    uploadFailure = new Error("网络暂时不可用");
    const result = await uploadMediaFile(input(), "audio");
    expect(result.pendingRemoteUpload).toBe(true);
    expect(result.storageKey).toStartWith("audio:account-a:");
    expect(writes).toEqual([result.storageKey]);
});

test("取消共享素材的一个等待方，不中断其他读取者", async () => {
    const controller = new AbortController();
    const cancelled = getMediaBlob("resource:input", controller.signal);
    const outcome = cancelled.catch((error) => error);
    const other = getMediaBlob("resource:input");
    await tick();
    controller.abort();
    expect(await outcome).toHaveProperty("name", "AbortError");
    const blob = input();
    sharedRead.resolve(blob);
    expect(await other).toBe(blob);
});

test("已取消的素材读取不会启动缓存或下载请求", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getMediaBlob("resource:input", controller.signal)).rejects.toHaveProperty("name", "AbortError");
    expect(reads).toBe(0);
});

test("真实分离 hook 在源下载取消后可立即重试，旧下载完成不会重复推理或写回", async () => {
    autoMetadata = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
    act(() => api.open(source));
    let first!: Promise<void>;
    await act(async () => {
        first = api.run("both");
        await tick();
    });
    expect(reads).toBe(1);
    await act(async () => {
        api.cancel();
        await first;
    });
    expect(inferCalls).toBe(0);
    act(() => api.open(source));
    expect(api.nodeId).toBe(source.id);
    let second!: Promise<void>;
    await act(async () => {
        second = api.run("both");
        await tick();
    });
    expect(reads).toBe(2);
    await act(async () => {
        sharedRead.resolve(input());
        await second;
    });
    expect(inferCalls).toBe(1);
    expect(uploads).toHaveLength(2);
    expect(uploads.every((upload) => upload.meta?.expectedUserId === "account-a" && upload.meta?.signal)).toBe(true);
    expect(nodesRef.current).toHaveLength(3);
    expect(api.nodeId).toBeNull();
});

function mountCanvas() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<Harness />));
    act(() => api.open(source));
}

test("开始后关闭配置，收起进度不取消任务，画布输入与焦点保持可用", async () => {
    autoMetadata = true;
    mountCanvas();
    let running!: Promise<void>;
    await act(async () => {
        running = api.run("both");
        await tick();
    });
    expect(api.nodeId).toBeNull();
    expect(api.task?.status).toBe("running");
    const inputElement = container!.querySelector("input")!;
    inputElement.focus();
    inputElement.value = "处理中继续编辑的名称";
    act(() => api.close());
    expect(api.task?.status).toBe("running");
    expect(container!.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
    act(() => (container!.querySelector('[aria-label="收起分离进度"]') as HTMLButtonElement).click());
    expect(container!.querySelector('[role="progressbar"]')).toBeNull();
    expect(api.task?.status).toBe("running");
    await act(async () => {
        sharedRead.resolve(input());
        await running;
    });
    expect(api.task?.status).toBe("succeeded");
    expect(api.task?.resultIds).toHaveLength(2);
    expect(document.activeElement).toBe(inputElement);
    expect(inputElement.value).toBe("处理中继续编辑的名称");
    expect(viewed).toBeEmpty();
    act(() => (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent?.includes("查看结果")) as HTMLButtonElement).click());
    expect(viewed).toEqual([api.task!.resultIds[0]]);
});

test("后台失败在任务卡显示，可直接重试，不重新阻塞配置弹窗", async () => {
    autoMetadata = true;
    mountCanvas();
    let running!: Promise<void>;
    await act(async () => {
        running = api.run("both");
        await tick();
    });
    await act(async () => {
        sharedRead.reject(new Error("音频读取失败，请重试"));
        await running;
    });
    expect(api.task?.status).toBe("failed");
    expect(container!.querySelector('[role="alert"]')?.textContent).toContain("音频读取失败");
    sharedRead = deferred<Blob>();
    await act(async () => {
        (Array.from(container!.querySelectorAll("button")).find((button) => button.textContent === "重试") as HTMLButtonElement).click();
        await tick();
    });
    expect(api.task?.status).toBe("running");
    expect(api.nodeId).toBeNull();
    await act(async () => {
        api.cancel();
        await tick();
    });
    expect(api.task?.status).toBe("cancelled");
    act(() => api.dismissTask());
    expect(api.task).toBeNull();
});

test("后台读取中切换账号，清除旧账号任务卡且不写回结果", async () => {
    mountCanvas();
    let running!: Promise<void>;
    await act(async () => {
        running = api.run("both");
        await tick();
    });
    await act(async () => {
        setActiveUserScope("account-b");
        await new Promise((resolve) => setTimeout(resolve, 300));
        await running;
    });
    expect(api.task).toBeNull();
    expect(container!.querySelector('[aria-label="音频分离任务"]')).toBeNull();
    expect(inferCalls).toBe(0);
    expect(uploads).toBeEmpty();
});
