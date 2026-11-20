import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaEpisodeDetail, DramaSummary } from "../../src/services/api/drama";
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
const { buildDramaSegmentGroup, dramaPlacement, placeDramaGroup } = await import("../../src/lib/canvas/drama-canvas-projection");
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
    connections: { current: CanvasConnection[] };
    focused: string[];
    enter: (focus?: import("../../src/services/drama-canvas").DramaCanvasFocus) => void;
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
    const [focused, focusNodes] = useState<string[]>([]);
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
        connectionsRef,
        setNodes,
        setConnections,
        focusNodes,
        searchParams,
        setSearchParams: (next) => setSearchParams((previous) => createSearchParams(typeof next === "function" ? next(previous) : next)),
        openPrevis: async (request, editor) => setOpened({ nodeId: await previs.prepareDramaPrevis(request), editor }),
    });
    const enter = (focus?: import("../../src/services/drama-canvas").DramaCanvasFocus) => setSearchParams(new URL(bridge.dramaCanvasPath("canvas-a", "project-a", focus), "http://localhost").searchParams);
    current = { drama, nodes: nodesRef, connections: connectionsRef, focused, enter, scenes, opened, setScenes, setNodes };
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

function setting(id: string, kind: DramaCast["kind"], patch: Partial<DramaCast> = {}): DramaCast {
    return {
        id,
        kind,
        projectId: "project-a",
        name: id,
        aliasesJson: "[]",
        role: "",
        description: "",
        appearance: "",
        voiceInstructions: "",
        importance: 1,
        position: 0,
        imageResourceId: `image-${id}`,
        imageStatus: "ready",
        imageVersion: 1,
        locked: false,
        ...patch,
    };
}

function putCast(cast: DramaCast[]) {
    spyOn(api, "listDramaCast").mockResolvedValue({ cast });
    client.setQueryData(dramaKeys.cast("project-a"), { cast });
}

test("停留在画布只更新侧栏；重开本集才在原框补图，保留移动、精修和旧连线", async () => {
    const hero = setting("character-a", "character", { imageResourceId: "image-old" });
    const prop = setting("prop", "prop", { imageResourceId: undefined });
    detail.segments[0].request.references.push({ castId: "prop", kind: "prop", name: "怀表", label: "参考图2", sent: false });
    await act(async () => {
        putCast([hero, prop]);
        current.enter({ kind: "episode", episodeId: "episode-a" });
    });
    const frame = current.nodes.current.find((node) => node.type === CanvasNodeType.Frame)!;
    const original = current.nodes.current.find((node) => node.metadata?.storageKey === "resource:image-old")!;
    const originalEdge = current.connections.current.find((edge) => edge.fromNodeId === original.id)!;
    const version = { id: "keep", number: 1, createdAt: "2026-01-01", source: "upload" as const, media: { storageKey: "resource:image-old" } };
    const moved = current.nodes.current.map((node) => ({
        ...node,
        position: { x: node.position.x + 125, y: node.position.y + 180 },
        ...(node.id === original.id ? { metadata: { ...node.metadata, storageKey: "resource:refined", mediaVersions: [version] } } : {}),
    }));
    await act(async () => current.setNodes(moved));
    detail.segments[0].request.references[1] = { ...detail.segments[0].request.references[1], sent: true, resourceId: "prop-new" };
    await act(async () => {
        putCast([hero, { ...prop, imageResourceId: "prop-new" }]);
    });
    expect(current.nodes.current).toEqual(moved);
    await act(async () => current.enter({ kind: "episode", episodeId: "episode-a" }));
    const added = current.nodes.current.find((node) => node.metadata?.storageKey === "resource:prop-new");
    expect(added?.parentId).toBe(frame.id);
    expect(current.nodes.current.find((node) => node.id === frame.id)?.position).toEqual(moved.find((node) => node.id === frame.id)!.position);
    expect(current.nodes.current.find((node) => node.id === original.id)).toEqual(moved.find((node) => node.id === original.id));
    expect(current.connections.current[0]).toEqual(originalEdge);
    expect(current.connections.current[1]?.fromNodeId).toBe(added!.id);
    const ids = current.nodes.current.map((node) => node.id);
    await act(async () => current.enter({ kind: "episode", episodeId: "episode-a" }));
    expect(current.nodes.current.map((node) => node.id)).toEqual(ids);
    expect(current.connections.current).toHaveLength(2);
});

test("制作台顶栏把已有设定图放入各自的框，重开只补缺图，保留精修和手动分组", async () => {
    const casts = [setting("hero", "character"), setting("look", "character", { parentId: "hero", lookName: "冬装" }), setting("lamp", "prop"), setting("street", "scene"), setting("draft", "prop", { imageResourceId: undefined })];
    await act(async () => {
        putCast(casts);
        current.enter();
    });
    const nodes = current.nodes.current;
    const frames = nodes.filter((node) => node.type === CanvasNodeType.Frame);
    expect(frames.map((frame) => frame.title)).toEqual(["角色", "造型", "道具", "场景"]);
    const images = nodes.filter((node) => node.type === CanvasNodeType.Image);
    expect(images.map((image) => [image.metadata?.storageKey, frames.find((frame) => frame.id === image.parentId)?.title])).toEqual([
        ["resource:image-hero", "角色"],
        ["resource:image-look", "造型"],
        ["resource:image-lamp", "道具"],
        ["resource:image-street", "场景"],
    ]);
    expect(bridge.ensureDramaCanvasAssets).toHaveBeenCalledTimes(1);
    expect(current.focused).toEqual(frames.map((frame) => frame.id));
    const moved = { ...images[0], parentId: frames[1].id, position: { x: 1800, y: 250 }, title: "我的精修", metadata: { ...images[0].metadata, storageKey: "resource:edited" } };
    await act(async () => current.setNodes(nodes.map((node) => (node.id === moved.id ? moved : node))));
    await act(async () => current.enter());
    expect(current.nodes.current).toHaveLength(nodes.length);
    expect(bridge.ensureDramaCanvasAssets).toHaveBeenCalledTimes(1);
    await act(async () => {
        putCast([...casts, setting("sword", "prop")]);
        current.enter();
    });
    expect(current.nodes.current).toHaveLength(nodes.length + 1);
    expect(current.nodes.current.find((node) => node.metadata?.storageKey === "resource:image-sword")?.parentId).toBe(frames[2].id);
    expect(current.nodes.current.find((node) => node.id === moved.id)).toBe(moved);
    await act(async () => current.enter({ kind: "cast", castId: "hero" }));
    expect(current.focused).toEqual([moved.id]);
    expect(current.drama.presence.cast.size).toBe(5);
});

test("按集投送时各段保留自己的参考图和连线，段内副本不占用作品设定位置", async () => {
    const cast = setting("character-a", "character", { imageResourceId: "image-old" });
    detail = { ...detail, segments: [...detail.segments, { ...detail.segments[0], id: "segment-b", index: 1 }] };
    await act(async () => {
        putCast([cast]);
        current.enter({ kind: "episode", episodeId: "episode-a" });
    });
    const groups = current.nodes.current.filter((node) => node.type === CanvasNodeType.Frame);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
        const children = current.nodes.current.filter((node) => node.parentId === group.id);
        const image = children.find((node) => node.metadata?.storageKey === "resource:image-old");
        const video = children.find((node) => node.type === CanvasNodeType.Video);
        expect(image).toBeDefined();
        expect(video).toBeDefined();
        expect(current.connections.current.some((edge) => edge.fromNodeId === image!.id && edge.toNodeId === video!.id)).toBe(true);
    }
    expect(current.drama.presence.cast.size).toBe(0);
    await act(async () => current.enter());
    expect(current.nodes.current.filter((node) => node.metadata?.storageKey === "resource:image-old")).toHaveLength(3);
    expect(current.drama.presence.cast.size).toBe(1);
});

test("4 图与 9 图的段按图片原比例换行，每个节点都在自己的段框中且互不遮挡", () => {
    let all: CanvasNodeData[] = [];
    for (const [index, count] of [4, 9].entries()) {
        const references = Array.from({ length: count }, (_, i) => ({ label: `参考图${i + 1}`, name: `素材${i + 1}`, castId: "", kind: "image" as const, resourceId: `r${i}`, sent: i !== 2 }));
        const segment = { ...detail.segments[0], id: `s${index}`, index, request: { ...detail.segments[0].request, references } };
        const size = (id: string) => (Number(id.slice(1)) % 2 ? { width: 900, height: 1600 } : { width: 1920, height: 1080 });
        const group = buildDramaSegmentGroup({
            projectId: "project-a",
            episode: detail.episode,
            segment,
            shots: detail.shots.map((shot) => ({ ...shot, segmentIndex: index })),
            castById: new Map(),
            aspectRatio: "16:9",
            media: { urlOf: (id) => id, assetIdOf: (id) => id, imageSizeOf: size },
        });
        const placed = placeDramaGroup(group.nodes, dramaPlacement(all, group.size, { kind: "segment", episodeId: detail.episode.id }));
        const [frame, ...children] = placed;
        const images = children.filter((node) => node.type === CanvasNodeType.Image);
        expect(images).toHaveLength(count);
        expect(new Set(images.map((image) => image.position.y)).size).toBeGreaterThan(1);
        for (const [i, image] of images.entries()) {
            const original = size(`r${i}`);
            expect(image.width / image.height).toBeCloseTo(original.width / original.height, 2);
            expect(image.metadata?.manualSize).toBe(true);
            expect(group.connections.some((edge) => edge.fromNodeId === image.id)).toBe(references[i].sent);
        }
        for (const [i, node] of children.entries()) {
            expect(node.parentId).toBe(frame.id);
            expect(node.position.x + node.width).toBeLessThanOrEqual(frame.position.x + frame.width);
            expect(node.position.y + node.height).toBeLessThanOrEqual(frame.position.y + frame.height);
            for (const other of children.slice(i + 1)) {
                expect(node.position.x + node.width <= other.position.x || other.position.x + other.width <= node.position.x || node.position.y + node.height <= other.position.y || other.position.y + other.height <= node.position.y).toBe(true);
            }
        }
        if (all.length) expect(frame.position.y).toBeGreaterThan(all[0].position.y + all[0].height);
        all = [...all, ...placed];
    }
});

test("一张已删除的图片不妨碍可用设定分组，重新进入可补回恢复的图片", async () => {
    const casts = [setting("available", "scene"), setting("removed", "prop")];
    const registration = spyOn(bridge, "ensureDramaCanvasAssets").mockResolvedValueOnce(new Map([["image-available", "asset-available"]]));
    await act(async () => {
        putCast(casts);
        current.enter();
    });
    expect(current.nodes.current.map((node) => node.title)).toEqual(["场景", "场景 · available"]);
    expect(document.body.textContent).toContain("1 张设定参考图不可用");
    await act(async () => current.enter());
    expect(current.nodes.current.map((node) => node.title)).toEqual(["场景", "场景 · available", "道具", "道具 · removed"]);
    expect(registration).toHaveBeenCalledTimes(2);
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
