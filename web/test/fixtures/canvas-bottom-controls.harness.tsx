import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";

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
    HTMLButtonElement: dom.HTMLButtonElement,
    HTMLInputElement: dom.HTMLInputElement,
    ShadowRoot: dom.ShadowRoot,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: TestResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasZoomControls } = await import("../../src/components/canvas/canvas-zoom-controls");
const { CanvasToolbar } = await import("../../src/components/canvas/canvas-toolbar");
const { clearToolbarPrefs, defaultToolbarPrefs, persistToolbarPrefs } = await import("../../src/lib/canvas/tool-registry");
afterAll(() => dom.happyDOM.abort());

// happy-dom does not compile Tailwind; supply the inset used by the measured layout.
const insetStyle = document.createElement("style");
insetStyle.textContent = ".canvas-main-toolbar { left: 12px; }";
document.head.append(insetStyle);

const noop = () => {};
const rect = (left: number, top: number, width: number, height: number) => new dom.DOMRect(left, top, width, height);

test("真实缩放组件按完整外壳避让，变宽后换行，收窄后回到同排", async () => {
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
        if (this.parentElement?.classList.contains("canvas-workspace-zoom-controls")) return rect(20, 720, controlsWidth, 28);
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
                    </div>
                </main>,
            ),
        );
        const shell = host.querySelector<HTMLElement>(".canvas-workspace-zoom-controls")!;
        const toolbar = host.querySelector<HTMLElement>(".canvas-main-toolbar")!;
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("136px");
        expect(300 + 136).toBeGreaterThanOrEqual(20 + controlsWidth + 16);
        expect(shell.style.bottom).toBe("22px");
        const observer = [...observers].find((item) => item.elements.has(shell));
        expect(observer).toBeDefined();

        controlsWidth = 600;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("76px");
        expect(shell.dataset.bottomLayout).toBe("stacked");
        expect(shell.style.maxWidth).toBe("980px");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-max-width")).toBe("980px");

        controlsWidth = 300;
        await act(async () => observer!.callback());
        expect(shell.style.bottom).toBe("22px");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("36px");
        await act(async () => root.unmount());
        expect(observer!.elements.size).toBe(0);
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")).toBe("");
        expect(toolbar.style.getPropertyValue("--canvas-main-toolbar-max-width")).toBe("");
        expect(shell.style.maxWidth).toBe("");
        expect(shell.style.bottom).toBe("");
    } finally {
        await act(async () => root.unmount());
        dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
        if (originalOffsetParent) Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", originalOffsetParent);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "offsetParent");
        host.remove();
    }
});

function MainToolbarHarness({ onCommand = noop }: { onCommand?: (command: string) => void }) {
    const [canvasTool, setCanvasTool] = useState<"move" | "box-select">("box-select");
    const props: ComponentProps<typeof CanvasToolbar> = {
        selectedCount: 2,
        workspaceMode: "professional",
        canvasTool,
        onToolChange: setCanvasTool,
        isProjectLinked: false,
        canUndo: true,
        canRedo: true,
        appearance: { mode: "light" },
        backgroundMode: "dots",
        showImageInfo: true,
        onAddImage: noop,
        onAddVideo: noop,
        onAddAudio: noop,
        onAddText: noop,
        onChooseStyle: noop,
        onAddScript: noop,
        onAddFrame: noop,
        onAddFolder: noop,
        onAddDrawing: noop,
        onAddExtensionNode: noop,
        onAddWorkflow: noop,
        onOpenPrevis: noop,
        onUndo: () => onCommand("undo"),
        onRedo: () => onCommand("redo"),
        onUpload: noop,
        onDelete: () => onCommand("delete"),
        onClear: () => onCommand("clear"),
        onDeselect: noop,
        onAppearanceChange: noop,
        onSaveAppearanceDefault: noop,
        onBackgroundModeChange: noop,
        onShowImageInfoChange: noop,
        onOpenWorkspace: noop,
        onOpenMyAssets: noop,
        onOpenProjectCharacters: noop,
        onOpenPoseLibrary: noop,
    };
    return <CanvasToolbar {...props} />;
}

test("真实主工具条保留所有命令、单一模式选中、键盘焦点与 Escape 关闭", async () => {
    clearToolbarPrefs("main");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const calls: string[] = [];
    try {
        await act(async () => root.render(<MainToolbarHarness onCommand={(command) => calls.push(command)} />));
        const dock = host.querySelector<HTMLElement>('[data-dock-variant="toolbar"]')!;
        expect(dock).not.toBeNull();
        expect([...dock.querySelectorAll("button")].map((button) => button.getAttribute("aria-label"))).toEqual(["区域选择", "抓手工具", "撤销", "重做", "添加节点", "素材库", "姿势库", "工作区", "画布外观", "工具栏设置", "删除 2 个节点", "清空画布"]);
        const select = dock.querySelector<HTMLButtonElement>('[aria-label="区域选择"]')!;
        await act(async () => {
            select.focus();
            select.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        });
        const grab = dock.querySelector<HTMLButtonElement>('[aria-label="抓手工具"]')!;
        expect(grab.getAttribute("aria-checked")).toBe("true");
        expect(select.getAttribute("aria-checked")).toBe("false");
        expect(document.activeElement).toBe(grab);
        expect(dock.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
        for (const label of ["撤销", "重做", "删除 2 个节点", "清空画布"]) {
            await act(async () => dock.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
        }
        expect(calls).toEqual(["undo", "redo", "delete", "clear"]);
        const add = dock.querySelector<HTMLButtonElement>('[aria-label="添加节点"]')!;
        await act(async () => add.click());
        expect(add.getAttribute("aria-expanded")).toBe("true");
        await act(async () => document.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(add.getAttribute("aria-expanded")).toBe("false");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        clearToolbarPrefs("main");
    }
});

test("真实主工具条尊重用户的顺序与隐藏设置", async () => {
    const defaults = defaultToolbarPrefs("main");
    persistToolbarPrefs("main", { order: ["tool-add", ...defaults.order.filter((id) => id !== "tool-add")], hidden: ["tool-pose-library", "tool-clear"] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<MainToolbarHarness />));
        const labels = [...host.querySelectorAll('[role="toolbar"] button')].map((button) => button.getAttribute("aria-label"));
        expect(labels[0]).toBe("添加节点");
        expect(labels).not.toContain("姿势库");
        expect(labels).not.toContain("清空画布");
        expect(labels).toContain("工具栏设置");
        expect(labels).toContain("删除 2 个节点");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        clearToolbarPrefs("main");
    }
});

test.each([390, 768, 1440, 2048])("真实底部控件在 %ipx 视口内按 Agent 停靠宽度避让", async (viewportWidth) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let agentWidth = viewportWidth >= 992 ? 400 : 0;
    const rowWidth = () => viewportWidth - agentWidth;
    const toolbarWidth = () => Math.min(540, rowWidth() - 88);
    const controlsWidth = () => Math.min(460, rowWidth() - 88);
    const originalRect = dom.HTMLElement.prototype.getBoundingClientRect;
    const originalOffsetParent = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "offsetParent");
    dom.HTMLElement.prototype.getBoundingClientRect = function () {
        if (this.tagName === "MAIN") return rect(0, 0, rowWidth(), 844);
        if (this.classList.contains("canvas-workspace-zoom-controls")) return rect(76, 730, controlsWidth(), 38);
        if (this.classList.contains("canvas-main-toolbar")) return rect(12, 786, rowWidth() - 24, 46);
        if (this.parentElement?.classList.contains("canvas-main-toolbar")) return rect((rowWidth() - toolbarWidth()) / 2, 786, toolbarWidth(), 46);
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
                <div className="app-user-workspace" data-agent-docked={agentWidth > 0}>
                    <main>
                        <MainToolbarHarness />
                        <div className="canvas-workspace-zoom-controls">
                            <CanvasZoomControls scale={1} onScaleChange={noop} onFitContent={noop} onAutoArrange={noop} onHideNodeConnectionsChange={noop} isMiniMapOpen={false} onToggleMiniMap={noop} onOpenShortcuts={noop} />
                        </div>
                    </main>
                </div>,
            ),
        );
        const shell = host.querySelector<HTMLElement>(".canvas-workspace-zoom-controls")!;
        const toolbar = host.querySelector<HTMLElement>(".canvas-main-toolbar")!;
        const observer = [...observers].find((item) => item.elements.has(shell))!;
        const verify = () => {
            const shift = Number.parseFloat(toolbar.style.getPropertyValue("--canvas-main-toolbar-shift")) || 0;
            const toolbarLeft = (rowWidth() - toolbarWidth()) / 2 + shift;
            expect(toolbarLeft).toBeGreaterThanOrEqual(76);
            expect(toolbarLeft + toolbarWidth()).toBeLessThanOrEqual(rowWidth() - 12);
            expect(shell.style.maxWidth).toBe(`${rowWidth() - 88}px`);
            if (shell.dataset.bottomLayout === "inline") expect(toolbarLeft).toBeGreaterThanOrEqual(76 + controlsWidth() + 12);
            else expect(Number.parseFloat(shell.style.bottom)).toBeGreaterThanOrEqual(844 - 786 + 12);
        };
        verify();
        agentWidth = 0;
        await act(async () => {
            host.querySelector<HTMLElement>(".app-user-workspace")!.dataset.agentDocked = "false";
            observer.callback();
        });
        verify();
    } finally {
        await act(async () => root.unmount());
        dom.HTMLElement.prototype.getBoundingClientRect = originalRect;
        if (originalOffsetParent) Object.defineProperty(dom.HTMLElement.prototype, "offsetParent", originalOffsetParent);
        else Reflect.deleteProperty(dom.HTMLElement.prototype, "offsetParent");
        host.remove();
    }
});

test("真实视图控制保留缩放、快速比例、连线、小地图及快捷键入口", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const scales: number[] = [];
    const calls: string[] = [];
    function ViewControls() {
        const [scale, setScale] = useState(1);
        const [minimap, setMinimap] = useState(false);
        const [hideConnections, setHideConnections] = useState(false);
        return (
            <CanvasZoomControls
                scale={scale}
                onScaleChange={(next) => {
                    scales.push(next);
                    setScale(next);
                }}
                onFitContent={() => calls.push("fit")}
                onAutoArrange={() => calls.push("arrange")}
                hideNodeConnections={hideConnections}
                onHideNodeConnectionsChange={setHideConnections}
                isMiniMapOpen={minimap}
                onToggleMiniMap={() => setMinimap((value) => !value)}
                onOpenShortcuts={() => calls.push("shortcuts")}
            />
        );
    }
    const click = async (label: string) => act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    try {
        await act(async () => root.render(<ViewControls />));
        await click("放大画布");
        await click("缩小画布");
        expect(scales).toEqual([1.1, 1]);
        await click("精确缩放");
        const precision = host.querySelector<HTMLButtonElement>('[aria-label="精确缩放"]')!;
        expect(precision.getAttribute("aria-expanded")).toBe("true");
        const half = [...host.querySelectorAll("button")].find((button) => button.textContent === "50%")!;
        await act(async () => half.click());
        expect(scales.at(-1)).toBe(0.5);
        expect(precision.textContent).toBe("50%");
        await act(async () => document.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        expect(precision.getAttribute("aria-expanded")).toBe("false");
        await click("打开小地图");
        expect(host.querySelector('[aria-label="关闭小地图"]')?.getAttribute("aria-pressed")).toBe("true");
        await click("设置隐藏节点连线");
        expect(host.querySelector('[aria-label="显示全部连线"]')?.getAttribute("aria-pressed")).toBe("true");
        await click("适应画布");
        await click("自动整理节点");
        await click("画布快捷键");
        expect(calls).toEqual(["fit", "arrange", "shortcuts"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
