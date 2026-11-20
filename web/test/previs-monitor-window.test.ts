import { expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { openPrevisMonitorWindow, type PrevisMonitorHandle } from "../src/components/canvas/previs/previs-monitor-window";

function monitorFixture() {
    const dom = new Window({ url: "http://localhost/" });
    const context = spyOn(dom.HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const popup = {
        document: dom.document,
        closed: false,
        requestAnimationFrame: mock(() => 1),
        cancelAnimationFrame: mock(() => {}),
        addEventListener: mock(() => {}),
        removeEventListener: mock(() => {}),
        close: mock(() => {
            popup.closed = true;
        }),
    };
    const browser = {
        open: mock(() => popup),
        setInterval: mock(() => 1),
        clearInterval: mock(() => {}),
    };
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: browser });
    const onClosed = mock(() => {});
    const handles: PrevisMonitorHandle[] = [];
    return {
        popup,
        onClosed,
        open(brandName: string) {
            const handle = openPrevisMonitorWindow({ brandName, renderFrame: () => null, onClosed });
            handles.push(handle);
            return handle;
        },
        async dispose() {
            for (const handle of handles) handle.close();
            context.mockRestore();
            await dom.happyDOM.abort();
            if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
            else Reflect.deleteProperty(globalThis, "window");
        },
    };
}

test("monitor uses the configured brand and updates an open window without interpreting HTML", async () => {
    const fixture = monitorFixture();
    try {
        const handle = fixture.open("祥子绘境");
        expect(fixture.popup.document.title).toBe("祥子绘境预演台 · 镜头监看");
        const brandName = '<img src="brand.png"> Studio & 影视';
        handle.setBrandName(brandName);
        expect(fixture.popup.document.title).toBe(`${brandName}预演台 · 镜头监看`);
        expect(fixture.popup.document.querySelector("img")).toBeNull();
        expect(fixture.onClosed).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("reusing a monitor window retires the old brand updater and close handle", async () => {
    const fixture = monitorFixture();
    try {
        const first = fixture.open("旧品牌");
        const second = fixture.open("新品牌");
        expect(first.closed()).toBe(true);
        expect(fixture.onClosed).toHaveBeenCalledTimes(1);
        first.setBrandName("过期品牌");
        first.close();
        expect(fixture.popup.document.title).toBe("新品牌预演台 · 镜头监看");
        expect(fixture.popup.closed).toBe(false);
        second.setBrandName("祥子绘境");
        second.close();
        second.setBrandName("关闭后的品牌");
        expect(fixture.popup.document.title).toBe("祥子绘境预演台 · 镜头监看");
        expect(fixture.onClosed).toHaveBeenCalledTimes(2);
    } finally {
        await fixture.dispose();
    }
});
