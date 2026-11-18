import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ContextMenuState } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
// HappyDOM 的原生动画取消会产生未处理拒绝，让 Motion 使用 RAF 路径验证交互。
Object.defineProperty(dom.Element.prototype, "animate", { configurable: true, value: undefined });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const { act, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasViewport } = await import("../../src/components/canvas/canvas-viewport");
const { CanvasNodeContextMenu } = await import("../../src/components/canvas/canvas-context-menu");
const noop = () => {};
afterAll(() => dom.happyDOM.abort());

async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const commits: unknown[] = [];
    let uploads = 0;
    function Harness() {
        const containerRef = useRef<HTMLDivElement>(null);
        const [menu, setMenu] = useState<ContextMenuState | null>(null);
        return (
            <>
                <CanvasViewport
                    containerRef={containerRef}
                    viewport={{ x: 0, y: 0, k: 1 }}
                    onViewportChange={(value) => {
                        commits.push(value);
                        setMenu(null);
                    }}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: { x: event.clientX, y: event.clientY } });
                    }}
                >
                    <div data-node-id="node" />
                </CanvasViewport>
                {menu ? (
                    <CanvasNodeContextMenu
                        menu={menu}
                        canUndo={false}
                        canRedo={false}
                        canPaste={false}
                        onClose={() => setMenu(null)}
                        onAddNode={noop}
                        onAddFolder={noop}
                        onChooseStyle={noop}
                        onOpenPrevis={noop}
                        onUpload={() => uploads++}
                        onOpenAssets={noop}
                        onOpenProjectCharacters={noop}
                        onUndo={noop}
                        onRedo={noop}
                        onPaste={noop}
                        onCopyNode={noop}
                        onCreateGenerationCopy={noop}
                        onDuplicate={noop}
                        onDelete={noop}
                        onSaveAsset={noop}
                        onViewMedia={noop}
                        onEditText={noop}
                        onOpenDrawing={noop}
                        onGenerateImage={noop}
                        onCopyContent={noop}
                        onCopyMediaUrl={noop}
                        onUploadToArkPrivateAsset={noop}
                        onSetAssetCategory={noop}
                        onToggleFrame={noop}
                    />
                ) : null}
            </>
        );
    }
    await act(async () => root.render(<Harness />));
    const viewport = host.querySelector<HTMLElement>("[data-canvas-viewport]")!;
    // HappyDOM 不模拟浏览器指针捕获；事件仍派发给真实组件与 window 监听器。
    viewport.setPointerCapture = noop;
    const pointer = async (type: string, x = 100, y = 100) => {
        await act(async () => viewport.dispatchEvent(new dom.PointerEvent(type, { bubbles: true, button: 2, buttons: type === "pointerup" ? 0 : 2, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y }) as unknown as Event));
    };
    const contextMenu = async () => {
        await act(async () => viewport.dispatchEvent(new dom.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 }) as unknown as Event));
    };
    return {
        host,
        commits,
        pointer,
        contextMenu,
        menu: () => host.querySelector("[data-canvas-context-menu]"),
        uploads: () => uploads,
        async cleanup() {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

for (const earlyContextMenu of [true, false]) {
    test(`右键${earlyContextMenu ? "松开前" : "松开后"}弹出菜单，轻微移动不关闭`, async () => {
        const f = await mount();
        try {
            await f.pointer("pointerdown");
            if (earlyContextMenu) await f.contextMenu();
            await f.pointer("pointermove", 102, 101);
            await f.pointer("pointerup", 102, 101);
            if (!earlyContextMenu) await f.contextMenu();
            expect(f.menu()).not.toBeNull();
            expect(f.commits).toEqual([]);
            const upload = Array.from(f.menu()!.querySelectorAll("button")).find((button) => button.textContent?.includes("上传到这里"))!;
            await act(async () => upload.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0 }) as unknown as Event));
            expect(f.menu()).not.toBeNull();
            await act(async () => upload.click());
            expect(f.uploads()).toBe(1);
            expect(f.menu()).toBeNull();
        } finally {
            await f.cleanup();
        }
    });
}

test("右键拖动提交视口并抑制菜单，下一次右键仍可打开，外部点击关闭", async () => {
    const f = await mount();
    try {
        await f.pointer("pointerdown");
        await f.pointer("pointermove", 120, 130);
        await f.pointer("pointerup", 120, 130);
        await f.contextMenu();
        expect(f.commits).toEqual([{ x: 20, y: 30, k: 1 }]);
        expect(f.menu()).toBeNull();
        await f.pointer("pointerdown");
        await f.contextMenu();
        await f.pointer("pointerup");
        expect(f.menu()).not.toBeNull();
        await act(async () => document.body.dispatchEvent(new dom.PointerEvent("pointerdown", { bubbles: true, button: 0 }) as unknown as Event));
        expect(f.menu()).toBeNull();
    } finally {
        await f.cleanup();
    }
});
