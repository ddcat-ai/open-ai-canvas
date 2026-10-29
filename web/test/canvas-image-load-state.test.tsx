import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

// 图片加载失败不再留下透明空白：先强制重签一次原图地址自动重试，仍失败才显示「重新加载」。
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
const { RetainedCanvasImage } = await import("../src/components/canvas/canvas-node-media-content");
const { canvasThemes } = await import("../src/lib/canvas-theme");

const accessRequests: unknown[] = [];
let nextAccessUrl = "https://cdn.example.com/fresh.png";
const previousAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => {
    const payload = JSON.parse(String(config.data || "[]")) as Array<{ resourceId: string }>;
    accessRequests.push(...payload);
    const items = payload.map((item) => ({ access: { resourceId: item.resourceId, url: nextAccessUrl, delivery: "cdn", actualVariant: "original", requestedVariant: "original", issuedAt: new Date().toISOString() } }));
    return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { items } } };
};

afterAll(() => {
    apiClient.defaults.adapter = previousAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

beforeEach(() => {
    failingUrls.clear();
    accessRequests.length = 0;
    nextAccessUrl = "https://cdn.example.com/fresh.png";
});

const settle = async () => {
    for (let index = 0; index < 8; index += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
};

async function mount(props: { src: string; storageKey?: string; accessFailed?: boolean; identity: string }) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<RetainedCanvasImage {...props} fallbackSrc="" originalSize={{}} fitToImage={() => {}} className="" loading={false} theme={canvasThemes.dark} />);
    });
    await settle();
    return { host, unmount: () => act(() => root.unmount()) };
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
