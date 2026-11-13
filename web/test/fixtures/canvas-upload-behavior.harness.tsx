import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CanvasNodeData } from "@/types/canvas";

const dom = new Window({ url: "http://localhost/" });
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
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
        src = "";
        naturalWidth = 800;
        naturalHeight = 600;
        async decode() {}
    },
});
const createElement = document.createElement.bind(document);
document.createElement = ((name: string, options?: ElementCreationOptions) => {
    const element = createElement(name, options);
    if (name === "video") {
        Object.defineProperties(element, { videoWidth: { value: 800 }, videoHeight: { value: 600 } });
        queueMicrotask(() => element.dispatchEvent(new dom.Event("loadedmetadata")));
    }
    return element;
}) as typeof document.createElement;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const antd = await import("antd");
const imageStorage = await import("@/services/image-storage");
const fileStorage = await import("@/services/file-storage");
const resources = await import("@/services/api/resources");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasNodeType } = await import("@/types/canvas");
const { canvasNodeToAsset } = await import("@/lib/canvas/canvas-node-asset");
const silent = () => {};
const persisted: CanvasNodeData[] = [];
const pending = new Map<string, { resolve: (value: any) => void; reject: (reason: unknown) => void }>();
let deferUploads = false;
let failure: Error | undefined;
const upload = async (input: File) => {
    if (deferUploads) return new Promise<any>((resolve, reject) => pending.set(input.name, { resolve, reject }));
    if (failure) throw failure;
    return uploaded(input.name);
};
function uploaded(name: string) {
    return { url: `/api/resources/${encodeURIComponent(name)}/file`, storageKey: `resource:${name}`, width: 800, height: 600, bytes: 20, mimeType: "image/png" };
}
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message: { info: silent, error: silent, warning: silent, success: silent } }) } }));
mock.module("@/components/canvas/canvas-asset-tray", () => ({ CANVAS_IMAGE_ASSET_DND_TYPE: "canvas-asset" }));
mock.module("@/services/image-storage", () => ({ ...imageStorage, uploadImage: upload }));
mock.module("@/services/file-storage", () => ({ ...fileStorage, uploadMediaFile: upload }));
mock.module("@/services/api/resources", () => ({
    ...resources,
    uploadResourceFile: async (file: File) => {
        await upload(file);
        return { id: file.name };
    },
}));
mock.module("@/services/project-asset-sync", () => ({
    ensureCanvasNodeAsset: async ({ node }: { node: CanvasNodeData }) => {
        persisted.push(node);
        return { assetId: `asset:${node.id}`, syncPending: false };
    },
}));
const { useCanvasUpload } = await import("@/pages/canvas/use-canvas-upload");
const { VideoPreviewPlayButton } = await import("@/components/canvas/canvas-node-media-content");
const { assetPickerItemsToInsertPayloads } = await import("@/components/canvas/asset-picker-modal");
let api: ReturnType<typeof useCanvasUpload>;
const nodesRef = { current: [] as CanvasNodeData[] };
const setNodes = (action: React.SetStateAction<CanvasNodeData[]>) => {
    nodesRef.current = typeof action === "function" ? action(nodesRef.current) : action;
};
function Harness() {
    api = useCanvasUpload({
        canvasId: "canvas",
        nodesRef,
        selectedNodeIdsRef: { current: new Set() },
        getCanvasCenter: () => ({ x: 0, y: 0 }),
        screenToCanvas: () => ({ x: 0, y: 0 }),
        setNodes,
        setSelectedNodeIds: silent,
        setSelectedConnectionId: silent,
        setContextMenu: silent,
        setDialogNodeId: silent,
    });
    return null;
}
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | undefined;
beforeEach(async () => {
    setActiveUserScope("upload-behavior-test");
    nodesRef.current = [];
    persisted.length = 0;
    pending.clear();
    deferUploads = false;
    failure = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
        root!.render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <Harness />
            </QueryClientProvider>,
        ),
    );
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    container.remove();
});
afterAll(() => {
    mock.restore();
    dom.happyDOM.abort();
});
const options = { quiet: { nodeId: "upload" } };

test("audio upload display names omit the extension while all media retain the entire filename in metadata", async () => {
    for (const [name, type, title] of [
        ["镜头参考_非常长的原始文件名_包含空格 与多个.版本.v12.PNG", "image/png", "镜头参考_非常长的原始文件名_包含空格 与多个.版本.v12.PNG"],
        ["镜头原片.v2.mp4", "video/mp4", "镜头原片.v2.mp4"],
        ["配音.final.wav", "audio/wav", "配音.final"],
        ["剧情梗概.v2.md", "text/markdown", "剧情梗概.v2.md"],
    ]) {
        let id: string | null = null;
        await act(async () => {
            id = await api.createFileNode(new File(["actual script text"], name, { type }), { x: 0, y: 0 }, undefined, { quiet: { nodeId: name } });
        });
        const result = nodesRef.current.find((node) => node.id === id)!;
        expect(result.title).toBe(title);
        expect(result.metadata?.originalFileName).toBe(name);
        expect(result.metadata?.fileUpload).toBeUndefined();
        const asset = canvasNodeToAsset(result, { canvasId: "canvas", source: "canvas-upload" })!;
        expect(asset.title).toBe(title);
        expect(asset.metadata?.originalFileName).toBe(name);
    }
});

test("concurrent uploads complete in either order without crossing names or identities", async () => {
    deferUploads = true;
    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    await act(async () => {
        first = api.createFileNode(new File(["one"], "one.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, { quiet: { nodeId: "one" } });
        second = api.createFileNode(new File(["two"], "two.md", { type: "text/markdown" }), { x: 10, y: 0 }, undefined, { quiet: { nodeId: "two" } });
    });
    await act(async () => {
        pending.get("two.md")!.resolve(uploaded("two.md"));
        await second;
    });
    expect(nodesRef.current.find((node) => node.id === "one")?.metadata?.fileUpload).toBe("uploading");
    await act(async () => {
        pending.get("one.md")!.resolve(uploaded("one.md"));
        await first;
    });
    expect(nodesRef.current.map((node) => [node.id, node.title, node.metadata?.originalFileName])).toEqual([
        ["one", "one.md", "one.md"],
        ["two", "two.md", "two.md"],
    ]);
});

test("removing the placeholder cancels insertion when the upload later completes", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "cancel.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    nodesRef.current = [];
    let id: string | null = "unexpected";
    await act(async () => {
        pending.get("cancel.md")!.resolve(uploaded("cancel.md"));
        id = await task;
    });
    expect(id).toBeNull();
    expect(nodesRef.current).toEqual([]);
    expect(persisted).toEqual([]);
});

test("leaving the canvas while uploading cannot add assets after unmount", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "leaving.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    await act(async () => root!.unmount());
    root = undefined;
    pending.get("leaving.md")!.resolve(uploaded("leaving.md"));
    expect(await task).toBeNull();
    expect(persisted).toEqual([]);
});

test("an explicit rename during upload wins while original filename metadata remains intact", async () => {
    deferUploads = true;
    for (const [name, type, title] of [
        ["original.md", "text/markdown", "original.md"],
        ["配音.final.wav", "audio/wav", "配音.final"],
    ]) {
        nodesRef.current = [];
        let task!: Promise<string | null>;
        await act(async () => {
            task = api.createFileNode(new File(["file"], name, { type }), { x: 0, y: 0 }, undefined, options);
        });
        expect(nodesRef.current[0]).toMatchObject({ title, metadata: { originalFileName: name, fileUpload: "uploading" } });
        nodesRef.current = nodesRef.current.map((node) => ({ ...node, title: "User title" }));
        await act(async () => {
            pending.get(name)!.resolve(uploaded(name));
            await task;
        });
        expect(nodesRef.current[0]).toMatchObject({ title: "User title", metadata: { originalFileName: name } });
    }
});

test("account switching prevents a pending upload from publishing into another scope", async () => {
    deferUploads = true;
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["text"], "scope.md", { type: "text/markdown" }), { x: 0, y: 0 }, undefined, options);
    });
    setActiveUserScope("another-upload-user");
    pending.get("scope.md")!.resolve(uploaded("scope.md"));
    expect(await task).toBeNull();
    expect(persisted).toEqual([]);
});

test("failed replacement restores old media; successful replacement takes the new filename", async () => {
    nodesRef.current = [{ id: "original", title: "old.txt", type: CanvasNodeType.Text, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { content: "old", originalFileName: "old.txt" } }];
    failure = new Error("rejected");
    await act(async () => {
        await api.createFileNode(new File(["new"], "new.txt", { type: "text/plain" }), { x: 0, y: 0 }, "original", options);
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "old.txt", metadata: { content: "old", originalFileName: "old.txt" } });
    failure = undefined;
    await act(async () => {
        await api.createFileNode(new File(["new"], "new.txt", { type: "text/plain" }), { x: 0, y: 0 }, "original", options);
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "new.txt", metadata: { content: "new", originalFileName: "new.txt" } });
});

test("replacing audio updates filename-derived titles and preserves custom or untraceable titles", async () => {
    for (const [title, originalFileName, expected] of [
        ["旧配音.final.wav", "旧配音.final.wav", "新配音.take2"],
        ["旧配音.final", "旧配音.final.wav", "新配音.take2"],
        ["第一幕旁白", "旧配音.final.wav", "第一幕旁白"],
        ["用户特意命名.wav", "旧配音.final.wav", "用户特意命名.wav"],
        ["来源不详的旧标题", undefined, "来源不详的旧标题"],
    ] as const) {
        nodesRef.current = [{ id: "original", title, type: CanvasNodeType.Audio, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { originalFileName, content: "old-audio" } }];
        await act(async () => {
            await api.createFileNode(new File(["audio"], "新配音.take2.MP3", { type: "audio/mpeg" }), { x: 0, y: 0 }, "original", options);
        });
        expect(nodesRef.current[0]).toMatchObject({ title: expected, metadata: { originalFileName: "新配音.take2.MP3" } });
        expect(canvasNodeToAsset(nodesRef.current[0], { canvasId: "canvas", source: "canvas-upload" })?.title).toBe(expected);
    }
});

test("renaming an audio node during replacement wins over the uploaded filename", async () => {
    deferUploads = true;
    nodesRef.current = [{ id: "original", title: "旧配音", type: CanvasNodeType.Audio, position: { x: 0, y: 0 }, width: 200, height: 100, metadata: { originalFileName: "旧配音.wav", content: "old-audio" } }];
    let task!: Promise<string | null>;
    await act(async () => {
        task = api.createFileNode(new File(["audio"], "新配音.final.wav", { type: "audio/wav" }), { x: 0, y: 0 }, "original", options);
    });
    nodesRef.current = nodesRef.current.map((node) => ({ ...node, title: "用户修订的旁白" }));
    await act(async () => {
        pending.get("新配音.final.wav")!.resolve(uploaded("新配音.final.wav"));
        await task;
    });
    expect(nodesRef.current[0]).toMatchObject({ title: "用户修订的旁白", metadata: { originalFileName: "新配音.final.wav" } });
});

test("library import retains long titles for every media type and uploaded text filenames", async () => {
    const title = "素材原始名称_超出三十二字符不应截掉扩展名_包含多个.版本.final.png";
    const image = { kind: "image" as const, id: "image", title, coverUrl: "", tags: [], metadata: { originalFileName: title }, data: { dataUrl: "", storageKey: "resource:image", width: 800, height: 600 } };
    const payloads = [
        ...assetPickerItemsToInsertPayloads(["image"], [{ id: "image", title, asset: image as never }]),
        { kind: "text" as const, title: "script.v3.md", content: "正文不会成为标题", originalFileName: "script.v3.md" },
        { kind: "video" as const, title: "视频源片.v2.mp4", url: "video", width: 800, height: 600 },
        { kind: "audio" as const, title: "音频.wav", url: "audio" },
    ];
    await act(async () => {
        await api.handleAssetsInsert(payloads);
    });
    expect(nodesRef.current.map((node) => node.title)).toEqual(payloads.map((payload) => payload.title));
    expect(nodesRef.current[0].metadata?.originalFileName).toBe(title);
});

test("video play control keeps a media foreground in either theme and native keyboard semantics", async () => {
    const css = document.createElement("style");
    css.textContent = `:root { --canvas-card-media-chip-ink: #fff; } button { color: inherit; }`;
    document.head.append(css);
    let plays = 0;
    let bubbles = 0;
    for (const color of ["#111827", "#ededed"]) {
        await act(async () =>
            root!.render(
                <div style={{ color }} onClick={() => bubbles++}>
                    <VideoPreviewPlayButton title="暗视频.mp4" onPlay={() => plays++} />
                </div>,
            ),
        );
        const button = container.querySelector("button")!;
        expect(button.type).toBe("button");
        expect(button.tabIndex).toBe(0);
        expect(button.getAttribute("aria-label")).toBe("播放 暗视频.mp4");
        expect(getComputedStyle(button).color).toBe("#fff");
        button.focus();
        expect(document.activeElement).toBe(button);
        // Keyboard activation of native buttons emits a click with detail=0.
        await act(async () => button.dispatchEvent(new dom.MouseEvent("click", { bubbles: true, detail: 0 })));
    }
    expect(plays).toBe(2);
    expect(bubbles).toBe(0);
    css.textContent = `:root { --color-neutral-0: #fff; } button { color: inherit; }`;
    expect(getComputedStyle(container.querySelector("button")!).color).toBe("#fff");
    css.remove();
});
