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
    segments: [
        segment(0, "minimax-h3-1080p", 9.8, ""),
        segment(1, "wb-seedance-2-fast", 10, "720P"),
        segment(2, "wb-seedance-2-fast", 10, "720P"),
        segment(3, "wb-seedance-2-fast", 10, "720P"),
    ],
    chapters: [],
    jobs: [],
};

function Host() {
    const [index, setIndex] = useState(0);
    return (
        <SegmentDialog
            detail={detail}
            segmentIndex={index}
            castById={new Map()}
            aspectRatio="9:16"
            busy={false}
            writing={false}
            reprocessing={false}
            defaultVideoModel={{ modelKey: "wb-seedance-2-fast", label: "wb-seedance-2-fast" }}
            videoResolution="720P"
            onClose={() => {}}
            onNavigate={(next) => setIndex(next)}
            onPatchShot={() => {}}
            onSavePrompt={() => {}}
            onSaveReferences={async () => {}}
            onWritePrompt={() => {}}
            onGenerate={() => {}}
            onReprocess={() => {}}
            onOpenCast={() => {}}
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
