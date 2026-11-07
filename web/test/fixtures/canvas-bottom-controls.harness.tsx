import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
    elements = new Set<Element>();
    constructor(readonly callback: () => void) {
        observers.add(this);
    }
    observe(element: Element) {
        this.elements.add(element);
    }
    unobserve(element: Element) {
        this.elements.delete(element);
    }
    disconnect() {
        this.elements.clear();
        observers.delete(this);
    }
}
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: TestResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasZoomControls } = await import("../../src/components/canvas/canvas-zoom-controls");
const { CanvasAgentHud } = await import("../../src/components/canvas/canvas-agent-hud");
afterAll(() => dom.happyDOM.abort());

const noop = () => {};
const rect = (left: number, top: number, width: number, height: number) => new dom.DOMRect(left, top, width, height);

test("真实缩放组件按包括 HUD 的外壳避让，变宽后换行，收窄后回到同排", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let controlsWidth = 400;
    const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
    const originalOffsetParent = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "offsetParent");
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.tagName === "MAIN") return rect(0, 0, 1000, 800);
        if (this.classList.contains("canvas-workspace-zoom-controls")) return rect(20, 720, controlsWidth, 32);
        if (this.classList.contains("canvas-main-toolbar")) return rect(0, 740, 1000, 44);
        if (this.parentElement?.classList.contains("canvas-main-toolbar")) return rect(300, 740, 400, 44);
        if (this.parentElement?.classList.contains("canvas-workspace-zoom-controls")) return rect(20, 720, 220, 28);
        return originalRect.call(this);
    };
    Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() {
            return this.closest("main");
        },
    });
    try {
        await act(async () =>
            root.render(
                <main>
                    <div className="canvas-main-toolbar" style={{ left: 16 }}>
                        <div className="canvas-floating-dock" />
                    </div>
                    <div className="canvas-workspace-zoom-controls">
                        <CanvasZoomControls scale={1} onScaleChange={noop} onFitContent={noop} isMiniMapOpen={false} onToggleMiniMap={noop} onOpenShortcuts={noop} />
                        <CanvasAgentHud nodeCount={3} connectionCount={3} followAgent onFollowAgentChange={noop} />
                    </div>
                </main>,
            ),
        );
        const shell = host.querySelector<HTMLElement>(".canvas-workspace-zoom-controls")!;
        const toolbar = host.querySelector<HTMLElement>(".canvas-main-toolbar")!;
        expect(shell.querySelector(".canvas-agent-hud")).not.toBeNull();
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("136px");
        expect(300 + 136).toBeGreaterThanOrEqual(20 + controlsWidth + 16);
        expect(shell.style.bottom).toBe("22px");
        const observer = [...observers].find((item) => item.elements.has(shell));
        expect(observer).toBeDefined();

        controlsWidth = 600;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("calc(var(--canvas-inset-y) + var(--space-16))");

        controlsWidth = 300;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("22px");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("36px");
        await act(async () => root.unmount());
        expect(observer!.elements.size).toBe(0);
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("");
        expect(shell.style.bottom).toBe("");
    } finally {
        await act(async () => root.unmount());
        dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
        if (originalOffsetParent) Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", originalOffsetParent);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "offsetParent");
        host.remove();
    }
});
