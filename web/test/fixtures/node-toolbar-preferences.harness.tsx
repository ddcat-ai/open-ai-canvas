import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
dom.matchMedia = (() => Object.assign(new dom.EventTarget(), { matches: true, addListener() {}, removeListener() {} })) as typeof dom.matchMedia;
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    CSS: dom.CSS,
    document: dom.document,
    navigator: dom.navigator,
    Element: dom.Element,
    Node: dom.Node,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    localStorage: dom.localStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
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
dom.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.DOMRect(0, 0, this.hasAttribute("data-node-toolbar-entry-width") ? 80 : this.hasAttribute("data-node-toolbar-more-width") ? 32 : 1000, 40);
};
const memoryStorage = new Map<string, string>();
const storage = {
    getItem: async (name: string) => memoryStorage.get(name) ?? null,
    setItem: async (name: string, value: string) => {
        memoryStorage.set(name, value);
    },
    removeItem: async (name: string) => {
        memoryStorage.delete(name);
    },
};
mock.module("@/lib/localforage-storage", () => ({ localForageStorage: storage, localForageStorageForScope: () => storage }));

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { NodeToolbarDock, NodeToolbarPreview, CanvasNodeToolbar } = await import("../../src/components/canvas/canvas-node-toolbar");
const { CanvasNodeType } = await import("../../src/types/canvas");
const { NodeToolbarSettingsModal } = await import("../../src/components/canvas/toolbars/node-toolbar-settings-modal");
const { buildNodeToolbarEntries } = await import("../../src/lib/canvas/node-toolbar-entries");
const { useNodeToolbarPreferences } = await import("../../src/hooks/use-node-toolbar-preferences");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { apiClient } = await import("../../src/services/api/request");
type Preferences = import("../../src/services/api/node-toolbar-preferences").NodeToolbarPreferences;
const initialAdapter = apiClient.defaults.adapter;
const entries = buildNodeToolbarEntries(
    [
        { id: "annotate", label: "区域标注", icon: null, group: "primary", order: 1, onClick() {} },
        { id: "upscale", label: "调整尺寸", icon: null, group: "process", order: 2, onClick() {} },
    ],
    [{ group: "process", label: "图片工具", icon: null }],
);

afterAll(() => {
    apiClient.defaults.adapter = initialAdapter;
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
const setUser = (id: string) => useUserStore.getState().setUser({ id, username: id, displayName: id, role: "user", status: "active" });
const visibleIds = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-node-toolbar-entry]")].map((element) => element.dataset.nodeToolbarEntry);

function Fixture() {
    const preferences = useNodeToolbarPreferences("image");
    const [open, setOpen] = useState(true);
    const [menu, setMenu] = useState<string | null>(null);
    return (
        <>
            <NodeToolbarDock entries={entries} pinnedEntryIds={preferences.pinnedEntryIds} availableWidth={1000} openMenuId={menu} onOpenChange={(id, isOpen) => setMenu(isOpen ? id : null)} onSettings={() => setOpen(true)} />
            <NodeToolbarSettingsModal
                key={preferences.userId}
                open={open}
                entries={entries}
                pinnedEntryIds={preferences.pinnedEntryIds}
                loading={preferences.loading}
                readError={preferences.error}
                onReload={() => void preferences.reload()}
                onSave={preferences.save}
                onClose={() => setOpen(false)}
            />
            <output data-settings-open={open} />
        </>
    );
}

test("保存失败保留草稿，成功后重新加载账号配置且隔离其他账号", async () => {
    const remote: Record<string, Preferences> = { a: { image: ["menu:process", "annotate"] }, b: {} };
    let rejectSave = true;
    apiClient.defaults.adapter = async (config) => {
        const owner = useUserStore.getState().user!.id;
        let data: unknown = { preferences: remote[owner] };
        let code = 0;
        if (config.method === "put") {
            if (rejectSave) code = 500;
            else {
                const body = JSON.parse(config.data);
                remote[owner] = { ...remote[owner], image: body.pinnedEntryIds };
                data = body;
            }
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code, data, msg: code ? "模拟保存失败" : "ok" } };
    };
    setUser("a");
    let client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const host = document.createElement("div");
    document.body.append(host);
    let root = createRoot(host);
    const render = (queryClient = client) =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <App>
                    <Fixture />
                </App>
            </QueryClientProvider>,
        );
    try {
        await act(async () => {
            render();
            await flush();
        });
        await act(flush);
        expect(visibleIds(host)).toEqual(["menu:process", "annotate"]);
        await act(async () => (document.querySelector('button[aria-label="固定调整尺寸"]') as HTMLButtonElement).click());
        await act(async () => document.querySelector('button[aria-label="拖动调整调整尺寸顺序"]')!.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }) as unknown as Event));
        const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")].find((button) => button.textContent?.includes("保"))!;
        await act(async () => {
            saveButton().click();
            await flush();
        });
        expect(document.querySelector('[role="alert"]')?.textContent).toContain("模拟保存失败");
        expect(visibleIds(host)).toEqual(["menu:process", "annotate"]);
        rejectSave = false;
        await act(async () => {
            saveButton().click();
            await flush();
        });
        await act(flush);
        expect(visibleIds(host)).toEqual(["menu:process", "upscale", "annotate"]);
        expect(host.querySelector("output")?.getAttribute("data-settings-open")).toBe("false");
        await act(async () => root.unmount());
        client.clear();
        root = createRoot(host);
        await act(async () => {
            client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
            render(client);
            await flush();
        });
        await act(flush);
        expect(visibleIds(host)).toEqual(["menu:process", "upscale", "annotate"]);
        await act(async () => {
            setUser("b");
            await flush();
        });
        await act(flush);
        expect(visibleIds(host)).toEqual(["annotate", "menu:process"]);
    } finally {
        await act(async () => root.unmount());
        client.clear();
        host.remove();
    }
});

test("四类真实节点按账号配置展示入口，已固定工具直接调用原处理回调", async () => {
    apiClient.defaults.adapter = async (config) => ({
        config,
        status: 200,
        statusText: "OK",
        headers: {},
        data: { code: 0, msg: "ok", data: { preferences: { image: ["upscale", "character_four_view", "menu:sheet"], video: ["download"], audio: ["download"], text: ["edit"] } } },
    });
    setUser("actual-nodes");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    const nodeElement = document.createElement("div");
    const host = document.createElement("div");
    container.append(nodeElement, host);
    document.body.append(container);
    const root = createRoot(host);
    const received: string[] = [];
    const presets: Array<[string, number]> = [];
    const noop = () => {};
    const handlers = {
        onKeep: noop,
        onLeave: noop,
        onInfo: noop,
        onEditText: noop,
        onDecreaseFont: noop,
        onIncreaseFont: noop,
        onToggleDialog: noop,
        onAnnotate: noop,
        onAnnotationEdit: noop,
        onTextEdit: noop,
        onGenerateImage: noop,
        onUpload: noop,
        onDownload: noop,
        onSaveAsset: noop,
        onRegionEdit: noop,
        onRemoveBackground: noop,
        onLayerDecomposition: noop,
        onEmotion: noop,
        onPortraitTexture: noop,
        onCrop: noop,
        onSplit: noop,
        onUpscale: noop,
        onSuperResolve: noop,
        onAngle: noop,
        onLighting: noop,
        onPanorama: noop,
        onPrevis: noop,
        onViewImage: noop,
        onExtractVideoFrames: noop,
        onExtractAudioFromVideo: noop,
        onTrimVideoSegments: noop,
        onReversePrompt: noop,
        onRetry: noop,
        onToggleFreeResize: noop,
        onToggleLocked: noop,
        onDelete: noop,
        onNineGrid: noop,
    };
    try {
        for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]) {
            const node = { id: `source-${type}`, type, title: type, position: { x: 0, y: 100 }, width: 120, height: 120, metadata: { content: "existing-content" } };
            nodeElement.dataset.nodeId = node.id;
            await act(async () => {
                root.render(
                    <QueryClientProvider client={client}>
                        <App>
                            <CanvasNodeToolbar
                                {...handlers}
                                node={node}
                                viewport={{ x: 0, y: 0, k: 1 }}
                                containerRef={{ current: container }}
                                extractingVideoFrames={false}
                                extractingAudio={false}
                                trimmingVideo={false}
                                onUpscale={(source) => received.push(source.id)}
                                onNineGrid={(source, id) => presets.push([source.id, id])}
                            />
                        </App>
                    </QueryClientProvider>,
                );
                await flush();
            });
            await act(flush);
            const expected = type === CanvasNodeType.Image ? ["upscale", "character_four_view", "menu:sheet"] : [type === CanvasNodeType.Text ? "edit" : "download"];
            expect(visibleIds(host)).toEqual(expected);
            if (type === CanvasNodeType.Image) {
                await act(async () => (host.querySelector('[data-node-toolbar-entry="upscale"] button') as HTMLButtonElement).click());
                await act(async () => (host.querySelector('[data-node-toolbar-entry="character_four_view"] button') as HTMLButtonElement).click());
                expect(host.querySelector('[data-node-toolbar-entry="menu:sheet"] button')).not.toBeNull();
            }
        }
        expect(received).toEqual(["source-image"]);
        expect(presets).toEqual([["source-image", 1000089]]);
    } finally {
        await act(async () => root.unmount());
        client.clear();
        container.remove();
    }
});

test("真实工具栏在窄宽度收纳末尾并在变宽后恢复，空配置保留更多入口", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const pinned = ["upscale", "annotate", "menu:process"];
    const render = (width: number, ids = pinned) =>
        root.render(
            <App>
                <NodeToolbarDock entries={entries} pinnedEntryIds={ids} availableWidth={width} openMenuId={null} onOpenChange={() => {}} onSettings={() => {}} />
            </App>,
        );
    try {
        await act(async () => render(200));
        expect(visibleIds(host)).toEqual(["upscale", "annotate"]);
        await act(async () => render(400));
        expect(visibleIds(host)).toEqual(["upscale", "annotate", "menu:process"]);
        await act(async () => render(200, []));
        expect(visibleIds(host)).toEqual([]);
        expect(host.querySelector('button[aria-label="更多"]')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("面板编辑中的草稿不会被后台刷新得到的账号配置覆盖", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const received: Array<string[] | null> = [];
    const render = (ids: string[]) =>
        root.render(
            <App>
                <NodeToolbarSettingsModal
                    open
                    entries={entries}
                    pinnedEntryIds={ids}
                    loading={false}
                    readError={null}
                    onReload={() => {}}
                    onClose={() => {}}
                    onSave={async (draft) => {
                        received.push(draft);
                    }}
                />
            </App>,
        );
    try {
        await act(async () => render(["annotate"]));
        await act(async () => (document.querySelector('button[aria-label="固定调整尺寸"]') as HTMLButtonElement).click());
        await act(async () => render(["menu:process"]));
        expect(document.querySelector('button[aria-label="取消固定调整尺寸"]')).not.toBeNull();
        await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")].find((button) => button.textContent?.includes("保"))!.click());
        expect(received).toEqual([["annotate", "upscale"]]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("固定入口可以直接前后移动，预览即时更新且不提前保存", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const saved: Array<string[] | null> = [];
    try {
        await act(async () =>
            root.render(
                <App>
                    <NodeToolbarSettingsModal
                        open
                        entries={entries}
                        pinnedEntryIds={["annotate", "upscale", "menu:process"]}
                        loading={false}
                        readError={null}
                        onReload={() => {}}
                        onClose={() => {}}
                        onSave={async (ids) => {
                            saved.push(ids);
                        }}
                        renderPreview={(ids: string[]) => <NodeToolbarPreview entries={entries} pinnedEntryIds={ids} />}
                    />
                </App>,
            ),
        );
        const preview = () => document.querySelector<HTMLElement>('[aria-label="工具栏预览"]')!;
        expect(preview()).not.toBeNull();
        expect(visibleIds(preview())).toEqual(["annotate", "upscale", "menu:process"]);
        const previous = document.querySelector<HTMLButtonElement>('button[aria-label="前移区域标注"]')!;
        expect(previous.disabled).toBe(true);
        await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="后移区域标注"]')!.click());
        expect(visibleIds(preview())).toEqual(["upscale", "annotate", "menu:process"]);
        expect(saved).toEqual([]);
        await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="前移图片工具"]')!.click());
        expect(visibleIds(preview())).toEqual(["upscale", "menu:process", "annotate"]);
        await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".ant-modal-footer button")].find((button) => button.textContent?.includes("保"))!.click());
        expect(saved).toEqual([["upscale", "menu:process", "annotate"]]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("拖过卡片内部元素不会反复交换位置，预览按钮不会执行实际工具", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const executed: string[] = [];
    const previewEntries = entries.map((entry) => (entry.kind === "tool" ? { ...entry, tool: { ...entry.tool, onClick: () => executed.push(entry.id) } } : entry));
    try {
        await act(async () =>
            root.render(
                <App>
                    <NodeToolbarSettingsModal
                        open
                        entries={entries}
                        pinnedEntryIds={["annotate", "upscale"]}
                        loading={false}
                        readError={null}
                        onReload={() => {}}
                        onClose={() => {}}
                        onSave={async () => {}}
                        renderPreview={(ids: string[]) => <NodeToolbarPreview entries={previewEntries} pinnedEntryIds={ids} />}
                    />
                </App>,
            ),
        );
        const source = document.querySelector<HTMLButtonElement>('button[aria-label="拖动调整区域标注顺序"]')!;
        const target = document.querySelector<HTMLButtonElement>('button[aria-label="拖动调整调整尺寸顺序"]')!.closest(".canvas-toolbar-settings-card")!;
        const transfer = new dom.DataTransfer();
        const dragEvent = (type: string) => {
            const event = new dom.Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, "dataTransfer", { value: transfer });
            return event as unknown as Event;
        };
        await act(async () => source.dispatchEvent(dragEvent("dragstart")));
        expect(transfer.getData("text/plain")).toBe("annotate");
        await act(async () => target.dispatchEvent(dragEvent("dragenter")));
        const preview = document.querySelector<HTMLElement>('[aria-label="工具栏预览"]')!;
        expect(visibleIds(preview)).toEqual(["upscale", "annotate"]);
        await act(async () => target.dispatchEvent(dragEvent("dragenter")));
        expect(visibleIds(preview)).toEqual(["upscale", "annotate"]);
        await act(async () => source.dispatchEvent(dragEvent("dragend")));
        await act(async () => preview.querySelector<HTMLButtonElement>('button[aria-label="调整尺寸"]')!.click());
        expect(executed).toEqual([]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
