import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaChapterRef } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/p1/e/ep1" });
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
    ResizeObserver: class {
        observe() {}
        unobserve() {}
        disconnect() {}
    },
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { http } = await import("../../src/services/api/request");
const { getDramaEpisode } = await import("../../src/services/api/drama");
const { dramaKeys } = await import("../../src/lib/drama/drama-query-keys");
const { ChapterPickerModal } = await import("../../src/pages/projects/studio/chapter-picker");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
let chapters: DramaChapterRef[];
let patch: ReturnType<typeof spyOn<typeof http, "patch">>;
let failure: Error | undefined;

function EpisodeChapterName() {
    const query = useQuery({ queryKey: dramaKeys.episode("p1", "ep1"), queryFn: () => getDramaEpisode("p1", "ep1") });
    return <output aria-label="剧本章节名称">{query.data?.chapters[0]?.title}</output>;
}

beforeEach(() => {
    chapters = Array.from({ length: 12 }, (_, index) => ({ id: `ch${index + 1}`, title: `原著第${index + 1}章`, position: index, wordCount: 20, reserved: true }));
    failure = undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    spyOn(http, "get").mockImplementation(async (path) => {
        if (path.endsWith("/chapters")) return { chapters } as never;
        if (path.endsWith("/chapters/ch1")) return { chapter: { ...chapters[0], sourceText: "原文保持不变。" } } as never;
        if (path.endsWith("/episodes/ep1")) return { chapters: [chapters[0]] } as never;
        throw new Error(`Unexpected request: ${path}`);
    });
    patch = spyOn(http, "patch").mockImplementation(async (path, body) => {
        expect(path).toBe("/dramas/p1/chapters/ch1");
        if (failure) throw failure;
        const { title } = body as { title: string };
        chapters = chapters.map((chapter) => (chapter.id === "ch1" ? { ...chapter, title } : chapter));
        return { chapter: { ...chapters[0], sourceText: "原文保持不变。" } } as never;
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    mock.restore();
});

afterAll(() => {
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

async function mount() {
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <EpisodeChapterName />
                        <ChapterPickerModal open projectId="p1" defaultPerEpisode={1} onClose={() => {}} onProduced={() => {}} />
                    </App>
                </ConfigProvider>
            </QueryClientProvider>,
        );
    });
    await settle();
}

function button(text: string) {
    const found = [...document.querySelectorAll("button")].find((element) => element.textContent?.trim() === text);
    expect(found).toBeDefined();
    return found!;
}

async function openRename() {
    const trigger = document.querySelector('button[aria-label="修改章节名称：原著第1章"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    await act(async () => trigger.click());
}

function input() {
    return document.querySelector('input[aria-label="章节名称"]') as HTMLInputElement;
}

async function enterTitle(value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input(), value);
        input().dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

test("原著章节改名只保存标题，刷新剧本与原文标题并保留全部勾选", async () => {
    client.setQueryData(["drama", "p1", "chapter", "ch1"], { chapter: { ...chapters[0], sourceText: "原文保持不变。" } });
    await mount();
    await act(async () => button("全选").click());
    expect(document.querySelector(".drama-chapter-pick-count b")?.textContent).toBe("12");
    await openRename();
    await enterTitle("  新的章节名称  ");
    await act(async () => button("保存名称").click());
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]?.[1]).toEqual({ title: "新的章节名称" });
    expect(document.querySelector(".drama-chapter-picker-preview h3")?.textContent).toContain("新的章节名称");
    expect(document.querySelector('[aria-label="剧本章节名称"]')?.textContent).toBe("新的章节名称");
    expect(document.querySelector(".drama-chapter-pick-count b")?.textContent).toBe("12");
    expect(client.getQueryState(["drama", "p1", "chapter", "ch1"])?.isInvalidated).toBe(true);
    expect(document.querySelector(".drama-chapter-picker-preview p")?.textContent).toBe("原文保持不变。");
});

test("保存失败保留输入和原名称，重试成功后更新", async () => {
    await mount();
    await openRename();
    await enterTitle("重命名草稿");
    failure = new Error("章节保存失败，请重试");
    await act(async () => button("保存名称").click());
    await settle();
    expect(input().value).toBe("重命名草稿");
    expect(input().disabled).toBe(false);
    expect(document.body.textContent).toContain("章节保存失败，请重试");
    expect(document.querySelector(".drama-chapter-picker-preview h3")?.textContent).toContain("原著第1章");
    expect(document.querySelector('[aria-label="剧本章节名称"]')?.textContent).toBe("原著第1章");
    failure = undefined;
    await act(async () => button("保存名称").click());
    await settle();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[aria-label="剧本章节名称"]')?.textContent).toBe("重命名草稿");
});

test("空白或未改名不能保存，取消不写入", async () => {
    await mount();
    await openRename();
    expect(button("保存名称").disabled).toBe(true);
    await enterTitle("   ");
    expect(button("保存名称").disabled).toBe(true);
    await act(async () => input().dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(patch).not.toHaveBeenCalled();
    await enterTitle("未保存名称");
    const dialog = input().closest('[role="dialog"]');
    const cancel = [...dialog!.querySelectorAll("button")].find((element) => element.textContent?.replace(/\s/g, "") === "取消")!;
    await act(async () => cancel.click());
    await settle();
    expect(patch).not.toHaveBeenCalled();
    expect(document.querySelector(".drama-chapter-picker-preview h3")?.textContent).toContain("原著第1章");
});
