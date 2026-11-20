import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { CreateDramaInput, DramaDraft, DramaModelCatalog, DramaSummary } from "../../src/services/api/drama";

const dom = new Window({ url: "http://localhost/projects/new" });
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
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { App } = await import("antd");
const { DramaStylePicker, StyleCompositionPicker } = await import("../../src/pages/projects/style-picker");
const { composeDramaStyleId, findDramaStyle, parseDramaStyleId } = await import("../../src/lib/drama/drama-styles");

const catalog: DramaModelCatalog = {
    defaults: { text: { logicalModelId: "text" }, image: { logicalModelId: "image" }, video: { logicalModelId: "video" } },
    options: {
        text: [],
        image: [],
        video: [{ choice: { logicalModelId: "video" }, capability: "video", label: "Video", priceLabel: "", tailFrameChain: true, videoRatios: ["9:16", "16:9"] }],
    },
};
// 本组只替换无关的模型、技能、参考图控件；真实创建页负责草稿回填、settings 构建和提交。
mock.module("../../src/pages/projects/drama-model-picker", () => ({ useDramaModelCatalog: () => ({ data: catalog }), DramaModelPicker: () => null }));
mock.module("../../src/pages/projects/asset-scheme", () => ({ useAssetSchemes: () => ({ data: undefined }), defaultAssetSettings: () => undefined, AssetSchemePicker: () => null }));
mock.module("../../src/pages/projects/step-settings", () => ({ DramaAssetImageModels: () => null, DramaTextSteps: () => null, VideoResolutionField: () => null }));
mock.module("../../src/pages/projects/storyboard-rules", () => ({ EpisodeDurationInput: () => null, StoryboardRules: () => null }));
const { default: DramaCreatePage } = await import("../../src/pages/projects/create");
const api = await import("../../src/services/api/drama");
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

async function render(children: ReactNode) {
    await act(async () => root.render(<App>{children}</App>));
}
function ControlledPicker({ initial, compact = false, onChange = () => {} }: { initial: string; compact?: boolean; onChange?: (id: string) => void }) {
    const [value, setValue] = useState(initial);
    return (
        <StyleCompositionPicker
            value={value}
            compact={compact}
            onChange={(id) => {
                setValue(id);
                onChange(id);
            }}
        />
    );
}
async function click(label: string, scope: ParentNode = host) {
    const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    expect(button).toBeDefined();
    await act(async () => button!.click());
}
async function choose(label: string, value: string) {
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}
function axisButton(axis: string, text: string) {
    return [...host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${axis}"] button`)].find((button) => button.textContent?.startsWith(text))!;
}
async function pressAxis(axis: string, text: string) {
    const button = axisButton(axis, text);
    expect(button).toBeDefined();
    await act(async () => button.click());
}

// 包含页面入口，确保预设只是辅助入口且自由组合始终可见。
test("create picker leads with two independent axes and keeps presets collapsed", async () => {
    await render(<DramaStylePicker value={composeDramaStyleId("3d", "urban")} onChange={() => {}} />);
    expect(host.querySelector('[role="group"][aria-label="表现形式"]')).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="题材"]')).not.toBeNull();
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(axisButton("表现形式", "3D 动画").getAttribute("aria-pressed")).toBe("true");
    expect(axisButton("题材", "都市").getAttribute("aria-pressed")).toBe("true");
});

test("switching either axis keeps the other and updates the controlled id", async () => {
    const changed = mock();
    await render(<ControlledPicker initial={composeDramaStyleId("3d", "xuanhuan")} onChange={changed} />);
    await pressAxis("题材", "都市");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("3d", "urban"));
    await pressAxis("表现形式", "2D 动画");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("2d", "urban"));
    await pressAxis("表现形式", "写实");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("realistic", "urban"));
    await pressAxis("题材", "末日");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("realistic", "apocalypse"));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("写实 · 末日");
});

test("editing a legacy preset starts a clean composition without retaining fantasy prompts", async () => {
    const changed = mock();
    await render(<ControlledPicker initial="3d-guoman" onChange={changed} />);
    expect(host.textContent).toContain("当前使用预设");
    await pressAxis("题材", "都市");
    const id = changed.mock.calls[0][0] as string;
    expect(id).toBe(composeDramaStyleId("3d", "urban"));
    expect(findDramaStyle(id)?.prompt).not.toMatch(/玄幻|宗门|古装|法术/);
    expect(host.textContent).not.toContain("当前使用预设");
});

test("compact picker restores both axes and changes them independently", async () => {
    const changed = mock();
    await render(<ControlledPicker initial={composeDramaStyleId("semi-realistic", "apocalypse")} compact onChange={changed} />);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="表现形式"]')?.value).toBe("semi-realistic");
    expect(host.querySelector<HTMLSelectElement>('[aria-label="题材"]')?.value).toBe("apocalypse");
    await choose("表现形式", "2d");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("2d", "apocalypse"));
    await choose("题材", "campus");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("2d", "campus"));
});

test("disabled compact and expanded selectors preserve their values", async () => {
    const changed = mock();
    const id = composeDramaStyleId("3d", "urban");
    await render(<StyleCompositionPicker value={id} onChange={changed} disabled />);
    expect([...host.querySelectorAll<HTMLSelectElement>("select")].every((select) => select.disabled)).toBe(true);
    await render(<StyleCompositionPicker value={id} onChange={changed} disabled compact={false} />);
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].every((button) => button.disabled)).toBe(true);
    await pressAxis("表现形式", "写实");
    expect(changed).not.toHaveBeenCalled();
});

test("empty custom style does not opt in or emit a default until the user chooses", async () => {
    const changed = mock();
    await render(<ControlledPicker initial="" compact onChange={changed} />);
    expect(changed).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="表现形式"]')?.value).toBe("");
    await choose("题材", "xuanhuan");
    expect(changed).toHaveBeenLastCalledWith(composeDramaStyleId("realistic", "xuanhuan"));
});

test("composition details expose the matching name and prompt", async () => {
    const style = findDramaStyle(composeDramaStyleId("2d", "apocalypse"))!;
    await render(<DramaStylePicker value={style.id} onChange={() => {}} />);
    await click("查看风格详情");
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(style.name);
    expect(dialog.textContent).toContain(style.prompt);
    expect(dialog.textContent).toContain("自由组合");
    expect(dialog.textContent).not.toContain("真人短剧");
    await click("关闭", dialog);
});

const sourceText = `第一章 回家\n${"林溪走进街角的咖啡馆，与许久未见的朋友聊起新的工作。".repeat(12)}`;
function savedDraft(styleId: string): DramaDraft {
    const style = findDramaStyle(styleId)!;
    return {
        projectId: "draft-style",
        name: "组合风格草稿",
        sourceFormat: "novel",
        settings: {
            aspectRatio: "16:9",
            episodeSeconds: 90,
            styleName: style.name,
            stylePrompt: style.prompt,
            language: "中文普通话",
            reviewMode: "sample",
            mediaMode: "manual",
            episodeMode: "chapter",
            chaptersPerEpisode: 1,
            videoContinuity: "parallel",
            models: catalog.defaults,
        } as DramaDraft["settings"],
        budgetMicrocredits: 0,
        selectedChapters: [0],
        chapterCount: 1,
        form: { sourceText, styleId },
    };
}
async function renderDraft(draft: DramaDraft) {
    client.setQueryData(["drama-draft", draft.projectId], draft);
    spyOn(api, "estimateDrama").mockResolvedValue({ episodes: 1, shots: 6, images: 0, videos: 0, textCalls: 1, minMicrocredits: 0, maxMicrocredits: 0, sampleMicrocredits: 0, priced: false, note: "", durationMinutes: 1 });
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[`/projects/new?draft=${draft.projectId}`]}>
                    <App>
                        <DramaCreatePage />
                    </App>
                </MemoryRouter>
            </QueryClientProvider>,
        ),
    );
}

test("create page hydrates a composed draft and persists both style settings and id", async () => {
    const original = savedDraft(composeDramaStyleId("3d", "xuanhuan"));
    const save = spyOn(api, "saveDramaDraft").mockResolvedValue({ project: { id: original.projectId } } as DramaSummary);
    await renderDraft(original);
    expect(axisButton("表现形式", "3D 动画").getAttribute("aria-pressed")).toBe("true");
    expect(axisButton("题材", "玄幻").getAttribute("aria-pressed")).toBe("true");
    await pressAxis("题材", "都市");
    await click("保存为草稿");
    expect(save).toHaveBeenCalledTimes(1);
    const [projectId, input] = save.mock.calls[0];
    const id = composeDramaStyleId("3d", "urban");
    expect(projectId).toBe(original.projectId);
    expect(input.draft).toEqual({ sourceText, styleId: id });
    expect(input.settings.styleName).toBe(findDramaStyle(id)?.name);
    expect(input.settings.stylePrompt).toBe(findDramaStyle(id)?.prompt);
    expect(input.settings.stylePrompt).not.toMatch(/宗门|玄幻|竖屏|横屏/);
    expect(input.settings.aspectRatio).toBe("16:9");
    // 用实际提交序列化后的数据重新打开真实创建页，验证另一轴和组合提示词没有丢失。
    const stored = JSON.parse(JSON.stringify(input)) as CreateDramaInput;
    await act(async () => root.unmount());
    client.clear();
    root = createRoot(host);
    await renderDraft({ ...original, settings: stored.settings as DramaDraft["settings"], form: stored.draft! });
    expect(axisButton("表现形式", "3D 动画").getAttribute("aria-pressed")).toBe("true");
    expect(axisButton("题材", "都市").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("3D 动画 · 都市");
});

test("starting a restored draft uses the composition in settings", async () => {
    const draft = savedDraft(composeDramaStyleId("semi-realistic", "apocalypse"));
    const save = spyOn(api, "saveDramaDraft").mockResolvedValue({ project: { id: draft.projectId } } as DramaSummary);
    await renderDraft(draft);
    await click("开始改编剧本与分镜");
    expect(save).toHaveBeenCalledTimes(1);
    const input = save.mock.calls[0][1];
    expect(input.start).toBe(true);
    expect(input.draft).toBeUndefined();
    expect(input.settings.styleName).toBe("半写实 · 末日");
    expect(input.settings.stylePrompt).toBe(findDramaStyle(draft.form.styleId!)?.prompt);
    expect(parseDramaStyleId(draft.form.styleId!)).toEqual({ formId: "semi-realistic", themeId: "apocalypse" });
});
