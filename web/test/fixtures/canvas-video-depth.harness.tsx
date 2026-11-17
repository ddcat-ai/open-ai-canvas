import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasConnection, CanvasNodeData } from "../../src/types/canvas";

const dom = new Window({ url: "https://canvas.example/canvas/test" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { CanvasVideoDepthDialog } = await import("../../src/components/canvas/canvas-video-depth-dialog");
const { useCanvasMediaTools } = await import("../../src/pages/canvas/use-canvas-media-tools");
const { useCanvasGenerationRetry } = await import("../../src/pages/canvas/use-canvas-generation-retry");
const { apiClient } = await import("../../src/services/api/request");
const { defaultConfig, createModelChannel, encodeChannelModel, useConfigStore } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig, VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL } = await import("../../src/lib/model-capabilities");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { CanvasNodeType } = await import("../../src/types/canvas");
const config = {
    ...defaultConfig,
    channels: [
        createModelChannel({
            id: "depth-channel",
            scope: "system",
            models: ["depth-model"],
            modelCosts: [
                {
                    model: "depth-model",
                    protocol: VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL,
                    capability: "video",
                    billingMode: "per_second",
                    unitPriceMicrocredits: 10,
                    capabilityConfig: defaultModelCapabilityConfig(VOLCENGINE_MEDIAKIT_VIDEO_DEPTH_PROTOCOL),
                },
            ],
        }),
    ],
};
const source: CanvasNodeData = { id: "source", type: CanvasNodeType.Video, title: "原视频", position: { x: 0, y: 0 }, width: 720, height: 405, metadata: { storageKey: "resource:source", content: "/source.mp4", durationMs: 18_600, status: "success" } };
afterAll(() => dom.happyDOM.abort());

test("opening and cancelling create nothing; confirming creates one connected result and one backend task", async () => {
    useConfigStore.setState({ config });
    useUserStore.setState((state) => ({ features: { ...state.features, creditsEnabled: false, frontendModelsEnabled: true } }));
    const requests: Array<{ url?: string; body: any }> = [];
    apiClient.defaults.adapter = async (request) => {
        if (request.method === "post") requests.push({ url: request.url, body: JSON.parse(request.data) });
        if (request.url !== "/tasks" && request.url !== "/tasks/depth-task") throw new Error(`Unexpected request ${request.url}`);
        return {
            status: 200,
            statusText: "OK",
            headers: {},
            config: request,
            data: { code: 0, data: { id: "depth-task", type: "canvas_video", status: "succeeded", resultJson: JSON.stringify({ mode: "video", video: { storageKey: "resource:result" } }) } },
        };
    };
    let snapshot!: { nodes: CanvasNodeData[]; connections: CanvasConnection[] };
    let processing: Promise<void> | undefined;
    const consumed: string[] = [];
    function Harness() {
        const [nodes, setNodes] = useState([source]);
        const [connections, setConnections] = useState<CanvasConnection[]>([]);
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        const connectionsRef = useRef(connections);
        connectionsRef.current = connections;
        const tools = useCanvasMediaTools({
            projectId: "canvas-test",
            nodesRef,
            connectionsRef,
            selectedNodeIdsRef: useRef(new Set<string>()),
            setNodes,
            setConnections,
            setSelectedNodeIds: () => {},
            setSelectedConnectionId: () => {},
            setDialogNodeId: () => {},
            setContextMenu: () => {},
            setHoveredNodeId: () => {},
            setToolbarNodeId: () => {},
            setRunningNodeId: () => {},
            startUploadStatus: () => () => {},
            startGenerationRequest: () => new AbortController(),
            finishGenerationRequest: () => {},
            bindGenerationTask: (id, task) => setNodes((current) => current.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, taskId: task.id } } : node))),
            applyGenerationTaskResult: async (id) => {
                consumed.push(id);
            },
        });
        snapshot = { nodes, connections };
        return (
            <>
                <button onClick={() => tools.openVideoProcessing(source, "depth")}>打开深度</button>
                {tools.videoProcessingDialog ? (
                    <CanvasVideoDepthDialog
                        node={source}
                        open
                        config={config}
                        onClose={() => tools.setVideoProcessingDialog(null)}
                        onConfirm={(params) => {
                            processing = tools.processVideoNode(source, { operation: "depth", params });
                        }}
                    />
                ) : null}
            </>
        );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const click = async (label: string) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)!;
        expect(button).toBeDefined();
        await act(async () => {
            button.click();
            await processing;
        });
    };
    try {
        await act(async () => {
            root.render(
                <App>
                    <Harness />
                </App>,
            );
        });
        await click("打开深度");
        expect(document.body.textContent).toContain("HEVC");
        expect(requests).toHaveLength(0);
        expect(snapshot.nodes).toEqual([source]);
        expect(snapshot.connections).toEqual([]);
        const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => /取\s*消|Cancel/.test(item.textContent || ""))!;
        await act(async () => {
            cancel.click();
        });
        expect(requests).toHaveLength(0);
        expect(snapshot.nodes).toEqual([source]);
        await click("打开深度");
        await click("开始处理");
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ url: "/tasks", body: { operation: "depth", input: { metadata: { videoEditOperation: "depth" }, referenceVideos: [{ storageKey: "resource:source" }] } } });
        expect(snapshot.nodes).toHaveLength(2);
        expect(snapshot.nodes[0]).toEqual(source);
        const result = snapshot.nodes[1]!;
        expect(result.metadata).toMatchObject({ videoDepth: { sourceNodeId: source.id }, videoEditOperation: "depth", taskId: "depth-task" });
        expect(snapshot.connections).toMatchObject([{ fromNodeId: source.id, toNodeId: result.id }]);
        expect(consumed).toEqual([result.id]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("a quote failure is visible and blocks the paid confirmation", async () => {
    useUserStore.setState((state) => ({ features: { ...state.features, creditsEnabled: true } }));
    const requests: string[] = [];
    apiClient.defaults.adapter = async (request) => {
        requests.push(request.url || "");
        return { status: 200, statusText: "OK", headers: {}, config: request, data: { code: 400, msg: "深度模型价格未配置" } };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let confirmed = 0;
    try {
        await act(async () => {
            root.render(
                <App>
                    <CanvasVideoDepthDialog
                        node={source}
                        open
                        config={config}
                        onClose={() => {}}
                        onConfirm={() => {
                            confirmed++;
                        }}
                    />
                </App>,
            );
        });
        expect(requests).toEqual(["/model-catalog/quote"]);
        expect(document.body.textContent).toContain("深度模型价格未配置");
        const start = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "开始处理")!;
        expect(start.disabled).toBe(true);
        await act(async () => start.click());
        expect(confirmed).toBe(0);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("retry reuses the result node and depth parameters; a missing source cannot submit again", async () => {
    useConfigStore.setState({ config });
    const result: CanvasNodeData = { ...source, id: "depth-result", metadata: { status: "error", taskId: "failed-depth", videoEditOperation: "depth", videoDepth: { sourceNodeId: source.id, model: encodeChannelModel("depth-channel", "depth-model") } } };
    const requests: Array<{ url?: string; method?: string; body?: any }> = [];
    apiClient.defaults.adapter = async (request) => {
        requests.push({ url: request.url, method: request.method, body: request.data ? JSON.parse(request.data) : undefined });
        const task = request.url === "/tasks/failed-depth" ? { id: "failed-depth", status: "failed" } : { id: "retried-depth", status: "succeeded", resultJson: JSON.stringify({ mode: "video", video: { storageKey: "resource:result" } }) };
        return { status: 200, statusText: "OK", headers: {}, config: request, data: { code: 0, data: task } };
    };
    let retry!: ReturnType<typeof useCanvasGenerationRetry>;
    let removeSource!: () => void;
    let nodesSnapshot!: CanvasNodeData[];
    const consumed: string[] = [];
    function Harness() {
        const [nodes, setNodes] = useState([source, result]);
        const nodesRef = useRef(nodes);
        nodesRef.current = nodes;
        nodesSnapshot = nodes;
        removeSource = () => setNodes((current) => current.filter((node) => node.id !== source.id));
        retry = useCanvasGenerationRetry({
            projectId: "canvas-test",
            addedSkills: [],
            assets: [],
            nodesRef,
            connectionsRef: useRef([{ id: "connection", fromNodeId: source.id, toNodeId: result.id }]),
            setNodes,
            setRunningNodeId: () => {},
            startGenerationRequest: () => new AbortController(),
            finishGenerationRequest: () => {},
            bindGenerationTask: (id, task) => setNodes((current) => current.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, taskId: task.id } } : node))),
            applyGenerationTaskResult: async (id) => {
                consumed.push(id);
            },
        });
        return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(
                <App>
                    <Harness />
                </App>,
            );
        });
        await act(async () => {
            await retry(result);
        });
        expect(requests.map((request) => request.method)).toEqual(["get", "post", "get"]);
        expect(requests[1]).toMatchObject({ url: "/tasks", body: { operation: "depth", input: { metadata: { nodeId: result.id, sourceNodeId: source.id, videoEditOperation: "depth", retryOf: "failed-depth" } } } });
        expect(nodesSnapshot.map((node) => node.id)).toEqual([source.id, result.id]);
        expect(consumed).toEqual([result.id]);
        await act(async () => removeSource());
        await act(async () => {
            await retry(result);
        });
        expect(requests.filter((request) => request.method === "post")).toHaveLength(1);
        expect(nodesSnapshot.map((node) => node.id)).toEqual([result.id]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
