import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { DramaCast, DramaListPage } from "../../src/services/api/drama";
import type { CastImageFieldsValue } from "../../src/pages/projects/studio/cast-image-fields";

const dom = new Window({ url: "http://localhost/projects/current" });
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
const { App } = await import("antd");
const { CastPanel } = await import("../../src/pages/projects/studio/panels");
const { CastCreateDialog } = await import("../../src/pages/projects/studio/cast-create-dialog");
const { CastProjectImport } = await import("../../src/pages/projects/studio/cast-project-import");
const { CastImageFields } = await import("../../src/pages/projects/studio/cast-image-fields");
const { composeDramaStyleId, findDramaStyle } = await import("../../src/lib/drama/drama-styles");
const api = await import("../../src/services/api/drama");
const resources = await import("../../src/services/api/resources");

function castFixture(id: string, name: string, patch: Partial<DramaCast> = {}): DramaCast {
    return {
        id,
        projectId: "current",
        kind: "character",
        name,
        aliasesJson: "[]",
        role: "",
        description: "",
        appearance: `${name}的初始外观`,
        voiceInstructions: "",
        importance: 1,
        imageStatus: "draft",
        imageVersion: 0,
        locked: false,
        position: 0,
        ...patch,
    };
}
const hero = castFixture("hero", "林溪", { imageStatus: "ready", imageResourceId: "hero-image" });
const evening = castFixture("evening-look", "林溪", { parentId: hero.id, lookName: "晚宴", appearance: "黑色礼服，银色耳饰", imagePrompt: "晚宴柔光", imageResourceId: "evening-image", imageStatus: "ready", lookFromChapter: 2, lookToChapter: 4 });
const childhood = castFixture("childhood-look", "林溪", { parentId: hero.id, lookName: "幼年", appearance: "童年短发，蓝色外套", imagePrompt: "保持幼年五官" });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;

beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    spyOn(resources, "getResourceAccess").mockRejectedValue(new Error("No remote media in this fixture"));
    spyOn(api, "getDramaCastImpact").mockResolvedValue({ episodes: 1, segments: 2 });
    spyOn(api, "listDramaTakes").mockResolvedValue({ takes: [] });
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
    await act(async () =>
        root.render(
            <QueryClientProvider client={client}>
                <App>{children}</App>
            </QueryClientProvider>,
        ),
    );
}
function button(label: string, scope: ParentNode = document) {
    const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    expect(result, `button ${label}`).toBeDefined();
    return result!;
}
async function click(label: string, scope: ParentNode = document) {
    await act(async () => button(label, scope).click());
}
async function fill(label: string, value: string, scope: ParentNode = document) {
    const input = scope.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    expect(input, `field ${label}`).not.toBeNull();
    const prototype = input.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function selectOption(label: string, text: string) {
    const input = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
    expect(input).not.toBeNull();
    await act(async () => input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    const option = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((item) => item.textContent?.trim() === text);
    expect(option, `option ${text}`).toBeDefined();
    await act(async () => option!.click());
}
function checkbox(label: string, scope: ParentNode = document) {
    const labeled = scope.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`);
    const wrapper = [...scope.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.trim() === label);
    const input = labeled || wrapper?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input, `checkbox ${label}`).toBeDefined();
    return input!;
}
async function check(label: string, scope: ParentNode = document) {
    await act(async () => checkbox(label, scope).click());
}
async function chooseAxis(label: string, value: string) {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    expect(select).not.toBeNull();
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}
async function settleUntil(predicate: () => boolean) {
    for (let attempt = 0; attempt < 30 && !predicate(); attempt++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(predicate()).toBe(true);
}
function spyGeneration() {
    return {
        single: spyOn(api, "regenerateDramaCast").mockResolvedValue({ affectedSegments: 0 }),
        batch: spyOn(api, "regenerateDramaCasts").mockResolvedValue({ queued: 0, skipped: 0, affectedSegments: 0 }),
    };
}
function expectNoGeneration(generation: ReturnType<typeof spyGeneration>) {
    expect(generation.single).not.toHaveBeenCalled();
    expect(generation.batch).not.toHaveBeenCalled();
}
function PanelHarness({ onFocus = () => {}, items = [hero, evening, childhood] }: { onFocus?: (id: string) => void; items?: DramaCast[] }) {
    const [focusId, setFocusId] = useState(hero.id);
    return (
        <CastPanel
            projectId="current"
            cast={items}
            ratios={{ character: "16:9" }}
            focusId={focusId}
            retrying={false}
            assetsPending={false}
            releasing={false}
            onFocus={(id) => {
                setFocusId(id);
                onFocus(id);
            }}
            onRetry={() => {}}
            onChanged={() => {}}
            onReleaseAssets={() => {}}
            onOpenCanvas={() => {}}
        />
    );
}

test("character thumbnails select the look id and save only that look from the side editor", async () => {
    const focused = mock();
    const updateBase = spyOn(api, "updateDramaCast").mockResolvedValue({ cast: hero });
    const updateLook = spyOn(api, "updateDramaCastLook").mockResolvedValue({ look: evening, affectedSegments: 0 });
    const generation = spyGeneration();
    await render(<PanelHarness onFocus={focused} />);
    await click("切换到晚宴", host);
    expect(focused).toHaveBeenLastCalledWith(evening.id);
    expect(button("切换到晚宴", host).getAttribute("aria-pressed")).toBe("true");
    const editor = host.querySelector(".drama-view-side")!;
    expect(editor.querySelector<HTMLInputElement>('[aria-label="造型名称"]')?.value).toBe("晚宴");
    expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="外貌描述"]')?.value).toBe(evening.appearance);
    await fill("造型名称", "红毯晚宴", editor);
    await fill("外貌描述", "深红礼服，珍珠耳饰", editor);
    await fill("参考图生成提示词", "红毯暖光，保持人物五官", editor);
    await click("保存设定", editor);
    expect(updateLook).toHaveBeenCalledWith("current", evening.id, expect.objectContaining({ lookName: "红毯晚宴", appearance: "深红礼服，珍珠耳饰", imagePrompt: "红毯暖光，保持人物五官", fromChapter: 2, toChapter: 4 }));
    expect(updateBase).not.toHaveBeenCalled();
    expectNoGeneration(generation);
    await click("切换到幼年", host);
    expect(focused).toHaveBeenLastCalledWith(childhood.id);
    expect(editor.querySelector<HTMLInputElement>('[aria-label="造型名称"]')?.value).toBe("幼年");
    await click("切换到基础造型", host);
    expect(focused).toHaveBeenLastCalledWith(hero.id);
    expect(editor.querySelector<HTMLInputElement>('[aria-label="名称"]')?.value).toBe(hero.name);
});

test("the separate appearance tab selects and edits an appearance without a base card", async () => {
    const focused = mock();
    await render(<PanelHarness onFocus={focused} />);
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent?.startsWith("造型"))!;
    await act(async () => tab.click());
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const grid = host.querySelector(".drama-cast-grid")!;
    expect(grid.querySelector('[aria-label="编辑林溪"]')).toBeNull();
    expect(grid.querySelectorAll(".drama-cast-card")).toHaveLength(2);
    await click("编辑幼年", grid);
    expect(focused).toHaveBeenLastCalledWith(childhood.id);
    expect(host.querySelector<HTMLInputElement>('[aria-label="造型名称"]')?.value).toBe("幼年");
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="外貌描述"]')?.value).toBe(childhood.appearance);
});

test("refetching saved appearance and style for the same cast id rehydrates the editor", async () => {
    const originalStyle = findDramaStyle(composeDramaStyleId("2d", "xuanhuan"))!;
    const original = { ...hero, imagePrompt: "原始提示词", imageStyleId: originalStyle.id, imageStyleName: originalStyle.name, imageStylePrompt: originalStyle.prompt };
    const refreshedStyle = findDramaStyle(composeDramaStyleId("semi-realistic", "apocalypse"))!;
    const refreshed = { ...original, name: "林溪·第二季", appearance: "第二季的短发与防护外套", imagePrompt: "导入后的末日生存提示词", imageStyleId: refreshedStyle.id, imageStyleName: refreshedStyle.name, imageStylePrompt: refreshedStyle.prompt };
    const save = spyOn(api, "updateDramaCast").mockResolvedValue({ cast: refreshed });
    await render(<PanelHarness items={[original]} />);
    await fill("名称", "尚未保存的名称", host);
    await fill("外貌描述", "尚未保存的外观", host);
    await fill("参考图生成提示词", "尚未保存的提示词", host);
    await chooseAxis("表现形式", "3d");
    await chooseAxis("题材", "urban");
    expect(save).not.toHaveBeenCalled();

    await render(<PanelHarness items={[refreshed]} />);
    const editor = host.querySelector(".drama-view-side")!;
    expect(editor.querySelector<HTMLInputElement>('[aria-label="名称"]')?.value).toBe(refreshed.name);
    expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="外貌描述"]')?.value).toBe(refreshed.appearance);
    expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="参考图生成提示词"]')?.value).toBe(refreshed.imagePrompt);
    expect(editor.querySelector<HTMLSelectElement>('[aria-label="表现形式"]')?.value).toBe("semi-realistic");
    expect(editor.querySelector<HTMLSelectElement>('[aria-label="题材"]')?.value).toBe("apocalypse");
    expect(button("保存设定", editor).disabled).toBe(true);

    // 单独更新已保存风格也应回填，不能依赖外观或名称恰好一起变化。
    const styleOnly = findDramaStyle(composeDramaStyleId("realistic", "campus"))!;
    await render(<PanelHarness items={[{ ...refreshed, imageStyleId: styleOnly.id, imageStyleName: styleOnly.name, imageStylePrompt: styleOnly.prompt }]} />);
    expect(editor.querySelector<HTMLSelectElement>('[aria-label="表现形式"]')?.value).toBe("realistic");
    expect(editor.querySelector<HTMLSelectElement>('[aria-label="题材"]')?.value).toBe("campus");
    expect(editor.querySelector<HTMLTextAreaElement>('[aria-label="外貌描述"]')?.value).toBe(refreshed.appearance);
    expect(button("保存设定", editor).disabled).toBe(true);
    await fill("外貌描述", `${refreshed.appearance}，增加防护手套`, editor);
    await click("保存设定", editor);
    expect(save).toHaveBeenCalledWith(
        "current",
        hero.id,
        expect.objectContaining({ appearance: `${refreshed.appearance}，增加防护手套`, imagePrompt: refreshed.imagePrompt, imageStyleId: styleOnly.id, imageStyleName: styleOnly.name, imageStylePrompt: styleOnly.prompt }),
    );
});

test("media status and lock polling preserve unsaved appearance, prompt and style edits", async () => {
    const savedStyle = findDramaStyle(composeDramaStyleId("2d", "urban"))!;
    const saved = { ...hero, imagePrompt: "已保存提示词", imageStyleId: savedStyle.id, imageStyleName: savedStyle.name, imageStylePrompt: savedStyle.prompt };
    const editedStyle = findDramaStyle(composeDramaStyleId("3d", "apocalypse"))!;
    const save = spyOn(api, "updateDramaCast").mockResolvedValue({ cast: saved });
    await render(<PanelHarness items={[saved]} />);
    await fill("名称", "编辑中的角色名", host);
    await fill("外貌描述", "编辑中的白色外套", host);
    await fill("参考图生成提示词", "编辑中的暖色光线", host);
    await chooseAxis("表现形式", "3d");
    await chooseAxis("题材", "apocalypse");
    const appearanceInput = host.querySelector<HTMLTextAreaElement>('[aria-label="外貌描述"]');
    const updates: Partial<DramaCast>[] = [{ imageStatus: "queued" }, { locked: true }, { imageStatus: "ready", imageVersion: 2, imageResourceId: "newly-polled-image", locked: true }];
    for (const update of updates) {
        await render(<PanelHarness items={[{ ...saved, ...update }]} />);
        expect(host.querySelector('[aria-label="外貌描述"]')).toBe(appearanceInput);
        expect(appearanceInput?.value).toBe("编辑中的白色外套");
        expect(host.querySelector<HTMLInputElement>('[aria-label="名称"]')?.value).toBe("编辑中的角色名");
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="参考图生成提示词"]')?.value).toBe("编辑中的暖色光线");
        expect(host.querySelector<HTMLSelectElement>('[aria-label="表现形式"]')?.value).toBe("3d");
        expect(host.querySelector<HTMLSelectElement>('[aria-label="题材"]')?.value).toBe("apocalypse");
    }
    await fill("外貌描述", "编辑中的白色外套，继续补充银色纽扣", host);
    await click("保存设定", host.querySelector(".drama-view-side")!);
    expect(save).toHaveBeenCalledWith(
        "current",
        hero.id,
        expect.objectContaining({ name: "编辑中的角色名", appearance: "编辑中的白色外套，继续补充银色纽扣", imagePrompt: "编辑中的暖色光线", imageStyleId: editedStyle.id, imageStyleName: editedStyle.name, imageStylePrompt: editedStyle.prompt }),
    );
});

for (const [kind, name] of [
    ["character", "新角色"],
    ["scene", "林间小屋"],
    ["prop", "铜制怀表"],
] as const) {
    test(`creating a ${kind} saves a draft without generating an image`, async () => {
        const created = castFixture(`created-${kind}`, name, { kind });
        const save = spyOn(api, "createDramaCast").mockResolvedValue({ cast: created });
        const generation = spyGeneration();
        const onCreated = mock();
        const onClose = mock();
        await render(<CastCreateDialog projectId="current" initialKind={kind} onCreated={onCreated} onClose={onClose} />);
        const dialog = document.querySelector('[role="dialog"]')!;
        expect(button("保存设定", dialog).disabled).toBe(true);
        await fill("新设定名称", `  ${name}  `, dialog);
        await fill("新设定外观", `  ${name}的具体外观  `, dialog);
        await fill("参考图生成提示词", "柔和侧光，保留细节", dialog);
        expect(save).not.toHaveBeenCalled();
        await click("保存设定", dialog);
        expect(save).toHaveBeenCalledWith("current", { kind, name, appearance: `${name}的具体外观`, imagePrompt: "柔和侧光，保留细节" });
        expect(onCreated).toHaveBeenCalledWith(created);
        expect(onClose).toHaveBeenCalledTimes(1);
        expectNoGeneration(generation);
    });
}

const sourceHero = castFixture("season-one-hero", hero.name, { projectId: "season-one", imageStatus: "ready", imageResourceId: "season-one-image" });
const sourceLook = castFixture("season-one-look", hero.name, { projectId: "season-one", parentId: sourceHero.id, lookName: "冬装" });
const sourceScene = castFixture("season-one-scene", "旧宅", { projectId: "season-one", kind: "scene" });
const sourceProp = castFixture("season-two-prop", "怀表", { projectId: "season-two", kind: "prop" });
function mockSources() {
    const list = spyOn(api, "listDramas").mockResolvedValue({
        items: [{ project: { id: "current", name: "当前作品" } }, { project: { id: "season-one", name: "第一季" } }, { project: { id: "season-two", name: "第二季" } }],
        page: 1,
        pageSize: 100,
        total: 3,
        hasMore: false,
        statusCounts: {},
    } as DramaListPage);
    const casts = spyOn(api, "listDramaCast").mockImplementation(async (id) => ({ cast: id === "season-one" ? [sourceHero, sourceLook, sourceScene] : [sourceProp] }));
    const imported = spyOn(api, "importDramaCast").mockResolvedValue({ imported: 1, skipped: 0, cast: [sourceHero] });
    return { list, casts, imported };
}
async function renderImport() {
    const sources = mockSources();
    const onClose = mock();
    const onImported = mock();
    await render(<CastProjectImport projectId="current" currentCast={[hero]} onClose={onClose} onImported={onImported} />);
    await settleUntil(() => sources.list.mock.calls.length === 1 && !document.querySelector(".ant-select-loading"));
    return { ...sources, onClose, onImported };
}
async function chooseSource(name: string, expectedCheckbox: string) {
    await selectOption("素材来源作品", name);
    await settleUntil(() => Boolean(document.querySelector(`[aria-label="${expectedCheckbox}"]`)));
}

test("cross-season import requires a source and explicit cast ids and defaults to preserving existing images", async () => {
    const generation = spyGeneration();
    const { imported, casts, onImported, onClose } = await renderImport();
    expect(button("关联 0 个设定").disabled).toBe(true);
    expect(casts).not.toHaveBeenCalled();
    expect(imported).not.toHaveBeenCalled();
    await chooseSource("第一季", `关联${sourceHero.name}`);
    expect(casts.mock.calls[0]?.[0]).toBe("season-one");
    expect(button("关联 0 个设定").disabled).toBe(true);
    const choices = document.querySelector('[role="group"][aria-label="选择要关联的素材"]')!;
    expect(choices.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(choices.querySelector('[aria-label="关联冬装"]')).toBeNull();
    await check(`关联${sourceHero.name}`, choices);
    await settleUntil(() => !button("关联 1 个设定").disabled);
    expect(imported).not.toHaveBeenCalled();
    await click("关联 1 个设定");
    expect(imported).toHaveBeenCalledWith("current", { sourceProjectId: "season-one", castIds: [sourceHero.id], matchByName: true, replaceExisting: false });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expectNoGeneration(generation);
});

test("replacing an existing image is sent only after explicitly checking replacement", async () => {
    const { imported } = await renderImport();
    await chooseSource("第一季", `关联${sourceHero.name}`);
    await check(`关联${sourceHero.name}`);
    await check("替换同名设定已有的参考图，旧图保留在版本记录中");
    await settleUntil(() => !button("关联 1 个设定").disabled);
    await click("关联 1 个设定");
    expect(imported).toHaveBeenCalledWith("current", { sourceProjectId: "season-one", castIds: [sourceHero.id], matchByName: true, replaceExisting: true });
});

test("switching import source clears cast selections and replacement permission", async () => {
    const { imported } = await renderImport();
    const replaceLabel = "替换同名设定已有的参考图，旧图保留在版本记录中";
    await chooseSource("第一季", `关联${sourceHero.name}`);
    await check(`关联${sourceHero.name}`);
    await check(`关联${sourceScene.name}`);
    await check(replaceLabel);
    expect(checkbox(replaceLabel).checked).toBe(true);
    expect(button("关联 2 个设定")).toBeDefined();
    await chooseSource("第二季", `关联${sourceProp.name}`);
    expect(checkbox(replaceLabel).checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>(`[aria-label="关联${sourceProp.name}"]`)?.checked).toBe(false);
    expect(document.querySelector(`[aria-label="关联${sourceHero.name}"]`)).toBeNull();
    expect(button("关联 0 个设定").disabled).toBe(true);
    expect(imported).not.toHaveBeenCalled();
    await check(`关联${sourceProp.name}`);
    await settleUntil(() => !button("关联 1 个设定").disabled);
    await click("关联 1 个设定");
    expect(imported).toHaveBeenCalledWith("current", { sourceProjectId: "season-two", castIds: [sourceProp.id], matchByName: true, replaceExisting: false });
});

test("import preview matches names across Unicode whitespace, punctuation and case", async () => {
    const { list, casts, imported } = mockSources();
    const target = castFixture("current-normalized", "主角\u3000a", { imageResourceId: "existing-normalized-image", imageStatus: "ready" });
    const variants = ["主角·A", "主角（A）", "主角 A"].map((name, index) => castFixture(`normalized-source-${index}`, name, { projectId: "season-one" }));
    const distinct = castFixture("distinct-source", "主角B", { projectId: "season-one" });
    casts.mockResolvedValue({ cast: [...variants, distinct] });
    await render(<CastProjectImport projectId="current" currentCast={[target]} onClose={() => {}} onImported={() => {}} />);
    await settleUntil(() => list.mock.calls.length === 1 && !document.querySelector(".ant-select-loading"));
    await chooseSource("第一季", `关联${variants[0].name}`);
    const preview = (name: string) => checkbox(`关联${name}`).closest(".drama-cast-import-item")!.querySelector(".drama-cast-import-description")!.textContent;
    for (const item of variants) {
        expect(preview(item.name)).toContain("保留本作品已有参考图");
        expect(preview(item.name)).not.toContain("作为新设定加入");
    }
    expect(preview(distinct.name)).toContain("作为新设定加入");

    const matchLabel = "匹配本作品中同类型、同名称的设定，缺少的设定新增";
    await check(matchLabel);
    for (const item of variants) expect(preview(item.name)).toContain("作为新设定加入");
    await check(matchLabel);
    for (const item of variants) expect(preview(item.name)).toContain("保留本作品已有参考图");
    await check("替换同名设定已有的参考图，旧图保留在版本记录中");
    for (const item of variants) expect(preview(item.name)).toContain("替换同名设定参考图，旧图保留版本");
    await check(`关联${variants[0].name}`);
    await settleUntil(() => !button("关联 1 个设定").disabled);
    await click("关联 1 个设定");
    expect(imported).toHaveBeenCalledWith("current", { sourceProjectId: "season-one", castIds: [variants[0].id], matchByName: true, replaceExisting: true });
});

function ImageFieldsHarness({ initial = {}, onChange = () => {}, overrideAppearance }: { initial?: CastImageFieldsValue; onChange?: (patch: CastImageFieldsValue) => void; overrideAppearance?: string }) {
    const [appearance, setAppearance] = useState("初始外观");
    const [value, setValue] = useState(initial);
    return (
        <>
            <input aria-label="当前外观" value={appearance} onChange={(event) => setAppearance(event.target.value)} />
            <CastImageFields
                projectId="current"
                castId={evening.id}
                appearance={overrideAppearance ?? appearance}
                value={value}
                onChange={(patch) => {
                    setValue((previous) => ({ ...previous, ...patch }));
                    onChange(patch);
                }}
            />
        </>
    );
}
async function enableOwnStyle() {
    const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.includes("为此设定单独设置风格"));
    const control = label?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(control).toBeDefined();
    await act(async () => control!.click());
}

test("prompt rebuilding uses the currently edited appearance and composed style without saving or generating", async () => {
    const rebuilt = spyOn(api, "rebuildDramaCastImagePrompt").mockResolvedValue({ imagePrompt: "已编排：3D 都市，白色风衣" });
    const save = spyOn(api, "updateDramaCastLook").mockResolvedValue({ look: evening, affectedSegments: 0 });
    const generation = spyGeneration();
    const changed = mock();
    await render(<ImageFieldsHarness initial={{ imagePrompt: "手写原提示词" }} onChange={changed} />);
    await fill("当前外观", "白色风衣，短发，银色耳饰");
    await enableOwnStyle();
    await chooseAxis("表现形式", "3d");
    await chooseAxis("题材", "urban");
    const style = findDramaStyle(composeDramaStyleId("3d", "urban"))!;
    expect(rebuilt).not.toHaveBeenCalled();
    await click("重新编排提示词");
    expect(rebuilt).toHaveBeenCalledWith("current", evening.id, { appearance: "白色风衣，短发，银色耳饰", imageStyleId: style.id, imageStyleName: style.name, imageStylePrompt: style.prompt });
    expect(changed).toHaveBeenLastCalledWith({ imagePrompt: "已编排：3D 都市，白色风衣" });
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="参考图生成提示词"]')?.value).toBe("已编排：3D 都市，白色风衣");
    expect(save).not.toHaveBeenCalled();
    expectNoGeneration(generation);
});

test("failed prompt rebuilding retains the user's current input", async () => {
    const style = findDramaStyle(composeDramaStyleId("2d", "xuanhuan"))!;
    const rebuilt = spyOn(api, "rebuildDramaCastImagePrompt").mockRejectedValue(new Error("编排暂时不可用"));
    const changed = mock();
    await render(<ImageFieldsHarness initial={{ imagePrompt: "初始提示词", imageStyleId: style.id, imageStyleName: style.name, imageStylePrompt: style.prompt }} onChange={changed} />);
    await fill("参考图生成提示词", "保留我手工输入的服装和表情");
    const changesBefore = changed.mock.calls.length;
    await click("重新编排提示词");
    expect(rebuilt).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(changesBefore);
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="参考图生成提示词"]')?.value).toBe("保留我手工输入的服装和表情");
    expect(button("重新编排提示词").disabled).toBe(false);
});

test("an outdated rebuild response does not overwrite input after appearance changes", async () => {
    let resolve!: (value: { imagePrompt: string }) => void;
    const rebuilt = spyOn(api, "rebuildDramaCastImagePrompt").mockReturnValue(
        new Promise((done) => {
            resolve = done;
        }),
    );
    const changed = mock();
    await render(<ImageFieldsHarness initial={{ imagePrompt: "原有手工提示词" }} onChange={changed} overrideAppearance="旧外观" />);
    await click("重新编排提示词");
    expect(rebuilt).toHaveBeenCalledTimes(1);
    await render(<ImageFieldsHarness initial={{ imagePrompt: "原有手工提示词" }} onChange={changed} overrideAppearance="新外观" />);
    await act(async () => resolve({ imagePrompt: "基于旧外观的过期提示词" }));
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="参考图生成提示词"]')?.value).toBe("原有手工提示词");
});
