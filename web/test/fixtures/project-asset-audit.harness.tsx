import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaEpisodeDetail, DramaEpisodeRow, DramaSegment, DramaShot } from "../../src/services/api/drama";

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
const { ProjectAssetAudit } = await import("../../src/pages/projects/studio/project-asset-audit");
const api = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");

function cast(id: string, kind: DramaCast["kind"], imageResourceId?: string): DramaCast {
    return {
        id,
        projectId: "project",
        kind,
        name: id,
        aliasesJson: "[]",
        role: "",
        description: "",
        appearance: "",
        voiceInstructions: "",
        importance: 1,
        imageResourceId,
        imageStatus: imageResourceId ? "ready" : "draft",
        imageVersion: 1,
        locked: false,
        position: 0,
    };
}
const assets = [cast("林川", "character", "hero-image"), cast("雨夜车站", "scene", "scene-image"), cast("旧钥匙", "prop")];
const episodes: DramaEpisodeRow[] = [1, 2].map((number) => ({
    id: `episode-${number}`,
    number,
    title: number === 1 ? "雨夜" : "重逢",
    synopsis: "",
    stage: "review",
    sourceFormat: "novel",
    error: "",
    shotCount: 1,
    durationMs: 6000,
    approved: false,
    mediaReleased: false,
    awaitingMedia: false,
    finalStale: false,
    stats: { segments: 1, promptReady: 1, videoReady: 0, videoGenerated: 0, failed: 0 },
}));

function episodeDetail(number: number): DramaEpisodeDetail {
    const id = `episode-${number}`;
    const shot: DramaShot = {
        id: `shot-${number}`,
        projectId: "project",
        episodeId: id,
        position: 0,
        segmentIndex: number + 2,
        segmentTitle: "",
        scene: "",
        sceneCastId: number === 1 ? "雨夜车站" : undefined,
        castIdsJson: number === 1 ? '["林川"]' : "[]",
        lookCastIdsJson: "[]",
        propIdsJson: number === 1 ? '["旧钥匙"]' : "[]",
        speaker: "",
        dialogue: "",
        action: `第${number}集分镜动作`,
        shotSize: "近景",
        camera: "固定",
        transition: "",
        durationMs: 6000,
        imagePrompt: "",
        videoPrompt: "",
        sourceQuote: "",
    };
    const references: DramaSegment["request"]["references"] =
        number === 1
            ? [
                  { castId: "林川", kind: "character", name: "林川", label: "参考图1", resourceId: "hero-image", sent: true },
                  { castId: "", kind: "image", name: "车站构图", label: "参考图2", resourceId: "composition", sent: true },
              ]
            : [{ castId: "", kind: "image", name: "第二集专用素材", label: "参考图1", resourceId: "second-image", sent: true }];
    const segment: DramaSegment = {
        id: `segment-${number}`,
        revision: 1,
        index: number + 2,
        title: `第${number}集剧情段`,
        shotIds: [shot.id],
        durationMs: 6000,
        videoPrompt: "",
        generated: "",
        custom: false,
        promptStatus: "ready",
        videoStatus: "draft",
        videoModel: {},
        referenceMode: "auto",
        audioReferenceMode: "auto",
        request: { operation: "reference_to_video", seconds: 6, maxVideoSeconds: 15, aspectRatio: "16:9", generateAudio: true, firstFramePending: false, references, referenceCapacity: 4, modelMaxImages: 4, header: "" },
    };
    return {
        episode: {
            id,
            projectId: "project",
            number,
            title: episodes[number - 1].title,
            synopsis: "",
            hook: "",
            cliffhanger: "",
            chapterIdsJson: "[]",
            sourceFormat: "novel",
            stage: "review",
            error: "",
            shotCount: 1,
            durationMs: 6000,
            approved: false,
            finalStale: false,
            subtitleSrt: "",
            revision: 1,
        },
        shots: [shot],
        segments: [segment],
        chapters: [],
        jobs: [],
    };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    spyOn(resources, "getResourceAccess").mockRejectedValue(new Error("No remote media in this fixture"));
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(onOpenSegment = mock(), onOpenCast = mock()) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <ProjectAssetAudit projectId="project" episodes={episodes} cast={assets} activeEpisodeId="episode-1" onOpenSegment={onOpenSegment} onOpenCast={onOpenCast} />
                </App>
            </QueryClientProvider>,
        ),
    );
}
async function settleUntil(predicate: () => boolean) {
    for (let attempt = 0; attempt < 50 && !predicate(); attempt++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(predicate()).toBe(true);
}
function button(label: string, scope: ParentNode = host) {
    const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    expect(result, `button ${label}`).toBeDefined();
    return result!;
}
async function click(target: HTMLButtonElement) {
    await act(async () => target.click());
}
function cards() {
    return [...host.querySelectorAll<HTMLElement>(".drama-audit-asset")];
}
function cardNames() {
    return cards().map((card) => card.querySelector("strong")?.textContent);
}

test("切换集按需读取，等待新集时不显示上一集的资产", async () => {
    let resolveSecond!: (detail: DramaEpisodeDetail) => void;
    const second = new Promise<DramaEpisodeDetail>((resolve) => {
        resolveSecond = resolve;
    });
    const request = spyOn(api, "getDramaEpisode").mockImplementation((_projectId, episodeId) => (episodeId === "episode-1" ? Promise.resolve(episodeDetail(1)) : second));
    await render();
    await settleUntil(() => cards().length === 4);
    expect(request).toHaveBeenCalledTimes(1);
    await click(host.querySelectorAll<HTMLButtonElement>(".drama-audit-episode")[1]);
    expect(cards()).toHaveLength(0);
    expect(host.textContent).toContain("正在读取第 2 集");
    await act(async () => resolveSecond(episodeDetail(2)));
    await settleUntil(() => cards().length === 1);
    expect(cardNames()).toEqual(["第二集专用素材"]);
    expect(request.mock.calls[1][1]).toBe("episode-2");
});

test("读取失败显示错误，重试成功后才展示配置", async () => {
    const request = spyOn(api, "getDramaEpisode").mockRejectedValueOnce(new Error("测试读取失败")).mockResolvedValue(episodeDetail(1));
    await render();
    await settleUntil(() => Boolean(host.querySelector('[role="alert"]')));
    expect(host.textContent).toContain("测试读取失败");
    expect(cards()).toHaveLength(0);
    const retry = host.querySelector<HTMLButtonElement>('[role="alert"] button');
    expect(retry).not.toBeNull();
    await click(retry!);
    await settleUntil(() => cards().length === 4);
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("测试读取失败");
});

test("类型筛选与仅待核查筛选按真实引用状态组合", async () => {
    spyOn(api, "getDramaEpisode").mockResolvedValue(episodeDetail(1));
    await render();
    await settleUntil(() => cards().length === 4);
    const segment = host.querySelector(".drama-audit-segment")!;
    const grids = segment.querySelectorAll(".drama-audit-assets");
    expect(grids).toHaveLength(1);
    expect(grids[0].children).toHaveLength(4);
    expect(cardNames()).toEqual(["林川", "雨夜车站", "旧钥匙", "车站构图"]);
    expect(segment.querySelector(".drama-audit-shot-details > summary")).not.toBeNull();
    await click(button("只看待核查"));
    expect(cardNames()).toEqual(["雨夜车站", "旧钥匙"]);
    await click(button("角色1", host.querySelector('[aria-label="资产类型"]')!));
    expect(cards()).toHaveLength(0);
    expect(host.textContent).toContain("没有符合筛选的资产");
    await click(button("只看待核查"));
    expect(cardNames()).toEqual(["林川"]);
    await click(button("环境1", host.querySelector('[aria-label="资产类型"]')!));
    expect(cardNames()).toEqual(["雨夜车站"]);
});

test("搜索筛选保留匹配资产且清空后恢复", async () => {
    spyOn(api, "getDramaEpisode").mockResolvedValue(episodeDetail(1));
    await render();
    await settleUntil(() => cards().length === 4);
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索本集资产"]')!;
    for (const [value, count] of [
        ["钥匙", 1],
        ["", 4],
    ] as const) {
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await settleUntil(() => cards().length === count);
    }
});

test("资产设定和剧情段入口传递当前集的准确标识", async () => {
    spyOn(api, "getDramaEpisode").mockImplementation((_projectId, episodeId) => Promise.resolve(episodeDetail(episodeId === "episode-1" ? 1 : 2)));
    const openSegment = mock();
    const openCast = mock();
    await render(openSegment, openCast);
    await settleUntil(() => cards().length === 4);
    await click(button("打开林川的资产设定"));
    expect(openCast).toHaveBeenCalledWith("林川");
    await click(button("进入剧情段"));
    expect(openSegment).toHaveBeenCalledWith("episode-1", 3);
    await click(host.querySelectorAll<HTMLButtonElement>(".drama-audit-episode")[1]);
    await settleUntil(() => cards().length === 1);
    await click(button("进入剧情段"));
    expect(openSegment).toHaveBeenLastCalledWith("episode-2", 4);
});
