import { expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaModelChoice, DramaSegment, DramaShot } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/p1/e/ep1" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ConfigProvider } = await import("antd");
const api = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");
const { Storyboard } = await import("../../src/pages/projects/studio/storyboard");

const model: DramaModelChoice = { modelKey: "test-model", logicalModelId: "test-model", label: "测试视频模型" };
const segment: DramaSegment = {
    id: "seg-0",
    revision: 1,
    index: 0,
    title: "第一段",
    shotIds: ["shot-0", "shot-1", "shot-2", "shot-3"],
    durationMs: 8000,
    videoPrompt: "已写提示词",
    generated: "已写提示词",
    custom: false,
    promptStatus: "ready",
    videoStatus: "draft",
    referenceMode: "auto",
    audioReferenceMode: "auto",
    request: {
        operation: "reference_to_video",
        seconds: 8,
        maxVideoSeconds: 15,
        aspectRatio: "16:9",
        resolution: "720P",
        generateAudio: true,
        firstFramePending: false,
        references: [],
        referenceCapacity: 5,
        modelMaxImages: 5,
        header: "",
    },
};
const shots: DramaShot[] = segment.shotIds.map((id, position) => ({
    id,
    projectId: "p1",
    episodeId: "ep1",
    position,
    segmentIndex: 0,
    segmentTitle: segment.title,
    scene: "屋内",
    castIdsJson: "[]",
    lookCastIdsJson: "[]",
    propIdsJson: "[]",
    speaker: position === 3 ? "甲" : "",
    dialogue: position === 3 ? "第四个镜头的对白" : "",
    action: `动作 ${position + 1}`,
    shotSize: "",
    camera: "",
    transition: "",
    durationMs: 2000,
    imagePrompt: "",
    videoPrompt: "",
    sourceQuote: "",
}));

test("分镜表格每段一行，镜头在段内展示，视频与参考图不重复，原有操作可用", async () => {
    const models = spyOn(api, "getDramaModels").mockResolvedValue({ options: { video: [], image: [], text: [] }, unavailable: {} } as never);
    const access = spyOn(resources, "getResourceAccess").mockImplementation(async (key, _mode, variant) => ({ url: `http://localhost/media/${variant}/${key}` }) as never);
    const references: DramaSegment["request"]["references"] = Array.from({ length: 7 }, (_, i) => ({
        castId: `ref-${i}`,
        label: `参考图${i + 1}`,
        kind: "image",
        name: `参考素材 ${i + 1}`,
        resourceId: i === 6 ? undefined : `image-${i}`,
        sent: i < 6,
    }));
    const tableSegment: DramaSegment = { ...segment, videoStatus: "ready", videoResourceId: "segment-video", tailFrameResourceId: "tail-frame", videoReprocessable: true, request: { ...segment.request, references } };
    const nextShot: DramaShot = { ...shots[0], id: "shot-4", position: 4, segmentIndex: 1, segmentTitle: "第二段", action: "第二段的画面" };
    const nextSegment: DramaSegment = { ...segment, id: "seg-1", index: 1, title: "第二段", shotIds: [nextShot.id], durationMs: nextShot.durationMs, videoStatus: "ready", videoResourceId: "next-video", tailFrameResourceId: "next-frame" };
    const castFallback = { id: "ref-6", name: "参考素材 7", kind: "prop", imageStatus: "ready", imageResourceId: "fallback-image" } as DramaCast;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpen = mock(() => {});
    const onGenerate = mock(() => {});
    const onWritePrompts = mock(() => {});
    const onReprocess = mock(() => {});
    const button = (label: string) => [...host.querySelectorAll("button")].find((item) => item.textContent?.trim().replace(/\s/g, "") === label.replace(/\s/g, ""))!;
    const activeLayout = () => host.querySelector('[aria-label="镜头布局"] button[aria-pressed="true"]');
    try {
        await act(async () => {
            root.render(
                <ConfigProvider wave={{ disabled: true }}>
                    <QueryClientProvider client={client}>
                        <Storyboard
                            shots={[...shots, nextShot]}
                            segments={[tableSegment, nextSegment]}
                            aspectRatio="16:9"
                            castById={new Map([[castFallback.id, castFallback]])}
                            defaultVideoModel={model}
                            busy={false}
                            keyboardEnabled={true}
                            onOpen={onOpen}
                            onGenerate={onGenerate}
                            onReprocess={onReprocess}
                            onWritePrompts={onWritePrompts}
                            empty={{ title: "空", text: "暂无镜头", active: false }}
                        />
                    </QueryClientProvider>
                </ConfigProvider>,
            );
        });
        expect(activeLayout()).toBe(button("卡片"));
        expect(host.textContent).toContain("还有 1 镜");
        expect(host.textContent).not.toContain("第四个镜头的对白");

        expect(button("表格")).toBeUndefined();
        const checkbox = () => host.querySelector<HTMLInputElement>('input[aria-label="选择第 1 段"]')!;
        await act(async () => checkbox().click());
        expect(host.textContent).toContain("已选 1 段");

        await act(async () => button("列表").click());
        expect(activeLayout()).toBe(button("列表"));
        const table = host.querySelector('table[aria-label="分镜列表"]')!;
        const headings = [...table.querySelectorAll(".drama-sg-table-shot-head .drama-sg-table-shot-columns > span")];
        expect(headings.map((heading) => heading.textContent?.trim())).toEqual(["镜头", "画面", "对白"]);
        const rows = [...table.querySelectorAll("tbody tr")];
        expect(rows).toHaveLength(2);
        const firstShots = rows[0].querySelectorAll(".drama-sg-table-shots li");
        expect(firstShots).toHaveLength(4);
        expect(firstShots[3].textContent).toContain("镜头 4");
        expect(firstShots[3].textContent).toContain("2s");
        expect(firstShots[3].children).toHaveLength(3);
        expect(firstShots[3].children[1].textContent).toBe("动作 4");
        expect(firstShots[3].children[2].textContent).toBe("甲：第四个镜头的对白");
        expect(rows[1].querySelectorAll(".drama-sg-table-shots li")).toHaveLength(1);
        expect(rows[1].querySelector(".drama-sg-table-shots li")?.textContent).toContain("第二段的画面");
        expect(host.querySelector("table thead th:last-child")?.textContent).toBe("段视频");
        expect(host.querySelectorAll("table tbody video")).toHaveLength(2);
        expect(rows[0].lastElementChild?.querySelector("video")?.src).toBe("http://localhost/media/playback/resource:segment-video");
        expect(rows[1].lastElementChild?.querySelector("video")?.src).toBe("http://localhost/media/playback/resource:next-video");
        const referenceCell = rows[0].querySelector(".drama-sg-table-reference-cell .drama-sg-table-cell");
        expect(referenceCell?.getAttribute("tabindex")).toBe("0");
        expect(referenceCell?.querySelectorAll(".drama-sg-thumb.is-wide")).toHaveLength(7);
        expect(rows[0].querySelector(".drama-sg-table-reference-head")?.textContent).toContain("7 张参考图");
        expect(rows[0].querySelector(".drama-sg-table-reference-head")?.textContent).toContain("另有 1 张");
        expect(rows[1].querySelector(".drama-sg-table-reference-head")?.textContent).not.toContain("另有");
        expect(rows[1].querySelector(".drama-sg-table-reference-cell")?.textContent).toContain("无参考图");
        expect(access).toHaveBeenCalledWith("resource:segment-video", "display", "playback");
        expect(access).toHaveBeenCalledWith("resource:next-video", "display", "playback");
        await act(async () => host.querySelector<HTMLButtonElement>('table button[aria-label="打开镜头 4"]')!.click());
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen).toHaveBeenLastCalledWith(0, "shot-3");
        expect(checkbox().checked).toBe(true);
        await act(async () => button("重新处理").click());
        expect(onReprocess).toHaveBeenLastCalledWith(0);
        await act(async () => button("生成视频 · 1 段").click());
        expect(onGenerate).toHaveBeenLastCalledWith([0], undefined);
        expect(checkbox().checked).toBe(false);
        await act(async () => checkbox().click());
        await act(async () => button("重新撰写提示词 · 1 段").click());
        expect(onWritePrompts).toHaveBeenLastCalledWith([0]);

        await act(async () => button("卡片").click());
        expect(host.querySelector("table")).toBeNull();
        expect(host.textContent).toContain("还有 1 镜");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        client.clear();
        models.mockRestore();
        access.mockRestore();
    }
});
