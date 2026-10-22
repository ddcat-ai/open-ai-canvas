import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentRef, RefObject } from "react";
import type { Popover } from "antd";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, Element: dom.Element, Node: dom.Node, HTMLElement: dom.HTMLElement, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useImperativeHandle, useRef } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePopoverAnchorAlign } = await import("../../src/hooks/use-popover-anchor-align");
const { useDismissPopupOnAnchorMove } = await import("../../src/hooks/use-dismiss-popup-on-anchor-move");
const { observeMovablePopupAnchor } = await import("../../src/lib/movable-popup-anchor");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("仅展开时通知原生 forceAlign，忽略内容和 Portal 样式，关闭与卸载后停止观察", async () => {
    const host = document.createElement("div");
    const popup = document.createElement("div");
    document.body.append(host, popup);
    const root = createRoot(host);
    let aligns = 0;
    const forceAlign = () => {
        aligns++;
        popup.style.left = `${aligns}px`;
    };
    function NativePopoverRef({ popoverRef }: { popoverRef: RefObject<ComponentRef<typeof Popover> | null> }) {
        const button = useRef<HTMLButtonElement>(null);
        useImperativeHandle(popoverRef, () => ({ nativeElement: button.current!, popupElement: popup, forceAlign }));
        return <button ref={button}>原生浮层锚点</button>;
    }
    function Harness({ open }: { open: boolean }) {
        const popoverRef = usePopoverAnchorAlign(open);
        return (
            <div data-popover-anchor-container data-world>
                <div data-popover-anchor-container>
                    <NativePopoverRef popoverRef={popoverRef} />
                    <span>参数内容</span>
                </div>
            </div>
        );
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    try {
        await act(async () => root.render(<Harness open={false} />));
        const world = host.firstElementChild as HTMLElement;
        const anchor = world.firstElementChild as HTMLElement;
        await act(async () => {
            anchor.style.transform = "translate(10px, 20px)";
            await settle();
        });
        expect(aligns).toBe(0);
        await act(async () => root.render(<Harness open />));
        await act(async () => {
            anchor.style.transform = "translate(100px, 200px)";
            anchor.style.width = "420px";
            await settle();
        });
        expect(aligns).toBe(1);
        await act(async () => {
            world.style.transform = "translate(40px, 20px) scale(0.8)";
            await settle();
        });
        expect(aligns).toBe(2);
        await act(async () => {
            anchor.querySelector("span")!.style.height = "100px";
            popup.style.top = "200px";
            await settle();
        });
        expect(aligns).toBe(2);
        await act(async () => root.render(<Harness open={false} />));
        await act(async () => {
            anchor.style.left = "300px";
            world.style.transform = "scale(1)";
            await settle();
        });
        expect(aligns).toBe(2);
        await act(async () => root.render(<Harness open />));
        await act(async () => {
            anchor.style.height = "500px";
            await settle();
        });
        expect(aligns).toBe(3);
        await act(async () => root.unmount());
        await act(async () => {
            anchor.style.top = "50px";
            await settle();
        });
        expect(aligns).toBe(3);
    } finally {
        if (host.childNodes.length) await act(async () => root.unmount());
        host.remove();
        popup.remove();
    }
});

test.each([false, true])("菜单在父块移动时仅收起一次，支持 DOM / Select 原生 ref（Select=%s）", async (selectRef) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let dismissals = 0;
    function Harness({ open }: { open: boolean }) {
        const button = useRef<HTMLButtonElement>(null);
        const nativeRef = useRef<{ nativeElement: HTMLElement }>(null);
        useImperativeHandle(nativeRef, () => ({ nativeElement: button.current! }));
        useDismissPopupOnAnchorMove(open, selectRef ? nativeRef : button, () => {
            dismissals++;
        });
        return (
            <div data-popover-anchor-container>
                <button ref={button}>菜单</button>
                <span>内容</span>
            </div>
        );
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    try {
        await act(async () => root.render(<Harness open={false} />));
        const anchor = host.firstElementChild as HTMLElement;
        await act(async () => {
            anchor.style.left = "1px";
            await settle();
        });
        expect(dismissals).toBe(0);
        await act(async () => root.render(<Harness open />));
        await act(async () => {
            anchor.querySelector("span")!.style.height = "20px";
            await settle();
        });
        expect(dismissals).toBe(0);
        await act(async () => {
            anchor.style.transform = "translate(20px, 30px)";
            await settle();
        });
        expect(dismissals).toBe(1);
        await act(async () => {
            anchor.style.width = "400px";
            await settle();
        });
        expect(dismissals).toBe(1);
        await act(async () => root.render(<Harness open={false} />));
        await act(async () => root.render(<Harness open />));
        await act(async () => {
            anchor.style.width = "500px";
            await settle();
        });
        expect(dismissals).toBe(2);
        await act(async () => root.unmount());
        await act(async () => {
            anchor.style.width = "600px";
            await settle();
        });
        expect(dismissals).toBe(2);
    } finally {
        if (host.childNodes.length) await act(async () => root.unmount());
        host.remove();
    }
});

test("独立拖动浮层与嵌套原生浮层的样式变化也会通知，子浮层自身不会反馈", async () => {
    const optimizer = document.createElement("div");
    const nativePopup = document.createElement("div");
    const trigger = document.createElement("button");
    const childPopup = document.createElement("div");
    optimizer.className = "canvas-prompt-optimizer-popover";
    nativePopup.className = "ant-popover";
    document.body.append(optimizer, childPopup);
    optimizer.append(nativePopup);
    nativePopup.append(trigger);
    let updates = 0;
    const stop = observeMovablePopupAnchor(trigger, () => {
        updates++;
        childPopup.style.left = `${updates}px`;
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
    try {
        optimizer.style.translate = "30px 40px";
        await settle();
        expect(updates).toBe(1);
        nativePopup.style.top = "50px";
        await settle();
        expect(updates).toBe(2);
        childPopup.style.top = "80px";
        await settle();
        expect(updates).toBe(2);
        stop();
        optimizer.style.translate = "80px 40px";
        await settle();
        expect(updates).toBe(2);
    } finally {
        stop();
        optimizer.remove();
        childPopup.remove();
    }
});
