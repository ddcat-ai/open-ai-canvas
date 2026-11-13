import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaEpisodeDetail, DramaSummary } from "../../src/services/api/drama";
import type { CanvasConnection, CanvasNodeData } from "../../src/types/canvas";
import type { PrevisScene } from "../../src/types/previs";

const dom = new Window({ url: "http://localhost/canvas/canvas-a" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useMemo, useRef, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { createSearchParams } = await import("react-router");
const { useCanvasDrama } = await import("../../src/pages/canvas/use-canvas-drama");
const { useCanvasPrevis } = await import("../../src/pages/canvas/use-canvas-previs");
const { createCanvasStateWriter } = await import("../../src/lib/canvas/canvas-editor-state");
const { dramaKeys } = await import("../../src/lib/drama/drama-query-keys");
const { CanvasNodeType } = await import("../../src/types/canvas");
const api = await import("../../src/services/api/drama");
const bridge = await import("../../src/services/drama-canvas");

const summary = { project: { id: "project-a", name: "测试短剧" }, production: { status: "paused", settings: { aspectRatio: "9:16" } }, episodes: [], jobCounts: {} } as unknown as DramaSummary;
let detail: DramaEpisodeDetail;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
let current: {
    drama: ReturnType<typeof useCanvasDrama>;
    nodes: { current: CanvasNodeData[] };
    scenes: PrevisScene[];
    opened: { nodeId: string; editor: string } | null;
    setScenes: (scenes: PrevisScene[]) => void;
    setNodes: (nodes: CanvasNodeData[]) => void;
};

function Harness() {
    const [nodes, publishNodes] = useState<CanvasNodeData[]>([]);
    const [, publishConnections] = useState<CanvasConnection[]>([]);
    const nodesRef = useRef<CanvasNodeData[]>([]);
    const connectionsRef = useRef<CanvasConnection[]>([]);
    const setNodes = useMemo(() => createCanvasStateWriter(nodesRef, publishNodes), []);
    const setConnections = useMemo(() => createCanvasStateWriter(connectionsRef, publishConnections), []);
    const [scenes, setScenes] = useState<PrevisScene[]>([]);
    const [opened, setOpened] = useState<{ nodeId: string; editor: string } | null>(null);
    const [searchParams, setSearchParams] = useState(new URLSearchParams());
    const [, setSelectedNodeIds] = useState(new Set<string>());
    const [, setSelectedConnectionId] = useState<string | null>(null);
    const [, setPrevisNodeId] = useState<string | null>(null);
    const previs = useCanvasPrevis({
        projectId: "canvas-a",
        domainProjectId: "project-a",
        previsNodeId: opened?.nodeId || null,
        previsScenes: scenes,
        nodesRef,
        connectionsRef,
        getCanvasCenter: () => ({ x: 0, y: 0 }),
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setPrevisNodeId,
        updateProject: (_, patch) => setScenes(patch.previsScenes),
    });
    const drama = useCanvasDrama({
        canvasId: "canvas-a",
        dramaId: "project-a",
        projectLoaded: true,
        nodes,
        nodesRef,
        setNodes,
        setConnections,
        focusNodes: () => {},
        searchParams,
        setSearchParams: (next) => setSearchParams((previous) => createSearchParams(typeof next === "function" ? next(previous) : next)),
        openPrevis: async (request, editor) => setOpened({ nodeId: await previs.prepareDramaPrevis(request), editor }),
    });
    current = { drama, nodes: nodesRef, scenes, opened, setScenes, setNodes };
    return null;
}

beforeEach(async () => {
    detail = {
        episode: { id: "episode-a", projectId: "project-a", number: 1, title: "夜市" },
        shots: [
            {
                id: "shot-a",
                episodeId: "episode-a",
                projectId: "project-a",
                position: 0,
                segmentIndex: 0,
                segmentTitle: "相遇",
                scene: "夜市",
                castIdsJson: "[]",
                lookCastIdsJson: "[]",
                propIdsJson: "[]",
                speaker: "",
                dialogue: "",
                action: "主角转身",
                shotSize: "中景",
                camera: "静止",
                transition: "",
                durationMs: 3500,
                imagePrompt: "夜市",
                videoPrompt: "转身",
                sourceQuote: "主角转身",
            },
        ],
        segments: [
            {
                id: "segment-a",
                index: 0,
                revision: 1,
                title: "相遇",
                shotIds: ["shot-a"],
                durationMs: 3500,
                videoPrompt: "参考图1的主角转身",
                generated: "",
                custom: true,
                promptStatus: "ready",
                videoStatus: "draft",
                videoModel: {},
                referenceMode: "auto",
                audioReferenceMode: "auto",
                request: {
                    operation: "reference_to_video",
                    seconds: 3.5,
                    maxVideoSeconds: 15,
                    aspectRatio: "9:16",
                    generateAudio: true,
                    firstFramePending: false,
                    references: [{ castId: "character-a", kind: "character", name: "主角", label: "参考图1", resourceId: "image-old", sent: true }],
                    referenceCapacity: 5,
                    modelMaxImages: 5,
                    header: "参考图1：主角",
                },
            },
        ],
    } as DramaEpisodeDetail;
    spyOn(api, "getDrama").mockResolvedValue(summary);
    spyOn(api, "getDramaEpisode").mockImplementation(async () => detail);
    spyOn(api, "listDramaCast").mockResolvedValue({ cast: [] });
    spyOn(api, "listDramaTakes").mockResolvedValue({ takes: [] });
    spyOn(bridge, "ensureDramaCanvasAssets").mockImplementation(async (_, items) => new Map(items.map((item) => [item.resourceId, `asset-${item.resourceId}`])));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(dramaKeys.summary("project-a"), summary);
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <Harness />
                </App>
            </QueryClientProvider>,
        ),
    );
});

afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("空画布第一次进入导演台会先投送段视频与参考，再打开可保存的预演场景", async () => {
    expect(current.nodes.current).toHaveLength(0);
    await act(async () => current.drama.projectSegment("episode-a", 0, "previs"));
    expect(current.opened?.editor).toBe("previs");
    expect(current.scenes).toHaveLength(1);
    expect(current.scenes[0].shots[0].duration).toBe(3.5);
    const source = current.nodes.current.find((node) => node.type === CanvasNodeType.Video && node.metadata?.workflowKind !== "shot");
    const previsNode = current.nodes.current.find((node) => node.id === current.opened?.nodeId);
    expect(source?.metadata?.dramaRef?.id).toBe("segment-a");
    expect(previsNode?.metadata?.previsSceneId).toBe(current.scenes[0].id);
    expect(previsNode?.metadata?.referenceAssetNodeIds).toHaveLength(1);
});

test("重复切到动画时间轴会复用已有场景，保留导演修改", async () => {
    await act(async () => current.drama.projectSegment("episode-a", 0, "previs"));
    const sceneId = current.scenes[0].id;
    const nodeId = current.opened?.nodeId;
    const nodeCount = current.nodes.current.length;
    await act(async () => current.setScenes(current.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((shot) => ({ ...shot, duration: 7.25, prompt: "导演修改后的提示词" })) }))));
    await act(async () => current.drama.projectSegment("episode-a", 0, "timeline"));
    expect(current.opened).toEqual({ nodeId, editor: "timeline" });
    expect(current.scenes).toHaveLength(1);
    expect(current.scenes[0].id).toBe(sceneId);
    expect(current.scenes[0].shots[0].duration).toBe(7.25);
    expect(current.scenes[0].shots[0].prompt).toBe("导演修改后的提示词");
    expect(current.nodes.current).toHaveLength(nodeCount);
});

test("旧段框的参考图已变化时，新预演使用制作台当前资源，不误用旧图", async () => {
    await act(async () => current.drama.projectSegment("episode-a", 0, "canvas"));
    detail = {
        ...detail,
        segments: detail.segments.map((segment) => ({ ...segment, videoPrompt: "新版参考图1的主角转身", request: { ...segment.request, references: segment.request.references.map((reference) => ({ ...reference, resourceId: "image-new" })) } })),
    };
    await act(async () => current.drama.projectSegment("episode-a", 0, "previs"));
    const node = current.nodes.current.find((item) => item.id === current.opened?.nodeId);
    const image = current.nodes.current.find((item) => item.id === node?.metadata?.referenceAssetNodeIds?.[0]);
    expect(image?.metadata?.storageKey).toBe("resource:image-new");
    expect(node?.metadata?.composerContent).toContain("新版参考图1");
    expect(current.nodes.current.some((item) => item.metadata?.storageKey === "resource:image-old")).toBe(true);
});
