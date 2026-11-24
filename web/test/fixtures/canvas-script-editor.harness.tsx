import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasGenerationBatch, CanvasNodeData, StoryboardColumn, StoryboardRow } from "../../src/types/canvas";

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
const { storyboardGenerationTargets } = await import("../../src/components/canvas/canvas-script-editor-model");
const { useGlobalAgentStore } = await import("../../src/stores/use-global-agent-store");
const { CanvasNodeType } = await import("../../src/types/canvas");

const clientHeight = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "clientHeight");
Object.defineProperty(dom.HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
        return this.classList.contains("canvas-script-editor-table-area") ? 640 : (clientHeight?.get?.call(this) ?? 0);
    },
});

const defaultColumns: StoryboardColumn[] = ["shotNumber", "plotDescription", "dialogue", "assets"];
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
let generationCalls: Array<{ kind: "images" | "videos"; rowIds: string[] }>;
let outputNodes: CanvasNodeData[];
let editedAssets: ReturnType<typeof mock>;
let focusedOutput: ReturnType<typeof mock>;
let retriedBatch: ReturnType<typeof mock>;
let setHarnessOpen: (open: boolean) => void;
let setHarnessNode: (node: CanvasNodeData) => void;

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
        metadata: { storyboard: { rows: [row(1), row(2), row(3)], visibleColumns: defaultColumns, referenceNodeIds: [] } },
    };
    calls = [];
    generationCalls = [];
    outputNodes = [];
    editedAssets = mock(() => {});
    focusedOutput = mock(() => {});
    retriedBatch = mock(() => {});
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
    setHarnessOpen = setOpen;
    setHarnessNode = (next) => {
        latest = next;
        setNode(next);
    };
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
                    nodes={[node, ...outputNodes]}
                    open={open}
                    onClose={() => {
                        calls.push("close");
                        setOpen(false);
                    }}
                    onUpdateRows={(rows) => update({ rows })}
                    onEditAssets={editedAssets}
                    onVisibleColumnsChange={(visibleColumns) => update({ visibleColumns })}
                    onGenerateImages={(rowIds) => generationCalls.push({ kind: "images", rowIds: [...rowIds] })}
                    onGenerateVideos={(rowIds) => generationCalls.push({ kind: "videos", rowIds: [...rowIds] })}
                    onVideoInputModeChange={(mode) => setHarnessNode({ ...node, metadata: { ...node.metadata, storyboardVideoInputMode: mode } })}
                    onFocusOutput={focusedOutput}
                    onRetryBatchItem={retriedBatch}
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
function detail() {
    return editor().querySelector<HTMLElement>('[aria-label="当前镜头工作区"]')!;
}
function storyboardRows() {
    return [...editor().querySelectorAll<HTMLElement>("tr[data-storyboard-row-id]")];
}
function currentShot() {
    return storyboardRows().find((element) => element.classList.contains("is-editing"))?.dataset.storyboardRowId;
}
function button(label: string, scope: ParentNode = document) {
    const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label);
    expect(target, label).toBeDefined();
    return target!;
}
async function click(label: string, scope: ParentNode = document) {
    await act(async () => button(label, scope).click());
}
async function selectTab(label: string) {
    const target = [...detail().querySelectorAll("label")].find((item) => item.textContent?.trim() === label)?.querySelector<HTMLInputElement>('input[type="radio"]');
    expect(target, label).toBeDefined();
    await act(async () => target!.click());
    expect(target!.checked).toBe(true);
}
async function toggleShot(number: number) {
    const input = editor().querySelector<HTMLInputElement>(`input[aria-label="批量选择镜头 ${number}"]`);
    expect(input).not.toBeNull();
    await act(async () => input!.click());
}
async function typeValue(label: string, value: string) {
    const target = editor().querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[aria-label="${label}"], textarea[aria-label="${label}"]`);
    expect(target, label).not.toBeNull();
    await act(async () => {
        const prototype = target!.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(target, value);
        target!.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function escape(target: HTMLElement) {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
    });
}
function headingLabels() {
    return [...document.querySelectorAll(".canvas-script-editor-table .ant-table-header th")].map((element) => element.textContent?.trim());
}
function mediaNode(id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 640, height: 360, metadata };
}
function queuedBatch(mode: CanvasGenerationBatch["mode"], nodeId: string): CanvasGenerationBatch {
    return {
        id: `batch-${nodeId}`,
        projectId: "project-1",
        sourceNodeId: latest.id,
        mode,
        status: "queued",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        items: [{ id: `item-${nodeId}`, nodeId, rowId: "row-3", status: "queued", retryCount: 0 }],
    };
}

test("opens fullscreen, can switch back and Escape exits fullscreen before closing", async () => {
    await render();
    expect(editor().dataset.fullscreen).toBe("true");
    expect(document.querySelector<HTMLElement>(".canvas-script-editor-modal")?.style.width).toBe("100vw");
    expect(document.querySelector<HTMLElement>(".ant-table-body")?.style.maxHeight).toBe("596px");
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

test("Escape closes the shot menu and delete confirmation without leaving fullscreen when focus stays on the trigger", async () => {
    await render();
    const menuTrigger = button("镜头操作");
    await act(async () => menuTrigger.focus());
    await click("镜头操作");
    expect(document.activeElement === menuTrigger).toBe(true);
    expect(Boolean(document.querySelector(".canvas-script-editor-row-menu:not(.ant-dropdown-hidden)"))).toBe(true);
    await escape(menuTrigger);
    expect(Boolean(document.querySelector(".canvas-script-editor-row-menu:not(.ant-dropdown-hidden)"))).toBe(false);
    expect(editor().dataset.fullscreen).toBe("true");
    expect(calls).toEqual([]);

    const deleteTrigger = button("删除镜头 1");
    await act(async () => deleteTrigger.focus());
    await click("删除镜头 1");
    expect(document.activeElement === deleteTrigger).toBe(true);
    expect(deleteTrigger.className).toContain("ant-popover-open");
    expect(document.querySelector(".canvas-script-editor-delete-popover:not(.ant-popover-hidden)")?.textContent).toContain("删除镜头 1？");
    await escape(deleteTrigger);
    expect(deleteTrigger.className).not.toContain("ant-popover-open");
    expect(editor().dataset.fullscreen).toBe("true");
    expect(latest.metadata!.storyboard!.rows).toHaveLength(3);
    expect(calls).toEqual([]);
    await escape(deleteTrigger);
    expect(editor().dataset.fullscreen).toBe("false");
});

test("keeps the table readable while row and pencil actions edit only the current shot", async () => {
    await render();
    expect(editor().querySelector(".canvas-script-editor-table textarea")).toBeNull();
    expect(editor().querySelector('.canvas-script-editor-table input:not([type="checkbox"])')).toBeNull();
    expect(headingLabels()).toContain("画面描述");
    await act(async () => storyboardRows()[1].click());
    expect(currentShot()).toBe("row-2");
    expect(detail().querySelector<HTMLTextAreaElement>('[aria-label="镜头 2 台词/旁白"]')?.value).toBe("台词 2");
    await typeValue("镜头 2 台词/旁白", "修改后的台词");
    expect(latest.metadata!.storyboard!.rows.map((item) => item.dialogue)).toEqual(["台词 1", "修改后的台词", "台词 3"]);
    expect(storyboardRows()[1].textContent).toContain("修改后的台词");
    await click("编辑镜头 3");
    expect(currentShot()).toBe("row-3");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("镜头 3 画面描述");
    expect(storyboardRows().filter((element) => element.classList.contains("is-editing"))).toHaveLength(1);
});

test("video-only workflows show readable summaries and edit the video prompt without filling the description", async () => {
    for (const item of latest.metadata!.storyboard!.rows) item.plotDescription = "";
    await render();
    expect(storyboardRows()).toHaveLength(3);
    for (const number of [1, 2, 3]) {
        const summary = button(`编辑镜头 ${number} 画面描述`);
        expect(summary.textContent).toContain(`视频提示词 ${number}`);
        expect(summary.textContent).toContain("视频提示词摘要");
        expect(summary.textContent).not.toContain("待补充画面描述");
    }
    await click("编辑镜头 2 画面描述");
    expect(currentShot()).toBe("row-2");
    expect(detail().querySelector('input[type="radio"]:checked')?.closest("label")?.textContent).toBe("生成提示");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("镜头 2 视频提示词");
    expect(Boolean(detail().querySelector('textarea[aria-label="镜头 2 画面描述"]'))).toBe(false);
    await typeValue("镜头 2 视频提示词", "跟随角色穿过雨夜走廊");
    expect(latest.metadata!.storyboard!.rows.map((item) => item.videoMotionPrompt)).toEqual(["视频提示词 1", "跟随角色穿过雨夜走廊", "视频提示词 3"]);
    expect(latest.metadata!.storyboard!.rows.map((item) => item.plotDescription)).toEqual(["", "", ""]);
    expect(button("编辑镜头 2 画面描述").textContent).toContain("跟随角色穿过雨夜走廊");
    expect(generationCalls).toEqual([]);
});

test("detail tabs update prompts and route assets and existing output to the current shot", async () => {
    latest.metadata!.storyboard!.rows[1].imageNodeId = "image-2";
    outputNodes = [mediaNode("image-2", CanvasNodeType.Image, { status: "error" })];
    await render();
    await click("编辑镜头 2");
    await selectTab("生成提示");
    await typeValue("镜头 2 视频提示词", "镜头沿走廊缓慢推进");
    await typeValue("镜头 2 图片提示词", "雨夜走廊，中景");
    expect(latest.metadata!.storyboard!.rows[1].videoMotionPrompt).toBe("镜头沿走廊缓慢推进");
    expect(latest.metadata!.storyboard!.rows[1].imageGenerationPrompt).toBe("雨夜走廊，中景");
    expect(latest.metadata!.storyboard!.rows[0].videoMotionPrompt).toBe("视频提示词 1");
    await selectTab("画面与资产");
    expect(detail().querySelector('[aria-label="镜头 2 的画面与资产"]')).not.toBeNull();
    await click("配置资产", detail());
    expect(editedAssets).toHaveBeenCalledWith("row-2");
    await click("在画布中检查", detail());
    expect(focusedOutput).toHaveBeenCalledWith("image-2");
    expect(generationCalls).toEqual([]);
    await selectTab("分镜内容");
    expect(detail().querySelector('[aria-label="镜头 2 画面描述"]')).not.toBeNull();
});

test("previous and next navigate the script with correct boundaries and preserve edits", async () => {
    await render();
    expect(button("上一镜").disabled).toBe(true);
    expect(button("下一镜").disabled).toBe(false);
    await click("下一镜");
    await typeValue("镜头 2 画面描述", "第二镜的新画面");
    await click("下一镜");
    expect(currentShot()).toBe("row-3");
    expect(button("下一镜").disabled).toBe(true);
    await click("上一镜");
    expect(currentShot()).toBe("row-2");
    expect(detail().querySelector<HTMLTextAreaElement>('[aria-label="镜头 2 画面描述"]')?.value).toBe("第二镜的新画面");
    expect(latest.metadata!.storyboard!.rows.map((item) => item.plotDescription)).toEqual(["画面 1", "第二镜的新画面", "画面 3"]);
});

test("column controls change the actual reading table and restore the pinned shot column", async () => {
    await render();
    expect(headingLabels()).toContain("镜头");
    expect(headingLabels()).toContain("画面描述");
    expect(headingLabels()).not.toContain("视频提示词");
    await click("显示列", editor());
    const popup = document.querySelector(".canvas-script-editor-columns")!;
    const promptColumn = [...popup.querySelectorAll("label")].find((label) => label.textContent === "视频提示词")!;
    await act(async () => promptColumn.querySelector<HTMLInputElement>("input")!.click());
    expect(headingLabels()).toContain("视频提示词");
    expect(latest.metadata!.storyboard!.visibleColumns).toContain("videoMotionPrompt");
    expect(document.querySelector<HTMLElement>(".ant-table-body")?.style.overflowX).toBe("auto");
    expect([...popup.querySelectorAll("label")].some((label) => label.textContent === "镜头")).toBe(false);
    await click("恢复阅读列", popup);
    expect(latest.metadata!.storyboard!.visibleColumns).toEqual(defaultColumns);
    expect(headingLabels()).not.toContain("视频提示词");
    expect([...editor().querySelectorAll("th")].find((element) => element.textContent === "镜头")?.classList.contains("ant-table-cell-fix-start")).toBe(true);
    expect(document.querySelector<HTMLElement>(".ant-table-body")?.style.overflowX).toBe("");
});

test("batch checkboxes stay independent from the current shot and generate exact row identities", async () => {
    await render();
    await click("编辑镜头 3");
    await toggleShot(2);
    await toggleShot(1);
    expect(currentShot()).toBe("row-3");
    expect(editor().querySelector<HTMLInputElement>('input[aria-label="批量选择镜头 3"]')?.checked).toBe(false);
    await click("生成分镜图2");
    await click("生成视频2");
    expect(generationCalls).toEqual([
        { kind: "images", rowIds: ["row-1", "row-2"] },
        { kind: "videos", rowIds: ["row-1", "row-2"] },
    ]);
    await click("编辑镜头 1");
    expect(editor().querySelector<HTMLInputElement>('input[aria-label="批量选择镜头 1"]')?.checked).toBe(true);
    await click("取消选择");
    expect(editor().querySelector('[aria-label="批量制作"]')).toBeNull();
    expect(currentShot()).toBe("row-1");
});

test("filtering reports hidden selections and only-selected reveals the real generation scope", async () => {
    await render();
    await toggleShot(1);
    await toggleShot(3);
    await typeValue("筛选分镜", "画面 2");
    expect(storyboardRows().map((element) => element.dataset.storyboardRowId)).toEqual(["row-2"]);
    expect(editor().textContent).toContain("其中 2 镜被筛选隐藏");
    expect(detail().textContent).toContain("当前镜头不在筛选结果中");
    await click("生成视频2");
    expect(generationCalls).toEqual([{ kind: "videos", rowIds: ["row-1", "row-3"] }]);
    await click("仅看已选");
    expect(button("仅看已选").getAttribute("aria-pressed")).toBe("true");
    expect(editor().querySelector<HTMLInputElement>('[aria-label="筛选分镜"]')?.value).toBe("");
    expect(storyboardRows().map((element) => element.dataset.storyboardRowId)).toEqual(["row-1", "row-3"]);
    expect(editor().textContent).not.toContain("镜被筛选隐藏");
    await click("取消选择");
    expect(storyboardRows()).toHaveLength(3);
});

test("locked scripts allow browsing and output navigation while guarding every edit and generation action", async () => {
    latest.metadata!.locked = true;
    latest.metadata!.storyboard!.rows[1].imageNodeId = "image-2";
    outputNodes = [mediaNode("image-2", CanvasNodeType.Image, { status: "error" })];
    await render();
    expect(editor().textContent).toContain("已锁定");
    expect(button("新增镜头").disabled).toBe(true);
    expect(editor().querySelector<HTMLInputElement>('input[aria-label="批量选择镜头 1"]')?.disabled).toBe(true);
    await click("编辑镜头 2");
    expect(currentShot()).toBe("row-2");
    expect(detail().querySelector<HTMLTextAreaElement>('[aria-label="镜头 2 台词/旁白"]')?.disabled).toBe(true);
    await typeValue("镜头 2 台词/旁白", "不应写入");
    expect(latest.metadata!.storyboard!.rows[1].dialogue).toBe("台词 2");
    expect(button("与小影讨论镜头 2").disabled).toBe(true);
    expect(button("删除镜头 2").disabled).toBe(true);
    await selectTab("生成提示");
    expect(detail().querySelector<HTMLTextAreaElement>('[aria-label="镜头 2 视频提示词"]')?.disabled).toBe(true);
    await selectTab("画面与资产");
    expect(button("配置资产").disabled).toBe(true);
    expect(button("生成本镜视频").disabled).toBe(true);
    expect(button("按当前分镜重试").disabled).toBe(true);
    await click("生成本镜视频");
    await click("配置资产");
    await click("在画布中查看");
    expect(focusedOutput).toHaveBeenCalledWith("image-2");
    expect(editedAssets).not.toHaveBeenCalled();
    expect(generationCalls).toEqual([]);
    await click("下一镜");
    expect(currentShot()).toBe("row-3");
});

test("reopening and renaming preserve the current shot but a different script clears query and batch scope", async () => {
    await render();
    await click("编辑镜头 2");
    await toggleShot(3);
    await typeValue("筛选分镜", "画面 3");
    await click("关闭分镜表格");
    await act(async () => {
        setHarnessNode({ ...latest, title: "第一集 · 修订" });
        setHarnessOpen(true);
    });
    expect(editor().querySelector("h2")?.textContent).toBe("第一集 · 修订");
    expect(detail().querySelector('[aria-label="镜头 2 画面描述"]')).not.toBeNull();
    await act(async () => setHarnessNode({ ...latest, id: "different-script", title: "第二集分镜" }));
    expect(editor().querySelector<HTMLInputElement>('[aria-label="筛选分镜"]')?.value).toBe("");
    expect(storyboardRows()).toHaveLength(3);
    expect(currentShot()).toBe("row-1");
    expect(editor().querySelector('[aria-label="批量制作"]')).toBeNull();
    expect([...editor().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => !input.checked)).toBe(true);
    await toggleShot(2);
    await click("生成视频1");
    expect(generationCalls).toEqual([{ kind: "videos", rowIds: ["row-2"] }]);
});

test("copying a shot retains its content and assets without sharing output or previs identities", async () => {
    Object.assign(latest.metadata!.storyboard!.rows[1], {
        imageNodeId: "image-2",
        videoNodeId: "video-2",
        previsSceneId: "previs-2",
        previsSnapshotUrl: "data:image/png;base64,cHJldmlz",
        status: "error",
        errorDetails: "旧任务失败",
        assetBindings: [{ nodeId: "scene-1", role: "scene" }],
    });
    const original = structuredClone(latest.metadata!.storyboard!.rows[1]);
    await render();
    await click("编辑镜头 2");
    await click("镜头操作");
    const copyItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim() === "复制镜头内容");
    expect(copyItem).toBeDefined();
    await act(async () => copyItem!.click());
    const rows = latest.metadata!.storyboard!.rows;
    expect(rows).toHaveLength(4);
    expect(rows.map((item) => item.shotNumber)).toEqual([1, 2, 3, 4]);
    expect(rows[1]).toEqual(original);
    expect(rows[2].id).toBeTruthy();
    expect(rows[2].id).not.toBe(original.id);
    expect(rows[2].plotDescription).toBe(original.plotDescription);
    expect(rows[2].assetBindings).toEqual(original.assetBindings);
    expect(rows[2].imageNodeId).toBeUndefined();
    expect(rows[2].videoNodeId).toBeUndefined();
    expect(rows[2].previsSceneId).toBeUndefined();
    expect(rows[2].previsSnapshotUrl).toBeUndefined();
    expect(rows[2].errorDetails).toBeUndefined();
    expect(rows[2].status).toBe("idle");
    expect(currentShot()).toBe(rows[2].id);
    expect(generationCalls).toEqual([]);
});

test("discussion closes the editor then opens the assistant with stable node and row identities", async () => {
    await render();
    const unsubscribe = useGlobalAgentStore.subscribe((state, previous) => {
        if (state.prefillRequest !== previous.prefillRequest && state.prefillRequest) calls.push("prefill");
    });
    try {
        await click("编辑镜头 2");
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

test("generation targets skip completed, queued, loading and empty shots while allowing failed output retries", () => {
    const rows = [row(1), row(2), row(3), row(4), row(5), row(6), row(7)];
    for (const item of rows.slice(1)) {
        item.imageNodeId = `image-${item.shotNumber}`;
        item.videoNodeId = `video-${item.shotNumber}`;
    }
    Object.assign(rows[3], { plotDescription: " ", imageGenerationPrompt: " ", videoMotionPrompt: " " });
    latest.metadata!.generationBatches = [queuedBatch("storyboard_image", "image-3"), queuedBatch("storyboard_video", "video-3")];
    const nodes = [
        mediaNode("image-2", CanvasNodeType.Image, { content: "data:image/png;base64,aW1hZ2U=" }),
        mediaNode("video-2", CanvasNodeType.Video, { content: "data:video/mp4;base64,dmlkZW8=" }),
        mediaNode("image-3", CanvasNodeType.Image),
        mediaNode("video-3", CanvasNodeType.Video),
        mediaNode("image-5", CanvasNodeType.Image, { status: "loading" }),
        mediaNode("video-5", CanvasNodeType.Video, { status: "loading" }),
        mediaNode("image-6", CanvasNodeType.Image, { status: "error" }),
        mediaNode("video-6", CanvasNodeType.Video, { status: "error" }),
        mediaNode("image-7", CanvasNodeType.Image, { storageKey: "stored/image-7" }),
        mediaNode("video-7", CanvasNodeType.Video, { storageKey: "stored/video-7" }),
    ];
    expect(storyboardGenerationTargets(latest, rows, nodes)).toEqual({ imageIds: ["row-1", "row-6"], videoIds: ["row-1", "row-6"], uncertainImageIds: [], uncertainVideoIds: [], missingKeyframeCount: 0 });
});

test("keyframe mode counts only pending videos missing a usable image and keeps completed videos excluded", () => {
    const rows = [row(1), row(2), row(3), row(4)];
    rows[1].imageNodeId = "image-2";
    rows[2].videoNodeId = "video-3";
    Object.assign(rows[3], { plotDescription: "", videoMotionPrompt: "" });
    latest.metadata!.storyboardVideoInputMode = "keyframe";
    const nodes = [mediaNode("image-2", CanvasNodeType.Image, { content: "data:image/png;base64,a2V5ZnJhbWU=" }), mediaNode("video-3", CanvasNodeType.Video, { content: "data:video/mp4;base64,ZG9uZQ==" })];
    expect(storyboardGenerationTargets(latest, rows, nodes)).toEqual({ imageIds: ["row-1", "row-3"], videoIds: ["row-2"], uncertainImageIds: [], uncertainVideoIds: [], missingKeyframeCount: 1 });
});

test("uncertain costs stay out of batch generation, retry the original task explicitly and unlock after a newer ordinary failure", async () => {
    Object.assign(latest.metadata!.storyboard!.rows[1], { imageNodeId: "image-2", videoNodeId: "video-2" });
    outputNodes = [mediaNode("image-2", CanvasNodeType.Image, { status: "error" }), mediaNode("video-2", CanvasNodeType.Video, { status: "error" })];
    const uncertainBatches = [queuedBatch("storyboard_image", "image-2"), queuedBatch("storyboard_video", "video-2")].map((batch): CanvasGenerationBatch => ({
        ...batch,
        status: "partial_failed",
        items: batch.items.map((item) => ({ ...item, rowId: "row-2", status: "failed", costUncertain: true })),
    }));
    latest.metadata!.generationBatches = uncertainBatches;
    expect(storyboardGenerationTargets(latest, latest.metadata!.storyboard!.rows, outputNodes)).toEqual({
        imageIds: ["row-1", "row-3"],
        videoIds: ["row-1", "row-3"],
        uncertainImageIds: ["row-2"],
        uncertainVideoIds: ["row-2"],
        missingKeyframeCount: 0,
    });
    await render();
    await toggleShot(1);
    await toggleShot(2);
    expect(editor().querySelector('[aria-label="批量制作"]')?.textContent).toContain("费用待确认的任务已排除");
    await click("生成分镜图1");
    await click("生成视频1");
    expect(generationCalls).toEqual([
        { kind: "images", rowIds: ["row-1"] },
        { kind: "videos", rowIds: ["row-1"] },
    ]);

    await click("编辑镜头 2");
    await selectTab("画面与资产");
    const video = detail().querySelector('[aria-label="镜头视频"]')!;
    const image = detail().querySelector('[aria-label="分镜图"]')!;
    expect(video.textContent).toContain("提交前会再次确认费用");
    await click("重试原任务", video);
    await click("重试原任务", image);
    expect(retriedBatch).toHaveBeenNthCalledWith(1, "batch-video-2", "item-video-2");
    expect(retriedBatch).toHaveBeenNthCalledWith(2, "batch-image-2", "item-image-2");
    expect(generationCalls).toHaveLength(2);

    const ordinaryFailures = uncertainBatches.map((batch): CanvasGenerationBatch => ({ ...batch, id: `${batch.id}-new`, items: batch.items.map((item) => ({ ...item, id: `${item.id}-new`, costUncertain: undefined })) }));
    await act(async () => setHarnessNode({ ...latest, metadata: { ...latest.metadata, generationBatches: [...uncertainBatches, ...ordinaryFailures] } }));
    expect(storyboardGenerationTargets(latest, latest.metadata!.storyboard!.rows, outputNodes)).toEqual({
        imageIds: ["row-1", "row-2", "row-3"],
        videoIds: ["row-1", "row-2", "row-3"],
        uncertainImageIds: [],
        uncertainVideoIds: [],
        missingKeyframeCount: 0,
    });
    expect(editor().querySelector('[aria-label="批量制作"]')?.textContent).not.toContain("费用待确认");
    expect(button("按当前分镜重试", video).disabled).toBe(false);
    await click("生成视频2");
    expect(generationCalls.at(-1)).toEqual({ kind: "videos", rowIds: ["row-1", "row-2"] });
});
