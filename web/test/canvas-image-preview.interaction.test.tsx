import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLImageElement: dom.HTMLImageElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ConfigProvider } = await import("antd");
const { CanvasImagePreview } = await import("../src/components/canvas/canvas-image-preview");
const { CanvasViewport } = await import("../src/components/canvas/canvas-viewport");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const portrait = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"/>');
const landscape = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"/>');

async function fixture(initialSource = portrait) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const canvasRef = createRef<HTMLDivElement>();
    const viewportChanges: unknown[] = [];
    const contextMenus: unknown[] = [];
    const bubbleEvents: Event[] = [];
    let closed = 0;
    let source = initialSource;
    let visible = true;
    const onDocumentWheel = (event: Event) => bubbleEvents.push(event);
    document.addEventListener("wheel", onDocumentWheel);
    const render = () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <CanvasViewport containerRef={canvasRef} viewport={{ x: 30, y: 40, k: 2 }} onViewportChange={(value) => viewportChanges.push(value)} onContextMenu={(event) => contextMenus.push(event)}>
                    {visible ? (
                        <CanvasImagePreview
                            src={source}
                            alt="预览测试"
                            onClose={() => {
                                closed++;
                                visible = false;
                                render();
                            }}
                        />
                    ) : null}
                </CanvasViewport>
            </ConfigProvider>,
        );
    await act(async () => render());
    const image = () => document.querySelector<HTMLImageElement>(".canvas-image-preview-modal img")!;
    const surface = () => document.querySelector<HTMLElement>(".canvas-image-preview-modal [data-canvas-no-zoom]")!;
    const stage = () => image().parentElement!;
    const setBounds = () => {
        // HappyDOM 没有排版引擎；实际组件的滚轮处理使用这组已知视口几何。
        stage().getBoundingClientRect = () => new dom.DOMRect(100, 80, 800, 600) as unknown as DOMRect;
    };
    setBounds();
    return {
        image,
        surface,
        stage,
        viewportChanges,
        contextMenus,
        bubbleEvents,
        closed: () => closed,
        async load() {
            await act(async () => image().dispatchEvent(new dom.Event("load") as unknown as Event));
        },
        async error() {
            await act(async () => image().dispatchEvent(new dom.Event("error") as unknown as Event));
        },
        async update(next: string) {
            source = next;
            await act(async () => render());
            setBounds();
        },
        async reopen() {
            visible = true;
            await act(async () => render());
            setBounds();
        },
        async dispose() {
            document.removeEventListener("wheel", onDocumentWheel);
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function transform(image: HTMLImageElement) {
    const numbers = image.style.transform.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
    return { x: numbers[0], y: numbers[1], scale: numbers[2] };
}

function wheelEvent(deltaY: number, options: { clientX?: number; clientY?: number; deltaMode?: number; ctrlKey?: boolean } = {}) {
    const event = new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode: options.deltaMode ?? 0 });
    // HappyDOM 的 WheelEvent 未继承 MouseEvent，补齐真实浏览器已有的鼠标字段。
    Object.assign(event, { clientX: 500, clientY: 380, ctrlKey: false, ...options });
    return event;
}

async function wheel(target: Element, deltaY: number, options: { clientX?: number; clientY?: number; deltaMode?: number; ctrlKey?: boolean } = {}) {
    const event = wheelEvent(deltaY, options);
    await act(async () => target.dispatchEvent(event as unknown as Event));
    return event;
}

test("竖图和横图以完整比例显示，图片及展示区无描边且保留阴影", async () => {
    const f = await fixture();
    try {
        for (const source of [portrait, landscape]) {
            await f.update(source);
            await f.load();
            expect(f.image().src).toBe(source);
            expect(f.image().className).toContain("object-contain");
            expect(f.image().className).toContain("max-w-[94vw]");
            expect(f.image().className).toContain("max-h-");
            for (const element of [f.image(), f.stage(), f.surface()]) {
                expect(element.className.split(/\s+/).some((name) => /^border(?:-|$)/.test(name))).toBe(false);
                expect(element.style.borderColor).toBe("");
            }
            expect(f.image().style.boxShadow).toBe("var(--shadow-lg)");
            expect(transform(f.image())).toEqual({ x: 0, y: 0, scale: 1 });
            expect(f.image().getAttribute("draggable")).toBe("false");
        }
    } finally {
        await f.dispose();
    }
});

test("预览只保留照片浮层，标题仅用于可访问名称，不显示标题栏和整页白色内容窗", async () => {
    const f = await fixture();
    try {
        expect(document.querySelector(".canvas-image-preview-modal .ant-modal-header")?.className).toContain("sr-only");
        const dialog = document.querySelector('.canvas-image-preview-modal [role="dialog"], .canvas-image-preview-modal[role="dialog"]')!;
        const label = document.getElementById(dialog.getAttribute("aria-labelledby")!);
        expect(label?.textContent).toBe("预览测试");
        expect(f.surface().className).not.toMatch(/min-h-|w-full|p-4|p-6/);
        expect(f.stage().className).not.toMatch(/min-h-|w-full|p-3|p-5/);
        expect(f.image().className).toContain("max-w-[94vw]");
        expect(f.image().className).toContain("max-h-[84vh]");
    } finally {
        await f.dispose();
    }
});

test("滚轮围绕鼠标放大和缩小，阻止默认操作及底层画布/文档事件", async () => {
    const f = await fixture();
    try {
        await f.load();
        const beforeSrc = f.image().src;
        const up = await wheel(f.image(), -100, { clientX: 650, clientY: 300 });
        const enlarged = transform(f.image());
        expect(enlarged.scale).toBeGreaterThan(1);
        expect(enlarged.x + 150 * enlarged.scale).toBeCloseTo(150);
        expect(enlarged.y - 80 * enlarged.scale).toBeCloseTo(-80);
        expect(up.defaultPrevented).toBe(true);
        const down = await wheel(f.image(), 100, { clientX: 650, clientY: 300, ctrlKey: true });
        expect(transform(f.image()).scale).toBeCloseTo(1);
        expect(transform(f.image()).x).toBeCloseTo(0);
        expect(transform(f.image()).y).toBeCloseTo(0);
        expect(down.defaultPrevented).toBe(true);
        expect(f.image().src).toBe(beforeSrc);
        expect(f.viewportChanges).toEqual([]);
        expect(f.bubbleEvents).toEqual([]);
    } finally {
        await f.dispose();
    }
});

test("连续滚轮稳定累积并限制在 25% 到 800%，限位后仍拦截事件", async () => {
    const f = await fixture();
    try {
        await f.load();
        await act(async () => {
            for (let i = 0; i < 30; i++) f.image().dispatchEvent(wheelEvent(-100) as unknown as Event);
        });
        expect(transform(f.image())).toEqual({ x: 0, y: 0, scale: 8 });
        expect((await wheel(f.image(), -100)).defaultPrevented).toBe(true);
        for (let i = 0; i < 30; i++) await wheel(f.image(), 100);
        expect(transform(f.image())).toEqual({ x: 0, y: 0, scale: 0.25 });
        expect((await wheel(f.image(), 100)).defaultPrevented).toBe(true);
        expect(f.viewportChanges).toEqual([]);
        expect(f.bubbleEvents).toEqual([]);
    } finally {
        await f.dispose();
    }
});

test("兼容行和页单位滚轮，零增量不改变图片", async () => {
    const f = await fixture();
    try {
        await f.load();
        await wheel(f.image(), 0);
        expect(transform(f.image()).scale).toBe(1);
        await wheel(f.image(), -3, { deltaMode: 1 });
        expect(transform(f.image()).scale).toBeCloseTo(Math.exp(48 * 0.002));
        await wheel(f.image(), 1, { deltaMode: 2 });
        expect(transform(f.image()).scale).toBeLessThan(1);
    } finally {
        await f.dispose();
    }
});

test("切换图片和关闭重开都恢复完整适配状态", async () => {
    const f = await fixture();
    try {
        await f.load();
        await wheel(f.image(), -100, { clientX: 650 });
        await f.update(landscape);
        expect(transform(f.image())).toEqual({ x: 0, y: 0, scale: 1 });
        await f.load();
        await wheel(f.image(), -100);
        const closeButton = document.querySelector<HTMLButtonElement>(".canvas-image-preview-modal .ant-modal-close")!;
        await act(async () => closeButton.click());
        expect(f.closed()).toBe(1);
        expect(document.querySelector(".canvas-image-preview-modal")).toBeNull();
        await f.reopen();
        expect(transform(f.image())).toEqual({ x: 0, y: 0, scale: 1 });
    } finally {
        await f.dispose();
    }
});

test("拖动平移放大图，捕获指针并隔离底层画布，取消后停止移动", async () => {
    const f = await fixture();
    try {
        await f.load();
        await wheel(f.image(), -100);
        const capture = new Set<number>();
        f.image().setPointerCapture = (id) => {
            capture.add(id);
        };
        f.image().hasPointerCapture = (id) => capture.has(id);
        f.image().releasePointerCapture = (id) => {
            capture.delete(id);
        };
        const pointer = async (type: string, x: number, y: number) => {
            await act(async () => f.image().dispatchEvent(new dom.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y }) as unknown as Event));
        };
        const scale = transform(f.image()).scale;
        await pointer("pointerdown", 400, 300);
        expect(capture.has(1)).toBe(true);
        await pointer("pointermove", 460, 320);
        expect(transform(f.image())).toEqual({ x: 60, y: 20, scale });
        await pointer("pointerup", 460, 320);
        expect(capture.size).toBe(0);
        await pointer("pointermove", 490, 350);
        expect(transform(f.image())).toEqual({ x: 60, y: 20, scale });
        expect(f.viewportChanges).toEqual([]);
    } finally {
        await f.dispose();
    }
});

test("右键拖动平移画布并抑制菜单，右键单击仍保留菜单", async () => {
    const f = await fixture();
    try {
        const canvas = document.querySelector<HTMLElement>("[data-canvas-viewport]")!;
        const capture = new Set<number>();
        canvas.setPointerCapture = (id) => {
            capture.add(id);
        };
        canvas.hasPointerCapture = (id) => capture.has(id);
        canvas.releasePointerCapture = (id) => {
            capture.delete(id);
        };
        const pointer = async (type: string, x: number, y: number) => {
            const target = type === "pointerdown" ? canvas : window;
            await act(async () => target.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 2, pointerType: "mouse", button: 2, clientX: x, clientY: y }) as unknown as Event));
        };
        const contextMenu = async () => {
            const event = new dom.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
            await act(async () => canvas.dispatchEvent(event));
            return event;
        };

        await pointer("pointerdown", 400, 300);
        expect(capture.has(2)).toBe(true);
        await pointer("pointermove", 460, 320);
        await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
        const worldLayer = canvas.querySelector<HTMLElement>("[data-canvas-world-layer]")!;
        expect(worldLayer.style.transform).toContain("translate3d(90px, 60px");
        await pointer("pointerup", 460, 320);
        expect((await contextMenu()).defaultPrevented).toBe(true);
        expect(f.contextMenus).toHaveLength(0);

        await pointer("pointerdown", 460, 320);
        await pointer("pointerup", 460, 320);
        expect((await contextMenu()).defaultPrevented).toBe(false);
        expect(f.contextMenus).toHaveLength(1);
    } finally {
        await f.dispose();
    }
});

test("加载、错误和图片外留白拦截滚轮但不缩放，错误后换图可恢复", async () => {
    // HappyDOM 默认禁用图片网络加载，使用外部 URL 可显式控制 load/error。
    const f = await fixture("https://example.invalid/preview.png");
    try {
        expect(document.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("图片加载中");
        expect((await wheel(f.image(), -100)).defaultPrevented).toBe(true);
        expect(transform(f.image()).scale).toBe(1);
        await f.load();
        expect((await wheel(f.surface(), -100)).defaultPrevented).toBe(true);
        expect(transform(f.image()).scale).toBe(1);
        await f.error();
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("图片暂时无法显示");
        expect((await wheel(f.image(), -100)).defaultPrevented).toBe(true);
        expect(transform(f.image()).scale).toBe(1);
        await f.update(landscape);
        await f.load();
        expect(document.querySelector('[role="alert"]')).toBeNull();
        await wheel(f.image(), -100);
        expect(transform(f.image()).scale).toBeGreaterThan(1);
        expect(f.viewportChanges).toEqual([]);
        expect(f.bubbleEvents).toEqual([]);
    } finally {
        await f.dispose();
    }
});
