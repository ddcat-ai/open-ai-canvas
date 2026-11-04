import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { Dispatch, SetStateAction } from "react";
import type { EcommerceDraft, EcommerceReferenceMode, EcommerceReferenceScreen } from "../src/services/api/ecommerce";
import type { CommerceImageTransfer } from "../src/pages/ecommerce/image-transfer";

const dom = new Window({ url: "https://commerce.example.com/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    location: dom.location,
    DOMParser: dom.DOMParser,
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
const { emptyEcommerceDraft } = await import("../src/services/api/ecommerce");
const { ReferenceModePanel, ReferenceScreenSummary } = await import("../src/pages/ecommerce/reference-mode-panel");
const { mockEcommerceImageDelivery } = await import("./helpers/ecommerce-media-fixture");
beforeEach(() => mockEcommerceImageDelivery());
let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let current: EcommerceDraft;
let update: Dispatch<SetStateAction<EcommerceDraft>>;
let patches: Partial<EcommerceDraft>[];
let uploadAction: ((source: CommerceImageTransfer, mode: EcommerceReferenceMode) => Promise<void>) | undefined;
let uploads: Array<{ source: CommerceImageTransfer; mode: EcommerceReferenceMode }>;

function Harness({ initial, uploading = false }: { initial: EcommerceDraft; uploading?: boolean }) {
    const [draft, setDraft] = useState(initial);
    current = draft;
    update = setDraft;
    return (
        <ReferenceModePanel
            draft={draft}
            uploading={uploading}
            onUpload={async (source, mode) => {
                uploads.push({ source, mode });
                await uploadAction?.(source, mode);
            }}
            onChange={(patch) => {
                patches.push(patch);
                setDraft((value) => ({ ...value, ...patch }));
            }}
        />
    );
}
async function render(initial: Partial<EcommerceDraft> = {}, options: { uploading?: boolean; onUpload?: typeof uploadAction } = {}) {
    patches = [];
    uploads = [];
    uploadAction = options.onUpload;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(<Harness initial={{ ...emptyEcommerceDraft(), ...initial }} uploading={options.uploading} />);
    });
}
async function select(optionText: string) {
    const input = host.querySelector<HTMLElement>('[aria-label="参考方式"]')!;
    await act(async () => {
        input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((entry) => entry.textContent?.trim() === optionText);
    expect(option).toBeDefined();
    await act(async () => {
        option!.click();
    });
}
async function pickFiles(...files: File[]) {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(input.value).toBe("");
}
async function removeReference(name: string) {
    const button = host.querySelector<HTMLButtonElement>(`[aria-label="移除${name}"]`)!;
    expect(button).not.toBeNull();
    await act(async () => {
        button.click();
    });
}
function transfer(files: File[], data: Record<string, string> = {}) {
    return { files, items: [], types: [...(files.length ? ["Files"] : []), ...Object.keys(data)], getData: (type: string) => data[type] || "" } as unknown as DataTransfer;
}
async function sendTransfer(type: "dragenter" | "drop" | "paste", value: DataTransfer) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value });
    await act(async () => {
        host.querySelector(".ecommerce-reference-upload")!.dispatchEvent(event);
    });
    return event;
}
const imageFile = (name: string) => new File(["image"], name, { type: "image/png" });
const galleryImages = () => Array.from(host.querySelectorAll<HTMLImageElement>(".ecommerce-reference-gallery img")).map((image) => image.alt);

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    host?.remove();
    mock.restore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("电商独立借鉴图片区", () => {
    test("默认自主策划只说明使用上方商品图，不提供第二上传入口或自动迁移素材", async () => {
        await render({
            referenceMode: undefined,
            references: [
                { resourceId: "product", role: "primary", name: "自己的商品.png" },
                { resourceId: "legacy-style", role: "style", name: "旧风格图.png" },
            ],
            layoutReferences: [{ resourceId: "layout", role: "style", name: "借鉴图.png" }],
        });
        expect(host.textContent).toContain("商品自主策划");
        expect(host.textContent).toContain("上方“自己的商品图”");
        expect(host.querySelector('input[type="file"]')).toBeNull();
        expect(host.querySelector("img")).toBeNull();
        expect(patches).toEqual([]);
    });
    for (const [mode, label] of [
        ["style", "风格与排版参考图"],
        ["detail", "逐屏参考长图"],
    ] as const) {
        test(`${label}点击打开多选文件入口，逐张传入同一参考方式`, async () => {
            await render({ referenceMode: mode });
            const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
            const click = spyOn(input, "click").mockImplementation(() => {});
            await act(async () => {
                host.querySelector<HTMLButtonElement>(`[aria-label="上传${label}"]`)!.click();
            });
            expect(click).toHaveBeenCalledTimes(1);
            expect(input.multiple).toBe(true);
            expect(input.accept).toContain("image/png");
            const first = imageFile("参考1.png");
            const second = imageFile("参考2.png");
            await pickFiles(first, second);
            expect(uploads).toEqual([
                { source: { files: [first] }, mode },
                { source: { files: [second] }, mode },
            ]);
            expect(host.querySelector(".ecommerce-reference-upload")?.getAttribute("aria-busy")).toBe("false");
        });
    }
    test("下方只按layoutReferences顺序展示借鉴图，商品与旧混合素材都不进入候选", async () => {
        await render({
            referenceMode: "style",
            references: [
                { resourceId: "product", role: "primary", name: "自己的商品.png" },
                { resourceId: "legacy", role: "style", name: "旧混合图片.png" },
            ],
            layoutReferences: [
                { resourceId: "second", role: "competitor", name: "先上传.png" },
                { resourceId: "first", role: "style", name: "后上传.png" },
            ],
        });
        expect(galleryImages()).toEqual(["先上传.png", "后上传.png"]);
        expect(host.textContent).not.toContain("自己的商品.png");
        expect(host.textContent).not.toContain("旧混合图片.png");
        expect(host.textContent).not.toContain("从已上传图片中选择");
        expect(host.querySelector('[aria-label="参考来源"]')).toBeNull();
        expect(host.textContent).toContain("全部按上传顺序使用");
        expect(host.textContent).toContain("继续添加风格与排版参考图");
        expect(patches).toEqual([]);
    });
    test("没有借鉴图时不把单张商品长图兜底为下方参考", async () => {
        await render({ referenceMode: "detail", layoutReferenceId: "product-long", references: [{ resourceId: "product-long", role: "primary", name: "自己的长图.png" }], layoutReferences: [] });
        expect(host.querySelector("img")).toBeNull();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("请在这里上传需要借鉴的图片");
        expect(host.textContent).not.toContain("自己的长图.png");
        expect(current.layoutReferences).toEqual([]);
        expect(patches).toEqual([]);
    });
    test("批量拖入、图片粘贴与站内资源粘贴均调用图片传输入口，普通文字不拦截", async () => {
        await render({ referenceMode: "detail" });
        const first = imageFile("参考1.png");
        const second = imageFile("参考2.png");
        const value = transfer([first, second]);
        expect((await sendTransfer("dragenter", value)).defaultPrevented).toBe(true);
        expect(host.querySelector(".ecommerce-reference-upload")?.classList.contains("is-dragging")).toBe(true);
        expect((await sendTransfer("drop", value)).defaultPrevented).toBe(true);
        expect(host.querySelector(".ecommerce-reference-upload")?.classList.contains("is-dragging")).toBe(false);
        await sendTransfer("paste", transfer([first]));
        const pasted = await sendTransfer("paste", transfer([], { "application/x-yingce-image-resource": JSON.stringify({ resourceId: "owned-reference", name: "已有长图" }) }));
        expect(pasted.defaultPrevented).toBe(true);
        expect(uploads).toEqual([
            { source: { files: [first] }, mode: "detail" },
            { source: { files: [second] }, mode: "detail" },
            { source: { files: [first] }, mode: "detail" },
            { source: { files: [], resourceId: "owned-reference", name: "已有长图" }, mode: "detail" },
        ]);
        expect((await sendTransfer("paste", transfer([], { "text/plain": "普通说明文字" }))).defaultPrevented).toBe(false);
        expect(uploads).toHaveLength(4);
    });
    test("借鉴图使用真实文件名或友好名称，不显示UUID，图片加载失败仍可移除", async () => {
        const opaque = "3f279146-3cab-42fc-8e9e-b0eb2a9b776b";
        await render({
            referenceMode: "detail",
            layoutReferences: [
                { resourceId: "named", role: "style", name: "耳机参考.png" },
                { resourceId: opaque, role: "style", name: `${opaque}.png` },
            ],
        });
        expect(galleryImages()).toEqual(["耳机参考.png", "详情长图 2"]);
        expect(host.textContent).not.toContain(opaque);
        const card = host.querySelector('[aria-label="移除详情长图 2"]')!.parentElement!;
        expect(card.querySelector("img")?.getAttribute("src")).toContain(`/resources/${opaque}/file`);
        await act(async () => {
            card.querySelector("img")!.dispatchEvent(new Event("error"));
        });
        expect(card.querySelector("img")).toBeNull();
        expect(card.querySelector('[aria-label="图片暂不可用"]')).not.toBeNull();
        await removeReference("详情长图 2");
        expect(current.layoutReferences?.map((item) => item.resourceId)).toEqual(["named"]);
    });
    test("移除单张只更新借鉴数组，商品图与其顺序保持不变", async () => {
        const products: EcommerceDraft["references"] = [{ resourceId: "product", role: "primary", name: "自己的商品.png" }];
        await render({
            referenceMode: "style",
            references: products,
            layoutReferences: [
                { resourceId: "one", role: "style", name: "第一张.png" },
                { resourceId: "two", role: "style", name: "第二张.png" },
            ],
        });
        await removeReference("第一张.png");
        expect(current.references).toBe(products);
        expect(current.layoutReferences?.map((reference) => reference.resourceId)).toEqual(["two"]);
        expect(patches).toEqual([{ layoutReferences: [{ resourceId: "two", role: "style", name: "第二张.png" }] }]);
        await removeReference("第二张.png");
        expect(current.layoutReferences).toEqual([]);
        expect(current.references).toBe(products);
        expect(host.querySelector("img")).toBeNull();
        expect(host.textContent).toContain("请在这里上传需要借鉴的图片");
    });
    test("切换参考方式和重建组件保留多张借鉴图，逐屏模式写回详情类型", async () => {
        await render({
            count: 3,
            layoutReferences: [
                { resourceId: "a", role: "style", name: "第一张.png" },
                { resourceId: "b", role: "style", name: "第二张.png" },
            ],
        });
        await select("长图详情页逐屏参考");
        expect(current.referenceMode).toBe("detail");
        expect(current.imageType).toBe("detail");
        expect(current.count).toBe(3);
        expect(current.layoutReferenceId).toBeUndefined();
        expect(galleryImages()).toEqual(["第一张.png", "第二张.png"]);
        const saved = JSON.parse(JSON.stringify(current)) as EcommerceDraft;
        await act(async () => {
            root!.render(<Harness key="restored" initial={saved} />);
        });
        expect(galleryImages()).toEqual(["第一张.png", "第二张.png"]);
        await select("商品自主策划");
        expect(host.querySelector('input[type="file"]')).toBeNull();
        expect(current.layoutReferences).toHaveLength(2);
        await select("参考风格与排版");
        expect(galleryImages()).toEqual(["第一张.png", "第二张.png"]);
        expect(host.textContent).toContain("未经核实的规格");
    });
    test("批量部分失败保留成功图片，只重试失败文件，不重传成功图", async () => {
        let failing = true;
        const products: EcommerceDraft["references"] = [{ resourceId: "product", role: "primary", name: "自己的商品.png" }];
        await render(
            { referenceMode: "style", references: products, layoutReferences: [{ resourceId: "existing", role: "style", name: "已有参考.png" }] },
            {
                onUpload: async (source) => {
                    const file = source.files[0];
                    if (file.name === "失败.png" && failing) throw new Error("网络错误");
                    update((draft) => ({ ...draft, layoutReferences: [...(draft.layoutReferences || []), { resourceId: `uploaded-${file.name}`, role: "style", name: file.name }] }));
                },
            },
        );
        const first = imageFile("成功1.png");
        const failed = imageFile("失败.png");
        const third = imageFile("成功3.png");
        await pickFiles(first, failed, third);
        expect(uploads.map((item) => item.source.files[0])).toEqual([first, failed, third]);
        expect(galleryImages()).toEqual(["已有参考.png", "成功1.png", "成功3.png"]);
        expect(current.references).toBe(products);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("已添加 2 张，1 张图片未添加");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("失败.png：网络错误");
        failing = false;
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".ecommerce-reference-upload-error button")!.click();
        });
        expect(uploads.map((item) => item.source.files[0])).toEqual([first, failed, third, failed]);
        expect(galleryImages()).toEqual(["已有参考.png", "成功1.png", "成功3.png", "失败.png"]);
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    test("批次处理中显示进度并锁定切换、移除和重复提交，完成首张后继续下一张", async () => {
        let resolveFirst!: () => void;
        await render(
            { referenceMode: "style", layoutReferences: [{ resourceId: "existing", role: "style", name: "参考图.png" }] },
            {
                onUpload: () =>
                    uploads.length === 1
                        ? new Promise((resolve) => {
                              resolveFirst = resolve;
                          })
                        : Promise.resolve(),
            },
        );
        const first = imageFile("第一张.png");
        const second = imageFile("第二张.png");
        await pickFiles(first, second);
        expect(uploads).toHaveLength(1);
        expect(host.querySelector('[role="status"]')?.textContent).toContain("正在添加 1/2 · 第一张.png");
        expect(host.querySelector(".ant-select-disabled")).not.toBeNull();
        expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('[aria-label="移除参考图.png"]')?.disabled).toBe(true);
        await sendTransfer("drop", transfer([first]));
        expect(uploads).toHaveLength(1);
        await act(async () => {
            resolveFirst();
        });
        expect(uploads.map((entry) => entry.source.files[0])).toEqual([first, second]);
        expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
    });
    test("成功上传后空拖入只提示当前错误，不重试之前成功的图片", async () => {
        await render({ referenceMode: "style" });
        await pickFiles(imageFile("成功.png"));
        await sendTransfer("drop", transfer([]));
        expect(uploads).toHaveLength(1);
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("没有读取到图片");
        expect(host.querySelector(".ecommerce-reference-upload-error button")).toBeNull();
    });
    test("移除借鉴图或切换模式后清理失败上传的重试内容", async () => {
        await render(
            { referenceMode: "style", layoutReferences: [{ resourceId: "existing", role: "style", name: "原参考.png" }] },
            {
                onUpload: async () => {
                    throw new Error("本次上传失败");
                },
            },
        );
        await pickFiles(imageFile("失败.png"));
        expect(host.querySelector(".ecommerce-reference-upload-error button")).not.toBeNull();
        await removeReference("原参考.png");
        expect(host.querySelector('[role="alert"]')).toBeNull();
        await sendTransfer("drop", transfer([]));
        expect(host.querySelector(".ecommerce-reference-upload-error button")).toBeNull();
        await pickFiles(imageFile("再次失败.png"));
        await select("长图详情页逐屏参考");
        expect(host.querySelector('[role="alert"]')).toBeNull();
    });
    test("页面已在上传时禁用下方所有写入口，拖拽与粘贴均不重复提交", async () => {
        await render({ referenceMode: "detail", layoutReferences: [{ resourceId: "existing", role: "style", name: "参考图.png" }] }, { uploading: true });
        expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('[aria-label="上传逐屏参考长图"]')?.disabled).toBe(true);
        expect(host.querySelector<HTMLButtonElement>('[aria-label="移除参考图.png"]')?.disabled).toBe(true);
        expect(host.querySelector(".ant-select-disabled")).not.toBeNull();
        await sendTransfer("drop", transfer([imageFile("长图.png")]));
        await sendTransfer("paste", transfer([imageFile("长图.png")]));
        expect(uploads).toEqual([]);
    });
    for (const failed of [false, true]) {
        test(`切换项目后停止旧批次剩余文件，旧请求${failed ? "失败" : "成功"}不影响新卡`, async () => {
            let finish!: () => void;
            await render(
                { referenceMode: "detail" },
                {
                    onUpload: () =>
                        new Promise((resolve, reject) => {
                            finish = () => (failed ? reject(new Error("旧项目上传失败")) : resolve());
                        }),
                },
            );
            await pickFiles(imageFile("旧项目1.png"), imageFile("旧项目2.png"));
            await act(async () => {
                root!.render(<Harness key="next-project" initial={{ ...emptyEcommerceDraft(), referenceMode: "style", layoutReferences: [{ resourceId: "new", role: "style", name: "新项目参考.png" }] }} />);
            });
            expect(host.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
            await act(async () => {
                finish();
            });
            expect(host.querySelector('[role="alert"]')).toBeNull();
            expect(galleryImages()).toEqual(["新项目参考.png"]);
            expect(uploads).toHaveLength(1);
            expect(patches).toEqual([]);
        });
    }
    test("方案卡保留逐屏识别和原文，裁切图失败仍展示内容", async () => {
        await render();
        const screen: EcommerceReferenceScreen = {
            sourceResourceId: "long",
            resourceId: "screen-crop",
            screenIndex: 2,
            top: 0.12,
            bottom: 0.27,
            content: "佩戴场景与细节说明",
            layout: "上方标题，右侧说明",
            visual: "产品居中并配局部放大",
            sourceCopy: "参考文案原文\n已核实后才可使用",
        };
        await act(async () => {
            root!.render(<ReferenceScreenSummary screen={screen} />);
        });
        expect(host.querySelector('[aria-label="原长图第 2 屏识别"]')).not.toBeNull();
        expect(host.textContent).toContain(screen.content);
        expect(host.textContent).toContain(screen.layout);
        expect(host.textContent).toContain(screen.visual);
        expect(host.querySelector("details")?.textContent).toContain(screen.sourceCopy);
        expect(host.querySelector("img")?.getAttribute("src")).toContain("/resources/screen-crop/file");
        await act(async () => {
            host.querySelector("img")!.dispatchEvent(new Event("error"));
        });
        expect(host.querySelector("img")).toBeNull();
        expect(host.textContent).toContain(screen.content);
    });
});
