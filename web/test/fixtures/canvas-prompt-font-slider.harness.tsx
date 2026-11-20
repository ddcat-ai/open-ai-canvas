import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasPromptFontSizeControl } = await import("@/components/canvas/canvas-prompt-font-size-control");
const { useCanvasPromptPreferencesStore: store } = await import("@/stores/canvas/use-canvas-prompt-preferences-store");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("font slider stays inside panel and blocks canvas close/drag events", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let outside = 0;
    await act(async () =>
        root.render(
            <div onClick={() => outside++} onPointerDown={() => outside++} onMouseDown={() => outside++}>
                <CanvasPromptFontSizeControl />
            </div>,
        ),
    );
    try {
        const input = host.querySelector("input")!;
        expect(input.type).toBe("range");
        await act(async () => {
            input.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true }));
            input.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true }));
            input.click();
        });
        expect(outside).toBe(0);
        expect(host.querySelector("input")).toBe(input);
        expect(document.querySelector(".ant-popover")).toBeNull();
        await act(async () => store.getState().setFontSize(22));
        expect(input.value).toBe("20");
        expect(host.textContent).toContain("20px");
        expect(JSON.parse(window.localStorage.getItem("yingce:canvas-prompt-preferences")!).state.fontSize).toBe(20);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
