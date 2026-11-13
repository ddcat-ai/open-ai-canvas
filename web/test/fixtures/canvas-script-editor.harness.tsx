import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData, StoryboardColumn, StoryboardRow } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/canvas/storyboard" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { CanvasScriptEditor } = await import("../../src/components/canvas/canvas-script-node");
const { useGlobalAgentStore } = await import("../../src/stores/use-global-agent-store");
const { CanvasNodeType } = await import("../../src/types/canvas");

const clientHeight = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "clientHeight");
Object.defineProperty(dom.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
        return this.classList.contains("canvas-script-editor-table-area") ? 640 : (clientHeight?.get?.call(this) ?? 0);
    },
});

const defaultColumns: StoryboardColumn[] = ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"];
function row(number: number): StoryboardRow {
    return {
        id: `row-${number}`,
        shotNumber: number,
        durationSeconds: 6,
        plotDescription: `画面 ${number}`,
        dialogue: `台词 ${number}`,
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "中景",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "固定",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: `视频提示词 ${number}`,
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [],
        status: "idle",
    };
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let latest: CanvasNodeData;
let calls: string[];
let editedAssets: ReturnType<typeof mock>;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = {
        id: "script-node",
        type: CanvasNodeType.Script,
        title: "第一集分镜",
        position: { x: 0, y: 0 },
        width: 800,
        height: 400,
        metadata: { storyboard: { rows: [row(1), row(2)], visibleColumns: defaultColumns, referenceNodeIds: [] } },
    };
    calls = [];
    editedAssets = mock(() => {});
    useGlobalAgentStore.getState().reset();
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    useGlobalAgentStore.getState().reset();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    if (clientHeight) Object.defineProperty(dom.HTMLElement.prototype, "clientHeight", clientHeight);
    else Reflect.deleteProperty(dom.HTMLElement.prototype, "clientHeight");
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function Harness() {
    const [node, setNode] = useState(latest);
    const [open, setOpen] = useState(true);
    const update = (patch: { rows?: StoryboardRow[]; visibleColumns?: StoryboardColumn[] }) =>
        setNode((current) => {
            const next = { ...current, metadata: { ...current.metadata, storyboard: { ...current.metadata!.storyboard!, ...patch } } };
            latest = next;
            return next;
        });
    return (
        <ConfigProvider theme={{ token: { motion: false } }}>
            <App>
                <CanvasScriptEditor
                    node={node}
                    nodes={[node]}
                    open={open}
                    onClose={() => {
                        calls.push("close");
                        setOpen(false);
                    }}
                    onUpdateRows={(rows) => update({ rows })}
                    onEditAssets={editedAssets}
                    onVisibleColumnsChange={(visibleColumns) => update({ visibleColumns })}
                    onGenerateImages={() => calls.push("images")}
                    onGenerateVideos={() => calls.push("videos")}
                    onVideoInputModeChange={() => {}}
                />
            </App>
        </ConfigProvider>
    );
}
async function render() {
    await act(async () => root.render(<Harness />));
}
function editor() {
    return document.querySelector<HTMLElement>(".canvas-script-editor")!;
}
async function click(label: string, scope: ParentNode = document) {
    const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label);
    expect(target, label).toBeDefined();
    await act(async () => target!.click());
}
async function escape(target: HTMLElement) {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    });
}
function headingLabels() {
    return [...document.querySelectorAll(".canvas-script-editor-table .ant-table-header th")].map((element) => element.textContent?.trim());
}

test("opens fullscreen, can switch back and Escape exits fullscreen before closing", async () => {
    await render();
    expect(editor().dataset.fullscreen).toBe("true");
    expect(document.querySelector<HTMLElement>(".canvas-script-editor-modal")?.style.width).toBe("100vw");
    await click("退出全屏");
    expect(editor().dataset.fullscreen).toBe("false");
    expect(calls).toEqual([]);
    await click("全屏查看");
    await escape(editor().querySelector("textarea")!);
    expect(editor().dataset.fullscreen).toBe("false");
    expect(calls).toEqual([]);
    await escape(editor().querySelector("textarea")!);
    expect(calls).toEqual(["close"]);
});

test("measures the real table container after the modal portal has mounted", async () => {
    await render();
    expect(document.querySelector<HTMLElement>(".ant-table-body")?.style.maxHeight).toBe("592px");
});

test("Escape closes the column popup before exiting fullscreen and ignores another modal", async () => {
    await render();
    await click("显示列", editor());
    const popupInput = document.querySelector<HTMLInputElement>(".canvas-script-editor-columns input")!;
    await escape(popupInput);
    expect(editor().dataset.fullscreen).toBe("true");
    expect(editor().querySelector('button[aria-expanded="true"]')).toBeNull();
    const otherModal = document.createElement("div");
    otherModal.className = "ant-modal";
    document.body.append(otherModal);
    try {
        await escape(otherModal);
        expect(editor().dataset.fullscreen).toBe("true");
    } finally {
        otherModal.remove();
    }
});

test("focus highlights the complete editing row and text updates preserve other rows", async () => {
    await render();
    const first = document.querySelector<HTMLTextAreaElement>('[aria-label="镜头 1 台词/旁白"]')!;
    const second = document.querySelector<HTMLTextAreaElement>('[aria-label="镜头 2 视频提示词"]')!;
    await act(async () => first.focus());
    expect(document.querySelector('tr[data-storyboard-row-id="row-1"]')?.classList.contains("is-editing")).toBe(true);
    expect(document.querySelector('tr[data-storyboard-row-id="row-2"]')?.classList.contains("is-editing")).toBe(false);
    expect(editor().textContent).toContain("正在编辑镜头 1");
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(first, "修改后的台词");
        first.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(latest.metadata!.storyboard!.rows[0].dialogue).toBe("修改后的台词");
    expect(latest.metadata!.storyboard!.rows[1].dialogue).toBe("台词 2");
    await act(async () => second.focus());
    expect(document.querySelector('tr[data-storyboard-row-id="row-1"]')?.classList.contains("is-editing")).toBe(false);
    expect(document.querySelector('tr[data-storyboard-row-id="row-2"]')?.classList.contains("is-editing")).toBe(true);
    expect(document.querySelectorAll(".canvas-script-editor-shot-number span")).toHaveLength(1);
});

test("column controls change the actual table, restore defaults and keep shot identity pinned", async () => {
    await render();
    expect(headingLabels()).toContain("镜头");
    expect(headingLabels()).not.toContain("画面描述");
    await click("显示列", editor());
    const popup = document.querySelector(".canvas-script-editor-columns")!;
    const description = [...popup.querySelectorAll("label")].find((label) => label.textContent === "画面描述")!;
    await act(async () => description.querySelector<HTMLInputElement>("input")!.click());
    expect(headingLabels()).toContain("画面描述");
    expect(latest.metadata!.storyboard!.visibleColumns).toContain("plotDescription");
    expect([...popup.querySelectorAll("label")].some((label) => label.textContent === "序号")).toBe(false);
    await click("显示全部", popup);
    expect(headingLabels()).toContain("连续性出口");
    expect(headingLabels()).toContain("负面要求");
    expect(latest.metadata!.storyboard!.visibleColumns).toHaveLength(19);
    await click("恢复常用列", popup);
    expect(latest.metadata!.storyboard!.visibleColumns).toEqual(defaultColumns);
    expect(headingLabels()).not.toContain("连续性出口");
    expect(document.querySelector(".canvas-script-editor-pinned")?.closest("th")?.classList.contains("ant-table-cell-fix-start")).toBe(true);
    expect(document.querySelector<HTMLElement>(".ant-table-body")?.style.overflowX).toBe("auto");
});

test("opening asset controls marks that row as editing without generating", async () => {
    await render();
    const secondRow = document.querySelector('tr[data-storyboard-row-id="row-2"]')!;
    await click("选择关联资产", secondRow);
    expect(editedAssets).toHaveBeenCalledWith("row-2");
    expect(secondRow.classList.contains("is-editing")).toBe(true);
    expect(calls).toEqual([]);
});

test("discussion closes the editor then opens the assistant with stable node and row identities", async () => {
    await render();
    const unsubscribe = useGlobalAgentStore.subscribe((state, previous) => {
        if (state.prefillRequest !== previous.prefillRequest && state.prefillRequest) calls.push("prefill");
    });
    try {
        await click("与小影讨论镜头 2");
        expect(calls).toEqual(["close", "prefill"]);
        const store = useGlobalAgentStore.getState();
        expect(store.open).toBe(true);
        expect(store.prefillRequest?.displayText).toBe("讨论镜头 2");
        expect(store.prefillRequest?.text).toContain("节点ID：script-node");
        expect(store.prefillRequest?.text).toContain("镜头行ID：row-2");
        expect(store.prefillRequest?.autoSubmit).not.toBe(true);
    } finally {
        unsubscribe();
    }
});
