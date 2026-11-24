import { expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { VideoAsset } from "@/stores/use-asset-store";

const dom = new Window({ url: "http://localhost/assets" });
Object.assign(globalThis, {
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
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
});
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { AssetRenameModal } = await import("@/pages/assets/asset-rename-modal");
const assets = await import("@/stores/use-asset-store");
const sync = await import("@/services/user-data-sync");
const api = await import("@/services/api/user-data");

test("读取完整素材再改名；远端失败保持原名和弹窗，成功保留视频与业务引用", async () => {
    const full: VideoAsset = {
        id: "video-1",
        kind: "video",
        title: "生成视频",
        coverUrl: "",
        tags: ["样片"],
        folderId: "folder-1",
        createdAt: "2026-11-01",
        updatedAt: "2026-11-02",
        metadata: { taskId: "task-1", projectIds: ["project-1"] },
        data: { url: "/api/resources/video-1/file", storageKey: "resource:video-1", width: 1280, height: 720, durationMs: 5000, bytes: 100, mimeType: "video/mp4" },
    };
    const load = spyOn(sync, "loadAssetsForUse").mockImplementation(async () => {
        assets.withAssetStorePersistenceSuppressed(() => assets.useAssetStore.setState({ assets: [full] }));
    });
    const persist = spyOn(assets, "flushAssetStorePersistence").mockResolvedValue(undefined);
    const write = spyOn(api, "upsertRemoteAsset").mockRejectedValue(new Error("保存失败"));
    const updated: string[] = [];
    let closed = false;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <App>
                    <AssetRenameModal
                        asset={{ ...full, metadata: {} }}
                        onClose={() => {
                            closed = true;
                        }}
                        onSaved={async (_id, name) => {
                            updated.push(name);
                        }}
                    />
                </App>,
            ),
        );
        const field = document.querySelector<HTMLInputElement>("#asset-rename-title")!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(field, "雨夜重逢");
            field.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        const save = async () => {
            await act(async () => {
                field.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            });
        };
        await save();
        expect(load).toHaveBeenCalledWith(["video-1"], { refresh: true });
        expect(assets.useAssetStore.getState().assets[0].title).toBe("生成视频");
        expect(closed).toBe(false);
        expect(updated).toEqual([]);
        expect(write.mock.calls[0][0]).toMatchObject({ title: "雨夜重逢", kind: "video", data: full.data, metadata: full.metadata, folderId: full.folderId });
        write.mockResolvedValue({ asset: { id: full.id, title: "雨夜重逢", createdAt: full.createdAt, updatedAt: full.updatedAt } });
        await save();
        expect(updated).toEqual(["雨夜重逢"]);
        expect(closed).toBe(true);
        expect(assets.useAssetStore.getState().assets[0]).toMatchObject({ title: "雨夜重逢", data: full.data, metadata: full.metadata });
    } finally {
        load.mockRestore();
        persist.mockRestore();
        write.mockRestore();
        await act(async () => root.unmount());
        host.remove();
    }
});
