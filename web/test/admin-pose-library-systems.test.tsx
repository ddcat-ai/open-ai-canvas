import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://admin.example.com/admin/pose-library" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    DOMParser: dom.DOMParser,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLButtonElement: dom.HTMLButtonElement,
    SVGElement: dom.SVGElement,
    Blob: dom.Blob,
    File: dom.File,
    URL: dom.URL,
    XMLHttpRequest: dom.XMLHttpRequest,
    MutationObserver: dom.MutationObserver,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    matchMedia: () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
(globalThis as Record<string, unknown>).__APP_VERSION__ = "test";
(globalThis as Record<string, unknown>).__APP_CHANGELOG__ = "";
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { PoseLibrarySystems } = await import("../src/pages/admin/pose-library/pose-library-page");
type BulkAction = "enable" | "disable" | "resync" | "delete";

const systems = Array.from({ length: 13 }, (_, index) => ({
    sourceKey: `source-${index + 1}`,
    system: `体系 ${index + 1}`,
    total: 200 + index,
    ready: 150 + index,
    enabled: index === 0 ? 0 : 100 + index,
}));
const sourceName = new Map(systems.map((item) => [item.sourceKey, `来源 ${item.sourceKey.slice(-1)}`]));

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
const bulkCalls: Array<[BulkAction, string]> = [];

async function render() {
    bulkCalls.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(<PoseLibrarySystems systems={systems} sourceName={sourceName} onBulk={(action, target) => bulkCalls.push([action, target.system])} />);
    });
}

const details = () => document.querySelector<HTMLDetailsElement>(".pose-library-systems")!;
const rows = () => document.querySelectorAll<HTMLElement>(".pose-library-systems .divide-y > div");

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    host?.remove();
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("姿势库按体系管理", () => {
    test("默认折叠，摘要展示体系数量与统计", async () => {
        await render();
        expect(details().open).toBe(false);
        const summary = document.querySelector(".pose-library-systems summary")!;
        expect(summary.textContent).toContain("13 个体系");
        expect(summary.textContent).toContain(`共 ${systems.reduce((sum, item) => sum + item.total, 0)} 条`);
        expect(rows()).toHaveLength(13);
    });

    test("展开后体系列表限高滚动，不挤压下方资源列表", async () => {
        await render();
        await act(async () => {
            details().open = true;
        });
        expect(details().open).toBe(true);
        const list = document.querySelector<HTMLElement>(".pose-library-systems .mt-2")!;
        expect(list.className).toContain("max-h-60");
        expect(list.className).toContain("overflow-y-auto");
        expect(rows()).toHaveLength(13);
        expect(rows()[12].textContent).toContain("体系 13");
        expect(rows()[0].textContent).toContain("来源 1");
    });

    test("体系行动作保留启用、停用、重新同步与删除", async () => {
        await render();
        const first = rows()[0];
        const buttons = first.querySelectorAll<HTMLButtonElement>("button");
        expect(Array.from(buttons).map((button) => button.textContent?.replace(/\s+/g, ""))).toEqual(["全部启用", "全部停用", "重新同步", "删除"]);
        expect(buttons[1].disabled).toBe(true);
        await act(async () => {
            buttons[0].click();
        });
        expect(bulkCalls).toEqual([["enable", "体系 1"]]);
    });
});
