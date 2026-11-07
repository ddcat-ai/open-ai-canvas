import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { DramaCast, DramaSegment, DramaSegmentReferencePatch, DramaSummary } from "../../src/services/api/drama";

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
const { CastLooks } = await import("../../src/pages/projects/studio/cast-looks");
const { CastVoicePreview } = await import("../../src/pages/projects/studio/cast-voice");
const { ReferenceBoard } = await import("../../src/pages/projects/studio/segment-references");
const { CanvasDramaAdoptModal } = await import("../../src/components/canvas/canvas-drama-adopt-modal");
const { buildDramaCastNode, defaultDramaAdoptTarget } = await import("../../src/lib/canvas/drama-canvas-projection");
const { CanvasNodeType } = await import("../../src/types/canvas");
const api = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");
const imageStorage = await import("../../src/services/image-storage");
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

async function renderLooks(looks = [look]) {
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <CastLooks projectId="project" character={character} looks={looks} restyle={false} onChanged={() => {}} />
                </App>
            </QueryClientProvider>,
        ),
    );
}
async function click(label: string, scope: ParentNode = host) {
    const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label);
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
}

test("a character starts with its base image and no automatically added look", async () => {
    const add = spyOn(api, "addDramaCastLook").mockResolvedValue({ look });
    await renderLooks([]);
    expect(host.textContent).toContain("角色本体即基础造型");
    expect(host.querySelector(".drama-look-item")).toBeNull();
    expect(host.querySelector(".drama-look-form")).toBeNull();
    expect(add).not.toHaveBeenCalled();
    await click("添加造型");
    expect(host.querySelector(".drama-look-form")).not.toBeNull();
    expect(add).not.toHaveBeenCalled();
});

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
        ["second", { ...character, id: "second", name: "配角", aliasesJson: '["小乙"]', imageResourceId: undefined, voiceSampleResourceId: "voice-2" }],
        ["hall", { ...character, id: "hall", kind: "scene", name: "王府大厅", imageResourceId: undefined }],
        ["sword", { ...character, id: "sword", kind: "prop", name: "宝剑", imageResourceId: undefined }],
        ["look", look],
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

test("reference groups and assets can both reorder without changing the custom image list", async () => {
    const save = mock(async () => {});
    const references = [
        segment.request.references[0],
        { castId: "second", name: "配角", kind: "character", label: "参考图2", sent: false },
        { castId: "hall", name: "王府大厅", kind: "scene", label: "参考图3", sent: false },
        { castId: "sword", name: "宝剑", kind: "prop", label: "参考图4", sent: false },
        { ...segment.request.references[1], label: "参考图5" },
    ] as DramaSegment["request"]["references"];
    await renderReferences(save, { ...segment, request: { ...segment.request, references } });
    expect([...host.querySelectorAll(".drama-sdx-asset-group")].map((group) => group.getAttribute("aria-label"))).toEqual(["人物参考", "场景参考", "道具参考", "附加图片参考"]);
    await click("提前场景分组");
    expect(save).toHaveBeenLastCalledWith({ referenceCastIds: ["hall", "hero", "second", "sword"] });
    const reordered = [references[2], references[0], references[1], references[3], references[4]].map((ref, index) => ({ ...ref, label: `参考图${index + 1}` }));
    await renderReferences(save, { ...segment, request: { ...segment.request, references: reordered } });
    expect(host.querySelector(".drama-sdx-asset-group")?.getAttribute("aria-label")).toBe("场景参考");
    await click("提前配角");
    expect(save).toHaveBeenLastCalledWith({ referenceCastIds: ["hall", "second", "hero", "sword"] });
});

test("voice controls stay under the character asset and a look inherits the base character voice", async () => {
    const save = mock(async () => {});
    const references = [{ castId: "look", name: "主角 · 晚宴", kind: "character", label: "参考图1", sent: false }] as DramaSegment["request"]["references"];
    await renderReferences(save, { ...segment, request: { ...segment.request, references, audioReferences: segment.request.audioReferences?.slice(0, 1) } });
    const card = host.querySelector('[aria-label="主角 · 晚宴资产"]');
    expect(card?.querySelector('[aria-label="关闭主角的音色"]')).not.toBeNull();
    expect(card?.querySelector('[aria-label="试听主角的音频"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="主角资产"]')).toBeNull();
    expect(host.querySelector('[aria-label="本段角色音色"]')).toBeNull();
    await click("关闭主角的音色");
    await click("保存音色选择");
    expect(save).toHaveBeenLastCalledWith({ audioCastIds: [] });
});

test("secondary asset menu searches by alias, filters categories, and toggles selected references", async () => {
    const save = mock(async () => {});
    await renderReferences(save);
    await click("管理参考资产");
    const menu = document.querySelector('[aria-label="搜索参考资产"]')!;
    expect(menu).not.toBeNull();
    const input = menu.querySelector<HTMLInputElement>('[aria-label="搜索资产"]')!;
    const type = async (value: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    };
    await type("小乙");
    expect(menu.querySelector('[aria-label="配角资产"]')).not.toBeNull();
    expect(menu.querySelector('[aria-label="主角资产"]')).toBeNull();
    await type("");
    await click("场景", menu);
    expect(menu.querySelector('[aria-label="配角资产"]')).toBeNull();
    await click("添加参考图王府大厅", menu);
    expect(save).toHaveBeenLastCalledWith({ referenceCastIds: ["hero", "hall"] });
    await renderReferences(save, { ...segment, request: { ...segment.request, references: [...segment.request.references, { castId: "hall", name: "王府大厅", kind: "scene", label: "参考图3", sent: false }] } });
    await click("移除参考图王府大厅", menu);
    expect(save).toHaveBeenLastCalledWith({ referenceCastIds: ["hero"] });
});

test("voice edits made in the secondary menu can be saved there", async () => {
    const save = mock(async () => {});
    await renderReferences(save);
    await click("管理参考资产");
    const menu = document.querySelector('[aria-label="搜索参考资产"]')!;
    await click("关闭配角的音色", menu);
    await click("保存音色选择", menu);
    expect(save).toHaveBeenLastCalledWith({ audioCastIds: ["hero"] });
});

test("reference image opens the real large preview and can return to the reference panel", async () => {
    spyOn(imageStorage, "resolveImageUrl").mockResolvedValue("data:image/png;base64,iVBORw0KGgo=");
    await renderReferences(mock(async () => {}));
    await click("放大预览夜景");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("夜景");
    await act(async () => document.querySelector<HTMLButtonElement>(".canvas-image-preview-modal .ant-modal-close")!.click());
    expect(document.querySelector(".canvas-image-preview-modal")).toBeNull();
    expect(host.querySelector('[aria-label="夜景资产"]')).not.toBeNull();
});

const adoptCast = [character, look, { ...character, id: "second", name: "配角" }, { ...character, id: "hall", kind: "scene", name: "大厅" }, { ...character, id: "sword", kind: "prop", name: "宝剑" }] as DramaCast[];

async function renderAdopt(boundCastId?: string) {
    const summary = { project: { id: "project" }, episodes: [], production: { settings: {} } } as unknown as DramaSummary;
    const node = {
        id: "canvas-image",
        type: CanvasNodeType.Image,
        position: { x: 0, y: 0 },
        width: 320,
        height: 240,
        metadata: {
            storageKey: "resource:canvas-outfit",
            ...(boundCastId ? { dramaRef: { projectId: "project", kind: "cast" as const, id: boundCastId } } : {}),
        },
    };
    const adopted = mock(() => {});
    const closed = mock(() => {});
    const impact = spyOn(api, "getDramaCastImpact").mockResolvedValue({ episodes: 1, segments: 2 });
    const save = spyOn(api, "setDramaCastImage").mockImplementation(async (_projectId, castId) => ({ cast: adoptCast.find((item) => item.id === castId)!, affectedSegments: 0 }));
    spyOn(resources, "getResourceAccess").mockRejectedValue(new Error("Preview unavailable in this fixture"));
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>
                    <CanvasDramaAdoptModal node={node} nodes={[node]} summary={summary} cast={adoptCast} onClose={closed} onAdopted={adopted} />
                </App>
            </QueryClientProvider>,
        ),
    );
    return { save, adopted, closed, impact };
}

async function selectAdoptOption(label: string, optionText: string) {
    const input = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    await act(async () => input!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((item) => item.textContent?.trim() === optionText);
    expect(option).toBeDefined();
    await act(async () => option!.click());
}

test("canvas adoption selects a character outfit and submits its own slot", async () => {
    const { save, adopted, closed, impact } = await renderAdopt();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect([...dialog.querySelectorAll("button")].find((item) => item.textContent?.replace(/\s/g, "") === "采用")?.disabled).toBe(true);
    await selectAdoptOption("选择设定", "主角");
    await selectAdoptOption("选择服装或妆造", "晚宴");
    expect(impact.mock.calls.at(-1)?.slice(0, 2)).toEqual(["project", "look"]);
    await click("采用", dialog);
    expect(save).toHaveBeenCalledWith("project", "look", "canvas-outfit", false, { source: "canvas", taskId: undefined });
    expect(adopted).toHaveBeenCalledWith("canvas-image", { kind: "cast", castId: "look" }, "canvas-outfit");
    expect(closed).toHaveBeenCalledTimes(1);
});

test("an outfit-bound canvas image defaults to the same character and outfit", async () => {
    const { save } = await renderAdopt("look");
    expect(document.querySelector('[aria-label="选择设定"]')?.closest(".app-unified-select")?.textContent).toContain("主角");
    expect(document.querySelector('[aria-label="选择服装或妆造"]')?.closest(".app-unified-select")?.textContent).toContain("晚宴");
    await click("采用", document);
    expect(save.mock.calls[0]?.[1]).toBe("look");
});

test("switching characters clears the previous outfit and selects the new base", async () => {
    const { save } = await renderAdopt("look");
    await selectAdoptOption("选择设定", "配角");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("还没有额外造型");
    await click("采用", document);
    expect(save.mock.calls[0]?.[1]).toBe("second");
});

test("base appearance remains an explicit adoption option", async () => {
    const { save } = await renderAdopt("look");
    await selectAdoptOption("选择服装或妆造", "基础造型（角色本体）");
    await click("采用", document);
    expect(save.mock.calls[0]?.[1]).toBe("hero");
});

test.each(["大厅", "宝剑"])("adopting to %s needs no character outfit selection", async (name) => {
    const { save } = await renderAdopt("look");
    await selectAdoptOption("选择设定", name);
    expect(document.querySelector('[aria-label="选择服装或妆造"]')).toBeNull();
    await click("采用", document);
    expect(save.mock.calls[0]?.[1]).toBe(name === "大厅" ? "hall" : "sword");
});

test("outfit projection preserves its name, custom prompt and adoption binding", () => {
    const node = buildDramaCastNode({ projectId: "project", cast: look, media: { assetIdOf: () => undefined, urlOf: () => "" }, topLeft: { x: 0, y: 0 } });
    expect(node.title).toBe("角色 · 主角 · 晚宴");
    expect(node.metadata?.prompt).toBe(look.imagePrompt);
    expect(node.metadata?.composerContent).toBe(look.imagePrompt);
    expect(defaultDramaAdoptTarget(node, [node])).toEqual({ kind: "cast", castId: "look" });
});
