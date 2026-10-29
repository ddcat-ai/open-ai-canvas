import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const preference = Object.assign(new dom.EventTarget(), { matches: false });
dom.matchMedia = (() => preference) as typeof dom.matchMedia;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    CustomEvent: dom.CustomEvent,
    Event: dom.Event,
    PointerEvent: dom.PointerEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: class {
        observe() {}
        disconnect() {}
    },
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

// 只截获出现动画窗口的计时器，其余计时器照常运行。
const revealTimers: Array<() => void> = [];
const originalSetTimeout = dom.setTimeout.bind(dom);
dom.setTimeout = ((handler: () => void, delay?: number, ...args: unknown[]) => {
    if (delay === 2600) {
        revealTimers.push(handler);
        return revealTimers.length as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(handler, delay, ...args);
}) as typeof dom.setTimeout;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CanvasNode } = await import("../../src/components/canvas/canvas-node");
const { CanvasNodeType } = await import("../../src/types/canvas");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

const noop = () => {};

function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (data: CanvasNodeData, disableMediaEffects = false) =>
        root.render(
            <CanvasNode
                data={data}
                scale={1}
                isSelected={false}
                isRelated={false}
                isFocusRelated={false}
                isConnectionTarget={false}
                showImageInfo={false}
                disableMediaEffects={disableMediaEffects}
                onMouseDown={noop}
                onHoverStart={noop}
                onHoverEnd={noop}
                onConnectStart={noop}
                onResize={noop}
                onContentChange={noop}
                onContextMenu={noop}
            />,
        );
    const shell = () => host.querySelector<HTMLElement>(".canvas-node-shell")!;
    const chip = () => host.querySelector<HTMLElement>(".canvas-node-status-chip");
    return { root, render, shell, chip };
}

const loading: CanvasNodeData = { id: "text", type: CanvasNodeType.Text, title: "文案", position: { x: 0, y: 0 }, width: 320, height: 240, metadata: { status: "loading", taskId: "task", taskStatus: "running", taskStage: "调用生成模型" } };
const done: CanvasNodeData = { ...loading, metadata: { status: "success", taskId: "task", taskStatus: "succeeded", content: "生成好的文案" } };

test("亲眼看到生成中转为完成时播放一次完成反馈，窗口结束后自行撤掉", async () => {
    const view = mount();
    await act(async () => view.render(loading));
    expect(view.shell().getAttribute("data-generation-reveal")).toBeNull();
    expect(view.chip()).toBeNull();
    expect(view.shell().textContent).toContain("正在生成文本");

    await act(async () => view.render(done));
    expect(view.shell().getAttribute("data-generation-reveal")).toBe("true");
    expect(view.chip()?.textContent).toBe("已完成");
    expect(view.chip()?.getAttribute("data-tone")).toBe("success");

    await act(async () => revealTimers.shift()?.());
    expect(view.shell().getAttribute("data-generation-reveal")).toBeNull();
    expect(view.chip()).toBeNull();

    // 之后的普通更新（例如改标题）不会重放。
    await act(async () => view.render({ ...done, title: "改过的标题" }));
    expect(view.chip()).toBeNull();
    await act(async () => view.root.unmount());
});

test("直接以完成状态挂载、或关闭媒体动效时都不播放", async () => {
    const mounted = mount();
    await act(async () => mounted.render(done));
    expect(mounted.shell().getAttribute("data-generation-reveal")).toBeNull();
    expect(mounted.chip()).toBeNull();
    await act(async () => mounted.root.unmount());

    const reduced = mount();
    await act(async () => reduced.render(loading, true));
    await act(async () => reduced.render(done, true));
    expect(reduced.shell().getAttribute("data-generation-reveal")).toBeNull();
    expect(reduced.chip()).toBeNull();
    await act(async () => reduced.root.unmount());
});
