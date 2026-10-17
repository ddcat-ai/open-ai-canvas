import { afterEach, describe, expect, test } from "bun:test";
import { useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useFocusMode } from "@/hooks/use-focus-mode";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const key = "canvas-focus-mode-v2";
type FocusAction = "enterFocusMode" | "exitFocusMode" | "toggleFocusMode";

afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

function viewport(width: number, storage: Map<string, string>, unavailable = false) {
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            innerWidth: width,
            localStorage: {
                getItem: (name: string) => {
                    if (unavailable) throw new Error("Storage unavailable");
                    return storage.get(name) ?? null;
                },
                setItem: (name: string, value: string) => {
                    if (unavailable) throw new Error("Storage unavailable");
                    storage.set(name, value);
                },
            },
        },
    });
}

// Render-phase state changes exercise the real hook and persistence without mocking React.
function Probe({ action }: { action?: FocusAction }) {
    const controls = useFocusMode();
    const applied = useRef(false);
    if (action && !applied.current) {
        applied.current = true;
        controls[action]();
    }
    return <output>{String(controls.focusMode)}</output>;
}

describe("canvas focus mode preference", () => {
    test("unsaved preference follows the unchanged 1024px default without persisting it", () => {
        const storage = new Map<string, string>();
        for (const [width, expected] of [
            [960, true],
            [1440, false],
            [1023, true],
            [1024, false],
        ] as const) {
            viewport(width, storage);
            expect(renderToStaticMarkup(<Probe />)).toBe(`<output>${expected}</output>`);
        }
        expect(storage.size).toBe(0);
    });

    test("explicit exit and toggle override small-screen default immediately and after reload", () => {
        const storage = new Map<string, string>();
        viewport(960, storage);
        expect(renderToStaticMarkup(<Probe action="exitFocusMode" />)).toBe("<output>false</output>");
        expect(storage.get(key)).toBe("false");
        expect(renderToStaticMarkup(<Probe />)).toBe("<output>false</output>");
        viewport(1440, storage);
        expect(renderToStaticMarkup(<Probe />)).toBe("<output>false</output>");
        expect(renderToStaticMarkup(<Probe action="toggleFocusMode" />)).toBe("<output>true</output>");
        expect(storage.get(key)).toBe("true");
        viewport(960, storage);
        expect(renderToStaticMarkup(<Probe action="toggleFocusMode" />)).toBe("<output>false</output>");
        expect(storage.get(key)).toBe("false");
    });

    test("saved true and false both win across viewport sizes", () => {
        for (const preference of [true, false]) {
            const storage = new Map([[key, String(preference)]]);
            for (const width of [960, 1440]) {
                viewport(width, storage);
                expect(renderToStaticMarkup(<Probe />)).toBe(`<output>${preference}</output>`);
            }
        }
    });

    test("unavailable storage still allows the current session to exit", () => {
        viewport(960, new Map(), true);
        expect(renderToStaticMarkup(<Probe />)).toBe("<output>true</output>");
        expect(renderToStaticMarkup(<Probe action="exitFocusMode" />)).toBe("<output>false</output>");
    });
});
