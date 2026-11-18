import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaEpisodeDetail, DramaModelChoice, DramaSegment } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/p1/e/ep1?segment=0" });
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
    PointerEvent: (dom as { PointerEvent?: unknown }).PointerEvent ?? dom.MouseEvent,
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

const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { App, ConfigProvider } = await import("antd");
const api = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");
const { SegmentDialog } = await import("../../src/pages/projects/studio/segment-dialog");

const generation = await import("../../src/services/api/generation-task");
const { createModelChannel, useConfigStore } = await import("../../src/stores/use-config-store");

const { http } = await import("../../src/services/api/request");

const { serializeEditableValue } = await import("../../src/components/canvas/canvas-mention-editable");

function request(seconds: number, resolution: string) {
    return {
        operation: "reference_to_video" as const,
        seconds,
        maxVideoSeconds: 15,
        aspectRatio: "9:16",
        resolution,
        generateAudio: true,
        firstFramePending: false,
        references: [] as DramaSegment["request"]["references"],
        referenceCapacity: 5,
        modelMaxImages: 5,
        header: "",
    };
}

function segment(index: number, label: string, seconds: number, resolution: string): DramaSegment {
    const model: DramaModelChoice = { modelKey: label, logicalModelId: label, label };
    return {
        id: `seg-${index}`,
        revision: 1,
        index,
        title: `场景${index + 1}`,
        shotIds: [],
        durationMs: seconds * 1000,
        videoPrompt: `第${index + 1}段提示词正文`,
        generated: `第${index + 1}段提示词正文`,
        custom: false,
        promptStatus: "ready",
        videoStatus: "ready",
        videoResourceId: `video-${index}`,
        videoSeconds: seconds,
        videoModel: model,
        referenceMode: "auto",
        audioReferenceMode: "auto",
        request: request(seconds, resolution),
    };
}

const detail: DramaEpisodeDetail = {
    episode: {
        id: "ep1",
        projectId: "p1",
        number: 12,
        title: "第十二集",
        synopsis: "",
        hook: "",
        cliffhanger: "",
        chapterIdsJson: "[]",
        sourceFormat: "novel",
        stage: "video",
        error: "",
        shotCount: 0,
        durationMs: 30000,
        approved: false,
        finalStale: false,
        subtitleSrt: "",
        revision: 1,
    },
    shots: [],
    segments: [segment(0, "minimax-h3-1080p", 9.8, ""), segment(1, "wb-seedance-2-fast", 10, "720P"), segment(2, "wb-seedance-2-fast", 10, "720P"), segment(3, "wb-seedance-2-fast", 10, "720P")],
    chapters: [],
    jobs: [],
};

function Host({
    onSavePrompt = async () => {},
    promptModel,
    busy = false,
    episodeDetail = detail,
}: {
    onSavePrompt?: (segment: DramaSegment, override: string) => Promise<unknown>;
    promptModel?: DramaModelChoice;
    busy?: boolean;
    episodeDetail?: DramaEpisodeDetail;
}) {
    const [index, setIndex] = useState(0);
    return (
        <SegmentDialog
            detail={episodeDetail}
            segmentIndex={index}
            castById={new Map()}
            aspectRatio="9:16"
            busy={busy}
            writing={false}
            reprocessing={false}
            defaultVideoModel={{ modelKey: "wb-seedance-2-fast", label: "wb-seedance-2-fast" }}
            promptModel={promptModel}
            videoResolution="720P"
            onClose={() => {}}
            onNavigate={(next) => setIndex(next)}
            onPatchShot={() => {}}
            onSavePrompt={onSavePrompt}
            onSaveReferences={async () => {}}
            onWritePrompt={() => {}}
            onGenerate={() => {}}
            onReprocess={() => {}}
            onOpenCast={() => {}}
            onOpenAssets={() => {}}
            onOpenCanvas={() => {}}
            canvasOpening={false}
        />
    );
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
    spyOn(api, "listDramaTakes").mockResolvedValue({ takes: [] });
    spyOn(api, "getDramaModels").mockResolvedValue({ options: { video: [], image: [], text: [] }, unavailable: {} } as never);
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

function toolbars() {
    return [...document.querySelectorAll('[aria-label="生成设置"]')];
}

test("冲突保留正文并可人工确认，AI 新稿不会自动替换手写稿", async () => {
    const saved: string[] = [];
    const current = { ...segment(0, "minimax-h3-1080p", 9.8, ""), custom: true, videoPrompt: "手写镜头：甲说你好。", promptStatus: "conflict" as const, promptError: "原对白缺失" };
    const render = (value: DramaSegment) =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <Host episodeDetail={{ ...detail, segments: [value] }} onSavePrompt={async (_, prompt) => saved.push(prompt)} />
                </App>
            </QueryClientProvider>,
        );
    await act(async () => render(current));
    expect(document.body.textContent).toContain("原对白缺失");
    expect(document.querySelector('[aria-label="完整视频提示词"]')?.textContent).toContain(current.videoPrompt);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "确认使用当前提示词");
    expect(confirm?.disabled).toBe(false);
    await act(async () => confirm!.click());
    expect(saved).toEqual([current.videoPrompt]);
    await act(async () => render({ ...current, promptStatus: "review", generated: "新的 AI 稿" }));
    expect(document.body.textContent).toContain("查看 AI 新稿");
    expect(saved).toHaveLength(1);
    const adopt = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("采用 AI 版本"));
    expect(adopt).toBeDefined();
    await act(async () => adopt!.click());
    expect(saved).toEqual([current.videoPrompt, ""]);
});

function clickNext() {
    const button = document.querySelector('button[aria-label="下一段"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
}

test("切换上一段下一段时生成设置卡片不会叠加", async () => {
    await act(async () => {
        root.render(
            <QueryClientProvider client={client}>
                <ConfigProvider>
                    <App>
                        <Host />
                    </App>
                </ConfigProvider>
            </QueryClientProvider>,
        );
    });
    await act(async () => {
        await Promise.resolve();
    });
    expect(toolbars().length).toBe(1);
    expect(document.body.textContent).toContain("场景1");

    await act(async () => {
        clickNext();
        await Promise.resolve();
    });
    expect(toolbars().length).toBe(1);
    expect(document.body.textContent).toContain("场景2");
    expect(document.body.textContent).not.toContain("场景1");

    await act(async () => {
        clickNext();
        await Promise.resolve();
    });
    await act(async () => {
        clickNext();
        await Promise.resolve();
    });
    expect(toolbars().length).toBe(1);
    expect(document.body.textContent).toContain("场景4");
    expect(document.body.textContent).not.toContain("场景1");
    expect(document.body.textContent).not.toContain("场景2");
    expect(document.querySelectorAll('section[aria-label="完整视频提示词"]').length).toBe(1);

    const prev = document.querySelector('button[aria-label="上一段"]') as HTMLButtonElement | null;
    expect(prev).not.toBeNull();
    await act(async () => {
        prev!.click();
        await Promise.resolve();
    });
    expect(toolbars().length).toBe(1);
    expect(document.querySelectorAll('section[aria-label="完整视频提示词"]').length).toBe(1);
    expect(document.body.textContent).toContain("场景3");
    expect(document.body.textContent).not.toContain("场景4");
});

test("剧情段采用 AI 候选等待保存，失败不替换正文并可重试", async () => {
    const previousConfig = useConfigStore.getState().config;
    const channel = createModelChannel({ id: "text-channel", scope: "system", models: ["text-model"], modelCosts: [{ model: "text-model", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 0 }] });
    useConfigStore.setState({ config: { ...previousConfig, channels: [channel] } });
    const model = { channelId: channel.id, modelKey: "text-model" };
    const candidate = "@参考图 1在远景中对峙，用反应镜头表现冲突。";
    const savedPrompt = "参考图1在远景中对峙，用反应镜头表现冲突。";
    let episodeDetail: DramaEpisodeDetail = {
        ...detail,
        segments: detail.segments.map((current) => ({ ...current, request: { ...current.request, references: [{ castId: "cast-1", label: "参考图1", name: "主角", kind: "character", sent: true }] } })),
    };
    const generate = spyOn(generation, "runBackendGenerationTask").mockResolvedValue({ text: candidate });
    let rejectSave!: (reason: Error) => void;
    const patch = spyOn(http, "patch").mockImplementation(
        () =>
            new Promise((_, reject) => {
                rejectSave = reject;
            }),
    );
    let busy = false;
    const render = () =>
        root.render(
            <QueryClientProvider client={client}>
                <ConfigProvider>
                    <App>
                        <Host episodeDetail={episodeDetail} busy={busy} promptModel={model} onSavePrompt={(current, override) => api.updateDramaSegment("p1", "ep1", current.index, override)} />
                    </App>
                </ConfigProvider>
            </QueryClientProvider>,
        );
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(text))!;
    const editor = () => document.querySelector<HTMLElement>('[role="textbox"][aria-label="完整视频提示词"]')!;
    const editorValue = () => serializeEditableValue(editor());
    const candidateField = () => document.querySelector<HTMLTextAreaElement>('[aria-label="AI 修改候选"]');
    try {
        await act(async () => render());
        await act(async () => {
            const field = document.querySelector<HTMLTextAreaElement>('[aria-label="提示词修改要求"]')!;
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(field, "改成对峙，弱化暴力描写");
            field.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        await act(async () => button("生成修改候选").click());
        expect(candidateField()?.value).toBe(candidate);
        expect(editorValue()).toBe(detail.segments[0].videoPrompt);
        expect(patch).not.toHaveBeenCalled();
        busy = true;
        await act(async () => render());
        expect(button("采用这版提示词").disabled).toBe(true);
        expect(editor().getAttribute("aria-readonly")).toBe("true");
        busy = false;
        await act(async () => render());
        await act(async () => button("采用这版提示词").click());
        expect(patch).toHaveBeenCalledWith("/dramas/p1/episodes/ep1/segments/0", { videoPromptOverride: candidate });
        expect(candidateField()?.value).toBe(candidate);
        expect(editorValue()).toBe(detail.segments[0].videoPrompt);
        expect(editor().getAttribute("aria-readonly")).toBe("true");
        expect(document.body.textContent).toContain("正在保存提示词");
        await act(async () => rejectSave(new Error("保存失败：服务暂不可用")));
        expect(candidateField()?.value).toBe(candidate);
        expect(editorValue()).toBe(detail.segments[0].videoPrompt);
        expect(editor().getAttribute("aria-readonly")).toBe("false");
        expect(document.body.textContent).toContain("保存失败：服务暂不可用");
        patch.mockImplementation(async () => {
            episodeDetail = {
                ...episodeDetail,
                segments: episodeDetail.segments.map((current) => (current.index === 0 ? { ...current, videoPrompt: savedPrompt, custom: true, revision: 2 } : current)),
            };
            render();
            return { saved: true };
        });
        await act(async () => button("采用这版提示词").click());
        expect(patch).toHaveBeenCalledTimes(2);
        expect(generate).toHaveBeenCalledTimes(1);
        expect(candidateField()).toBeNull();
        expect(editorValue()).toBe(savedPrompt);
        expect(document.querySelector(".drama-sd-pane-foot")!.textContent).not.toContain("未保存");
        await act(async () => button("生成修改候选").click());
        expect(candidateField()?.value).toBe(candidate);
        await act(async () => button("采用这版提示词").click());
        expect(patch).toHaveBeenCalledTimes(3);
        expect(episodeDetail.segments[0].revision).toBe(2);
        expect(editorValue()).toBe(savedPrompt);
        expect(document.querySelector(".drama-sd-pane-foot")!.textContent).not.toContain("未保存");
    } finally {
        await act(async () => useConfigStore.setState({ config: previousConfig }));
    }
});
