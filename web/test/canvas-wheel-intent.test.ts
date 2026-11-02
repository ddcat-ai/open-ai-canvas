import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { canvasWheelBelongsToViewport, canvasWheelIntentTarget, createCanvasWheelIntent, observeCanvasEditorWheelZoom } from "@/lib/canvas/canvas-wheel-intent";

const point = { clientX: 20, clientY: 30 };
const wheel = (dom: Window, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) => {
    const event = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 20 });
    // happy-dom does not copy MouseEvent modifier fields into WheelEventInit.
    for (const key of ["ctrlKey", "metaKey"] as const) Object.defineProperty(event, key, { value: Boolean(modifiers[key]) });
    return event;
};

describe("canvas wheel ownership", () => {
    test("settling over text cannot steal an already running pan", () => {
        const intent = createCanvasWheelIntent<object>();
        const text = {};
        expect(intent.resolve(null, point, 0)).toBe("canvas");
        intent.move(text, point, 10);
        expect(intent.resolve(null, point, 160)).toBe("canvas");
        for (const now of [180, 250, 350, 450, 550]) expect(intent.resolve(text, point, now)).toBe("canvas");
        expect(intent.resolve(text, point, 750)).toBe("scroll");
        expect(intent.resolve(text, point, 770)).toBe("scroll");
    });

    test("movement resets the hover dwell and nested targets cannot steal a gesture", () => {
        const intent = createCanvasWheelIntent<object>();
        const first = {},
            second = {};
        intent.move(first, point, 0);
        intent.move(first, { clientX: 40, clientY: 30 }, 150);
        expect(intent.resolve(first, { clientX: 40, clientY: 30 }, 200)).toBe("canvas");
        expect(intent.resolve(first, { clientX: 40, clientY: 30 }, 400)).toBe("scroll");
        intent.move(second, point, 410);
        expect(intent.resolve(second, point, 420)).toBe("canvas");
        expect(intent.resolve(second, point, 600)).toBe("scroll");
    });

    test("horizontal and modifier gestures can reclaim canvas ownership", () => {
        const intent = createCanvasWheelIntent<object>();
        const text = {};
        intent.move(text, point, 0);
        expect(intent.resolve(text, point, 200)).toBe("scroll");
        expect(intent.resolve(text, point, 210, true)).toBe("canvas");
        expect(intent.resolve(text, point, 250)).toBe("canvas");
        intent.reset();
        expect(intent.resolve(text, point, 1000)).toBe("canvas");
    });
});

describe("canvas wheel DOM boundaries", () => {
    test("storyboard text inherits intent while menus and numeric inputs do not", () => {
        const dom = new Window();
        dom.document.body.innerHTML = '<div data-canvas-wheel-intent><textarea></textarea><input/><select></select><div class="ant-popover"><textarea></textarea></div></div>';
        const doc = dom.document;
        const area = doc.querySelector("textarea")!;
        const root = doc.querySelector("[data-canvas-wheel-intent]")!;
        expect(canvasWheelIntentTarget(area as unknown as Element)).toBe(root as unknown as Element);
        for (const selector of ["input", "select", ".ant-popover textarea"]) expect(canvasWheelIntentTarget(doc.querySelector(selector) as unknown as Element)).toBeNull();
        dom.happyDOM.abort();
    });

    test("associated node panels share their canvas, unrelated page controls do not", () => {
        const dom = new Window();
        dom.document.body.innerHTML =
            '<main><section><div data-canvas-viewport></div><div data-canvas-node-panel><textarea></textarea></div></section><aside><div data-canvas-viewport></div></aside><textarea id="page"></textarea><div class="canvas-prompt-editor-modal"><textarea></textarea></div></main>';
        const doc = dom.document;
        const viewport = doc.querySelector("[data-canvas-viewport]")! as unknown as HTMLElement;
        const editor = doc.querySelector("[data-canvas-node-panel] textarea")! as unknown as Element;
        expect(canvasWheelBelongsToViewport(editor, viewport)).toBe(true);
        expect(canvasWheelBelongsToViewport(editor, doc.querySelector("aside [data-canvas-viewport]")! as unknown as HTMLElement)).toBe(false);
        expect(canvasWheelBelongsToViewport(doc.querySelector("#page")! as unknown as Element, viewport)).toBe(false);
        expect(canvasWheelBelongsToViewport(doc.querySelector(".canvas-prompt-editor-modal textarea")! as unknown as Element, viewport)).toBe(false);
        dom.happyDOM.abort();
    });

    test("native non-passive zoom guard cancels modifiers only inside canvas editors and cleans up", () => {
        const dom = new Window();
        for (const scope of ["data-canvas-viewport", "data-canvas-node-panel", 'class="canvas-prompt-editor-modal"']) {
            dom.document.body.innerHTML = `<section ${scope}><div id="editor"><textarea></textarea></div></section>`;
            const root = dom.document.querySelector("#editor")!;
            const input = root.querySelector("textarea")!;
            const cleanup = observeCanvasEditorWheelZoom(root as unknown as HTMLElement);
            for (const key of ["ctrlKey", "metaKey"] as const) {
                const event = wheel(dom, { [key]: true });
                input.dispatchEvent(event);
                expect(event.defaultPrevented).toBe(true);
            }
            const ordinary = wheel(dom);
            input.dispatchEvent(ordinary);
            expect(ordinary.defaultPrevented).toBe(false);
            cleanup();
            const after = wheel(dom, { ctrlKey: true });
            input.dispatchEvent(after);
            expect(after.defaultPrevented).toBe(false);
        }
        dom.document.body.innerHTML = '<div id="page"><textarea></textarea></div>';
        const root = dom.document.querySelector("#page")!;
        const cleanup = observeCanvasEditorWheelZoom(root as unknown as HTMLElement);
        const event = wheel(dom, { ctrlKey: true });
        root.querySelector("textarea")!.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        cleanup();
        dom.happyDOM.abort();
    });
});
