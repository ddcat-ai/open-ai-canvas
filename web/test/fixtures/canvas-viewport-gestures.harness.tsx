import { afterAll, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ViewportTransform } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ResizeObserver: dom.ResizeObserver,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createPortal } = await import("react-dom");
const { CanvasViewport } = await import("../../src/components/canvas/canvas-viewport");
const { CanvasResourceMentionTextarea } = await import("../../src/components/canvas/canvas-resource-mention-textarea");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function mount(realPrompt = false) {
    const host = document.createElement("div");
    const portal = document.createElement("div");
    document.body.append(host, portal);
    const root = createRoot(host);
    const containerRef = createRef<HTMLDivElement>();
    const previews: ViewportTransform[] = [];
    let now = 1000;
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const render = (interactive: boolean) =>
        root.render(
            <CanvasViewport interactive={interactive} containerRef={containerRef} viewport={{ x: 0, y: 0, k: 1 }} onViewportChange={() => {}} onViewportPreviewChange={(value) => previews.push(value)}>
                <div data-canvas-no-zoom data-test-panel onWheel={(event) => event.stopPropagation()}>
                    {realPrompt ? <CanvasResourceMentionTextarea value={"长提示词\n".repeat(40)} references={[]} onChange={() => {}} /> : <textarea />}
                </div>
                {createPortal(
                    <div className="ant-popover" onWheel={(event) => event.stopPropagation()}>
                        参数
                    </div>,
                    portal,
                )}
            </CanvasViewport>,
        );
    await act(async () => render(true));
    return {
        canvas: containerRef.current!,
        panel: host.querySelector("textarea")!,
        popup: portal.firstElementChild!,
        previews,
        advance: (milliseconds: number) => {
            now += milliseconds;
        },
        wheel: (target: Element, options: WheelEventInit = {}) => {
            now += 10;
            const event = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 12, ...options });
            // Happy DOM 的 WheelEvent 继承 UIEvent，需补上浏览器提供的鼠标修饰键与坐标。
            Object.assign(event, { ctrlKey: false, metaKey: false, shiftKey: false, clientX: 100, clientY: 100, ...options });
            target.dispatchEvent(event);
            return event;
        },
        disable: () => act(async () => render(false)),
        dispose: async () => {
            await act(async () => root.unmount());
            clock.mockRestore();
            host.remove();
            portal.remove();
        },
    };
}

test("画布起点连续经过输入框、body Portal 再回到画布，位移累计且阻止面板滚动", async () => {
    const ui = await mount();
    try {
        for (const target of [ui.canvas, ui.panel, ui.popup, ui.canvas]) {
            expect(ui.wheel(target).defaultPrevented).toBe(true);
        }
        expect(ui.previews.map((value) => value.y)).toEqual([-12, -24, -36, -48]);
        ui.advance(121);
        expect(ui.wheel(ui.panel).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(4);
    } finally {
        await ui.dispose();
    }
});

test("面板起点的滚动不会中途接管画布，空闲后允许新画布手势", async () => {
    const ui = await mount();
    try {
        expect(ui.wheel(ui.panel).defaultPrevented).toBe(false);
        expect(ui.wheel(ui.canvas).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(0);
        ui.advance(121);
        expect(ui.wheel(ui.canvas, { deltaX: 8, deltaY: 4 }).defaultPrevented).toBe(true);
        expect(ui.previews).toEqual([{ x: -8, y: -4, k: 1 }]);
    } finally {
        await ui.dispose();
    }
});

test("画布外的新手势、已结束手势和禁用画布不被全局监听拦截", async () => {
    const ui = await mount();
    try {
        expect(ui.wheel(ui.popup).defaultPrevented).toBe(false);
        expect(ui.wheel(ui.canvas).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(0);
        ui.advance(121);
        ui.wheel(ui.canvas);
        ui.advance(121);
        expect(ui.wheel(ui.popup).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(1);
        await ui.disable();
        expect(ui.wheel(ui.canvas).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(1);
    } finally {
        await ui.dispose();
    }
});

test.each([100, 120, 125])("连续平移的 %s 增量不会改为缩放或丢失手势归属", async (delta) => {
    const ui = await mount();
    try {
        ui.wheel(ui.canvas);
        for (const target of [ui.canvas, ui.panel, ui.popup]) {
            expect(ui.wheel(target, { deltaY: delta }).defaultPrevented).toBe(true);
            expect(ui.wheel(target).defaultPrevented).toBe(true);
        }
        expect(ui.previews).toHaveLength(7);
        expect(ui.previews.at(-1)).toEqual({ x: 0, y: -12 - 3 * (delta + 12), k: 1 });
        expect(ui.previews.every((value) => value.k === 1)).toBe(true);
    } finally {
        await ui.dispose();
    }
});

test("画布手势经过真实提示词不滚动文本，面板起点仍可手工滚动", async () => {
    const ui = await mount(true);
    try {
        ui.panel.scrollTop = 40;
        ui.wheel(ui.canvas);
        ui.wheel(ui.panel);
        expect(ui.panel.scrollTop).toBe(40);
        expect(ui.previews.at(-1)).toEqual({ x: 0, y: -24, k: 1 });
        ui.advance(121);
        ui.wheel(ui.panel);
        expect(ui.panel.scrollTop).toBe(52);
        expect(ui.previews).toHaveLength(2);
    } finally {
        await ui.dispose();
    }
});

test("空闲后的离散滚轮重新识别，捏合可直接切换为缩放", async () => {
    const ui = await mount();
    try {
        ui.wheel(ui.canvas);
        ui.advance(121);
        expect(ui.wheel(ui.panel, { deltaY: 120 }).defaultPrevented).toBe(false);
        expect(ui.previews).toHaveLength(1);
        ui.wheel(ui.canvas, { deltaY: 120 });
        expect(ui.previews.at(-1)!.k).toBeLessThan(1);
        ui.wheel(ui.canvas);
        const scale = ui.previews.at(-1)!.k;
        expect(ui.wheel(ui.panel, { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(ui.previews.at(-1)!.k).toBeLessThan(scale);
    } finally {
        await ui.dispose();
    }
});
