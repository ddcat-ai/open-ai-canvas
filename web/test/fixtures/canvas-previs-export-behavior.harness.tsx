import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { UploadedImage } from "@/services/image-storage";
import type { PrevisCanvasExport, PrevisRenderMode, PrevisScene } from "@/types/previs";

const dom = new Window({ url: "http://localhost/canvas/previs-export-test" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const antd = await import("antd");
const imageStorage = await import("@/services/image-storage");
const silent = () => {};
const warning = mock(silent);
const upload = mock(async (_image: Blob): Promise<UploadedImage> => uploaded());
type AssetInput = { canvasId: string; domainProjectId?: string; node: CanvasNodeData; source: string };
type AssetResult = { assetId: string; syncPending: boolean };
const ensureAsset = mock(async ({ node }: AssetInput): Promise<AssetResult> => ({ assetId: `asset:${node.id}`, syncPending: false }));
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message: { info: silent, error: silent, warning, success: silent } }) } }));
mock.module("@/services/image-storage", () => ({ ...imageStorage, uploadImage: upload }));
mock.module("@/services/project-asset-sync", () => ({ ensureCanvasNodeAsset: ensureAsset }));

// Keep node creation, sizing, layout, scope and the authoritative canvas store real.
const { useCanvasPrevis } = await import("@/pages/canvas/use-canvas-previs");
const { useCanvasStore, withCanvasStorePersistenceSuppressed } = await import("@/stores/canvas/use-canvas-store");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { createPrevisSceneFromTemplate } = await import("@/lib/canvas/previs/previs-templates");
const { CanvasNodeType } = await import("@/types/canvas");
useCanvasStore.persist.setOptions({ storage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } });
await useCanvasStore.persist.rehydrate();

const nodesRef = { current: [] as CanvasNodeData[] };
const connectionsRef = { current: [] as CanvasConnection[] };
const setNodes = mock((action: React.SetStateAction<CanvasNodeData[]>) => {
    nodesRef.current = typeof action === "function" ? action(nodesRef.current) : action;
});
const setConnections = mock((action: React.SetStateAction<CanvasConnection[]>) => {
    connectionsRef.current = typeof action === "function" ? action(connectionsRef.current) : action;
});
let selectedNodeIds = new Set<string>();
let selectedConnectionId: string | null = null;
const setSelectedNodeIds = mock((action: React.SetStateAction<Set<string>>) => {
    selectedNodeIds = typeof action === "function" ? action(selectedNodeIds) : action;
});
const setSelectedConnectionId = mock((action: React.SetStateAction<string | null>) => {
    selectedConnectionId = typeof action === "function" ? action(selectedConnectionId) : action;
});
const updateProject = mock(silent);
let api: ReturnType<typeof useCanvasPrevis>;
let scene: PrevisScene;
let projectId: string;
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
function Harness({ id }: { id: string }) {
    api = useCanvasPrevis({
        projectId: id,
        domainProjectId: "domain-project",
        previsNodeId: "source",
        previsScenes: [scene],
        nodesRef,
        connectionsRef,
        getCanvasCenter: () => ({ x: 0, y: 0 }),
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setPrevisNodeId: silent,
        updateProject,
    });
    return null;
}
function uploaded(width = 1920, height = 1080): UploadedImage {
    return { url: "/api/resources/previs-frame/file", storageKey: "resource:previs-frame", width, height, bytes: 321, mimeType: "image/png" };
}
function node(id: string): CanvasNodeData {
    return { id, type: CanvasNodeType.Text, title: id, width: 200, height: 100, position: { x: -900, y: -900 }, metadata: { content: `content:${id}` } };
}
function project(id: string): CanvasProject {
    return {
        id,
        title: id,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        nodes: nodesRef.current,
        connections: connectionsRef.current,
        previsScenes: [scene],
        chatSessions: [],
        activeChatId: null,
        viewport: { x: 0, y: 0, k: 1 },
        backgroundMode: "dots",
        showImageInfo: false,
    };
}
function projects(value: CanvasProject[]) {
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: value }));
}
function promptOutput(): Extract<PrevisCanvasExport, { kind: "prompt" }> {
    return { kind: "prompt", sceneId: scene.id, shotId: scene.shots[0].id, title: "镜头 7 · 夜景", prompt: "  雨夜，镜头从街角缓慢推进。\n人物回望；保留中文、换行与首尾空白。  " };
}
function screenshotOutput(renderMode: PrevisRenderMode = "beauty"): Extract<PrevisCanvasExport, { kind: "screenshot" }> {
    return { ...promptOutput(), kind: "screenshot", image: new Blob(["viewport frame"], { type: "image/png" }), renderMode, timecode: "00:00:02:12", duration: 7.5 };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, decline) => {
        resolve = accept;
        reject = decline;
    });
    return { promise, resolve, reject };
}
function expectNoCanvasWrite() {
    expect(setNodes).not.toHaveBeenCalled();
    expect(setConnections).not.toHaveBeenCalled();
    expect(setSelectedNodeIds).not.toHaveBeenCalled();
    expect(setSelectedConnectionId).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
}
type Stage = "upload" | "asset registration";
async function pauseExport(stage: Stage) {
    const uploadGate = deferred<UploadedImage>();
    const assetGate = deferred<AssetResult>();
    if (stage === "upload") upload.mockImplementationOnce(() => uploadGate.promise);
    else ensureAsset.mockImplementationOnce(() => assetGate.promise);
    let task!: Promise<unknown>;
    await act(async () => {
        task = api.addPrevisToCanvas(screenshotOutput()).then(
            () => null,
            (error: unknown) => error,
        );
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(ensureAsset).toHaveBeenCalledTimes(stage === "upload" ? 0 : 1);
    expectNoCanvasWrite();
    return {
        task,
        async finish() {
            let outcome: unknown;
            await act(async () => {
                if (stage === "upload") uploadGate.resolve(uploaded());
                else assetGate.resolve({ assetId: "asset:delayed", syncPending: false });
                outcome = await task;
            });
            return outcome;
        },
    };
}

beforeEach(async () => {
    projectId = "canvas-previs-export";
    setActiveUserScope("previs-export-user");
    scene = createPrevisSceneFromTemplate("empty", "测试场景");
    nodesRef.current = [
        {
            ...node("source"),
            type: CanvasNodeType.Video,
            title: "导演台源镜头",
            position: { x: 100, y: 200 },
            width: 520,
            height: 340,
            metadata: { workflowKind: "shot", previsSceneId: scene.id, previsShotId: scene.shots[0].id, composerContent: "源节点保持原文" },
        },
        node("keep"),
        node("remove"),
    ];
    connectionsRef.current = [{ id: "existing-link", fromNodeId: "keep", toNodeId: "source" }];
    selectedNodeIds = new Set(["source"]);
    selectedConnectionId = "existing-link";
    for (const fn of [upload, ensureAsset, warning, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, updateProject]) fn.mockClear();
    upload.mockImplementation(async () => uploaded());
    ensureAsset.mockImplementation(async ({ node }) => ({ assetId: `asset:${node.id}`, syncPending: false }));
    projects([project(projectId)]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Harness id={projectId} />));
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    container.remove();
    projects([]);
});
afterAll(() => {
    mock.restore();
    dom.happyDOM.abort();
});

test("prompt export writes the complete text once without uploads or changing the source", async () => {
    const output = promptOutput();
    const before = [...nodesRef.current];
    const links = [...connectionsRef.current];
    await act(async () => api.addPrevisToCanvas(output));
    const text = nodesRef.current.at(-1)!;
    expect(nodesRef.current).toHaveLength(before.length + 1);
    expect(nodesRef.current.slice(0, before.length)).toEqual(before);
    expect(text).toMatchObject({ type: CanvasNodeType.Text, title: `${output.title} · 提示词`, metadata: { content: output.prompt, status: "success" } });
    expect(connectionsRef.current).toEqual(links);
    expect(selectedNodeIds).toEqual(new Set([text.id]));
    expect(selectedConnectionId).toBeNull();
    expect(upload).not.toHaveBeenCalled();
    expect(ensureAsset).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
    expect(setNodes).toHaveBeenCalledTimes(1);
});

test("blank prompts reject without changing nodes, links or selection", async () => {
    const before = nodesRef.current;
    await expect(api.addPrevisToCanvas({ ...promptOutput(), prompt: " \n\t " })).rejects.toThrow("提示词");
    expect(nodesRef.current).toBe(before);
    expectNoCanvasWrite();
    expect(upload).not.toHaveBeenCalled();
    expect(ensureAsset).not.toHaveBeenCalled();
});

for (const renderMode of ["beauty", "clay"] as const) {
    for (const [width, height] of [
        [1920, 1080],
        [720, 1280],
    ]) {
        test(`${renderMode} ${width}x${height} creates a proportional asset image and a linked first-frame video`, async () => {
            upload.mockImplementationOnce(async () => uploaded(width, height));
            const output = screenshotOutput(renderMode);
            const before = structuredClone(nodesRef.current);
            const beforeLinks = [...connectionsRef.current];
            await act(async () => api.addPrevisToCanvas(output));
            const [picture, video] = nodesRef.current.slice(before.length);
            expect(nodesRef.current.slice(0, before.length)).toEqual(before);
            expect(nodesRef.current).toHaveLength(before.length + 2);
            expect(picture).toMatchObject({
                type: CanvasNodeType.Image,
                title: `${output.title} · ${output.timecode}`,
                metadata: { content: uploaded().url, storageKey: uploaded().storageKey, naturalWidth: width, naturalHeight: height, mimeType: "image/png", bytes: 321, status: "success", prompt: output.prompt, assetId: `asset:${picture.id}` },
            });
            expect(picture.width / picture.height).toBeCloseTo(width / height, 10);
            expect(picture.width).toBeGreaterThan(0);
            expect(picture.width).toBeLessThanOrEqual(720);
            expect(picture.height).toBeLessThanOrEqual(520);
            expect(video).toMatchObject({
                type: CanvasNodeType.Video,
                title: `${output.title} · 图生视频`,
                metadata: { generationMode: "video", videoEditOperation: "image_to_video", videoStartFrameNodeId: picture.id, referenceAssetNodeIds: [picture.id], prompt: output.prompt, composerContent: output.prompt, seconds: "7.5", status: "idle" },
            });
            expect(video.metadata?.content).toBeFalsy();
            expect(video.position.x).toBeGreaterThanOrEqual(picture.position.x + picture.width);
            expect(connectionsRef.current.slice(0, beforeLinks.length)).toEqual(beforeLinks);
            expect(connectionsRef.current.slice(beforeLinks.length)).toEqual([expect.objectContaining({ fromNodeId: picture.id, toNodeId: video.id })]);
            expect(upload).toHaveBeenCalledWith(output.image);
            expect(ensureAsset).toHaveBeenCalledTimes(1);
            expect(ensureAsset.mock.calls[0][0]).toMatchObject({ canvasId: projectId, domainProjectId: "domain-project", source: "canvas-manual", node: { id: picture.id, type: CanvasNodeType.Image } });
            expect(selectedNodeIds).toEqual(new Set([picture.id, video.id]));
            expect(selectedConnectionId).toBeNull();
            expect(setNodes).toHaveBeenCalledTimes(1);
            expect(setConnections).toHaveBeenCalledTimes(1);
            expect(updateProject).not.toHaveBeenCalled();
        });
    }
}

for (const renderMode of ["depth", "normal", "pose"] as const) {
    test(`${renderMode} exports only the control image, with no video or added connection`, async () => {
        const before = [...nodesRef.current];
        const links = [...connectionsRef.current];
        await act(async () => api.addPrevisToCanvas(screenshotOutput(renderMode)));
        expect(nodesRef.current).toHaveLength(before.length + 1);
        expect(nodesRef.current.at(-1)).toMatchObject({ type: CanvasNodeType.Image, metadata: { assetId: expect.any(String) } });
        expect(nodesRef.current.slice(0, before.length)).toEqual(before);
        expect(connectionsRef.current).toEqual(links);
        expect(selectedNodeIds).toEqual(new Set([nodesRef.current.at(-1)!.id]));
        expect(ensureAsset).toHaveBeenCalledTimes(1);
    });
}

for (const stage of ["upload", "asset registration"] as const) {
    test(`${stage} failure is atomic and a retry inserts exactly one complete output group`, async () => {
        const before = nodesRef.current;
        const beforeLinks = connectionsRef.current;
        const failure = new Error(`${stage} rejected`);
        if (stage === "upload")
            upload.mockImplementationOnce(async () => {
                throw failure;
            });
        else
            ensureAsset.mockImplementationOnce(async () => {
                throw failure;
            });
        await expect(api.addPrevisToCanvas(screenshotOutput())).rejects.toBe(failure);
        expectNoCanvasWrite();
        expect(nodesRef.current).toBe(before);
        expect(connectionsRef.current).toBe(beforeLinks);
        expect(selectedNodeIds).toEqual(new Set(["source"]));
        expect(selectedConnectionId).toBe("existing-link");
        expect(ensureAsset).toHaveBeenCalledTimes(stage === "upload" ? 0 : 1);
        await act(async () => api.addPrevisToCanvas(screenshotOutput()));
        expect(nodesRef.current).toHaveLength(before.length + 2);
        expect(connectionsRef.current).toHaveLength(beforeLinks.length + 1);
        expect(setNodes).toHaveBeenCalledTimes(1);
    });
}

test("a locally registered asset with pending cloud sync remains usable and warns", async () => {
    ensureAsset.mockImplementationOnce(async () => ({ assetId: "asset:local", syncPending: true }));
    await act(async () => api.addPrevisToCanvas(screenshotOutput()));
    expect(nodesRef.current.at(-2)?.metadata?.assetId).toBe("asset:local");
    expect(nodesRef.current.at(-1)?.metadata?.videoStartFrameNodeId).toBe(nodesRef.current.at(-2)?.id);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning.mock.calls[0][0]).toContain("云端同步待完成");
});

for (const stage of ["upload", "asset registration"] as const) {
    test(`edits made during ${stage} preserve inserted, moved and removed nodes and edited links`, async () => {
        const pending = await pauseExport(stage);
        const movedSource = { ...nodesRef.current[0], position: { x: 2500, y: 1800 }, title: "并发改名" };
        const movedKeep = { ...nodesRef.current[1], position: { x: -400, y: 300 }, metadata: { content: "并发编辑正文" } };
        const blocker = { ...node("new-blocker"), position: { x: movedSource.position.x + movedSource.width + 48, y: movedSource.position.y }, width: 720, height: 600 };
        const concurrentNodes = [movedSource, movedKeep, blocker];
        const concurrentLinks = [{ id: "new-link", fromNodeId: "new-blocker", toNodeId: "keep" }];
        nodesRef.current = concurrentNodes;
        connectionsRef.current = concurrentLinks;
        const latestScene = { ...scene, title: "并发场景修改", updatedAt: "2026-11-10T00:01:00Z" };
        projects([{ ...project(projectId), previsScenes: [latestScene] }]);
        expect(await pending.finish()).toBeNull();
        expect(nodesRef.current.slice(0, concurrentNodes.length)).toEqual(concurrentNodes);
        expect(nodesRef.current.some((item) => item.id === "remove")).toBe(false);
        expect(connectionsRef.current.slice(0, concurrentLinks.length)).toEqual(concurrentLinks);
        expect(connectionsRef.current.some((item) => item.id === "existing-link")).toBe(false);
        expect(useCanvasStore.getState().projects[0].previsScenes[0]).toBe(latestScene);
        expect(updateProject).not.toHaveBeenCalled();
        const added = nodesRef.current.slice(concurrentNodes.length);
        expect(added).toHaveLength(2);
        for (const item of added) {
            expect(item.position.x).toBeGreaterThanOrEqual(movedSource.position.x + movedSource.width + 48);
            expect(item.position.x >= blocker.position.x + blocker.width || item.position.y >= blocker.position.y + blocker.height).toBe(true);
        }
    });
}

const invalidations = ["project switch", "account switch", "unmount", "source deletion", "source scene replacement", "shot deletion", "project deletion"] as const;
for (const stage of ["upload", "asset registration"] as const) {
    for (const invalidation of invalidations) {
        test(`${invalidation} during ${stage} rejects late completion without any canvas write`, async () => {
            const pending = await pauseExport(stage);
            if (invalidation === "project switch") {
                projectId = "another-canvas";
                // Identical scene/node IDs exercise the project guard rather than incidental missing data.
                projects([...useCanvasStore.getState().projects, project(projectId)]);
                await act(async () => root!.render(<Harness id={projectId} />));
            } else if (invalidation === "account switch") {
                setActiveUserScope("another-previs-user");
            } else if (invalidation === "unmount") {
                await act(async () => root!.unmount());
                root = undefined;
            } else if (invalidation === "source deletion") {
                nodesRef.current = nodesRef.current.filter((item) => item.id !== "source");
                connectionsRef.current = [];
            } else if (invalidation === "source scene replacement") {
                nodesRef.current = nodesRef.current.map((item) => (item.id === "source" ? { ...item, metadata: { ...item.metadata, previsSceneId: "replacement-scene" } } : item));
            } else if (invalidation === "shot deletion") {
                projects([{ ...project(projectId), previsScenes: [{ ...scene, shots: [] }] }]);
            } else {
                projects([]);
            }
            const currentNodes = nodesRef.current;
            const currentLinks = connectionsRef.current;
            expect(await pending.finish()).toBeInstanceOf(Error);
            expectNoCanvasWrite();
            expect(nodesRef.current).toBe(currentNodes);
            expect(connectionsRef.current).toBe(currentLinks);
            expect(ensureAsset).toHaveBeenCalledTimes(stage === "upload" ? 0 : 1);
        });
    }
}

test("two exports finishing in reverse order retain both image/video pairs and their own prompts", async () => {
    const firstGate = deferred<UploadedImage>();
    const secondGate = deferred<UploadedImage>();
    upload.mockImplementationOnce(() => firstGate.promise).mockImplementationOnce(() => secondGate.promise);
    const firstOutput = { ...screenshotOutput(), title: "镜头 A", prompt: "首个镜头的提示词", duration: 3 };
    const secondOutput = { ...screenshotOutput("clay"), title: "镜头 B", prompt: "第二个镜头的提示词", duration: 9 };
    const beforeCount = nodesRef.current.length;
    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
        first = api.addPrevisToCanvas(firstOutput);
        second = api.addPrevisToCanvas(secondOutput);
    });
    expectNoCanvasWrite();
    await act(async () => {
        secondGate.resolve(uploaded(720, 1280));
        await second;
    });
    await act(async () => {
        firstGate.resolve(uploaded());
        await first;
    });
    const added = nodesRef.current.slice(beforeCount);
    expect(added).toHaveLength(4);
    expect(new Set(added.map((item) => item.id)).size).toBe(4);
    for (const output of [firstOutput, secondOutput]) {
        const picture = added.find((item) => item.type === CanvasNodeType.Image && item.title.startsWith(output.title))!;
        const video = added.find((item) => item.type === CanvasNodeType.Video && item.title.startsWith(output.title))!;
        expect(video.metadata).toMatchObject({ videoStartFrameNodeId: picture.id, prompt: output.prompt, composerContent: output.prompt, seconds: String(output.duration) });
        expect(connectionsRef.current.filter((link) => link.fromNodeId === picture.id && link.toNodeId === video.id)).toHaveLength(1);
    }
    expect(connectionsRef.current).toHaveLength(3);
    expect(ensureAsset).toHaveBeenCalledTimes(2);
});
