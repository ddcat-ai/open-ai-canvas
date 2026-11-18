import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaEpisodeRow } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/p1/e/ep1" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
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
const originalHeight = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "offsetHeight");
const originalWidth = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "offsetWidth");
Object.defineProperties(dom.HTMLElement.prototype, {
    offsetHeight: {
        configurable: true,
        get() {
            return this.classList.contains("drama-rail-list") ? 480 : 0;
        },
    },
    offsetWidth: {
        configurable: true,
        get() {
            return this.classList.contains("drama-rail-list") ? 300 : 0;
        },
    },
});

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const { http } = await import("../../src/services/api/request");
const { getDrama, getDramaEpisode } = await import("../../src/services/api/drama");
const { dramaKeys } = await import("../../src/lib/drama/drama-query-keys");
const { EpisodeRail } = await import("../../src/pages/projects/studio/episode-rail");
const { EpisodeRenameModal } = await import("../../src/pages/projects/studio/episode-rename-modal");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
let episodes: DramaEpisodeRow[];
let patch: ReturnType<typeof spyOn<typeof http, "patch">>;
let failure: Error | undefined;
let pendingSave: Promise<void> | undefined;
let selected: string[];
let inserted: string[];
let deleted: string[];

beforeEach(() => {
    episodes = ["第一章 零悟性", "第二章 入门"].map((title, index) => ({
        id: `ep${index + 1}`,
        number: index + 1,
        title,
        synopsis: "原剧情简介",
        stage: "review",
        sourceFormat: "novel",
        error: "",
        shotCount: 3,
        durationMs: 45_000,
        approved: false,
        mediaReleased: false,
        awaitingMedia: false,
        finalStale: false,
        stats: { segments: 1, promptReady: 1, videoReady: 0, videoGenerated: 0, failed: 0 },
    }));
    failure = undefined;
    pendingSave = undefined;
    selected = [];
    inserted = [];
    deleted = [];
    dom.localStorage.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    spyOn(http, "get").mockImplementation(async (path) => {
        if (path === "/dramas/p1") return { episodes } as never;
        if (path === "/dramas/p1/episodes/ep2") return { episode: episodes[1] } as never;
        throw new Error(`Unexpected request: ${path}`);
    });
    patch = spyOn(http, "patch").mockImplementation(async (path, body) => {
        if (pendingSave) await pendingSave;
        if (failure) throw failure;
        const id = path.split("/").at(-1);
        const { title } = body as { title: string };
        episodes = episodes.map((episode) => (episode.id === id ? { ...episode, title } : episode));
        return { episode: episodes.find((episode) => episode.id === id) } as never;
    });
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    mock.restore();
});

afterAll(() => {
    if (originalHeight) Object.defineProperty(dom.HTMLElement.prototype, "offsetHeight", originalHeight);
    if (originalWidth) Object.defineProperty(dom.HTMLElement.prototype, "offsetWidth", originalWidth);
    for (const [key, value] of globals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
    dom.happyDOM.abort();
});

function Studio() {
    const summary = useQuery({ queryKey: dramaKeys.summary("p1"), queryFn: ({ signal }) => getDrama("p1", signal) });
    const detail = useQuery({ queryKey: dramaKeys.episode("p1", "ep2"), queryFn: ({ signal }) => getDramaEpisode("p1", "ep2", signal) });
    const [renaming, setRenaming] = useState<DramaEpisodeRow | null>(null);
    return (
        <>
            <EpisodeRail
                episodes={summary.data?.episodes || []}
                currentId="ep1"
                planning={false}
                onSelect={(id) => selected.push(id)}
                onAdd={() => {}}
                onRename={setRenaming}
                onInsert={(episode, position) => inserted.push(`${episode.id}:${position}`)}
                onDelete={(episode) => deleted.push(episode.id)}
            />
            <output aria-label="第二集详情名称">{detail.data?.episode.title}</output>
            {renaming ? <EpisodeRenameModal projectId="p1" episode={renaming} onClose={() => setRenaming(null)} /> : null}
        </>
    );
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
    });
}

async function mount() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <Studio />
                    </App>
                </ConfigProvider>
            </QueryClientProvider>,
        ),
    );
    await settle();
}

function button(text: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "").includes(text.replace(/\s/g, "")));
    expect(found).toBeDefined();
    return found!;
}

function titleInput() {
    return document.querySelector<HTMLInputElement>('input[aria-label="分集名称"]')!;
}

async function enterTitle(title: string) {
    await act(async () => {
        const input = titleInput();
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, title);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

async function openMenu(number: number) {
    const more = document.querySelector<HTMLButtonElement>(`button[aria-label="第 ${number} 集更多操作"]`);
    expect(more).not.toBeNull();
    await act(async () => more!.click());
    await settle();
}

async function chooseMenu(text: string) {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => !element.closest(".ant-dropdown-hidden") && element.textContent?.includes(text));
    expect(item).toBeDefined();
    await act(async () => item!.click());
    await settle();
}

test("卡片更多菜单可改非当前集名称，仅保存标题并刷新列表和详情", async () => {
    await mount();
    await openMenu(2);
    await chooseMenu("修改名称");
    expect(titleInput().value).toBe("第二章 入门");
    expect(titleInput().maxLength).toBe(60);
    expect(selected).toEqual([]);
    await enterTitle("  第二章 新的开始  ");
    let finishSave!: () => void;
    pendingSave = new Promise((resolve) => {
        finishSave = resolve;
    });
    await act(async () => button("保存名称").click());
    await settle();
    expect(patch).toHaveBeenCalledWith("/dramas/p1/episodes/ep2", { title: "第二章 新的开始" });
    expect(titleInput().disabled).toBe(true);
    expect(button("保存名称").disabled).toBe(true);
    await act(async () => button("保存名称").click());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(episodes[1].title).toBe("第二章 入门");
    await act(async () => finishSave());
    await settle();
    expect(titleInput()).toBeNull();
    expect(document.querySelector('.drama-ep-title[title="第二章 新的开始"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="第二集详情名称"]')!.textContent).toBe("第二章 新的开始");
    expect(episodes[0].title).toBe("第一章 零悟性");
    expect(episodes[1].synopsis).toBe("原剧情简介");
    expect(selected).toEqual([]);
});

test("卡片铅笔保存失败保留输入和原名称，原位重试成功", async () => {
    await mount();
    const pencil = document.querySelector<HTMLButtonElement>('button[aria-label="修改第 1 集名称"]');
    expect(pencil).not.toBeNull();
    await act(async () => pencil!.click());
    expect(selected).toEqual([]);
    await enterTitle("第一章 新悟性");
    failure = new Error("名称保存暂时失败");
    await act(async () => button("保存名称").click());
    await settle();
    expect(titleInput().value).toBe("第一章 新悟性");
    expect(button("保存名称").disabled).toBe(false);
    expect(document.body.textContent).toContain("名称保存暂时失败");
    expect(episodes[0].title).toBe("第一章 零悟性");
    failure = undefined;
    await act(async () => button("保存名称").click());
    await settle();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(titleInput()).toBeNull();
    expect(document.querySelector('.drama-ep-title[title="第一章 新悟性"]')).not.toBeNull();
});

test("空白、未修改与取消不写入，插入和删除菜单保持原目标", async () => {
    await mount();
    await openMenu(1);
    await chooseMenu("修改名称");
    expect(button("保存名称").disabled).toBe(true);
    await enterTitle("  ");
    expect(button("保存名称").disabled).toBe(true);
    await enterTitle("尚未保存的标题");
    await act(async () => button("取消").click());
    expect(titleInput()).toBeNull();
    expect(patch).not.toHaveBeenCalled();
    await openMenu(2);
    await chooseMenu("在前面插入一集");
    await openMenu(2);
    await chooseMenu("在后面插入一集");
    await openMenu(2);
    await chooseMenu("删除本集");
    expect(inserted).toEqual(["ep2:before", "ep2:after"]);
    expect(deleted).toEqual(["ep2"]);
    expect(selected).toEqual([]);
});
