import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
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
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CommerceMarketPicker } = await import("../src/pages/ecommerce/market-picker");

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
const selected: string[] = [];

function Harness() {
    const [language, setLanguage] = useState("zh-CN");
    return (
        <CommerceMarketPicker
            platform="amazon"
            language={language}
            region=""
            onPlatform={() => undefined}
            onLanguage={(value) => {
                selected.push(value);
                setLanguage(value);
            }}
            onRegion={() => undefined}
            onClose={() => undefined}
        />
    );
}

async function render() {
    selected.length = 0;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(<Harness />);
    });
}

function trigger() {
    return document.querySelector<HTMLButtonElement>(".commerce-language-trigger")!;
}

function options() {
    return document.querySelector<HTMLElement>(".commerce-language-options");
}

async function open() {
    await act(async () => {
        trigger().click();
    });
}

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    host?.remove();
    document.querySelectorAll(".ant-modal-root").forEach((node) => node.remove());
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("投放平台与语言弹窗", () => {
    test("输出语言展开后保留完整列表高度并可选择、收起", async () => {
        await render();
        await open();
        expect(options()).not.toBeNull();
        expect(options()!.querySelectorAll('[role="option"]')).toHaveLength(12);
        expect(options()!.querySelector('[aria-selected="true"]')?.textContent).toContain("中文简体");

        const english = Array.from(options()!.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((item) => item.textContent?.includes("英文"))!;
        await act(async () => {
            english.click();
        });
        expect(selected).toEqual(["en"]);
        expect(options()).toBeNull();
        expect(trigger().textContent).toContain("英文");
        expect(document.activeElement).toBe(trigger());
    });

    test("Esc 与点击外部收起列表，焦点回到触发器", async () => {
        await render();
        await open();
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(options()).toBeNull();
        expect(document.activeElement).toBe(trigger());

        await open();
        await act(async () => {
            document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        });
        expect(options()).toBeNull();
    });

    test("列表在受高弹窗内按内容撑开，并由弹窗内容区滚动", async () => {
        const css = await Bun.file(new URL("../src/pages/ecommerce/market-picker.css", import.meta.url)).text();
        expect(css).toContain("grid-auto-rows: max-content;");
        expect(css).toContain("max-height: 240px;");
        expect(css).toContain("overflow-y: auto;");
    });
});
