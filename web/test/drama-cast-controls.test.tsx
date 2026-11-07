import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaSegment, DramaSegmentReferencePatch } from "../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/drama" });
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
const { CastLooks } = await import("../src/pages/projects/studio/cast-looks");
const { CastVoicePreview } = await import("../src/pages/projects/studio/cast-voice");
const { ReferenceBoard } = await import("../src/pages/projects/studio/segment-dialog");
const api = await import("../src/services/api/drama");
const character = { id: "hero", name: "主角", kind: "character", imageStatus: "ready", imageResourceId: "base" } as DramaCast;
const look = { id: "look", name: "主角", parentId: "hero", kind: "character", lookName: "晚宴", appearance: "黑色礼服", imagePrompt: "银色耳饰，柔和侧光", imageStatus: "draft" } as DramaCast;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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

async function renderLooks() {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <CastLooks projectId="project" character={character} looks={[look]} restyle={false} onChanged={() => {}} />
                </App>
            </QueryClientProvider>,
        ),
    );
}
async function click(label: string) {
    const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label);
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
}

test("confirming a look saves its editable prompt without requesting generation", async () => {
    const update = spyOn(api, "updateDramaCastLook").mockResolvedValue({ look, affectedSegments: 0 });
    const generate = spyOn(api, "regenerateDramaCast").mockResolvedValue({ affectedSegments: 0 });
    await renderLooks();
    await click("编辑造型 晚宴");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="造型生成提示词"]')?.value).toBe("银色耳饰，柔和侧光");
    await click("确认保存");
    expect(update).toHaveBeenCalledWith("project", "look", expect.objectContaining({ imagePrompt: "银色耳饰，柔和侧光", appearance: "黑色礼服" }));
    expect(generate).not.toHaveBeenCalled();
});

test("saved draft generates only through its separate generation button", async () => {
    const generate = spyOn(api, "regenerateDramaCast").mockResolvedValue({ affectedSegments: 0 });
    await renderLooks();
    expect(host.textContent).toContain("已保存，待生成或上传");
    expect(generate).not.toHaveBeenCalled();
    await click("生成造型图");
    expect(generate).toHaveBeenCalledWith("project", "look", false);
});

test("voice preview distinguishes characters with and without audio", async () => {
    await act(async () =>
        root.render(
            <App>
                <CastVoicePreview name="甲" resourceId="sample" />
                <CastVoicePreview name="乙" />
            </App>,
        ),
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="试听甲的音频"]')?.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="乙未绑定音频"]')?.disabled).toBe(true);
});

const segment = {
    id: "segment",
    index: 0,
    referenceMode: "custom",
    audioReferenceMode: "auto",
    request: {
        references: [
            { castId: "hero", name: "主角", kind: "character", label: "参考图1", sent: false },
            { castId: "", resourceId: "extra", name: "夜景", kind: "image", label: "参考图2", sent: false },
        ],
        audioReferences: [
            { castId: "hero", name: "主角", sent: false },
            { castId: "second", name: "配角", sent: false },
        ],
        modelMaxAudios: 1,
        referenceCapacity: 3,
        modelMaxImages: 3,
    },
} as DramaSegment;

async function renderReferences(onSave: (patch: DramaSegmentReferencePatch) => Promise<unknown>, currentSegment = segment) {
    const castById = new Map<string, DramaCast>([
        ["hero", { ...character, imageResourceId: undefined, voiceSampleResourceId: "voice-1" }],
        ["second", { ...character, id: "second", name: "配角", imageResourceId: undefined, voiceSampleResourceId: "voice-2" }],
    ]);
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <ReferenceBoard segment={currentSegment} shots={[]} castById={castById} busy={false} onSave={onSave} onOpenCast={() => {}} />
                </App>
            </QueryClientProvider>,
        ),
    );
}

test("reference removal updates only the selected source and keeps library/upload entry points", async () => {
    const save = mock(async () => {});
    await renderReferences(save);
    expect(host.textContent).toContain("素材库");
    expect(host.textContent).toContain("上传参考图");
    await click("移除参考图夜景");
    expect(save).toHaveBeenLastCalledWith({ referenceImages: [] });
    await click("移除参考图主角");
    expect(save).toHaveBeenLastCalledWith({ referenceCastIds: [] });
});

test("over-limit automatic voices can be adjusted before saving and restored to automatic mode", async () => {
    const save = mock(async () => {});
    await renderReferences(save);
    expect(host.textContent).toContain("当前模型音色不可多于 1 个");
    await click("关闭配角的音色");
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="开启配角的音色"]')?.disabled).toBe(true);
    await click("保存音色选择");
    expect(save).toHaveBeenLastCalledWith({ audioCastIds: ["hero"] });
    await renderReferences(save, { ...segment, audioReferenceMode: "custom", request: { ...segment.request, audioReferences: segment.request.audioReferences?.slice(0, 1) } });
    await click("恢复自动音色");
    expect(save).toHaveBeenLastCalledWith({ autoAudioReferences: true });
});
