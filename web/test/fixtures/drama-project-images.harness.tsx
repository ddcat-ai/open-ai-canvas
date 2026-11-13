import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaEpisodeDetail, DramaSegment, DramaSegmentReferencePatch, DramaSummary } from "../../src/services/api/drama";
import type { ProjectAsset } from "../../src/services/api/projects";

const dom = new Window({ url: "http://localhost/projects/project" });
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
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App } = await import("antd");
const { ReferenceBoard } = await import("../../src/pages/projects/studio/segment-references");
const projects = await import("../../src/services/api/projects");
const drama = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");
const sync = await import("../../src/services/user-data-sync");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { useAssetStore } = await import("../../src/stores/use-asset-store");
const originalUser = useUserStore.getState();
const originalAssets = useAssetStore.getState().assets;
const currentSegment = { id: "segment", index: 0, title: "相遇", request: { references: [], audioReferences: [], referenceCapacity: 6 } } as unknown as DramaSegment;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    useUserStore.setState({ hydrated: true, user: { id: "user", username: "test", displayName: "测试", role: "user", status: "active" } });
    spyOn(resources, "getResourceAccess").mockResolvedValue({ url: "/image.png" } as Awaited<ReturnType<typeof resources.getResourceAccess>>);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    useUserStore.setState(originalUser);
    useAssetStore.setState({ assets: originalAssets });
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(onSave: (patch: DramaSegmentReferencePatch) => Promise<unknown>) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <ReferenceBoard projectId="project" segment={currentSegment} shots={[]} castById={new Map()} busy={false} onSave={onSave} onOpenCast={() => {}} onOpenAssets={() => {}} />
                </App>
            </QueryClientProvider>,
        ),
    );
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

async function click(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
    await settle();
}

async function openProjectImages() {
    await click("项目资产窗口");
    await click("从本项目导入");
}

async function pickCard(title: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>(".asset-picker-card-action")].find((item) => item.title === title);
    expect(button, title).toBeDefined();
    await act(async () => button!.click());
}

function projectImage(id: string, title: string, resourceId = id): ProjectAsset {
    return { id, title, category: "material", mediaType: "image", status: "confirmed", storageKey: `resource:${resourceId}`, versionCount: 1, usages: [], position: 0, updatedAt: "2026-11-12" };
}

function assetPage(assets: ProjectAsset[], page = 1, total = assets.length) {
    return { assets, page, total, pageSize: 40, hasMore: page * 40 < total, categoryCounts: { material: total }, folderCounts: {} };
}

test("failed image registration and segment saving retry the uploaded resource without uploading again", async () => {
    const upload = spyOn(resources, "uploadResourceFile").mockResolvedValue({ id: "uploaded" } as Awaited<ReturnType<typeof resources.uploadResourceFile>>);
    const link = spyOn(projects, "linkProjectAsset")
        .mockRejectedValueOnce(new Error("项目登记失败"))
        .mockResolvedValue({ asset: projectImage("uploaded", "雨巷") });
    const save = mock(async (_patch: DramaSegmentReferencePatch) => {});
    save.mockRejectedValueOnce(new Error("分镜保存失败"));
    await render(save);
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new dom.File(["image"], "雨巷.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("尚未添加到本段");
    await click("重试添加");
    expect(save).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("尚未添加到本段");
    await click("重试添加");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledTimes(3);
    expect(link.mock.calls[0]).toEqual(["project", { assetId: "uploaded", category: "material", title: "雨巷", source: "uploaded" }]);
    expect(save.mock.calls[1]).toEqual([{ referenceImages: [{ resourceId: "uploaded", name: "雨巷" }] }]);
    expect(host.textContent).not.toContain("尚未添加到本段");
});

test("project images use bounded server pagination and retain a selected image after changing pages", async () => {
    const list = spyOn(projects, "listProjectAssetsPage").mockImplementation(async (_id, options) =>
        assetPage([projectImage(options?.page === 2 ? "second" : "first", options?.page === 2 ? "第二页" : "第一页", options?.page === 2 ? "second-image" : "first-image")], options?.page, 80),
    );
    const history = spyOn(drama, "getDrama");
    const globalList = spyOn(sync, "loadAssetLibraryPage");
    const link = spyOn(projects, "linkProjectAsset").mockResolvedValue({ asset: projectImage("first", "第一页", "first-image") });
    const save = mock(async (_patch: DramaSegmentReferencePatch) => {});
    await render(save);
    expect(list).not.toHaveBeenCalled();
    await openProjectImages();
    expect(list.mock.calls[0]?.[0]).toBe("project");
    expect(list.mock.calls[0]?.[1]).toEqual({ page: 1, pageSize: 40, mediaType: "image", category: undefined, query: "" });
    expect(list.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    await pickCard("第一页");
    await click("下一页");
    expect(list.mock.calls.at(-1)?.[1]?.page).toBe(2);
    expect(document.querySelector('.asset-picker-card-action[title="第二页"]')).not.toBeNull();
    await click("添加到本段参考");
    expect(link).toHaveBeenCalledWith("project", { assetId: "first", category: "material", title: "第一页", source: "uploaded" });
    expect(save).toHaveBeenCalledWith({ referenceImages: [{ resourceId: "first-image", name: "第一页" }] });
    expect(history).not.toHaveBeenCalled();
    expect(globalList).not.toHaveBeenCalled();
});

test("project search and category filtering are sent to the server and loading failures can retry", async () => {
    const list = spyOn(projects, "listProjectAssetsPage")
        .mockRejectedValueOnce(new Error("暂不可用"))
        .mockResolvedValue(assetPage([projectImage("search", "书房")]));
    await render(mock(async () => {}));
    await openProjectImages();
    expect(document.querySelector('.asset-picker-grid-wrap [role="alert"]')).not.toBeNull();
    await click("重试");
    await click("道具");
    const input = document.querySelector<HTMLInputElement>(".asset-picker-search input")!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, "  花瓶  ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
    });
    await settle();
    expect(list.mock.calls.at(-1)?.[1]).toEqual({ page: 1, pageSize: 40, mediaType: "image", category: "prop", query: "花瓶" });
    expect(document.querySelector(".asset-picker-recycle")).toBeNull();
});

test("library images keep the original remote asset identity and category when linked to the project", async () => {
    const image = {
        id: "library-asset",
        kind: "image",
        title: "雨夜街道",
        category: "environment",
        status: "confirmed",
        tags: [],
        coverUrl: "",
        createdAt: "2026-11-12",
        updatedAt: "2026-11-12",
        data: { dataUrl: "", storageKey: "resource:street", width: 1280, height: 720, bytes: 1024, mimeType: "image/png" },
    };
    const library = spyOn(sync, "loadAssetLibraryPage").mockResolvedValue({ assets: [image], total: 1, categoryCounts: { environment: 1 }, page: 1, pageSize: 40 } as Awaited<ReturnType<typeof sync.loadAssetLibraryPage>>);
    useAssetStore.setState({ assets: [image as (typeof originalAssets)[number]] });
    const link = spyOn(projects, "linkProjectAsset").mockResolvedValue({ asset: projectImage("library-asset", "雨夜街道", "street") });
    const save = mock(async (_patch: DramaSegmentReferencePatch) => {});
    await render(save);
    await click("从素材库导入");
    expect(library).toHaveBeenCalled();
    await pickCard("雨夜街道");
    await click("添加到本段参考");
    expect(link).toHaveBeenCalledWith("project", { assetId: "library-asset", category: "environment", title: "雨夜街道", source: "uploaded" });
    expect(save).toHaveBeenCalledWith({ referenceImages: [{ resourceId: "street", name: "雨夜街道" }] });
});

test("historical images load only the selected episode, deduplicate resources, and keep selection after failed save", async () => {
    const summary = spyOn(drama, "getDrama").mockResolvedValue({
        episodes: [
            { id: "e1", number: 1, title: "起点" },
            { id: "e2", number: 2, title: "重逢" },
        ],
    } as DramaSummary);
    const reference = { castId: "", kind: "image", resourceId: "history-image", name: "旧雨伞" };
    const episode = spyOn(drama, "getDramaEpisode").mockResolvedValue({
        episode: { id: "e2", projectId: "project", number: 2 },
        segments: [
            { index: 0, title: "街边", request: { references: [reference, { ...reference, castId: "hero", resourceId: "cast-image" }] } },
            { index: 1, title: "回忆", request: { references: [reference] } },
        ],
    } as DramaEpisodeDetail);
    const projectList = spyOn(projects, "listProjectAssetsPage");
    const link = spyOn(projects, "linkProjectAsset").mockResolvedValue({ asset: projectImage("history-image", "旧雨伞") });
    const save = mock(async (_patch: DramaSegmentReferencePatch) => {});
    save.mockRejectedValueOnce(new Error("稍后再试"));
    await render(save);
    expect(summary).not.toHaveBeenCalled();
    await click("项目资产窗口");
    await click("从分集图片导入");
    expect(summary).toHaveBeenCalledTimes(1);
    expect(episode).not.toHaveBeenCalled();
    const select = document.querySelector('[aria-label="选择图片来源分集"]')!;
    await act(async () => select.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    await settle();
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((element) => element.title === "第 2 集 · 重逢");
    expect(option).toBeDefined();
    await act(async () => option!.click());
    await click("查看这集图片");
    expect(episode).toHaveBeenCalledTimes(1);
    expect(episode.mock.calls[0]?.slice(0, 2)).toEqual(["project", "e2"]);
    expect(document.querySelectorAll(".asset-picker-card-action")).toHaveLength(1);
    expect(document.querySelector(".asset-picker-card-copy")?.textContent).toContain("第 1 段 · 街边；第 2 段 · 回忆");
    await pickCard("旧雨伞");
    await click("添加到本段参考");
    expect(document.querySelector('.asset-picker-card-action[aria-pressed="true"]')).not.toBeNull();
    expect(document.querySelector(".asset-picker-footer-error")?.textContent).toBe("稍后再试");
    await click("添加到本段参考");
    expect(save).toHaveBeenCalledTimes(2);
    expect(link).toHaveBeenCalledWith("project", { assetId: "history-image", category: "material", title: "旧雨伞", source: "uploaded" });
    expect(save.mock.calls[1]).toEqual([{ referenceImages: [{ resourceId: "history-image", name: "旧雨伞" }] }]);
    expect(projectList).not.toHaveBeenCalled();
});
