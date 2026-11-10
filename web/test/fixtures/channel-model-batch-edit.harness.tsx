import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import { batchModel, batchPricing, batchProtocols, batchTier } from "./channel-model-batch-edit.fixtures";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLBodyElement",
    "HTMLHtmlElement",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Element",
    "SVGElement",
    "ShadowRoot",
    "Node",
    "CustomEvent",
    "MutationObserver",
    "ResizeObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const raw = key === "window" ? dom : (dom as any)[key];
    const value = ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? raw.bind(dom) : raw;
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
originals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { ChannelModelBatchEditDialog } = await import("../../src/pages/admin/components/channel-model-batch-edit-dialog");
const { AdminProvider } = await import("../../src/pages/admin/admin-context");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const { pricingTemplatesKey, PRICING_TEMPLATES_CHANGED } = await import("../../src/pages/admin/components/saved-pricing-templates");
const { capabilityTemplatesKey, CAPABILITY_TEMPLATES_CHANGED } = await import("../../src/pages/admin/components/saved-capability-templates");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { defaultPriceTier } = await import("../../src/pages/admin/components/channel-model-price-tier-form");

function account(id: string) {
    setActiveUserScope(id);
    useUserStore.getState().setUser({ id, username: id, displayName: id, role: "admin", status: "active" });
}
let post: ReturnType<typeof spyOn>;
let get: ReturnType<typeof spyOn>;
beforeEach(() => {
    dom.localStorage.clear();
    account("batch-account");
    post = spyOn(http, "post").mockResolvedValue({ updated: 1 });
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path !== "/admin/references") throw new Error(`Unexpected ${path}`);
        return { users: [], channels: [{ id: "another-channel", name: "其他渠道", enabled: true, models: [], modelDisplayNames: ["全局已有目录", "Alpha 分组", "全局已有目录"] }] };
    });
});
afterEach(() => {
    post.mockRestore();
    get.mockRestore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function button(text: string) {
    const node = [...document.querySelectorAll("button")].find((item) => item.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""));
    expect(node).toBeTruthy();
    return node as HTMLButtonElement;
}
async function click(text: string) {
    await act(async () => button(text).click());
}
async function check(label: string) {
    const input = document.querySelector(`input[aria-label="修改${label}"]`) as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => input.click());
}
async function input(label: string, value: string) {
    const field = document.querySelector(`[aria-label="${label}"]`)!;
    const proto = field.tagName === "TEXTAREA" ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype;
    await act(async () => {
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
        field.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}
async function choose(label: string, text: string) {
    const field = document.querySelector(`input[aria-label="${label}"]`)!;
    expect(field).toBeTruthy();
    await act(async () => field.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    const node = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((item) => item.textContent === text);
    expect(node).toBeTruthy();
    await act(async () => (node as HTMLElement).click());
}
async function mount(overrides: Partial<ComponentProps<typeof ChannelModelBatchEditDialog>> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const counters = { closed: 0, saved: 0 };
    let props: ComponentProps<typeof ChannelModelBatchEditDialog> = {
        channelId: "channel-1",
        items: [batchModel()],
        currentItems: [batchModel()],
        contextKey: "group-1",
        protocols: batchProtocols,
        protocolLoading: false,
        protocolError: "",
        onClose: () => {
            counters.closed++;
        },
        onSaved: async () => {
            counters.saved++;
        },
        ...overrides,
    };
    const render = () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <AdminProvider>
                        <ChannelModelBatchEditDialog {...props} />
                    </AdminProvider>
                </App>
            </ConfigProvider>,
        );
    await act(async () => render());
    return {
        counters,
        async rerender(patch: Partial<typeof props>) {
            props = { ...props, ...patch };
            await act(async () => render());
        },
        async dispose() {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

test("默认四个通用字段与各类型配置均不修改，取消不发送请求", async () => {
    const fixture = await mount();
    try {
        expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(4);
        expect([...document.querySelectorAll('input[type="checkbox"]')].every((item) => !(item as HTMLInputElement).checked)).toBe(true);
        expect(button("保存").disabled).toBe(true);
        await click("取消");
        expect(fixture.counters.closed).toBe(1);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("单组提交名称及清空备注，取消勾选后的字段不提交", async () => {
    const fixture = await mount();
    try {
        await check("模型展示名");
        await input("批量模型展示名", "新名称");
        await check("备注");
        await check("模型启用");
        await choose("批量模型启用", "停用");
        await check("模型启用");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0]).toEqual([
            "/admin/channels/channel-1/models/batch-update",
            { models: [{ modelId: "model-1", priceVersion: 9, capabilityVersion: 3, updatedAt: "2026-11-09T02:00:00.123456789Z", changes: { displayName: "新名称", description: "" } }] },
        ]);
        expect(fixture.counters).toEqual({ saved: 1, closed: 1 });
    } finally {
        await fixture.dispose();
    }
});

test("批量名称读取全局目录、搜索选择、自填及清空，并且未勾选不写", async () => {
    const fixture = await mount();
    try {
        await check("模型展示名");
        const field = document.querySelector('input[aria-label="批量模型展示名"]')!;
        await act(async () => field.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
        let options = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].map((item) => item.textContent);
        expect(options.filter((value) => value === "全局已有目录")).toHaveLength(1);
        expect(options).toContain("Alpha 分组");
        expect(options).not.toContain("现有名称");
        await input("批量模型展示名", "Alpha");
        options = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].map((item) => item.textContent);
        expect(options).toEqual(["Alpha 分组"]);
        await act(async () => (document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option") as HTMLElement).click());
        expect((field as HTMLInputElement).value).toBe("Alpha 分组");
        await input("批量模型展示名", "新目录");
        expect((field as HTMLInputElement).value).toBe("新目录");
        const clear = field.closest(".ant-select")!.querySelector(".ant-select-clear")!;
        expect(clear).toBeTruthy();
        await act(async () => clear.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
        expect((field as HTMLInputElement).value).toBe("");
        await click("保存");
        expect(post.mock.calls[0][1].models[0].changes).toEqual({ displayName: "" });
    } finally {
        await fixture.dispose();
    }
    const unselected = await mount();
    try {
        await check("模型展示名");
        await input("批量模型展示名", "不应保存");
        await check("模型展示名");
        await check("备注");
        await click("保存");
        expect(post.mock.calls[1][1].models[0].changes).toEqual({ description: "" });
    } finally {
        await unselected.dispose();
    }
});

test("全部模型接口允许跨组，模型启用与全部价档开关独立", async () => {
    const models = [batchModel(), batchModel({ id: "model-2", channelId: "channel-2", enabled: false })];
    const fixture = await mount({ channelId: undefined, items: models, currentItems: models });
    try {
        await check("可供用户使用");
        await choose("批量可供用户使用", "关闭全部价格档");
        await click("保存");
        expect(post.mock.calls[0][0]).toBe("/admin/channel-models/batch-update");
        expect(post.mock.calls[0][1].models.map((item: any) => item.changes)).toEqual([{ pricingEnabled: false }, { pricingEnabled: false }]);
    } finally {
        await fixture.dispose();
    }
});

test("混选能力分别显示可选的模板，仍能统一修改备注", async () => {
    const models = [batchModel(), batchModel({ id: "image", capability: "image", protocol: "image-protocol", capabilityConfig: defaultModelCapabilityConfig("openai-image") })];
    const fixture = await mount({ items: models, currentItems: models });
    try {
        expect((document.querySelector('[aria-label="文本能力模板"]') as HTMLInputElement).disabled).toBe(false);
        expect((document.querySelector('[aria-label="图片能力模板"]') as HTMLInputElement).disabled).toBe(false);
        expect((document.querySelector('[aria-label="文本积分模板"]') as HTMLInputElement).disabled).toBe(false);
        expect((document.querySelector('[aria-label="图片积分模板"]') as HTMLInputElement).disabled).toBe(false);
        await check("备注");
        await input("批量备注", "统一备注");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][1].models.every((item: any) => item.changes.description === "统一备注")).toBe(true);
    } finally {
        await fixture.dispose();
    }
});

test("未配置零价禁止启用，原始失败草稿可以改为停用再保存", async () => {
    const models = [batchModel({ priceTiers: [batchTier({ unitPriceMicrocredits: 0, priceConfigured: false, enabled: false })] })];
    const fixture = await mount({ items: models, currentItems: models });
    try {
        await check("可供用户使用");
        expect(button("保存").disabled).toBe(true);
        expect(document.body.textContent).toContain("金额尚未填写完整");
        expect(post).not.toHaveBeenCalled();
        await choose("批量可供用户使用", "关闭全部价格档");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
    } finally {
        await fixture.dispose();
    }
});

for (const enabled of [true, false]) {
    for (const billingMode of ["fixed_request", "token"] as const) {
        test(`旧模型 ${billingMode} enabled=${enabled} 未配置金额不发送启用请求`, async () => {
            const models = [
                batchModel({
                    priceTiers: [],
                    priceConfigured: false,
                    enabled,
                    billingMode,
                    unitPriceMicrocredits: 0,
                    inputTokenPriceMicrocredits: 1_000_000,
                    outputTokenPriceMicrocredits: 1_000_000,
                    cachedTokenPriceMicrocredits: 1_000_000,
                    cacheWriteTokenPriceMicrocredits: 0,
                }),
            ];
            const fixture = await mount({ items: models, currentItems: models });
            try {
                await check("可供用户使用");
                expect(button("保存").disabled).toBe(true);
                expect(document.body.textContent).toContain("金额尚未填写完整");
                await click("保存");
                expect(post).not.toHaveBeenCalled();
                expect(fixture.counters.closed).toBe(0);
            } finally {
                await fixture.dispose();
            }
        });
    }
}

test("保存失败保留输入，允许用户核对后主动重试", async () => {
    post.mockRejectedValueOnce(new Error("第二模型配置冲突"));
    const fixture = await mount();
    try {
        await check("备注");
        await input("批量备注", "保留草稿");
        await click("保存");
        expect(document.body.textContent).toContain("第二模型配置冲突");
        expect((document.querySelector('[aria-label="批量备注"]') as HTMLTextAreaElement).value).toBe("保留草稿");
        expect(fixture.counters.closed).toBe(0);
        expect(post).toHaveBeenCalledTimes(1);
        await click("保存");
        expect(post).toHaveBeenCalledTimes(2);
        expect(fixture.counters.closed).toBe(1);
    } finally {
        await fixture.dispose();
    }
});

test("保存期间禁止重复提交、取消和编辑", async () => {
    let resolve!: (value: unknown) => void;
    post.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const fixture = await mount();
    try {
        await check("模型启用");
        await act(async () => {
            button("保存").click();
            button("保存").click();
        });
        expect(post).toHaveBeenCalledTimes(1);
        expect(button("取消").disabled).toBe(true);
        expect((document.querySelector('[aria-label="修改备注"]') as HTMLInputElement).disabled).toBe(true);
        await click("取消");
        expect(fixture.counters.closed).toBe(0);
        await act(async () => resolve({ updated: 1 }));
        expect(fixture.counters.closed).toBe(1);
    } finally {
        await fixture.dispose();
    }
});

test("已保存但刷新失败会提示并关闭，不再开放重复保存", async () => {
    const fixture = await mount({
        onSaved: async () => {
            throw new Error("refresh failed");
        },
    });
    try {
        await check("备注");
        await click("保存");
        expect(document.body.textContent).toContain("已保存，刷新失败");
        expect(fixture.counters.closed).toBe(1);
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
    } finally {
        await fixture.dispose();
    }
});

for (const scenario of ["account", "context", "model"] as const) {
    test(`${scenario} 变化后旧草稿不能提交`, async () => {
        const fixture = await mount();
        try {
            await check("备注");
            if (scenario === "account") await act(async () => account("new-account"));
            if (scenario === "context") await fixture.rerender({ contextKey: "other-filter" });
            if (scenario === "model") await fixture.rerender({ currentItems: [batchModel({ priceVersion: 10 })] });
            expect(button("保存").disabled).toBe(true);
            expect(document.body.textContent).toContain("重新打开");
            await click("保存");
            expect(post).not.toHaveBeenCalled();
        } finally {
            await fixture.dispose();
        }
    });
}

test("选中积分模板后模板版本变化会阻止旧模板提交", async () => {
    const template = batchPricing();
    dom.localStorage.setItem(pricingTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [template] }));
    const fixture = await mount();
    try {
        await choose("文本积分模板", "常用积分");
        expect(button("保存").disabled).toBe(false);
        await act(async () => {
            dom.localStorage.setItem(pricingTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [{ ...template, revision: "changed" }] }));
            window.dispatchEvent(new CustomEvent(PRICING_TEMPLATES_CHANGED, { detail: "batch-account" }));
        });
        expect(button("保存").disabled).toBe(true);
        expect(document.body.textContent).toContain("积分模板已变更");
        expect(post).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("能力模板使用已有本机模板库，应用后提交能力快照", async () => {
    const template = { id: "cap-1", revision: "v1", name: "文本能力", capability: "text", config: { protocol: "text-protocol", capabilityConfig: defaultModelCapabilityConfig("openai") } };
    dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [template] }));
    const fixture = await mount();
    try {
        await choose("文本能力模板", "文本能力");
        await click("保存");
        expect(Object.keys(post.mock.calls[0][1].models[0].changes)).toEqual(["capabilityTemplate"]);
        expect(Object.keys(post.mock.calls[0][1].models[0].changes.capabilityTemplate)).toEqual(["capabilityConfig"]);
        expect(post.mock.calls[0][1].models[0].changes.pricingTemplate).toBeUndefined();
    } finally {
        await fixture.dispose();
    }
});

test("能力模板变更不静默替换已选草稿", async () => {
    const template = { id: "cap-1", revision: "v1", name: "文本能力", capability: "text", config: { protocol: "text-protocol", capabilityConfig: defaultModelCapabilityConfig("openai") } };
    dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [template] }));
    const fixture = await mount();
    try {
        await choose("文本能力模板", "文本能力");
        await act(async () => {
            dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [{ ...template, revision: "v2" }] }));
            window.dispatchEvent(new CustomEvent(CAPABILITY_TEMPLATES_CHANGED, { detail: "batch-account" }));
        });
        expect(button("保存").disabled).toBe(true);
        expect(document.body.textContent).toContain("能力模板已变更");
        expect(post).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("两类模板组合消除原价档冲突后可保存，不被中间状态阻止", async () => {
    const config = defaultModelCapabilityConfig("openai-image");
    config.image!.quality = { supported: true, values: ["low"], default: "low" };
    const original = structuredClone(config);
    original.image!.quality = { supported: true, values: ["high"], default: "high" };
    const models = [batchModel({ capability: "image", protocol: "image-protocol", capabilityConfig: original, priceTiers: [batchTier({ selector: { quality: "high" } })] })];
    const capability = { id: "cap-1", revision: "v1", name: "新图片能力", capability: "image", config: { protocol: "image-protocol", capabilityConfig: config } };
    const pricing = batchPricing({ name: "新图片价格", capability: "image", pricing: { priceCurrency: "credits", referenceVideoBilling: false, priceTiers: [{ ...defaultPriceTier("advanced"), quality: "low", unitPrice: 1 }] } });
    dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [capability] }));
    dom.localStorage.setItem(pricingTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [pricing] }));
    const fixture = await mount({ items: models, currentItems: models });
    try {
        await choose("图片能力模板", "新图片能力");
        expect(button("保存").disabled).toBe(true);
        expect(document.body.textContent).toContain("high");
        await choose("图片积分模板", "新图片价格");
        expect(button("保存").disabled).toBe(false);
        await click("保存");
        expect(post.mock.calls[0][1].models[0].changes).toMatchObject({ capabilityTemplate: { capabilityConfig: { image: { quality: { values: ["low"] } } } }, pricingTemplate: { priceTiers: [{ selector: { quality: "low" } }] } });
    } finally {
        await fixture.dispose();
    }
});

test("全未配置模型直接选图片、协议和两种模板后一次保存", async () => {
    const model = batchModel({ capability: "", protocol: "", capabilityConfig: undefined, enabled: false, priceConfigured: false, priceTiers: [], unitPriceMicrocredits: 0 });
    const capability = { id: "image-cap", revision: "v1", name: "常用图片能力", capability: "image", config: { protocol: "image-protocol", capabilityConfig: defaultModelCapabilityConfig("openai-image") } };
    dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [capability] }));
    dom.localStorage.setItem(pricingTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [batchPricing({ capability: "image" })] }));
    const fixture = await mount({ items: [model], currentItems: [model] });
    try {
        expect(document.body.textContent).not.toContain("请先单独设置类型");
        expect((document.querySelector('[aria-label="未设置类型调用协议"]') as HTMLInputElement).disabled).toBe(true);
        await choose("未设置类型的模型类型", "图片");
        await choose("未设置类型调用协议", "image");
        await choose("未设置类型能力模板", "常用图片能力");
        await choose("未设置类型积分模板", "常用积分");
        await check("模型启用");
        await check("可供用户使用");
        expect(button("保存").disabled).toBe(false);
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][1].models[0].changes).toMatchObject({
            capability: "image",
            protocol: "image-protocol",
            capabilityTemplate: { capabilityConfig: { image: {} } },
            pricingTemplate: { priceCurrency: "USD" },
            enabled: true,
            pricingEnabled: true,
        });
        expect(fixture.counters).toEqual({ saved: 1, closed: 1 });
    } finally {
        await fixture.dispose();
    }
});

test("混合文本图片与新模型时只修改已选择的文本组", async () => {
    const models = [batchModel(), batchModel({ id: "image", capability: "image", protocol: "image-protocol" }), batchModel({ id: "new", capability: "", protocol: "" })];
    const fixture = await mount({ items: models, currentItems: models, channelId: undefined });
    try {
        await choose("文本调用协议", "text");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe("/admin/channel-models/batch-update");
        expect(post.mock.calls[0][1].models).toHaveLength(1);
        expect(post.mock.calls[0][1].models[0]).toMatchObject({ modelId: "model-1", changes: { protocol: "text-protocol" } });
    } finally {
        await fixture.dispose();
    }
});

test("选择模板不填协议，手动换协议保留模板，再次选模板保留显式协议", async () => {
    const template = { id: "cap-1", revision: "v1", name: "文本能力", capability: "text", config: { protocol: "text-protocol", capabilityConfig: defaultModelCapabilityConfig("chat-completion") } };
    dom.localStorage.setItem(capabilityTemplatesKey("batch-account"), JSON.stringify({ version: 1, templates: [template] }));
    const fixture = await mount({ protocols: [...batchProtocols, { ...batchProtocols[0], value: "other-text", label: "另一个文本协议" }] });
    try {
        await choose("文本能力模板", "文本能力");
        expect(document.querySelector('[aria-label="文本调用协议"]')!.closest(".ant-select")!.textContent).toContain("不修改");
        await choose("文本调用协议", "另一个文本协议");
        expect(document.querySelector('[aria-label="文本能力模板"]')!.closest(".ant-select")!.textContent).toContain("文本能力");
        await choose("文本能力模板", "文本能力");
        expect(document.querySelector('[aria-label="文本调用协议"]')!.closest(".ant-select")!.textContent).toContain("另一个文本协议");
        await click("保存");
        expect(post.mock.calls[0][1].models[0].changes).toMatchObject({ protocol: "other-text", capabilityTemplate: { capabilityConfig: { text: {} } } });
    } finally {
        await fixture.dispose();
    }
});

for (const unavailable of [
    { protocolLoading: true, protocolError: "" },
    { protocolLoading: false, protocolError: "目录读取失败" },
]) {
    test(`协议目录不可用时仍能为未配置模型修改备注及关闭开关：${unavailable.protocolLoading ? "加载中" : "失败"}`, async () => {
        const model = batchModel({ capability: "", protocol: "", enabled: false, priceConfigured: false });
        const fixture = await mount({ items: [model], currentItems: [model], protocols: [], ...unavailable });
        try {
            await check("备注");
            await input("批量备注", "先整理备注");
            await check("模型启用");
            await choose("批量模型启用", "停用");
            await check("可供用户使用");
            await choose("批量可供用户使用", "关闭全部价格档");
            expect(button("保存").disabled).toBe(false);
            await click("保存");
            expect(post.mock.calls[0][1].models[0].changes).toEqual({ description: "先整理备注", enabled: false, pricingEnabled: false });
        } finally {
            await fixture.dispose();
        }
    });
}
