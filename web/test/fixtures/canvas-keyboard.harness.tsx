import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
for (const key of ["document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Element", "Node"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom[key] });
}
Object.assign(globalThis, { window: dom, IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCanvasKeyboard } = await import("../../src/pages/canvas/use-canvas-keyboard");
type Options = Parameters<typeof useCanvasKeyboard>[0];
let root: ReturnType<typeof createRoot> | null = null;

async function mount(overrides: Partial<Options> = {}) {
    const noop = () => {};
    const options: Options = {
        nodesRef: { current: [] },
        selectedNodeIdsRef: { current: new Set(["video"]) },
        selectedConnectionId: null,
        setSelectedNodeIds: noop,
        setSelectedConnectionId: noop,
        setContextMenu: noop,
        setShortcutRequestNonce: noop,
        setInfoNodeId: mock(noop),
        setCropNodeId: noop,
        setRegionEditNodeId: noop,
        setAnnotationNodeId: noop,
        saveCanvasProject: noop,
        zoomToActualSize: noop,
        fitCanvasContent: noop,
        fitCanvasSelection: noop,
        undoCanvas: noop,
        redoCanvas: noop,
        cancelSelectionBox: noop,
        copySelectedNodes: noop,
        pasteCopiedNodes: () => false,
        restoreCopiedNodesFromText: () => false,
        shouldPreferCopiedNodes: () => false,
        pasteSystemClipboard: () => false,
        deleteNodes: noop,
        deleteConnection: noop,
        deselectCanvas: mock(noop),
        zoomCanvasIn: noop,
        zoomCanvasOut: noop,
        focusMode: false,
        exitFocusMode: mock(noop),
        toggleFocusMode: noop,
        onOpenSearch: noop,
        beginBatchConnection: noop,
        ...overrides,
    };
    function Harness() {
        useCanvasKeyboard(options);
        return <button data-testid="canvas">画布</button>;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Harness />));
    return options;
}

function overlay(className: string, rendered = true) {
    const element = document.createElement("div");
    element.className = className;
    element.getClientRects = () => (rendered ? [new dom.DOMRect(0, 0, 300, 200)] : []) as unknown as DOMRectList;
    const close = document.createElement("button");
    close.textContent = "关闭";
    element.append(close);
    document.body.append(element);
    return { element, close };
}

async function escape(target: Element = document.querySelector('[data-testid="canvas"]')!) {
    const event = new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => target.dispatchEvent(event as unknown as Event));
    return event;
}

afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = "";
});
afterAll(() => dom.happyDOM.abort());

test("放大弹窗关闭按钮上的 Esc 交给浮层，保留画布选中及编辑状态", async () => {
    const options = await mount();
    const { element, close } = overlay("ant-modal-wrap");
    const dismiss = mock(() => element.remove());
    element.addEventListener("keydown", dismiss);
    const event = await escape(close);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    expect(options.deselectCanvas).not.toHaveBeenCalled();
    expect(options.setInfoNodeId).not.toHaveBeenCalled();
    await escape();
    expect(options.deselectCanvas).toHaveBeenCalledTimes(1);
});

test("没有浮层时 Esc 仍取消画布选择", async () => {
    const options = await mount();
    await escape();
    expect(options.deselectCanvas).toHaveBeenCalledTimes(1);
    expect(options.setInfoNodeId).toHaveBeenCalledWith(null);
});

test("已关闭但未卸载的 modal/dropdown 不阻止画布 Esc", async () => {
    const options = await mount();
    overlay("ant-modal-wrap", false).element.style.display = "none";
    overlay("ant-dropdown", false).element.style.display = "none";
    await escape();
    expect(options.deselectCanvas).toHaveBeenCalledTimes(1);
});

test("visibility、hidden、aria-hidden 与 inert 的残留浮层均不拦截 Esc", async () => {
    const options = await mount();
    overlay("ant-modal-wrap").element.style.visibility = "hidden";
    overlay("ant-popover").element.hidden = true;
    overlay("ant-dropdown").element.setAttribute("aria-hidden", "true");
    const parent = document.createElement("div");
    parent.setAttribute("inert", "");
    document.body.append(parent);
    parent.append(overlay("ant-select-dropdown").element);
    await escape();
    expect(options.deselectCanvas).toHaveBeenCalledTimes(1);
});

test("可见弹出菜单优先处理 Esc；关闭后无选中可退出专注模式", async () => {
    const options = await mount({ focusMode: true, selectedNodeIdsRef: { current: new Set() } });
    const { element } = overlay("ant-popover");
    await escape();
    expect(options.exitFocusMode).not.toHaveBeenCalled();
    expect(options.deselectCanvas).not.toHaveBeenCalled();
    element.style.display = "none";
    element.getClientRects = () => [] as unknown as DOMRectList;
    await escape();
    expect(options.exitFocusMode).toHaveBeenCalledTimes(1);
    expect(options.deselectCanvas).not.toHaveBeenCalled();
});
