import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { FormInstance } from "antd";
import type { ChannelModelFormValues } from "../../src/pages/admin/components/channel-model-editor-form";
import type { ModelProtocolDefinition } from "../../src/lib/model-protocols";
import type { ChannelModel } from "../../src/services/api/wallet";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of ["HTMLBodyElement", "HTMLHtmlElement"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: (dom as any)[key] });
}
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Node: dom.Node,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider, Form } = await import("antd");
const { CapabilityTemplatePanel, PricingTemplatePanel } = await import("../../src/pages/admin/components/channel-model-template-panels");
const { PriceTierFields } = await import("../../src/pages/admin/components/channel-model-price-tier-fields");
const { duplicateChannelModelValues, initialChannelModelValues, validateChannelModelPrices } = await import("../../src/pages/admin/components/channel-model-editor-form");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { defaultPriceTier, priceTierPayloadFromForm } = await import("../../src/pages/admin/components/channel-model-price-tier-form");
const { readPricingTemplates, savePricingTemplate, pricingTemplatesKey } = await import("../../src/pages/admin/components/saved-pricing-templates");
const { readCapabilityTemplates, saveCapabilityTemplate, capabilityTemplatesKey, templateCapabilityForModel } = await import("../../src/pages/admin/components/saved-capability-templates");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
beforeEach(() => {
    dom.localStorage.clear();
    setActiveUserScope("template-test");
    useUserStore.getState().setUser({ id: "template-test", username: "test", displayName: "test", role: "admin", status: "active" });
});
const manifest = await Bun.file(new URL("../../../plugin-packages/openai-images/manifest.json", import.meta.url)).json();
const protocols: ModelProtocolDefinition[] = [
    { value: "openai-image", capability: "image", label: "OpenAI Images", create: "POST /images", contentType: "application/json", media: "image", imageParameters: manifest.contributes.providers[0].imageParameters },
];

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function button(text: string) {
    const aliases: Record<string, string> = { 新增模板: "新增积分模板", 编辑模板: "编辑积分模板", 将当前配置保存为模板: "将当前积分配置保存为模板" };
    const label = aliases[text] || text;
    const found = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""));
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
}
async function click(text: string) {
    await act(async () => {
        button(text).click();
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
}
async function choose(label: string, option: string) {
    const input = document.querySelector(`input[aria-label="${label}"]`)!;
    expect(input).toBeTruthy();
    await act(async () => input.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const item = [...document.querySelectorAll(".ant-select-item-option")].find((node) => node.textContent === option || node.textContent === `${option}（内置）`);
    expect(item).toBeTruthy();
    await act(async () => (item as HTMLElement).click());
}
const draft = (): ChannelModelFormValues => ({
    ...initialChannelModelValues(null, protocols),
    capability: "image",
    protocol: "openai-image",
    modelKey: "gpt-image-2",
    providerModelKey: "gpt-image-2",
    priceCurrency: "USD",
    capabilityConfig: defaultModelCapabilityConfig("openai-image", "gpt-image-2"),
    priceTiers: [{ ...defaultPriceTier(), unitPrice: 17, costConfigured: true, costUnitPrice: 3, cacheWriteTokenPrice: 9 }],
});

async function mount(values = draft(), catalog = protocols) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let form!: FormInstance<ChannelModelFormValues>;
    let dirty = 0;
    function EditorSections() {
        [form] = Form.useForm<ChannelModelFormValues>();
        const capability = Form.useWatch("capability", { form, preserve: true }) || values.capability;
        const profile = Form.useWatch("capabilityConfig", { form, preserve: true }) || values.capabilityConfig;
        return (
            <Form form={form} initialValues={values}>
                <CapabilityTemplatePanel
                    form={form}
                    protocols={catalog}
                    onApplied={() => {
                        dirty++;
                    }}
                />
                <PricingTemplatePanel
                    form={form}
                    onApplied={() => {
                        dirty++;
                    }}
                />
                <Form.List name="priceTiers">
                    {(fields) =>
                        fields.map((field) => (
                            <PriceTierFields
                                key={field.key}
                                index={field.name}
                                ordinal={field.name + 1}
                                form={form}
                                capability={capability}
                                protocol={values.protocol}
                                capabilityConfig={profile}
                                modelUpstream={values.modelKey}
                                onDirty={() => {
                                    dirty++;
                                }}
                                onRemove={() => {}}
                            />
                        ))
                    }
                </Form.List>
            </Form>
        );
    }
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <EditorSections />
                </App>
            </ConfigProvider>,
        ),
    );
    return {
        form,
        host,
        dirty: () => dirty,
        close: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("真实模板面板：选择不改草稿，明确应用、手改和撤销仅影响能力字段", async () => {
    const values = draft();
    values.capabilityConfig!.image!.references.maxImages = 3;
    const fixture = await mount(values);
    try {
        const before = structuredClone(fixture.form.getFieldsValue(true));
        await choose("选择能力模板", "GPT Image · OpenAI Images");
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
        expect(fixture.dirty()).toBe(0);
        await click("应用能力模板");
        expect(fixture.form.getFieldValue(["capabilityConfig", "image", "parameters"]).length).toBeGreaterThan(0);
        expect(fixture.form.getFieldValue("priceTiers")).toEqual(before.priceTiers);
        await act(async () => fixture.form.setFieldValue(["capabilityConfig", "image", "references", "maxImages"], 8));
        expect(fixture.form.getFieldValue(["capabilityConfig", "image", "references", "maxImages"])).toBe(8);
        await click("撤销能力模板");
        expect(fixture.form.getFieldValue("capabilityConfig")).toEqual(before.capabilityConfig);
        expect(fixture.form.getFieldValue("priceTiers")).toEqual(before.priceTiers);
    } finally {
        await fixture.close();
    }
});

test("真实定价面板：当前配置保存、编辑不影响模型，应用和撤销保留完整价格", async () => {
    const fixture = await mount();
    try {
        const before = structuredClone(fixture.form.getFieldsValue(true));
        await click("将当前配置保存为模板");
        await inputValue('input[aria-label="积分模板名称"]', "实际价格");
        await click("保存模板");
        expect(readPricingTemplates("template-test")[0].pricing).toMatchObject({ priceCurrency: "USD", priceTiers: [{ unitPrice: 17, costUnitPrice: 3 }] });
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
        await click("编辑模板");
        await inputValue('input[aria-label="积分模板名称"]', "改名价格");
        await inputValue('input[id="pricing-template_priceTiers_0_unitPrice"]', "29");
        await click("保存模板");
        expect(readPricingTemplates("template-test")[0]).toMatchObject({ name: "改名价格", pricing: { priceTiers: [{ unitPrice: 29 }] } });
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
        await click("应用定价模板");
        expect(fixture.form.getFieldValue("priceTiers")[0]).toMatchObject({ unitPrice: 29, costUnitPrice: 3 });
        expect(fixture.form.getFieldValue("capabilityConfig")).toEqual(before.capabilityConfig);
        await click("撤销定价模板");
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
    } finally {
        await fixture.close();
    }
});

test("能力模板：保存当前、编辑、取消及另一模型应用只修改草稿", async () => {
    const values = draft();
    values.capabilityConfig!.image!.references.maxImageBytes = 10 * 1024 * 1024;
    const fixture = await mount(values);
    try {
        const before = structuredClone(fixture.form.getFieldsValue(true));
        await click("将当前能力保存为模板");
        await inputValue('input[aria-label="能力模板名称"]', "十兆图片");
        await click("保存");
        expect(readCapabilityTemplates("template-test")[0].config.capabilityConfig!.image!.references.maxImageBytes).toBe(10 * 1024 * 1024);
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
        await click("编辑能力模板");
        await inputValue('input[aria-label="能力模板名称"]', "改名能力");
        await click("保存");
        expect(readCapabilityTemplates("template-test")[0].name).toBe("改名能力");
        await click("编辑能力模板");
        await inputValue('input[aria-label="能力模板名称"]', "取消编辑");
        await click("取消");
        expect(readCapabilityTemplates("template-test")[0].name).toBe("改名能力");
    } finally {
        await fixture.close();
    }
    const other = await mount({ ...draft(), protocol: "other-image", modelKey: "gpt-image-other", providerModelKey: "gpt-image-other" }, [{ ...protocols[0], value: "other-image" }]);
    try {
        const before = structuredClone(other.form.getFieldsValue(true));
        await choose("选择能力模板", "改名能力");
        expect(other.form.getFieldsValue(true)).toEqual(before);
        await click("应用能力模板");
        expect(other.form.getFieldValue("protocol")).toBe("other-image");
        expect(other.form.getFieldValue(["capabilityConfig", "image", "references", "maxImageBytes"])).toBe(10 * 1024 * 1024);
        expect(other.form.getFieldValue("modelKey")).toBe("gpt-image-other");
        expect(other.form.getFieldValue("priceTiers")).toEqual(before.priceTiers);
        await click("撤销能力模板");
        expect(other.form.getFieldsValue(true)).toEqual(before);
    } finally {
        await other.close();
    }
});

test("视频能力模板：引用卡片独立滚动区与数量、大小、时长保存应用", async () => {
    const values = { ...draft(), capability: "video" as const, protocol: "agnes-video", capabilityConfig: defaultModelCapabilityConfig("agnes-video", "agnes-video-2.5") };
    const fixture = await mount(values, [{ ...protocols[0], value: "agnes-video", capability: "video", imageParameters: undefined }]);
    try {
        await click("将当前能力保存为模板");
        await inputValue('input[aria-label="能力模板名称"]', "视频引用限制");
        const content = document.querySelector(".admin-capability-template-content")!;
        expect(content).toBeTruthy();
        expect(content.querySelectorAll(".admin-capability-reference-card")).toHaveLength(4);
        expect(content.querySelectorAll(".admin-model-editor-modal")).toHaveLength(0);
        for (const [label, value] of [
            ["最大图片引用", "1"],
            ["单张图片上限 MB", "10"],
            ["最大视频引用", "2"],
            ["单个视频上限 MB", "25"],
            ["单个视频最长秒数", "8"],
            ["最大音频引用", "1"],
            ["单个音频上限 MB", "12"],
            ["单个音频最长秒数", "9"],
        ]) {
            const field = [...content.querySelectorAll("label.admin-capability-number-field")].find((node) => node.textContent?.includes(label))!;
            expect(field).toBeTruthy();
            const input = field.querySelector("input")!;
            input.setAttribute("data-template-test", label);
            await inputValue(`input[data-template-test="${label}"]`, value);
        }
        await click("保存");
        const saved = readCapabilityTemplates("template-test")[0].config.capabilityConfig!.video!.references;
        expect(saved).toMatchObject({ maxImages: 1, maxImageBytes: 10 * 1024 * 1024, maxVideos: 2, maxVideoBytes: 25 * 1024 * 1024, maxVideoDurationSeconds: 8, maxAudios: 1, maxAudioBytes: 12 * 1024 * 1024, maxAudioDurationSeconds: 9 });
        await click("应用能力模板");
        expect(fixture.form.getFieldValue(["capabilityConfig", "video", "references"])).toEqual(saved);
        expect(fixture.form.getFieldValue("protocol")).toBe("agnes-video");
    } finally {
        await fixture.close();
    }
});

test("历史模板忽略旧协议且读取不回写，离线编辑保留能力并以无协议格式保存", async () => {
    const values = draft();
    values.capabilityConfig!.image!.parameters = [{ name: "customQuality", label: "自定义质量", type: "string", values: ["fine"], default: "fine", pricing: true }];
    const old = { id: "legacy", revision: "legacy-rev", name: "旧能力", capability: "image", config: { protocol: "removed-plugin", capabilityConfig: values.capabilityConfig } };
    const raw = JSON.stringify({ version: 1, templates: [old] });
    dom.localStorage.setItem(capabilityTemplatesKey("template-test"), raw);
    const [loaded] = readCapabilityTemplates("template-test");
    expect(loaded).toMatchObject({ id: "legacy", revision: "legacy-rev", name: "旧能力", capability: "image" });
    expect(Object.keys(loaded.config)).toEqual(["capabilityConfig"]);
    expect(dom.localStorage.getItem(capabilityTemplatesKey("template-test"))).toBe(raw);
    const fixture = await mount(draft(), []);
    try {
        await choose("选择能力模板", "旧能力");
        await click("编辑能力模板");
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("自定义质量");
        expect(document.querySelector('[aria-label="能力模板协议"]')).toBeNull();
        await inputValue('input[aria-label="能力模板名称"]', "更新旧能力");
        await click("保存");
        const [saved] = readCapabilityTemplates("template-test");
        expect(saved.id).toBe(old.id);
        expect(saved.revision).not.toBe(old.revision);
        expect(saved.config).toEqual(loaded.config);
        expect(dom.localStorage.getItem(capabilityTemplatesKey("template-test"))).not.toContain('"protocol"');
    } finally {
        await fixture.close();
    }
});

test("应用内置模板后切换协议，撤销仅恢复能力而保留新的协议", async () => {
    const fixture = await mount();
    try {
        const original = structuredClone(fixture.form.getFieldValue("capabilityConfig"));
        await choose("选择能力模板", "Nano Banana · Gemini Image");
        await click("应用能力模板");
        expect(fixture.form.getFieldValue("protocol")).toBe("openai-image");
        await act(async () => fixture.form.setFieldValue("protocol", "manual-image"));
        await click("撤销能力模板");
        expect(fixture.form.getFieldValue("protocol")).toBe("manual-image");
        expect(fixture.form.getFieldValue("capabilityConfig")).toEqual(original);
    } finally {
        await fixture.close();
    }
});

test("无协议模板可移除后加回分辨率、缩小后扩大数量，保存重开仍可扩大", async () => {
    const values = draft();
    values.capabilityConfig!.image!.parameters = [
        { name: "imageResolution", label: "分辨率", type: "string", binding: "resolution", values: ["1k", "2k", "4k"], default: "1k", pricing: true },
        { name: "count", label: "生成数量", type: "integer", binding: "imageCount", min: 1, max: 4, step: 1, default: 1 },
    ];
    saveCapabilityTemplate("template-test", "可扩展能力", values);
    const fixture = await mount();
    const fourK = () => [...document.querySelectorAll('[role="dialog"] [aria-label="分辨率快捷选择"] button')].find((node) => node.textContent === "4K") as HTMLButtonElement;
    const setMaximum = async (value: string) => {
        await inputValue('[role="dialog"] input[aria-label="生成数量最大值"]', value);
        await act(async () => document.querySelector('[role="dialog"] input[aria-label="生成数量最大值"]')!.dispatchEvent(new dom.FocusEvent("focusout", { bubbles: true })));
    };
    try {
        await choose("选择能力模板", "可扩展能力");
        await click("编辑能力模板");
        await act(async () => fourK().click());
        expect(fourK()).toBeTruthy();
        expect(fourK().getAttribute("aria-pressed")).toBe("false");
        await act(async () => fourK().click());
        expect(fourK().getAttribute("aria-pressed")).toBe("true");
        await setMaximum("2");
        await setMaximum("6");
        expect((document.querySelector('[aria-label="生成数量最大值"]') as HTMLInputElement).value).toBe("6");
        await act(async () => fourK().click());
        await setMaximum("2");
        await click("保存");
        const first = readCapabilityTemplates("template-test")[0].config.capabilityConfig!.image!.parameters!;
        expect(first.find((field) => field.name === "imageResolution")!.values).not.toContain("4k");
        expect(first.find((field) => field.name === "count")!.max).toBe(2);
        await click("编辑能力模板");
        expect(fourK().getAttribute("aria-pressed")).toBe("false");
        await act(async () => fourK().click());
        await setMaximum("8");
        await click("保存");
        const saved = readCapabilityTemplates("template-test")[0].config.capabilityConfig!.image!.parameters!;
        expect(saved.find((field) => field.name === "imageResolution")!.values).toContain("4k");
        expect(saved.find((field) => field.name === "count")!.max).toBe(8);
        expect(fixture.form.getFieldValue("capabilityConfig")).toEqual(draft().capabilityConfig);
    } finally {
        await fixture.close();
    }
});

test("能力模板：新增必须命名，复用能力表单而非修改模型", async () => {
    const fixture = await mount();
    try {
        const before = structuredClone(fixture.form.getFieldsValue(true));
        await click("新增能力模板");
        await click("保存");
        expect(document.body.textContent).toContain("模板名称须为");
        expect(readCapabilityTemplates("template-test")).toEqual([]);
        expect(document.querySelector('[aria-label="能力模板协议"]')).toBeNull();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("引用与限制");
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain("能力参数");
        await inputValue('input[aria-label="能力模板名称"]', "新能力");
        await click("保存");
        expect(readCapabilityTemplates("template-test")).toHaveLength(1);
        expect(fixture.form.getFieldsValue(true)).toEqual(before);
    } finally {
        await fixture.close();
    }
});

test("能力模板：账号隔离、旧版本编辑及损坏存储拒绝覆盖", () => {
    const first = saveCapabilityTemplate("template-test", "原能力", draft());
    saveCapabilityTemplate("template-test", "新能力", draft(), first);
    expect(() => saveCapabilityTemplate("template-test", "旧修改", draft(), first)).toThrow("已被修改");
    expect(readCapabilityTemplates("another-account")).toEqual([]);
    setActiveUserScope("another-account");
    expect(() => saveCapabilityTemplate("template-test", "串号", draft())).toThrow("账号已切换");
    setActiveUserScope("template-test");
    dom.localStorage.setItem(capabilityTemplatesKey("template-test"), "broken-json");
    expect(() => saveCapabilityTemplate("template-test", "覆盖", draft())).toThrow("数据无效");
    expect(dom.localStorage.getItem(capabilityTemplatesKey("template-test"))).toBe("broken-json");
});

test("能力模板：存储失败、凭据白名单和能力类型隔离", () => {
    const values = { ...draft(), apiKey: "fake-secret", capabilityConfig: { ...draft().capabilityConfig!, apiKey: "fake-nested-secret" } };
    const saved = saveCapabilityTemplate("template-test", "白名单", values);
    const before = dom.localStorage.getItem(capabilityTemplatesKey("template-test"));
    expect(before).not.toContain("fake-secret");
    expect(before).not.toContain("fake-nested-secret");
    expect(before).not.toContain("priceTiers");
    expect(before).not.toContain('"protocol"');
    expect(() => templateCapabilityForModel(saved, { capability: "video" })).toThrow("能力类型");
    expect(templateCapabilityForModel(saved, draft())).toEqual(saved.config);
    const descriptor = Object.getOwnPropertyDescriptor(dom, "localStorage")!;
    const storage = dom.localStorage;
    try {
        Object.defineProperty(dom, "localStorage", {
            configurable: true,
            value: {
                getItem: storage.getItem.bind(storage),
                setItem: () => {
                    throw new Error("quota");
                },
            },
        });
        expect(() => saveCapabilityTemplate("template-test", "失败", draft(), saved)).toThrow("未保存");
    } finally {
        Object.defineProperty(dom, "localStorage", descriptor);
    }
    expect(dom.localStorage.getItem(capabilityTemplatesKey("template-test"))).toBe(before);
});

test("能力模板保存只校验能力，目标模型的价格冲突仍阻止保存模型", () => {
    const values = draft();
    values.capabilityConfig!.image!.parameters = [{ name: "quality", label: "质量", type: "string", values: ["low"], pricing: true, default: "low" }];
    values.priceTiers = [{ ...defaultPriceTier("advanced"), imageSelector: { quality: "high" } }];
    expect(() => saveCapabilityTemplate("template-test", "独立能力", values)).not.toThrow();
    expect(readCapabilityTemplates("template-test")).toHaveLength(1);
    expect(() => validateChannelModelPrices(values)).toThrow("不受当前参数支持");
});
test("缺失插件时真实面板说明原因且无法应用", async () => {
    const fixture = await mount(draft(), []);
    try {
        expect(document.body.textContent).toContain("当前协议不可用，请先启用或选择协议");
        expect(button("应用能力模板").disabled).toBe(true);
    } finally {
        await fixture.close();
    }
});

test("真实定价面板：新增空模板、取消与重新打开，未展开任何组合档位", async () => {
    const fixture = await mount();
    try {
        await click("新增模板");
        await inputValue('input[aria-label="积分模板名称"]', "手动价格");
        await inputValue('input[id="pricing-template_priceTiers_0_unitPrice"]', "6");
        await click("保存模板");
        const templates = readPricingTemplates("template-test");
        expect(templates).toHaveLength(1);
        expect(templates[0].pricing.priceTiers).toHaveLength(1);
        expect(templates[0].pricing.priceTiers[0].unitPrice).toBe(6);
        expect(fixture.form.getFieldValue("priceTiers")[0].unitPrice).toBe(17);
        expect(document.body.textContent).not.toContain("选择计价维度");
        await click("编辑模板");
        await inputValue('input[aria-label="积分模板名称"]', "取消的名字");
        await click("取消");
        expect(readPricingTemplates("template-test")[0].name).toBe("手动价格");
    } finally {
        await fixture.close();
    }
    const reopened = await mount();
    try {
        await choose("选择定价模板", "手动价格");
        await click("应用定价模板");
        expect(reopened.form.getFieldValue("priceTiers")[0].unitPrice).toBe(6);
    } finally {
        await reopened.close();
    }
});
const { ChannelModelEditor } = await import("../../src/pages/admin/components/channel-model-editor");
const { AdminProvider } = await import("../../src/pages/admin/admin-context");
const { apiClient } = await import("../../src/services/api/request");
const { defaultTokenPriceRule } = await import("../../src/pages/admin/components/channel-model-price-tier-form");

test("积分模板：账号隔离、并发编辑及损坏存储不能覆盖原数据", () => {
    const first = savePricingTemplate("template-test", "原价格", draft());
    const edited = savePricingTemplate("template-test", "新价格", draft(), first);
    expect(edited.revision).not.toBe(first.revision);
    expect(() => savePricingTemplate("template-test", "过期修改", draft(), first)).toThrow("已被修改");
    expect(readPricingTemplates("another-account")).toEqual([]);
    setActiveUserScope("another-account");
    expect(() => savePricingTemplate("template-test", "跨账号", draft())).toThrow("账号已切换");
    setActiveUserScope("template-test");
    dom.localStorage.setItem(pricingTemplatesKey("template-test"), "broken-json");
    expect(() => savePricingTemplate("template-test", "覆盖", draft())).toThrow("数据无效");
    expect(dom.localStorage.getItem(pricingTemplatesKey("template-test"))).toBe("broken-json");
});

test("积分模板：存储写入失败不报告成功，模型信息不进入模板", () => {
    const values = { ...draft(), apiKey: "test-only-not-a-real-key" };
    values.priceTiers[0].providerModelKey = "other-upstream";
    const saved = savePricingTemplate("template-test", "价格", values);
    const before = dom.localStorage.getItem(pricingTemplatesKey("template-test"));
    expect(before).not.toContain("test-only-not-a-real-key");
    expect(before).not.toContain("other-upstream");
    const descriptor = Object.getOwnPropertyDescriptor(dom, "localStorage")!;
    const storage = dom.localStorage;
    try {
        Object.defineProperty(dom, "localStorage", {
            configurable: true,
            value: {
                getItem: storage.getItem.bind(storage),
                setItem: () => {
                    throw new Error("quota");
                },
            },
        });
        expect(() => savePricingTemplate("template-test", "失败价格", draft(), saved)).toThrow("未保存");
    } finally {
        Object.defineProperty(dom, "localStorage", descriptor);
    }
    expect(dom.localStorage.getItem(pricingTemplatesKey("template-test"))).toBe(before);
});

test("完整模型编辑器：模板包含模型不支持的质量，显示冲突并禁止保存", async () => {
    const { applyCapabilityTemplate } = await import("../../src/pages/admin/components/channel-model-templates");
    const source = applyCapabilityTemplate("gpt-image-openai-v1", draft());
    source.priceTiers = [{ ...defaultPriceTier("advanced"), imageSelector: { quality: "high" }, unitPrice: 4 }];
    savePricingTemplate("template-test", "高清价格", source);
    const target = structuredClone(source);
    target.priceTiers = [defaultPriceTier()];
    const quality = target.capabilityConfig!.image!.parameters!.find((field) => field.name === "quality")!;
    quality.values = ["low"];
    quality.default = "low";
    const fixture = await mountEditor(savedModel(target));
    try {
        await tab("积分定价");
        await choose("选择定价模板", "高清价格");
        await click("应用定价模板");
        expect(document.body.textContent).toContain("quality=high 不受当前参数支持");
        expect(button("保存修改").disabled).toBe(true);
        await click("保存修改");
        expect(fixture.saves).toHaveLength(0);
        await click("编辑模板");
        expect(button("保存模板").disabled).toBe(true);
        expect(readPricingTemplates("template-test")[0].pricing.priceTiers[0].imageSelector).toEqual({ quality: "high" });
    } finally {
        await fixture.close();
    }
});

async function inputValue(selector: string, value: string) {
    const input = document.querySelector(selector) as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.Event("input", { bubbles: true }));
        input.dispatchEvent(new dom.Event("change", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 10));
    });
}
async function tab(name: string) {
    const found = [...document.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name)!;
    expect(found).toBeTruthy();
    await act(async () => (found as HTMLElement).click());
}
async function mountEditor(editing: ChannelModel | null, catalog = protocols, draftValues?: ChannelModelFormValues, initialProtocolLoading = false) {
    const originalRequest = apiClient.request;
    const saves: any[] = [];
    const suggestions: Array<{ config: any; resolve(value: any): void }> = [];
    apiClient.request = (async (config: any) => {
        if (config.url.includes("protocol-suggestion")) return new Promise((resolve) => suggestions.push({ config, resolve: (data) => resolve({ status: 200, data: { code: 0, data } }) }));
        if (config.url.endsWith("/references")) return { status: 200, data: { code: 0, data: { channels: [], users: [] } } };
        if (["post", "put", "patch"].includes(config.method.toLowerCase())) saves.push(config.data);
        return { status: 200, data: { code: 0, data: {} } };
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let closed = 0;
    let protocolLoading = initialProtocolLoading;
    const render = () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <AdminProvider>
                        <ChannelModelEditor
                            channel={{ id: "test-channel", name: "测试 Key", baseUrl: "https://example.com/v1", apiKey: "", enabled: true, models: [] }}
                            editing={editing}
                            draftValues={draftValues}
                            protocols={catalog}
                            protocolLoading={protocolLoading}
                            protocolError=""
                            onRetryProtocols={() => {}}
                            onClose={() => {
                                closed++;
                            }}
                            onSaved={async () => {}}
                        />
                    </AdminProvider>
                </App>
            </ConfigProvider>,
        );
    await act(async () => render());
    return {
        saves,
        suggestions,
        setProtocolLoading: async (value: boolean) => {
            protocolLoading = value;
            await act(async () => render());
        },
        refreshEditing: async (value: ChannelModel) => {
            editing = value;
            await act(async () => render());
        },
        closed: () => closed,
        close: async () => {
            await act(async () => root.unmount());
            host.remove();
            apiClient.request = originalRequest;
        },
    };
}
function savedModel(values = draft()): ChannelModel {
    return {
        id: "model-1",
        channelId: "test-channel",
        ...values,
        billingMode: "fixed_request",
        unitPriceMicrocredits: 0,
        inputTokenPriceMicrocredits: 0,
        outputTokenPriceMicrocredits: 0,
        cachedTokenPriceMicrocredits: 0,
        priceConfigured: true,
        priceVersion: 1,
        createdAt: "",
        updatedAt: "",
        priceTiers: values.priceTiers.map((tier, index) => ({
            ...priceTierPayloadFromForm(values.capability, tier, values.modelKey, values.capabilityConfig),
            id: `tier-${index}`,
            channelModelId: "model-1",
            selectorKey: "{}",
            priceVersion: 1,
            createdAt: "",
            updatedAt: "",
        })),
    };
}

test("完整模型编辑器：模板实际金额与币种保存，能力及模型身份不变", async () => {
    const source = { ...draft(), priceCurrency: "CNY" as const };
    source.priceTiers[0].unitPrice = 29;
    savePricingTemplate("template-test", "人民币价格", source);
    const editing = savedModel();
    editing.updatedAt = "2026-11-10T01:00:00.000001Z";
    editing.priceVersion = 4;
    const fixture = await mountEditor(editing);
    try {
        await fixture.refreshEditing({ ...editing, updatedAt: "2026-11-10T02:00:00.000001Z", priceVersion: 5 });
        await tab("积分定价");
        await choose("选择定价模板", "人民币价格");
        await click("应用定价模板");
        expect(fixture.saves).toHaveLength(0);
        await click("保存修改");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0]).toMatchObject({
            modelKey: editing.modelKey,
            priceCurrency: "CNY",
            protocol: editing.protocol,
            protocolSelectionExplicit: false,
            expectedUpdatedAt: editing.updatedAt,
            expectedPriceVersion: 4,
            priceTiers: [{ unitPriceMicrocredits: 29_000_000, costPricing: { unitPriceMicrocredits: 3_000_000 } }],
        });
        expect(fixture.suggestions).toHaveLength(0);
        expect(fixture.closed()).toBe(1);
    } finally {
        await fixture.close();
    }
});
test("完整模型编辑器：无操作保存保留缓存写入、分时规则与成本字段，不刷新协议记忆", async () => {
    const values = { ...draft(), capability: "text" as const, protocol: "text-test", capabilityConfig: defaultModelCapabilityConfig("text-test") };
    values.priceTiers = [
        {
            ...defaultPriceTier(),
            billingMode: "token",
            inputTokenPrice: 3,
            outputTokenPrice: 7,
            cachedTokenPrice: 1,
            cacheWriteTokenPrice: 2,
            costConfigured: true,
            costInputTokenPrice: 0.5,
            costOutputTokenPrice: 1.5,
            costCachedTokenPrice: 0.2,
            costCacheWriteTokenPrice: 0.4,
            tokenRulesEnabled: true,
            tokenRules: [{ ...defaultTokenPriceRule(), cacheWriteTokenPrice: 4 }],
        },
    ];
    const editing = savedModel(values);
    const fixture = await mountEditor(editing, [{ ...protocols[0], capability: "text", value: "text-test", imageParameters: undefined }]);
    try {
        await click("保存修改");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0].priceTiers).toEqual(editing.priceTiers!.map(({ id, channelModelId, selectorKey, priceVersion, createdAt, updatedAt, ...tier }) => tier));
        expect(fixture.saves[0].protocolSelectionExplicit).toBe(false);
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：自动协议建议忽略旧响应，保存不会成为明确选择", async () => {
    const textProtocols: ModelProtocolDefinition[] = [
        { ...protocols[0], value: "text-a", label: "协议 A", capability: "text", imageParameters: undefined },
        { ...protocols[0], value: "text-b", label: "协议 B", capability: "text", imageParameters: undefined },
    ];
    const fixture = await mountEditor(null, textProtocols);
    try {
        await inputValue('input[id="modelKey"]', "model-a");
        expect(fixture.suggestions).toHaveLength(1);
        await inputValue('input[id="providerModelKey"]', "model-b");
        expect(fixture.suggestions).toHaveLength(2);
        await act(async () => fixture.suggestions[1].resolve({ protocol: "text-b", source: "selection", candidates: ["text-b"] }));
        await act(async () => fixture.suggestions[0].resolve({ protocol: "text-a", source: "history", candidates: ["text-a"] }));
        expect(document.body.textContent).toContain("已预选同网站上次明确保存的协议");
        await click("添加模型");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0]).toMatchObject({ providerModelKey: "model-b", protocol: "text-b", protocolSelectionExplicit: false });
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：失效协议建议显示原因并阻止保存", async () => {
    const fixture = await mountEditor(null, [{ ...protocols[0], value: "text-a", capability: "text", imageParameters: undefined }]);
    try {
        await inputValue('input[id="modelKey"]', "model-a");
        await act(async () => fixture.suggestions[0].resolve({ protocol: "missing", source: "selection", candidates: ["missing"] }));
        expect(document.body.textContent).toContain("协议建议已失效，请手动选择");
        await click("添加模型");
        expect(fixture.saves).toHaveLength(0);
        expect(document.querySelector('.choice-browser input[type="radio"]:checked')).toBeNull();
        expect(document.body.textContent).toContain("请检查标记的配置项后重试");
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：手动选择优先于待返回建议，保存明确选择", async () => {
    const catalog: ModelProtocolDefinition[] = ["a", "b"].map((key) => ({ ...protocols[0], value: `text-${key}`, label: `协议 ${key}`, capability: "text", imageParameters: undefined }));
    const fixture = await mountEditor(null, catalog);
    try {
        await inputValue('input[id="modelKey"]', "model-a");
        await act(async () => (document.querySelector('.choice-browser input[value="text-b"]') as HTMLInputElement).click());
        await act(async () => fixture.suggestions[0].resolve({ protocol: "text-a", source: "selection", candidates: ["text-a"] }));
        expect((document.querySelector(".choice-browser input:checked") as HTMLInputElement).value).toBe("text-b");
        await click("添加模型");
        expect(fixture.saves[0]).toMatchObject({ protocol: "text-b", protocolSelectionExplicit: true });
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：能力模板应用和撤销均不记录明确协议选择", async () => {
    for (const undo of [false, true]) {
        const fixture = await mountEditor(null, protocols);
        try {
            await inputValue('input[id="modelKey"]', "gpt-image-2");
            const imageCapability = [...document.querySelectorAll("label.ant-segmented-item")].find((item) => item.textContent === "图片")!.querySelector("input") as HTMLInputElement;
            await act(async () => imageCapability.click());
            await act(async () => fixture.suggestions.at(-1)!.resolve({ protocol: "openai-image", source: "selection", candidates: ["openai-image"] }));
            await tab("能力与参数");
            await choose("选择能力模板", "GPT Image · OpenAI Images");
            await click("应用能力模板");
            if (undo) await click("撤销能力模板");
            await click("添加模型");
            expect(fixture.saves).toHaveLength(1);
            expect(fixture.saves[0]).toMatchObject({ protocol: "openai-image", protocolSelectionExplicit: false });
        } finally {
            await fixture.close();
        }
    }
});

test("完整模型编辑器：迟到的协议建议保留已应用模板能力且不标为明确选择", async () => {
    const values = draft();
    values.capabilityConfig!.image!.references.maxImageBytes = 7 * 1024 * 1024;
    saveCapabilityTemplate("template-test", "七兆模板", values);
    const fixture = await mountEditor(null, protocols);
    try {
        await inputValue('input[id="modelKey"]', "gpt-image-2");
        const imageCapability = [...document.querySelectorAll("label.ant-segmented-item")].find((item) => item.textContent === "图片")!.querySelector("input") as HTMLInputElement;
        await act(async () => imageCapability.click());
        await tab("能力与参数");
        await choose("选择能力模板", "七兆模板");
        await click("应用能力模板");
        await act(async () => fixture.suggestions.at(-1)!.resolve({ protocol: "openai-image", source: "selection", candidates: ["openai-image"] }));
        await click("添加模型");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0]).toMatchObject({ protocol: "openai-image", protocolSelectionExplicit: false, capabilityConfig: { image: { references: { maxImageBytes: 7 * 1024 * 1024 } } } });
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：先应用或撤销模板再发起协议建议也保留能力", async () => {
    const values = draft();
    values.capabilityConfig!.image!.references.maxImageBytes = 7 * 1024 * 1024;
    saveCapabilityTemplate("template-test", "先设能力", values);
    for (const loading of [false, true]) {
        for (const undo of [false, true]) {
            const initial = { ...draft(), protocol: "", modelKey: "", providerModelKey: "" };
            initial.capabilityConfig!.image!.references.maxImageBytes = 11 * 1024 * 1024;
            const fixture = await mountEditor(null, protocols, initial, loading);
            try {
                if (loading) await inputValue('input[id="modelKey"]', "gpt-image-2");
                await tab("能力与参数");
                await choose("选择能力模板", "先设能力");
                await click("应用能力模板");
                if (undo) await click("撤销能力模板");
                expect(fixture.suggestions).toHaveLength(0);
                if (loading) await fixture.setProtocolLoading(false);
                else {
                    await tab("基本信息");
                    await inputValue('input[id="modelKey"]', "gpt-image-2");
                }
                expect(fixture.suggestions).toHaveLength(1);
                await act(async () => fixture.suggestions[0].resolve({ protocol: "openai-image", source: "selection", candidates: ["openai-image"] }));
                await click("添加模型");
                expect(fixture.saves).toHaveLength(1);
                expect(fixture.saves[0]).toMatchObject({ protocol: "openai-image", protocolSelectionExplicit: false, capabilityConfig: { image: { references: { maxImageBytes: (undo ? 11 : 7) * 1024 * 1024 } } } });
            } finally {
                await fixture.close();
            }
        }
    }
});

test("完整模型编辑器：未操作保存保留参考视频计价及独立成本", async () => {
    const values = { ...draft(), capability: "video" as const, protocol: "video-test", referenceVideoBilling: true, capabilityConfig: defaultModelCapabilityConfig("video-test") };
    values.priceTiers = [{ ...defaultPriceTier(), billingMode: "per_second", unitPrice: 3, referenceVideoUnitPrice: 4, costConfigured: true, costUnitPrice: 1, costReferenceVideoUnitPrice: 2 }];
    const editing = savedModel(values);
    const fixture = await mountEditor(editing, [{ ...protocols[0], capability: "video", value: "video-test", imageParameters: undefined }]);
    try {
        await click("保存修改");
        expect(fixture.saves[0]).toMatchObject({
            referenceVideoBilling: true,
            protocolSelectionExplicit: false,
            priceTiers: [{ unitPriceMicrocredits: 3_000_000, referenceVideoUnitPriceMicrocredits: 4_000_000, costPricing: { unitPriceMicrocredits: 1_000_000, referenceVideoUnitPriceMicrocredits: 2_000_000 } }],
        });
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：复制预填与模板操作不记录协议选择，主动改协议才记录", async () => {
    const catalog = [...protocols, { ...protocols[0], value: "other-image", label: "另一图片协议" }];
    for (const action of ["unchanged", "manual", "template", "undo"] as const) {
        const copied = duplicateChannelModelValues(savedModel(), catalog);
        const fixture = await mountEditor(null, catalog, copied);
        try {
            await inputValue('input[id="modelKey"]', "gpt-image-copy");
            expect(fixture.suggestions).toHaveLength(0);
            if (action === "manual") {
                await act(async () => (document.querySelector('.choice-browser input[value="other-image"]') as HTMLInputElement).click());
            } else if (action === "template" || action === "undo") {
                await tab("能力与参数");
                await choose("选择能力模板", "GPT Image · OpenAI Images");
                await click("应用能力模板");
                if (action === "undo") await click("撤销能力模板");
            }
            await click("添加模型");
            expect(fixture.saves).toHaveLength(1);
            expect(fixture.saves[0]).toMatchObject({ protocol: action === "manual" ? "other-image" : "openai-image", protocolSelectionExplicit: action === "manual" });
        } finally {
            await fixture.close();
        }
    }
});

test("完整模型编辑器：已有模型改协议再改回原值，保存不刷新协议记忆", async () => {
    const catalog = [...protocols, { ...protocols[0], value: "other-image", label: "另一图片协议" }];
    const fixture = await mountEditor(savedModel(), catalog);
    try {
        await act(async () => (document.querySelector('.choice-browser input[value="other-image"]') as HTMLInputElement).click());
        await act(async () => (document.querySelector('.choice-browser input[value="openai-image"]') as HTMLInputElement).click());
        await click("保存修改");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0]).toMatchObject({ protocol: "openai-image", protocolSelectionExplicit: false });
    } finally {
        await fixture.close();
    }
});

test("完整模型编辑器：keep_source 三档帧率保存为模板后复用原金额", async () => {
    const values = { ...draft(), capability: "video" as const, protocol: "volcengine-mediakit-enhance-video", capabilityConfig: defaultModelCapabilityConfig("volcengine-mediakit-enhance-video") };
    values.priceTiers = ["le30", "le60", "le120"].map((fpsBand, index) => ({ ...defaultPriceTier("advanced"), fpsBand, billingMode: "per_second", unitPrice: index + 1, costConfigured: true, costUnitPrice: (index + 1) / 2 }));
    const editing = savedModel(values);
    const fixture = await mountEditor(editing, [{ ...protocols[0], capability: "video", value: values.protocol, imageParameters: undefined }]);
    try {
        await tab("积分定价");
        await click("将当前配置保存为模板");
        await inputValue('input[aria-label="积分模板名称"]', "三档处理");
        await click("保存模板");
        await click("应用定价模板");
        await click("保存修改");
        expect(fixture.saves).toHaveLength(1);
        expect(fixture.saves[0].priceTiers.map((tier: any) => tier.selector)).toEqual([{ fpsBand: "le30" }, { fpsBand: "le60" }, { fpsBand: "le120" }]);
        expect(fixture.saves[0].priceTiers.map((tier: any) => tier.unitPriceMicrocredits)).toEqual([1_000_000, 2_000_000, 3_000_000]);
    } finally {
        await fixture.close();
    }
});
