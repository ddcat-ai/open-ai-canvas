import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "../src/types/canvas";

// 图片失败时重签相同展示档位；仍失败才显示「重新加载」，缩略图不能隐式升级成原图。
const dom = new Window({ url: "http://localhost/" });
const failingUrls = new Set<string>();
class FakeImage {
    onload: ((event: Event) => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = "async";
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    private current = "";
    get src() {
        return this.current;
    }
    set src(value: string) {
        this.current = value;
        queueMicrotask(() => {
            if (failingUrls.has(value)) return this.onerror?.();
            this.complete = true;
            this.naturalWidth = 1824;
            this.naturalHeight = 1024;
            this.onload?.(new Event("load"));
        });
    }
    removeAttribute() {}
    decode() {
        return Promise.resolve();
    }
}
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MouseEvent: dom.MouseEvent,
    Image: FakeImage,
    FileReader: class {
        result: ArrayBuffer | null = null;
        onload: (() => void) | null = null;
        readAsArrayBuffer(blob: Blob) {
            void blob.arrayBuffer().then((value) => {
                this.result = value;
                this.onload?.();
            });
        }
    },
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { apiClient } = await import("../src/services/api/request");
const { ImageContent, RetainedCanvasImage, useNodeResourceUrl } = await import("../src/components/canvas/canvas-node-media-content");
const { CanvasNodeActionContext } = await import("../src/components/canvas/canvas-node-action-context");
const { CachedResourceImage } = await import("../src/components/cached-resource-image");
const { clearResourceAccessCache } = await import("../src/services/api/resources");
const { primeResourceBlobCache, clearResourceBlobCache, acquireCachedResourceObjectUrl } = await import("../src/services/resource-blob-cache");
const { setActiveUserScope } = await import("../src/lib/user-scope");
const { CanvasNodeType } = await import("../src/types/canvas");
const { canvasThemes } = await import("../src/lib/canvas-theme");

const accessRequests: unknown[] = [];
let nextAccessUrl = "https://cdn.example.com/fresh.png";
let failAccess = false;
let originalDimensions: { originalWidth?: number; originalHeight?: number } = {};
const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => {
    const payload = JSON.parse(String(config.data || "[]")) as Array<{ resourceId: string; variant: string }>;
    accessRequests.push(...payload);
    if (failAccess) throw new Error("access unavailable");
    const items = payload.map((item) => ({ access: { resourceId: item.resourceId, url: nextAccessUrl, delivery: "cdn", actualVariant: item.variant, requestedVariant: item.variant, issuedAt: new Date().toISOString(), ...originalDimensions } }));
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items } } };
};

afterAll(() => {
    clearResourceAccessCache();
    clearResourceBlobCache();
    setActiveUserScope(null);
    apiClient.defaults.adapter = previousAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

beforeEach(() => {
    clearResourceAccessCache();
    clearResourceBlobCache();
    setActiveUserScope(null);
    failingUrls.clear();
    accessRequests.length = 0;
    nextAccessUrl = "https://cdn.example.com/fresh.png";
    failAccess = false;
    originalDimensions = {};
});

const settle = async () => {
    for (let index = 0; index < 8; index += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
};

async function mount(props: { src: string; storageKey?: string; accessFailed?: boolean; identity: string; variant?: "original" | "thumbnail" }) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<RetainedCanvasImage {...props} fallbackSrc="" originalSize={{}} fitToImage={() => {}} className="" loading={false} theme={canvasThemes.dark} />);
    });
    await settle();
    return { host, unmount: () => act(async () => root.unmount()) };
}

test("首次地址失败时强制重签原图地址并自动重试一次", async () => {
    failingUrls.add("https://cdn.example.com/stale.png");
    const view = await mount({ identity: "a", src: "https://cdn.example.com/stale.png", storageKey: "resource:r1" });
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/fresh.png");
    expect(view.host.querySelector(".canvas-image-state")).toBeNull();
    expect(accessRequests).toHaveLength(1);
    await view.unmount();
});

test("重签后仍失败显示可重试的失败态，点击重新加载后恢复显示", async () => {
    // 加载器会缓存已解码图片，每个用例使用独立地址。
    nextAccessUrl = "https://cdn.example.com/fresh-b.png";
    failingUrls.add("https://cdn.example.com/stale-b.png");
    failingUrls.add(nextAccessUrl);
    const view = await mount({ identity: "b", src: "https://cdn.example.com/stale-b.png", storageKey: "resource:r2" });
    const error = view.host.querySelector('.canvas-image-state[data-state="error"]');
    expect(error?.textContent).toContain("图片暂时无法显示");
    expect(view.host.querySelector("img")?.getAttribute("src")).toBeNull();

    failingUrls.delete(nextAccessUrl);
    await act(async () => (view.host.querySelector(".canvas-image-state-retry") as HTMLButtonElement).click());
    await settle();
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
    expect(view.host.querySelector(".canvas-image-state")).toBeNull();
    expect(accessRequests).toHaveLength(2);
    await view.unmount();
});

test("访问地址换取失败且无回退时直接显示失败态，重试会重新换取地址", async () => {
    nextAccessUrl = "https://cdn.example.com/fresh-c.png";
    const view = await mount({ identity: "c", src: "", storageKey: "resource:r3", accessFailed: true });
    expect(view.host.querySelector('.canvas-image-state[data-state="error"]')).not.toBeNull();
    await act(async () => (view.host.querySelector(".canvas-image-state-retry") as HTMLButtonElement).click());
    await settle();
    expect(accessRequests).toHaveLength(1);
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
    await view.unmount();
});

test("尚无地址时用静态底板占位，而不是露出画布", async () => {
    const view = await mount({ identity: "d", src: "", storageKey: "resource:r4" });
    expect(view.host.querySelector('.canvas-image-state[data-state="idle"]')).not.toBeNull();
    expect(view.host.querySelector(".canvas-image-state-retry")).toBeNull();
    expect(accessRequests).toHaveLength(0);
    await view.unmount();
});

test("骨架微光只给占用下载并发位的图片，排队中的保持静止", async () => {
    // 让图片一直处于加载中，占满 4 个并发位后第 5 个只能排队。
    const hang = "https://cdn.example.com/hang-";
    const originalSetter = Object.getOwnPropertyDescriptor(FakeImage.prototype, "src")!;
    Object.defineProperty(FakeImage.prototype, "src", {
        configurable: true,
        get: originalSetter.get,
        set(value: string) {
            if (value.startsWith(hang)) return;
            originalSetter.set!.call(this, value);
        },
    });
    try {
        const views = [];
        for (let index = 0; index < 5; index += 1) views.push(await mount({ identity: `q${index}`, src: `${hang}${index}.png` }));
        const active = views.map((view) => view.host.querySelector(".canvas-image-skeleton")?.getAttribute("data-active"));
        expect(active.filter((value) => value === "true")).toHaveLength(4);
        expect(active[4]).toBeNull();
        for (const view of views) await view.unmount();
    } finally {
        Object.defineProperty(FakeImage.prototype, "src", originalSetter);
    }
});

test("非资源图片失败时不请求访问地址，直接显示失败态", async () => {
    failingUrls.add("https://provider.example.com/a.png");
    const view = await mount({ identity: "e", src: "https://provider.example.com/a.png" });
    expect(view.host.querySelector('.canvas-image-state[data-state="error"]')).not.toBeNull();
    expect(accessRequests).toHaveLength(0);
    await view.unmount();
});

test("缩略图地址过期时自动重签和手动重试均保持缩略图", async () => {
    nextAccessUrl = "https://cdn.example.com/thumbnail-fresh.webp";
    failingUrls.add("https://cdn.example.com/thumbnail-stale.webp");
    failingUrls.add(nextAccessUrl);
    const view = await mount({ identity: "thumbnail", src: "https://cdn.example.com/thumbnail-stale.webp", storageKey: "resource:thumb-retry", variant: "thumbnail" });
    expect(view.host.querySelector('.canvas-image-state[data-state="error"]')).not.toBeNull();
    expect(accessRequests).toEqual([{ resourceId: "thumb-retry", purpose: "display", variant: "thumbnail" }]);
    failingUrls.delete(nextAccessUrl);
    await act(async () => (view.host.querySelector(".canvas-image-state-retry") as HTMLButtonElement).click());
    await settle();
    expect(view.host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
    expect(accessRequests).toHaveLength(2);
    expect(accessRequests.every((item) => (item as { variant: string }).variant === "thumbnail")).toBe(true);
    await view.unmount();
});

test("共享缩略图组件加载失败不会降级请求原图", async () => {
    nextAccessUrl = "https://cdn.example.com/thumbnail-broken.webp";
    failingUrls.add(nextAccessUrl);
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<CachedResourceImage storageKey="resource:thumb-cached-component" variant="thumbnail" eager fallback={<span>预览不可用</span>} />));
    await settle();
    expect(host.textContent).toContain("预览不可用");
    expect(accessRequests.length).toBeGreaterThan(0);
    expect(accessRequests.every((item) => (item as { variant: string }).variant === "thumbnail")).toBe(true);
    await act(() => root.unmount());
});

function ResourceURLProbe({ storageKey }: { storageKey: string }) {
    const result = useNodeResourceUrl({ id: storageKey, type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey, content: "https://cdn.example.com/large-original.png" } }, true, "thumbnail");
    return <output data-failed={result.failed}>{result.url}</output>;
}

test("已缓存的上传原图不会绕过缩略图访问请求", async () => {
    nextAccessUrl = "https://cdn.example.com/upload-thumbnail.webp";
    setActiveUserScope("thumbnail-cache-user");
    await primeResourceBlobCache("resource:thumb-upload-cache", new Blob(["original-image"], { type: "image/png" }));
    const lease = acquireCachedResourceObjectUrl("resource:thumb-upload-cache");
    expect(lease?.url).toStartWith("blob:");
    lease?.release();
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<ResourceURLProbe storageKey="resource:thumb-upload-cache" />));
    await settle();
    expect(host.textContent).toBe(nextAccessUrl);
    expect(accessRequests).toEqual([{ resourceId: "thumb-upload-cache", purpose: "display", variant: "thumbnail" }]);
    await act(() => root.unmount());
});

test("缩略图访问接口失败时不会使用节点上的原图地址", async () => {
    failAccess = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<ResourceURLProbe storageKey="resource:thumb-access-error" />));
    await settle();
    expect(host.textContent).toBe("");
    expect(host.querySelector("output")?.getAttribute("data-failed")).toBe("true");
    await act(() => root.unmount());
});

for (const knownDimensions of [true, false]) {
    test(`小图显示不把解码尺寸当作原图尺寸：${knownDimensions ? "已知原图尺寸" : "原图尺寸缺失"}`, async () => {
        nextAccessUrl = `https://cdn.example.com/dimensions-${knownDimensions}.webp`;
        originalDimensions = knownDimensions ? { originalWidth: 4096, originalHeight: 2048 } : {};
        let current: CanvasNodeData = { id: "dimension-test", title: "图片", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { storageKey: `resource:dimensions-${knownDimensions}` } };
        const host = document.createElement("div");
        const root = createRoot(host);
        await act(async () => {
            root.render(
                <CanvasNodeActionContext.Provider
                    value={{
                        updateMediaNode: (_id, update) => {
                            current = update(current);
                        },
                    }}
                >
                    <ImageContent node={current} theme={canvasThemes.dark} isBatchRoot={false} batchCount={0} batchExpanded={false} batchOpening={false} batchRecovering={false} />
                </CanvasNodeActionContext.Provider>,
            );
        });
        await settle();
        expect(host.querySelector("img")?.getAttribute("src")).toBe(nextAccessUrl);
        expect(current.metadata?.naturalWidth).toBe(knownDimensions ? 4096 : undefined);
        expect(current.metadata?.naturalHeight).toBe(knownDimensions ? 2048 : undefined);
        await act(() => root.unmount());
    });
}
