// 批量连接「高亮了就能连上」回归。真实的连接控制器、选择控制器和 CanvasNode 一起跑；
// 分镜脚本、批量创作表的内容区，以及视口、分组、连线、面板用带同样 DOM 标记的替身（真实组件依赖素材库、Leafer 等全局状态）。
// 命中栈由 elementsFromPoint 模拟；pointerdown 被 preventDefault 时不再派发兼容的 mousedown / mouseup（Pointer Events 规范），click 照常派发。
import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import type { CanvasConnection, CanvasNodeData, ContextMenuState } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
const reducedMotion = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    // 产品代码自己 new 的事件（例如拖动预览的 CustomEvent）要用 happy-dom 的构造器才能派发到元素上。
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    IntersectionObserver: dom.IntersectionObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
(dom as unknown as { matchMedia: () => unknown }).matchMedia = () => reducedMotion;

// 指针捕获：浏览器把被捕获指针的后续事件派发给捕获元素（缩放手柄靠它跟随拖动）。
let captureTarget: Element | null = null;
for (const proto of [dom.Element.prototype, dom.HTMLElement.prototype] as unknown as Record<string, unknown>[]) {
    proto.setPointerCapture = function (this: Element) {
        captureTarget = this;
    };
    proto.releasePointerCapture = function (this: Element) {
        if (captureTarget === this) captureTarget = null;
    };
    proto.hasPointerCapture = function (this: Element) {
        return captureTarget === this;
    };
}

// 只记录提示、不渲染 AntD 消息：每次手势的提示条数精确可数，不受消息约 3 秒后才消失的影响。
const notices: string[] = [];
const recordNotice = (type: string) => (content: unknown) => {
    const text = typeof content === "string" ? content : String((content as { content?: unknown } | null)?.content ?? "");
    notices.push(`${type}:${text}`);
    return Promise.resolve(true);
};
const appApi = {
    message: { success: recordNotice("success"), warning: recordNotice("warning"), error: recordNotice("error"), info: recordNotice("info"), loading: recordNotice("loading"), open: recordNotice("open"), destroy: () => {} },
    modal: { confirm: () => ({ destroy: () => {}, update: () => {} }) },
    notification: { open: () => {}, destroy: () => {} },
};
const antd = await import("antd");
(antd.App as unknown as { useApp: () => unknown }).useApp = () => appApi;

const { act, useCallback, useEffect, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { useCanvasConnectionController } = await import("../../src/pages/canvas/use-canvas-connection-controller");
const { useCanvasSelectionController } = await import("../../src/pages/canvas/use-canvas-selection-controller");
const { CanvasNode } = await import("../../src/components/canvas/canvas-node");
const { defaultConfig } = await import("../../src/stores/use-config-store");
const { CanvasNodeType } = await import("../../src/types/canvas");
const { planBatchConnections } = await import("../../src/lib/canvas/canvas-batch-connection");
const { batchCellConnectionError, batchCellHandle } = await import("../../src/lib/canvas/canvas-batch-references");
const { batchReferenceHandleId, createBatchRow } = await import("../../src/lib/canvas/canvas-batch-table");
const { storyboardNodeHeight } = await import("../../src/lib/canvas/canvas-storyboard-layout");

type Controller = ReturnType<typeof useCanvasConnectionController>;
type Selection = ReturnType<typeof useCanvasSelectionController>;

const noop = () => {};
const EMPTY_SCROLL: Record<string, number> = {};
const IMAGE = "data:image/png;base64,iVBORw0KGgo=";
const ROWS = ["row-a", "row-b"];
const CELL_ROW = "cell-row";
const COLUMN = "reference-1";
const PORT_HANDLE = batchReferenceHandleId(COLUMN);
const CELL_HANDLE = batchCellHandle(CELL_ROW, COLUMN);
const TARGET_IDS = ["video", "config", "script", "table"];
const POINTER_IGNORE = "[data-canvas-no-zoom],[data-connection-create-menu],.ant-modal,.ant-popover,.ant-dropdown";

function storyboardRow(id: string, index: number) {
    return {
        id,
        shotNumber: index + 1,
        durationSeconds: 5,
        plotDescription: "",
        dialogue: "",
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [],
        status: "idle" as const,
    };
}

// 世界坐标：来源在 x=0，目标彼此相隔 1000，缩放到 0.25 时吸附圈（224）也不会互相重叠。
function sceneNodes(): CanvasNodeData[] {
    const node = (id: string, type: CanvasNodeData["type"], x: number, y: number, width: number, height: number, metadata?: CanvasNodeData["metadata"]): CanvasNodeData => ({ id, title: id, type, position: { x, y }, width, height, metadata });
    return [
        node("srcA", CanvasNodeType.Text, 0, 0, 100, 100),
        node("srcB", CanvasNodeType.Text, 0, 200, 100, 100),
        node("imgA", CanvasNodeType.Image, 0, 400, 100, 100, { content: IMAGE }),
        node("imgB", CanvasNodeType.Image, 0, 600, 100, 100, { content: IMAGE }),
        node("cfgSrc", CanvasNodeType.Config, 0, 800, 100, 100, { generationMode: "image" }),
        node("video", CanvasNodeType.Video, 1000, 0, 400, 225),
        node("config", CanvasNodeType.Config, 2000, 0, 360, 420, { generationMode: "image" }),
        node("script", CanvasNodeType.Script, 3000, 0, 400, storyboardNodeHeight(ROWS.length), { storyboard: { rows: ROWS.map(storyboardRow) } } as CanvasNodeData["metadata"]),
        node("table", CanvasNodeType.BatchTable, 4000, 0, 1280, 560, { batchTable: { operation: "try_on", concurrency: 10, rows: [{ ...createBatchRow("try_on"), id: CELL_ROW }] } }),
        node("frame", CanvasNodeType.Frame, 5000, 0, 500, 500),
    ];
}

type Variant = "texts" | "dup" | "images" | "mixed" | "single";
const SOURCES: Record<Variant, string[]> = { texts: ["srcA", "srcB"], dup: ["srcA", "srcB"], images: ["imgA", "imgB"], mixed: ["srcA", "imgA"], single: ["imgA", "cfgSrc"] };
// 生成配置不能作为聚合连接源，两个入口都会先滤掉。
const eligibleSources = (variant: Variant) => SOURCES[variant].filter((id) => id !== "cfgSrc");
const DUP_EDGES: CanvasConnection[] = [
    { id: "dup-a", fromNodeId: "srcA", toNodeId: "video" },
    { id: "dup-b", fromNodeId: "srcB", toNodeId: "video" },
];
const initialEdges = (variant: Variant) => (variant === "dup" ? DUP_EDGES.map((edge) => ({ ...edge })) : []);

type Part =
    | "videoCard"
    | "videoHeader"
    | "videoCorner"
    | "videoLeftRail"
    | "videoRightRail"
    | "configCard"
    | "configControl"
    | "configInput"
    | "configBadge"
    | "configLeftRail"
    | "scriptRow"
    | "scriptLeftPort"
    | "scriptRightPort"
    | "scriptHeader"
    | "tablePort"
    | "tableCell"
    | "tableBottom"
    | "blankNear"
    | "blankFar"
    | "edgeNear"
    | "edgeFar"
    | "frame"
    | "panel"
    | "overlay"
    | "circle"
    | "single";
const PART_NODE: Partial<Record<Part, string>> = {
    videoCard: "video",
    videoHeader: "video",
    videoCorner: "video",
    videoLeftRail: "video",
    videoRightRail: "video",
    configCard: "config",
    configControl: "config",
    configInput: "config",
    configBadge: "config",
    configLeftRail: "config",
    scriptRow: "script",
    scriptLeftPort: "script",
    scriptRightPort: "script",
    scriptHeader: "script",
    tablePort: "table",
    tableCell: "table",
    tableBottom: "table",
};
const PROBE: Partial<Record<Part, string>> = {
    configCard: "config-body",
    configControl: "config-button",
    configInput: "config-input",
    configBadge: "config-badge",
    scriptRow: "script-row-row-a",
    scriptLeftPort: "script-left-row-a",
    scriptRightPort: "script-right-row-a",
    scriptHeader: "script-header",
    tablePort: "table-port",
    tableCell: "table-cell",
    tableBottom: "table-bottom",
    frame: "frame",
    panel: "panel",
    overlay: "overlay",
    circle: "circle",
    single: "single",
};
const BACKGROUND_PARTS = new Set<Part>(["blankNear", "blankFar", "edgeNear", "edgeFar"]);
const OTHER_PARTS = new Set<Part>(["frame", "panel", "overlay", "circle", "single"]);
// 修复前按钮入口按下就能完成的部位（卡面普通区域与输入端口）。
const COMMITTING_PARTS = new Set<Part>(["videoCard", "configCard", "videoLeftRail", "configLeftRail", "scriptRow", "scriptLeftPort", "tablePort"]);
const isNodePart = (part: Part) => !BACKGROUND_PARTS.has(part) && !OTHER_PARTS.has(part);

// 落点的世界坐标；客户端坐标 = 世界坐标 × 缩放（视口原点在 0,0）。
function worldPoint(part: Part, k: number) {
    const radius = 56 / k; // 与控制器的 CONNECTION_SNAP_RADIUS 相同
    switch (part) {
        case "videoCard":
            return { x: 1200, y: 112 };
        case "videoHeader":
            return { x: 1010, y: -12 };
        case "videoCorner":
            return { x: 1398, y: 223 };
        case "videoLeftRail":
            return { x: 960, y: 112.5 };
        case "videoRightRail":
            return { x: 1440, y: 112.5 };
        case "configCard":
        case "configControl":
        case "configInput":
        case "configBadge":
            return { x: 2180, y: 210 };
        case "configLeftRail":
            return { x: 1960, y: 210 };
        case "scriptRow":
            return { x: 3200, y: 148 };
        case "scriptLeftPort":
            return { x: 3000, y: 148 };
        case "scriptRightPort":
            return { x: 3400, y: 148 };
        case "scriptHeader":
            return { x: 3200, y: 50 };
        case "tablePort":
            return { x: 4000, y: 139 };
        case "tableCell":
            return { x: 4100, y: 300 };
        case "tableBottom":
            return { x: 4500, y: 540 };
        // 左侧加号（卡片外直径 80 的圆）上下、贴着卡片边缘、仍在吸附圈内的空白。
        case "blankNear":
        case "edgeNear":
            return { x: 1000 - 0.1 * radius, y: 112.5 + 0.9 * radius };
        case "frame":
            return { x: 5250, y: 250 };
        case "circle":
            return { x: 600, y: 1200 };
        case "single":
            return { x: 50, y: 50 };
        default:
            return { x: 500, y: 1500 };
    }
}

type TargetHit = { kind: "target"; nodeId: string; handleId?: string };
type Hit = TargetHit | { kind: "rejected"; nodeId: string; reason: string } | { kind: "none" };
// 与悬停高亮同一套命中判定的期望结果，由夹具几何与命中栈推出（控制器不导出 getBatchConnectionDropTarget）。
function hitFor(part: Part, variant: Variant): Hit {
    switch (part) {
        case "videoCard":
        case "videoHeader":
        case "videoCorner":
        case "videoLeftRail":
        case "videoRightRail":
        case "blankNear":
        case "edgeNear":
            return { kind: "target", nodeId: "video" };
        case "configCard":
        case "configControl":
        case "configInput":
        case "configBadge":
        case "configLeftRail":
            return { kind: "target", nodeId: "config" };
        case "scriptRow":
        case "scriptLeftPort":
        case "scriptRightPort":
            return { kind: "target", nodeId: "script", handleId: "row:row-a" };
        case "scriptHeader":
            return { kind: "rejected", nodeId: "script", reason: "请对准分镜脚本的某一行" };
        case "tablePort":
            return { kind: "target", nodeId: "table", handleId: PORT_HANDLE };
        case "tableCell":
            return eligibleSources(variant).length === 1 ? { kind: "target", nodeId: "table", handleId: CELL_HANDLE } : { kind: "rejected", nodeId: "table", reason: "每个参考格只能连接一张图片" };
        case "tableBottom":
            return { kind: "rejected", nodeId: "table", reason: "请对准批量创作表左侧的参考图连接点" };
        default:
            return { kind: "none" };
    }
}

type Entry = "button" | "drag" | "none";
type Shape = "press" | "pressRelease" | "pressReleaseClick" | "pressMoveRelease";
type GestureInput = { entry: Entry; part: Part; variant: Variant; shape: Shape; hover: boolean; k: number; button: 0 | 2 };
const gesture = (overrides: Partial<GestureInput>): GestureInput => ({ entry: "button", part: "videoCard", variant: "texts", shape: "pressRelease", hover: true, k: 1, button: 0, ...overrides });

// 缺陷条件：按钮入口按在节点任何部位（修复前就能完成的部位除外）、
// 按在已高亮目标的吸附圈底面上，或拖拽入口松在连不上的节点上。
function isBugCondition(input: GestureInput) {
    const hit = hitFor(input.part, input.variant);
    if (input.entry === "none") return false;
    if (input.entry === "drag") return hit.kind === "rejected";
    if (input.button !== 0) return false;
    if (isNodePart(input.part)) return hit.kind === "rejected" || (hit.kind === "target" && !COMMITTING_PARTS.has(input.part));
    return BACKGROUND_PARTS.has(input.part) && hit.kind === "target" && input.hover; //
}
// 修复后在 document 捕获阶段接管的按下；这类非缺陷输入比较时不看 pointerdown 是否被取消、视口是否收到。
function inTakeoverScope(input: GestureInput) {
    const hit = hitFor(input.part, input.variant);
    if (input.entry !== "button" || input.button !== 0) return false;
    return (isNodePart(input.part) && hit.kind !== "none") || (BACKGROUND_PARTS.has(input.part) && input.hover && hit.kind === "target");
}

type Observation = {
    added: string[];
    messages: string[];
    preview: string;
    pending: string;
    connecting: string;
    resizes: number;
    editing: boolean;
    actions: string;
    cellBinds: string[];
    selection: string;
    moved: string;
    viewport: number;
    prevented: boolean | null;
};
const CORE_FIELDS = ["added", "messages", "preview", "pending", "connecting", "resizes", "editing", "actions", "cellBinds", "selection", "moved"] as const;
const fieldsFor = (input: GestureInput): readonly (keyof Observation)[] => (inTakeoverScope(input) && !isBugCondition(input) ? CORE_FIELDS : [...CORE_FIELDS, "viewport", "prevented"]);
const pick = (observation: Observation, fields: readonly (keyof Observation)[]) => Object.fromEntries(fields.map((key) => [key, observation[key]]));
const edgeKey = (edge: Pick<CanvasConnection, "fromNodeId" | "toNodeId" | "fromHandleId" | "toHandleId">) => `${edge.fromNodeId}>${edge.toNodeId}|${edge.fromHandleId ?? ""}|${edge.toHandleId ?? ""}`;

// 沿用 commitBatchConnection 的规则与提示文案：参考格只绑定一张图片，其余按 planBatchConnections。
function commitOutcome(sources: string[], hit: TargetHit, connections: CanvasConnection[]): Partial<Observation> {
    if (hit.handleId === CELL_HANDLE) {
        const error = sources.length !== 1 ? "每个参考格只能连接一张图片" : batchCellConnectionError(sceneNodes(), sources[0], hit.nodeId, hit.handleId);
        return error ? { messages: [`warning:${error}`] } : { cellBinds: [`${hit.nodeId}|${CELL_ROW}|${COLUMN}|${sources[0]}`] };
    }
    const plan = planBatchConnections({ sourceNodeIds: sources, targetNodeId: hit.nodeId, targetHandleId: hit.handleId, nodes: sceneNodes(), connections, config: defaultConfig });
    if (!plan.connections.length) return { messages: [`warning:${plan.skipped[0]?.reason || "没有可建立的连接"}`] };
    const skipped = plan.skipped.length + plan.duplicates.length;
    const suffix = skipped ? `，跳过 ${skipped} 个` : "";
    const message = plan.skipped.length ? `warning:已连接 ${plan.connected.length} 个节点${suffix}：${plan.skipped[0].reason}` : `success:已连接 ${plan.connected.length} 个节点${suffix}`;
    return { added: plan.connections.map(edgeKey).sort(), messages: [message] };
}

function expectedFor(input: GestureInput): Observation {
    const hit = hitFor(input.part, input.variant);
    const quiet: Observation = {
        added: [],
        messages: [],
        preview: "none",
        pending: "none",
        connecting: "none",
        resizes: 0,
        editing: false,
        actions: "",
        cellBinds: [],
        selection: [...SOURCES[input.variant]].sort().join(","),
        moved: "",
        viewport: 0,
        prevented: true,
    };
    const settle = (): Observation => {
        if (hit.kind === "target") return { ...quiet, ...commitOutcome(eligibleSources(input.variant), hit, initialEdges(input.variant)) };
        // 按钮入口连不上时保留预览，按提示重新对准；拖拽入口松手即结束。
        if (hit.kind === "rejected") return { ...quiet, messages: [`warning:${hit.reason}`], ...(input.entry === "button" ? { preview: "target:null" } : {}) };
        return { ...quiet, pending: "batch" };
    };
    if (input.entry === "drag" || isBugCondition(input)) return settle();
    if (input.entry === "button" && input.button === 0 && COMMITTING_PARTS.has(input.part)) return settle();
    return input.entry === "button" ? waitingExpectation(input, quiet, hit) : noPreviewExpectation(input, { ...quiet, prevented: false });
}

// 按钮入口里不被接管的按下：预览保持（目标取悬停时的命中），各部位照原来处理。
function waitingExpectation(input: GestureInput, quiet: Observation, hit: Hit): Observation {
    const waiting: Observation = { ...quiet, preview: `target:${input.hover && hit.kind === "target" ? hit.nodeId : "null"}`, prevented: false };
    switch (input.part) {
        case "blankFar":
        case "blankNear":
            return input.button === 0 && input.shape !== "press" ? { ...waiting, preview: "none", selection: "", viewport: 1 } : { ...waiting, viewport: 1 };
        case "edgeFar":
        case "edgeNear":
            return { ...waiting, actions: "edge=1", viewport: 1 };
        case "frame":
            return { ...waiting, messages: ["warning:请点击目标节点的输入端"], viewport: 1 };
        case "panel":
            return { ...waiting, actions: "panel=1" };
        case "overlay":
            return { ...waiting, actions: "overlay=1", viewport: 1 };
        case "circle":
            return input.shape === "press" ? { ...quiet, preview: "target:null" } : { ...quiet, pending: "batch" };
        case "configInput":
            return { ...waiting, actions: "inputDown=2", viewport: 1 };
        case "videoCard":
        case "configControl":
            return { ...waiting, viewport: 1 };
        default:
            return waiting; // 右键：标题行、缩放区、角标拦截按下冒泡，视口收不到；不缩放、不改名
    }
}

// 没有批量预览：节点各部位照常工作（3.11）。
function noPreviewExpectation(input: GestureInput, idle: Observation): Observation {
    switch (input.part) {
        case "videoCorner":
            return { ...idle, prevented: true, resizes: input.shape === "pressMoveRelease" ? 1 : 0 };
        case "videoHeader":
            return { ...idle, editing: input.shape === "pressReleaseClick" };
        case "videoRightRail":
            return { ...idle, prevented: true, ...(input.shape === "press" ? { connecting: "video:source" } : input.shape === "pressMoveRelease" ? {} : { pending: "quick" }) };
        case "videoCard":
            return { ...idle, viewport: 1, selection: "video", moved: input.shape === "pressMoveRelease" ? "video" : "" };
        case "configControl":
            return { ...idle, viewport: 1, actions: input.shape === "pressReleaseClick" ? "configButton=1" : "" };
        case "configInput":
            return { ...idle, viewport: 1, actions: "inputDown=2" };
        case "configBadge":
            return { ...idle, actions: input.shape === "pressReleaseClick" ? "badge=1" : "" };
        default:
            throw new Error(`没有为无预览场景建模：${input.part}`);
    }
}

type Counters = { resize: number; configButton: number; inputDown: number; badge: number; cellDrag: number; cellPick: number; edge: number; panel: number; overlay: number; viewport: number; contextMenuClosed: number };
const ACTION_KEYS = ["configButton", "inputDown", "badge", "cellDrag", "cellPick", "edge", "panel", "overlay"] as const;
const zeroCounters = (): Counters => ({ resize: 0, configButton: 0, inputDown: 0, badge: 0, cellDrag: 0, cellPick: 0, edge: 0, panel: 0, overlay: 0, viewport: 0, contextMenuClosed: 0 });

function StubContent({ node, controllerRef, counters }: { node: CanvasNodeData; controllerRef: { current: Controller }; counters: Counters }) {
    if (node.type === CanvasNodeType.Config) {
        return (
            <div>
                <span data-probe="config-body">图片配置</span>
                <button
                    type="button"
                    data-probe="config-button"
                    onClick={() => {
                        counters.configButton += 1;
                    }}
                >
                    运行
                </button>
                <input
                    data-probe="config-input"
                    aria-label="配置输入"
                    onPointerDown={() => {
                        counters.inputDown += 1;
                    }}
                    onMouseDown={() => {
                        counters.inputDown += 1;
                    }}
                />
                {/* 与节点角标相同：拦截按下冒泡，单击执行自身动作。 */}
                <button
                    type="button"
                    data-probe="config-badge"
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        counters.badge += 1;
                    }}
                >
                    版本
                </button>
            </div>
        );
    }
    if (node.type === CanvasNodeType.Script) {
        // 与 project.tsx 给分镜行端口的接线相同：左端口是输入，右端口是输出。
        return (
            <div>
                <span data-probe="script-header">分镜表头</span>
                {ROWS.map((rowId) => (
                    <div key={rowId}>
                        <span data-probe={`script-row-${rowId}`}>镜头</span>
                        <button type="button" data-probe={`script-left-${rowId}`} onPointerDown={(event) => controllerRef.current.handleConnectStart(event, node.id, "target", `row:${rowId}`)} />
                        <button type="button" data-probe={`script-right-${rowId}`} onPointerDown={(event) => controllerRef.current.handleConnectStart(event, node.id, "source", `row:${rowId}`)} />
                    </div>
                ))}
            </div>
        );
    }
    if (node.type !== CanvasNodeType.BatchTable) return null;
    // 与 BatchReferenceHandle、ReferenceThumbnail 的 DOM 标记和事件处理相同。
    return (
        <div>
            <span data-probe="table-bottom">任务区</span>
            <button
                type="button"
                data-probe="table-port"
                onPointerDown={(event) => {
                    event.stopPropagation();
                    controllerRef.current.handleConnectStart(event, node.id, "target", PORT_HANDLE);
                }}
                onPointerUp={(event) => {
                    event.stopPropagation();
                    controllerRef.current.handleConnectDrop(event, node.id, PORT_HANDLE);
                }}
            />
            <div data-batch-reference-cell data-canvas-no-drag data-target-node-id={node.id} data-row-id={CELL_ROW} data-column-id={COLUMN}>
                <button
                    type="button"
                    data-probe="table-cell"
                    onPointerDown={() => {
                        counters.cellDrag += 1;
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        counters.cellPick += 1;
                    }}
                />
            </div>
        </div>
    );
}

type Live = { controller: Controller; selection: Selection; nodes: CanvasNodeData[]; edges: CanvasConnection[]; selected: Set<string>; reset: (variant: Variant, k: number) => void };

async function mount() {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const counters = zeroCounters();
    const cellBinds: string[] = [];
    let stack: Element[] = [];
    let sources = SOURCES.texts;
    let initialEdgeIds = new Set<string>();
    const doc = document as unknown as { elementsFromPoint: unknown; elementFromPoint: unknown };
    doc.elementsFromPoint = () => stack;
    doc.elementFromPoint = () => stack[0] || null;
    const live = {} as Live;

    function Harness() {
        const [nodes, setNodes] = useState(sceneNodes);
        const [connections, setConnections] = useState<CanvasConnection[]>([]);
        const [selected, setSelected] = useState(() => new Set<string>());
        const [k, setK] = useState(1);
        const [epoch, setEpoch] = useState(0);
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        const connectionsRef = useRef(connections);
        connectionsRef.current = connections;
        const selectedRef = useRef(selected);
        selectedRef.current = selected;
        const viewportRef = useRef({ x: 0, y: 0, k });
        viewportRef.current.k = k;
        const containerRef = useRef<HTMLDivElement>(null);
        const historyPausedRef = useRef(false);
        const screenToCanvas = useCallback((x: number, y: number) => ({ x: x / viewportRef.current.k, y: y / viewportRef.current.k }), []);
        const setContextMenu = useCallback((value: SetStateAction<ContextMenuState | null>) => {
            if (value === null) counters.contextMenuClosed += 1;
        }, []);
        const onBatchCellConnect = useCallback((tableId: string, rowId: string, columnId: string, sourceId: string) => {
            cellBinds.push(`${tableId}|${rowId}|${columnId}|${sourceId}`);
        }, []);
        const onResize = useCallback(() => {
            counters.resize += 1;
        }, []);
        const controller = useCanvasConnectionController({
            projectId: "press",
            config: defaultConfig,
            defaultDrawingEngine: "excalidraw",
            nodesRef,
            connectionsRef,
            viewportRef,
            scriptScrollTopById: EMPTY_SCROLL,
            screenToCanvas,
            setNodes,
            setConnections,
            setSelectedNodeIds: setSelected,
            setSelectedConnectionId: noop,
            setContextMenu,
            setDialogNodeId: noop,
            setDrawingNodeId: noop,
            onBatchCellConnect,
        });
        const controllerRef = useRef(controller);
        controllerRef.current = controller;
        const selection = useCanvasSelectionController({
            containerRef,
            nodesRef,
            viewportRef,
            selectedNodeIdsRef: selectedRef,
            historyPausedRef,
            screenToCanvas,
            setNodes,
            setSelectedNodeIds: setSelected,
            setSelectedConnectionId: noop,
            cancelPendingConnectionCreate: controller.cancelPendingConnectionCreate,
            onCanvasSelectionStart: noop,
            onNodeInteractionStart: noop,
            onNodeClick: noop,
            onBatchConnectionTarget: controller.handleBatchConnectionTargetClick,
            onDeselect: noop,
        });
        Object.assign(live, {
            controller,
            selection,
            nodes,
            edges: connections,
            selected,
            reset: (variant: Variant, zoom: number) => {
                setK(zoom);
                setNodes(sceneNodes());
                setConnections(initialEdges(variant));
                setSelected(new Set(SOURCES[variant]));
                setEpoch((value) => value + 1);
            },
        });
        // 视口替身：与 canvas-viewport.tsx 的平移意图相同（空白处按下开始平移，没移动就松手取消选择）。
        // 只记录，不调用 preventDefault，用来确认接管没有拦截空白处的按下。
        const panRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
        const deselectRef = useRef(selection.deselectCanvas);
        deselectRef.current = selection.deselectCanvas;
        useEffect(() => {
            const move = (event: PointerEvent) => {
                const pan = panRef.current;
                if (pan && pan.pointerId === event.pointerId && Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 3) pan.moved = true;
            };
            const end = (event: PointerEvent) => {
                const pan = panRef.current;
                if (!pan || pan.pointerId !== event.pointerId) return;
                panRef.current = null;
                if (event.type === "pointerup" && !pan.moved) deselectRef.current();
            };
            const stop = () => {
                panRef.current = null;
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", end);
            window.addEventListener("pointercancel", end);
            window.addEventListener("blur", stop);
            return () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", end);
                window.removeEventListener("pointercancel", end);
                window.removeEventListener("blur", stop);
            };
        }, []);
        const onViewportPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
            counters.viewport += 1;
            const target = event.target instanceof Element ? event.target : null;
            if (!target || event.button !== 0 || target.closest(POINTER_IGNORE) || target.closest("[data-node-id],[data-connection-id]")) return;
            panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        };
        const renderNodeContent = useCallback((node: CanvasNodeData) => <StubContent node={node} controllerRef={controllerRef} counters={counters} />, []);
        const preview = controller.batchConnectionPreview;
        return (
            <MemoryRouter>
                <div ref={containerRef} data-canvas-viewport data-probe="viewport" onPointerDown={onViewportPointerDown}>
                    <div data-canvas-world-layer>
                        {nodes
                            .filter((node) => TARGET_IDS.includes(node.id))
                            .map((node) => (
                                <CanvasNode
                                    key={`${node.id}:${epoch}`}
                                    data={node}
                                    scale={k}
                                    isSelected={selected.has(node.id)}
                                    isRelated={false}
                                    isFocusRelated={false}
                                    isConnectionTarget={preview?.targetNodeId === node.id || controller.connectionTargetNodeId === node.id}
                                    isConnecting={Boolean(preview || controller.connectingParams)}
                                    forceInputMounted={Boolean(preview)}
                                    showImageInfo={false}
                                    renderNodeContent={renderNodeContent}
                                    onMouseDown={selection.handleNodeMouseDown}
                                    onHoverStart={noop}
                                    onHoverEnd={noop}
                                    onConnectStart={controller.handleConnectStart}
                                    onResize={onResize}
                                    onTitleChange={noop}
                                    onContentChange={noop}
                                    onContextMenu={noop}
                                />
                            ))}
                        {/* 分组只有 data-node-id，没有 .node-element（canvas-frame-node.tsx）。 */}
                        <div data-node-id="frame" data-probe="frame" onMouseDown={(event) => selection.handleNodeMouseDown(event, "frame")}>
                            分组
                        </div>
                        <svg>
                            <path
                                data-connection-id="edge-1"
                                data-probe="edge"
                                d="M 0 0 L 10 10"
                                onPointerDown={() => {
                                    counters.edge += 1;
                                }}
                            />
                        </svg>
                        <button type="button" data-probe="circle" onPointerDown={(event) => controller.startBatchConnection(event, sources)}>
                            批量连接
                        </button>
                        <button type="button" data-probe="single" onPointerDown={(event) => controller.handleConnectStart(event, "srcA", "source")}>
                            单条连线
                        </button>
                        <div
                            data-probe="overlay"
                            data-canvas-no-zoom
                            onPointerDown={() => {
                                counters.overlay += 1;
                            }}
                        >
                            节点面板
                        </div>
                    </div>
                </div>
                <div
                    data-probe="panel"
                    onPointerDown={() => {
                        counters.panel += 1;
                    }}
                >
                    侧栏面板
                </div>
            </MemoryRouter>
        );
    }

    await act(async () =>
        root.render(
            <antd.App>
                <Harness />
            </antd.App>,
        ),
    );
    const pointer = (type: string, x: number, y: number, button: number, buttons: number) =>
        new dom.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: x, clientY: y, button, buttons });
    const mouse = (type: string, x: number, y: number, button: number) => new dom.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button, buttons: type === "mousedown" ? (button === 2 ? 2 : 1) : 0, detail: 1 });
    const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const q = (selector: string) => host.querySelector(selector);
    const nodeEl = (id: string) => host.querySelector(`.node-element[data-node-id="${id}"]`);
    const viewport = () => q('[data-probe="viewport"]')!;
    const chain = (element: Element | null) => {
        const out: Element[] = [];
        for (let current = element; current; current = current.parentElement) {
            out.push(current);
            if (current === host) break;
        }
        return out;
    };
    function partElement(part: Part): Element | null {
        const video = nodeEl("video");
        switch (part) {
            case "videoCard":
                return video?.querySelector(".canvas-node-shell")?.firstElementChild ?? null;
            case "videoHeader":
                return video?.querySelector(".canvas-node-external-header button") ?? null;
            case "videoCorner":
                return video?.querySelector('[data-resize-corner="bottom-right"]') ?? null;
            case "videoLeftRail":
                return video?.querySelector('[data-canvas-connection-rail="left"]') ?? null;
            case "videoRightRail":
                return video?.querySelector('[data-canvas-connection-rail="right"]') ?? null;
            case "configLeftRail":
                return nodeEl("config")?.querySelector('[data-canvas-connection-rail="left"]') ?? null;
            case "blankNear":
            case "blankFar":
                return viewport();
            case "edgeNear":
            case "edgeFar":
                return q('[data-probe="edge"]');
            default:
                return q(`[data-probe="${PROBE[part]}"]`);
        }
    }
    // 命中栈：卡片外侧的加号、连线和画布上的按钮只压在视口上；卡片内的部位连同祖先都在指针下。
    function stackFor(part: Part, element: Element): Element[] {
        if (part === "panel") return [element, host];
        if (part === "videoLeftRail" || part === "videoRightRail" || part === "configLeftRail" || part === "edgeNear" || part === "edgeFar" || OTHER_PARTS.has(part)) return [element, viewport(), host];
        return chain(element);
    }
    function spot(part: Part, k: number) {
        const element = partElement(part);
        if (!element) return null;
        const world = worldPoint(part, k);
        return { stack: stackFor(part, element), x: world.x * k, y: world.y * k };
    }
    return {
        host,
        counters,
        cellBinds,
        live,
        spot,
        setSources: (next: string[]) => {
            sources = next;
        },
        async hoverNode(id: string) {
            const shell = nodeEl(id)?.querySelector(".canvas-node-shell");
            if (shell)
                await act(async () => {
                    shell.dispatchEvent(new dom.MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
                });
        },
        async move(x: number, y: number, next: Element[], buttons: number) {
            stack = next;
            await act(async () => {
                (captureTarget ?? next[0]).dispatchEvent(pointer("pointermove", x, y, -1, buttons));
                await nextFrame();
            });
        },
        async press(x: number, y: number, next: Element[], button = 0) {
            stack = next;
            const down = pointer("pointerdown", x, y, button, button === 2 ? 2 : 1);
            await act(async () => {
                next[0].dispatchEvent(down);
                if (!down.defaultPrevented) next[0].dispatchEvent(mouse("mousedown", x, y, button));
            });
            return down.defaultPrevented;
        },
        async release(x: number, y: number, next: Element[], canceled: boolean, button = 0) {
            stack = next;
            const target = captureTarget ?? next[0];
            await act(async () => {
                target.dispatchEvent(pointer("pointerup", x, y, button, 0));
                if (!canceled) target.dispatchEvent(mouse("mouseup", x, y, button));
            });
        },
        async click(x: number, y: number, next: Element[]) {
            stack = next;
            await act(async () => {
                next[0].dispatchEvent(mouse("click", x, y, 0));
            });
        },
        async cancel(x: number, y: number, next: Element[]) {
            stack = next;
            await act(async () => {
                (captureTarget ?? next[0]).dispatchEvent(pointer("pointercancel", x, y, 0, 0));
            });
        },
        async reset(variant: Variant, k: number) {
            await act(async () => {
                window.dispatchEvent(new dom.Event("blur"));
            });
            await act(async () => {
                live.controller.cancelPendingConnectionCreate();
                live.reset(variant, k);
            });
            captureTarget = null;
            sources = SOURCES[variant];
            initialEdgeIds = new Set(initialEdges(variant).map((edge) => edge.id));
            notices.length = 0;
            cellBinds.length = 0;
            Object.assign(counters, zeroCounters());
        },
        observe(prevented: boolean | null): Observation {
            const { controller, edges, selected, nodes } = live;
            const preview = controller.batchConnectionPreview;
            const pending = controller.pendingConnectionCreate;
            const connecting = controller.connectingParams;
            const initial = new Map(sceneNodes().map((node) => [node.id, node.position]));
            return {
                added: edges
                    .filter((edge) => !initialEdgeIds.has(edge.id))
                    .map(edgeKey)
                    .sort(),
                messages: notices.slice(),
                preview: preview ? `target:${preview.targetNodeId ?? "null"}` : "none",
                pending: pending ? (pending.batchSourceNodeIds?.length ? "batch" : pending.quick ? "quick" : "single") : "none",
                connecting: connecting ? `${connecting.nodeId}:${connecting.handleType}` : "none",
                resizes: counters.resize,
                editing: Boolean(host.querySelector('input[aria-label="节点名称"]')),
                actions: ACTION_KEYS.filter((key) => counters[key])
                    .map((key) => `${key}=${counters[key]}`)
                    .join(","),
                cellBinds: cellBinds.slice(),
                selection: Array.from(selected).sort().join(","),
                moved: nodes
                    .filter((node) => {
                        const origin = initial.get(node.id);
                        return Boolean(origin && (origin.x !== node.position.x || origin.y !== node.position.y));
                    })
                    .map((node) => node.id)
                    .sort()
                    .join(","),
                viewport: counters.viewport,
                prevented,
            };
        },
        async dispose() {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

type Harness = Awaited<ReturnType<typeof mount>>;
const h = await mount();

afterAll(async () => {
    await h.dispose();
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

// 一次手势：按钮入口先进入批量预览；拖拽入口从选区圆钮按下拖到落点松手；"none" 表示没有批量预览。
async function runGesture(harness: Harness, input: GestureInput) {
    await harness.reset(input.variant, input.k);
    const nodeId = PART_NODE[input.part];
    if (input.entry === "drag") {
        const circle = harness.spot("circle", input.k)!;
        const prevented = await harness.press(circle.x, circle.y, circle.stack);
        if (nodeId) await harness.hoverNode(nodeId);
        const target = harness.spot(input.part, input.k);
        if (!target) return null;
        await harness.move(target.x, target.y, target.stack, 1);
        await harness.release(target.x, target.y, target.stack, prevented);
        return harness.observe(prevented);
    }
    if (input.entry === "button") await act(async () => harness.live.controller.beginBatchConnectionMode(SOURCES[input.variant]));
    if (nodeId) await harness.hoverNode(nodeId);
    const target = harness.spot(input.part, input.k);
    if (!target) return null;
    if (input.hover) await harness.move(target.x, target.y, target.stack, 0);
    const prevented = await harness.press(target.x, target.y, target.stack, input.button);
    const endX = input.shape === "pressMoveRelease" ? target.x + 20 : target.x;
    if (input.shape === "pressMoveRelease") await harness.move(endX, target.y, target.stack, input.button === 2 ? 2 : 1);
    if (input.shape !== "press") await harness.release(endX, target.y, target.stack, prevented, input.button);
    if (input.shape === "pressReleaseClick") await harness.click(endX, target.y, target.stack);
    return harness.observe(prevented);
}

async function check(input: GestureInput, label = JSON.stringify(input)) {
    const actual = await runGesture(h, input);
    if (!actual) throw new Error(`部位没有渲染：${label}`);
    const fields = fieldsFor(input);
    expect(pick(actual, fields), label).toEqual(pick(expectedFor(input), fields));
    return actual;
}

test("E1 按钮入口：在高亮目标右下角缩放区按下并拖动，连上且不缩放", async () => {
    const actual = await check(gesture({ part: "videoCorner", shape: "pressMoveRelease" }));
    expect(actual.added).toHaveLength(2);
    expect(actual.resizes).toBe(0);
    expect(h.counters.contextMenuClosed).toBeGreaterThan(0);
}, 15000);

test("E2 按钮入口：单击高亮目标的标题行，连上且不进入改名", async () => {
    expect((await check(gesture({ part: "videoHeader", shape: "pressReleaseClick" }))).editing).toBe(false);
}, 15000);

test("E3 按钮入口：按卡内按钮或输入框都连上，控件自身不响应", async () => {
    expect((await check(gesture({ part: "configControl", shape: "pressReleaseClick" }))).actions).toBe("");
    expect((await check(gesture({ part: "configInput", shape: "pressReleaseClick" }))).actions).toBe("");
}, 15000);

test("E4 按钮入口：按右侧加号连上，不拉出单条线、不弹快速新建", async () => {
    await check(gesture({ part: "videoRightRail", shape: "pressRelease" }));
}, 15000);

test("E5 按钮入口：按分镜行右端口连到这一行", async () => {
    expect((await check(gesture({ part: "scriptRightPort", shape: "pressRelease" }))).added).toEqual(["srcA>script||row:row-a", "srcB>script||row:row-a"]);
}, 15000);

test("E6 按钮入口：按在分镜表头上提示对准某一行，并结束预览", async () => {
    expect((await check(gesture({ part: "scriptHeader", shape: "pressRelease" }))).messages).toEqual(["warning:请对准分镜脚本的某一行"]);
    expect(h.counters.contextMenuClosed).toBe(1);
}, 15000);

test("E7 按钮入口：参考格上多张图片说明原因，一张图片照常绑定", async () => {
    await check(gesture({ part: "tableCell", variant: "images", shape: "pressReleaseClick" }));
    const single = await check(gesture({ part: "tableCell", variant: "single", shape: "pressReleaseClick" }));
    expect(single.cellBinds).toEqual([`table|${CELL_ROW}|${COLUMN}|imgA`]);
    expect(single.actions).toBe(""); // 替身参考格：自身的拖动和选图都没有开始
}, 15000);

test("E8 拖拽入口：松在分镜表头上提示对准某一行，不出新建菜单", async () => {
    await check(gesture({ entry: "drag", part: "scriptHeader" }));
}, 15000);

test("E9 拖拽入口：两张图片松在同一个参考格上说明原因，不出新建菜单", async () => {
    await check(gesture({ entry: "drag", part: "tableCell", variant: "images" }));
}, 15000);

test("E10 按钮入口：缩小画布后在左侧加号外、已高亮的吸附范围内按下也连上", async () => {
    expect((await check(gesture({ part: "blankNear", shape: "pressRelease", k: 0.5 }))).added).toHaveLength(2);
}, 15000);

test("E11 同一次操作之后的松手和单击不会再连一次、再提示一次", async () => {
    for (const value of [gesture({ part: "videoCorner", shape: "pressMoveRelease" }), gesture({ part: "scriptHeader", shape: "pressRelease" })]) {
        const first = await check(value);
        const target = h.spot(value.part, value.k)!;
        await h.release(target.x, target.y, target.stack, true);
        await h.click(target.x, target.y, target.stack);
        expect(pick(h.observe(first.prevented), CORE_FIELDS)).toEqual(pick(first, CORE_FIELDS));
    }
}, 15000);

test("P1 拖拽入口：松在高亮目标的卡面、四个角、标题行、左右加号上照常连上", async () => {
    for (const part of ["videoCard", "videoCorner", "videoHeader", "videoLeftRail", "videoRightRail"] as const) await check(gesture({ entry: "drag", part }));
}, 30000);

test("P2 拖拽入口：松在空白处、短按圆钮都出批量新建菜单", async () => {
    await check(gesture({ entry: "drag", part: "blankFar" }));
    await h.reset("texts", 1);
    const circle = h.spot("circle", 1)!;
    const prevented = await h.press(circle.x, circle.y, circle.stack);
    await h.release(circle.x, circle.y, circle.stack, prevented);
    const actual = h.observe(prevented);
    expect([actual.pending, actual.preview, actual.added.length]).toEqual(["batch", "none", 0]);
}, 15000);

test("P3 拖拽入口：一张有内容的图片松在可用参考格上，绑定这一格", async () => {
    expect((await check(gesture({ entry: "drag", part: "tableCell", variant: "single" }))).cellBinds).toHaveLength(1);
}, 15000);

test("P4 提交沿用原有规则与提示：重复连接、部分跳过", async () => {
    expect((await check(gesture({ part: "videoCard", variant: "dup" }))).messages).toEqual(["warning:没有可建立的连接"]);
    expect((await check(gesture({ part: "tablePort", variant: "mixed" }))).messages[0]).toStartWith("warning:已连接 1 个节点，跳过 1 个：");
}, 15000);

test("P5 视口外的面板、视口内的浮层上按下不被接管，预览保持", async () => {
    for (const part of ["panel", "overlay"] as const) {
        const actual = await check(gesture({ part, shape: "press" }));
        expect(actual.prevented).toBe(false);
        expect(actual.actions).toBe(`${part}=1`); // 面板自己的监听照常收到这次按下
    }
}, 15000);

test("P6 Esc、窗口失焦、拖拽入口被系统取消，都结束批量预览且不连线", async () => {
    await h.reset("texts", 1);
    await act(async () => h.live.controller.beginBatchConnectionMode(SOURCES.texts));
    await act(async () => h.live.selection.deselectCanvas()); // Esc 经 use-canvas-keyboard 调到这里
    expect(h.live.controller.batchConnectionPreview).toBeNull();
    await act(async () => h.live.controller.beginBatchConnectionMode(SOURCES.texts));
    await act(async () => {
        window.dispatchEvent(new dom.Event("blur"));
    });
    expect(h.live.controller.batchConnectionPreview).toBeNull();
    const circle = h.spot("circle", 1)!;
    await h.press(circle.x, circle.y, circle.stack);
    expect(h.live.controller.batchConnectionPreview).not.toBeNull();
    await h.cancel(circle.x, circle.y, circle.stack);
    expect(h.live.controller.batchConnectionPreview).toBeNull();
    expect(h.live.edges).toHaveLength(0);
}, 15000);

test("P7 按钮入口只移动不按键：预览跟随并高亮，不提前连线", async () => {
    await h.reset("texts", 1);
    await act(async () => h.live.controller.beginBatchConnectionMode(SOURCES.texts));
    await h.hoverNode("video");
    const target = h.spot("videoCard", 1)!;
    await h.move(target.x, target.y, target.stack, 0);
    expect(h.live.controller.batchConnectionPreview?.targetNodeId).toBe("video");
    expect(h.observe(null).added).toEqual([]);
}, 15000);

test("P8 按钮入口：卡面、左侧加号、分镜行左端口、参考列端口按下立即连上；在别处按下后到参考列端口上松手也连上", async () => {
    for (const value of [gesture({ part: "videoCard", shape: "press" }), gesture({ part: "videoLeftRail", shape: "press" }), gesture({ part: "scriptLeftPort", shape: "press" }), gesture({ part: "tablePort", variant: "images", shape: "press" })])
        await check(value);
    await h.reset("images", 1);
    await act(async () => h.live.controller.beginBatchConnectionMode(SOURCES.images));
    const panel = h.spot("panel", 1)!;
    expect(await h.press(panel.x, panel.y, panel.stack)).toBe(false);
    await h.hoverNode("table");
    const port = h.spot("tablePort", 1)!;
    await h.move(port.x, port.y, port.stack, 1);
    await h.release(port.x, port.y, port.stack, false);
    const actual = h.observe(null);
    expect(actual.added).toEqual(expectedFor(gesture({ part: "tablePort", variant: "images" })).added);
    expect([actual.messages.length, actual.preview]).toEqual([1, "none"]);
}, 30000);

test("P9 按钮入口：吸附范围外的空白处交给视口；空白处拖动平移后松在节点上不连线", async () => {
    const pressed = await check(gesture({ part: "blankFar", shape: "press" }));
    expect([pressed.prevented, pressed.viewport]).toEqual([false, 1]);
    expect((await check(gesture({ part: "blankFar", shape: "pressRelease" }))).selection).toBe("");
    await h.reset("texts", 1);
    await act(async () => h.live.controller.beginBatchConnectionMode(SOURCES.texts));
    const blank = h.spot("blankFar", 1)!;
    expect(await h.press(blank.x, blank.y, blank.stack)).toBe(false);
    await h.hoverNode("video");
    const card = h.spot("videoCard", 1)!;
    await h.move(card.x, card.y, card.stack, 1);
    await h.release(card.x, card.y, card.stack, false);
    const panned = h.observe(false);
    expect([panned.added, panned.preview, panned.viewport]).toEqual([[], "target:video", 1]);
}, 15000);

test("P10 没有批量预览时，节点各部位照常工作", async () => {
    expect((await check(gesture({ entry: "none", part: "videoCorner", shape: "pressMoveRelease" }))).resizes).toBe(1);
    expect((await check(gesture({ entry: "none", part: "videoHeader", shape: "pressReleaseClick" }))).editing).toBe(true);
    expect((await check(gesture({ entry: "none", part: "videoRightRail", shape: "press" }))).connecting).toBe("video:source");
    expect((await check(gesture({ entry: "none", part: "videoCard", shape: "press" }))).selection).toBe("video");
}, 15000);

test("P13 单条连接点短按打开快速新建菜单", async () => {
    expect((await check(gesture({ entry: "none", part: "videoRightRail", shape: "pressRelease" }))).pending).toBe("quick");
}, 15000);

test("P14 选区没有可用来源时提示原因，不进入批量预览", async () => {
    await h.reset("texts", 1);
    await act(async () => h.live.controller.beginBatchConnectionMode(["cfgSrc", "frame"]));
    expect([h.observe(null).messages, h.live.controller.batchConnectionPreview]).toEqual([["warning:当前选区没有可作为连接源的节点"], null]);
    notices.length = 0;
    h.setSources(["cfgSrc"]);
    const circle = h.spot("circle", 1)!;
    await h.press(circle.x, circle.y, circle.stack);
    expect([h.observe(null).messages, h.live.controller.batchConnectionPreview]).toEqual([["warning:当前选区没有可作为连接源的节点"], null]);
}, 15000);

test("P15 单条拖线：松在可连目标的任何位置都只连一条到这个目标", async () => {
    const cases = [
        ["videoCard", "video"],
        ["videoHeader", "video"],
        ["videoCorner", "video"],
        ["videoLeftRail", "video"],
        ["videoRightRail", "video"],
        ["configCard", "config"],
        ["configControl", "config"],
        ["configInput", "config"],
        ["configBadge", "config"],
    ] as const;
    for (const [part, target] of cases) {
        await h.reset("texts", 1);
        const start = h.spot("single", 1)!;
        const prevented = await h.press(start.x, start.y, start.stack);
        await h.hoverNode(target);
        const spot = h.spot(part, 1)!;
        await h.move(spot.x, spot.y, spot.stack, 1);
        expect(h.live.controller.connectionTargetNodeId, part).toBe(target);
        await h.release(spot.x, spot.y, spot.stack, prevented);
        const actual = h.observe(prevented);
        expect(actual.added, part).toEqual([`srcA>${target}||`]);
        expect([actual.connecting, actual.pending, actual.messages.length], part).toEqual(["none", "none", 0]);
    }
}, 30000);

// 性质测试：固定种子的伪随机生成器（mulberry32，种子 1–200），不引入 fast-check；失败信息带种子和输入。
function mulberry32(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
type Template = { entry: Entry; parts: Part[]; variants: Variant[]; shapes?: Shape[]; hover?: boolean[]; buttons?: (0 | 2)[]; zooms?: number[] };
const ZOOMS = [0.25, 0.5, 1, 2];
const HEADER_ZOOMS = [0.5, 1, 2]; // 缩放小于 0.35 时不渲染标题行
const ALL_SHAPES: Shape[] = ["press", "pressRelease", "pressReleaseClick", "pressMoveRelease"];
const TAP_SHAPES: Shape[] = ["press", "pressRelease", "pressReleaseClick"];
const BOTH = [true, false];
const BUG_TEMPLATES: Template[] = [
    { entry: "button", parts: ["videoCorner", "videoRightRail"], variants: ["texts", "dup"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["videoHeader"], variants: ["texts", "dup"], shapes: ALL_SHAPES, hover: BOTH, zooms: HEADER_ZOOMS },
    { entry: "button", parts: ["configControl", "configInput", "configBadge", "scriptRightPort", "scriptHeader"], variants: ["texts"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["tableCell"], variants: ["images", "single"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["tableBottom"], variants: ["images"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["blankNear", "edgeNear"], variants: ["texts", "dup"], shapes: TAP_SHAPES, hover: [true] }, //
    { entry: "drag", parts: ["scriptHeader"], variants: ["texts"] },
    { entry: "drag", parts: ["tableCell", "tableBottom"], variants: ["images"] },
];
const PRESERVATION_TEMPLATES: Template[] = [
    { entry: "drag", parts: ["videoCard", "videoCorner", "videoLeftRail", "videoRightRail", "blankNear", "edgeNear"], variants: ["texts", "dup"] },
    { entry: "drag", parts: ["videoHeader"], variants: ["texts", "dup"], zooms: HEADER_ZOOMS },
    { entry: "drag", parts: ["configCard", "configControl", "configInput", "configBadge", "configLeftRail", "scriptRow", "scriptLeftPort", "scriptRightPort", "blankFar", "edgeFar", "frame", "panel", "overlay"], variants: ["texts"] },
    { entry: "drag", parts: ["tablePort"], variants: ["images", "mixed"] },
    { entry: "drag", parts: ["tableCell"], variants: ["single"] },
    { entry: "button", parts: ["videoCard", "videoLeftRail"], variants: ["texts", "dup"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["configCard", "configLeftRail", "scriptRow", "scriptLeftPort"], variants: ["texts"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["tablePort"], variants: ["images", "mixed"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["blankFar", "edgeFar"], variants: ["texts"], shapes: TAP_SHAPES, hover: BOTH },
    { entry: "button", parts: ["blankNear", "edgeNear"], variants: ["texts"], shapes: TAP_SHAPES, hover: [false] }, // 未高亮时交给视口
    { entry: "button", parts: ["frame", "panel", "overlay", "circle"], variants: ["texts"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "button", parts: ["videoCard", "videoCorner", "configControl", "configInput", "configBadge", "blankFar"], variants: ["texts"], shapes: ["press", "pressRelease"], hover: BOTH, buttons: [2] },
    { entry: "button", parts: ["videoHeader"], variants: ["texts"], shapes: ["press", "pressRelease"], hover: BOTH, buttons: [2], zooms: HEADER_ZOOMS },
    { entry: "none", parts: ["videoCorner", "videoRightRail", "videoCard", "configControl", "configInput", "configBadge"], variants: ["texts"], shapes: ALL_SHAPES, hover: BOTH },
    { entry: "none", parts: ["videoHeader"], variants: ["texts"], shapes: ALL_SHAPES, hover: BOTH, zooms: HEADER_ZOOMS },
];

function generate(seed: number, templates: Template[]): GestureInput {
    const random = mulberry32(seed);
    const one = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    const template = one(templates);
    return { entry: template.entry, part: one(template.parts), variant: one(template.variants), shape: one(template.shapes ?? ["pressRelease"]), hover: one(template.hover ?? [true]), button: one(template.buttons ?? [0]), k: one(template.zooms ?? ZOOMS) };
}

async function runProperty(name: string, templates: Template[], bug: boolean) {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed += 1) {
        const value = generate(seed, templates);
        const label = `${name} seed ${seed} ${JSON.stringify(value)}`;
        expect(isBugCondition(value), label).toBe(bug);
        const actual = await check(value, label);
        // 计数部分：每次操作最多提交一次、最多一条提示。
        expect(actual.messages.length, label).toBeLessThanOrEqual(1);
        expect(actual.cellBinds.length, label).toBeLessThanOrEqual(1);
        seen.add(`${value.entry}:${value.part}`);
    }
    console.log(`[${name}] 200 个输入，覆盖 ${seen.size} 种入口与部位组合`);
}

test("PBT1 缺陷输入：高亮了就能连上，连不上就说明原因（种子 1–200）", async () => {
    await runProperty("PBT1", BUG_TEMPLATES, true);
}, 180000);

test("PBT2 非缺陷输入：结果与修复前一致（种子 1–200）", async () => {
    await runProperty("PBT2", PRESERVATION_TEMPLATES, false);
}, 180000);
