import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { InspirationCover } from "../src/pages/inspirations/inspiration-detail-modal";

test("card covers load on approach, while a detail cover and browsers without observers load immediately", async () => {
    const dom = new Window({ url: "https://fixture.example" });
    const cover = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
    const host = dom.document.createElement("div");
    dom.document.body.append(host);
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    let disconnected = 0;
    let observed: Element | undefined;
    class Observer {
        constructor(callback: typeof notify) {
            notify = callback;
        }
        observe(element: Element) {
            observed = element;
        }
        disconnect() {
            disconnected++;
        }
    }

    const globals = { window: dom, document: dom.document, IntersectionObserver: Observer, IS_REACT_ACT_ENVIRONMENT: true };
    const originals = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, value });
    const root = createRoot(host as unknown as HTMLElement);
    try {
        await act(async () => root.render(<InspirationCover defer image={cover} />));
        const image = host.querySelector("img")!;
        expect(observed).toBe(image as unknown as Element);
        expect(image.hasAttribute("src")).toBe(false);
        await act(async () => notify([{ isIntersecting: false }]));
        expect(image.hasAttribute("src")).toBe(false);
        await act(async () => notify([{ isIntersecting: true }]));
        expect(image.getAttribute("src")).toBe(cover);
        expect(disconnected).toBeGreaterThan(0);

        await act(async () => root.render(<InspirationCover key="detail" image={cover + "#detail"} />));
        expect(host.querySelector("img")?.getAttribute("src")).toBe(cover + "#detail");
        Reflect.deleteProperty(globalThis, "IntersectionObserver");
        await act(async () => root.render(<InspirationCover key="fallback" defer image={cover + "#fallback"} />));
        expect(host.querySelector("img")?.getAttribute("src")).toBe(cover + "#fallback");
    } finally {
        try {
            await act(async () => root.unmount());
        } finally {
            for (const name of Object.keys(globals)) {
                const original = originals.get(name);
                if (original) Object.defineProperty(globalThis, name, original);
                else Reflect.deleteProperty(globalThis, name);
            }
            await dom.happyDOM.abort();
        }
    }
});
