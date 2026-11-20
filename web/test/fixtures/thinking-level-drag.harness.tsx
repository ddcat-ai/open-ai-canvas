import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ThinkingLevelSlider } = await import("../../src/components/thinking-level-slider");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("drag follows fractional positions locally and commits one level on release", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const changes: string[] = [];
    try {
        await act(async () => root.render(<ThinkingLevelSlider levels={["off", "low", "high", "max"]} value="off" onChange={(value) => changes.push(value)} />));
        const input = host.querySelector("input")!;
        input.setPointerCapture = () => {};
        await act(async () => input.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0 }) as unknown as Event));
        const setValue = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!;
        await act(async () => {
            setValue.call(input, "2.35");
            input.dispatchEvent(new dom.Event("input", { bubbles: true }) as unknown as Event);
        });
        expect(input.step).toBe("any");
        expect(input.value).toBe("2.35");
        expect(changes).toEqual([]);
        await act(async () => input.dispatchEvent(new dom.PointerEvent("pointerup", { bubbles: true, pointerId: 1 }) as unknown as Event));
        expect(changes).toEqual(["low"]);
        await act(async () => input.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "End", bubbles: true }) as unknown as Event));
        expect(changes.at(-1)).toBe("max");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
