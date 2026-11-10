import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps } from "react";
import { batchModel, batchProtocols } from "./channel-model-batch-edit.fixtures";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLBodyElement",
    "HTMLHtmlElement",
    "HTMLElement",
    "HTMLAnchorElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "Document",
    "DocumentFragment",
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
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: ["getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"].includes(key) ? raw.bind(dom) : raw });
}
originals.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { MemoryRouter } = await import("react-router");
const { ChannelModelProtocolDialog } = await import("../../src/pages/admin/components/channel-model-protocol-dialog");
const { ChannelModelManager } = await import("../../src/pages/admin/components/channel-model-manager");
const { AllChannelModelsPanel } = await import("../../src/pages/admin/channels/all-channel-models-panel");
const { AdminProvider, useAdminContext } = await import("../../src/pages/admin/admin-context");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const { setActiveUserScope } = await import("../../src/lib/user-scope");
const protocols = batchProtocols.flatMap((item) => [item, { ...item, value: `${item.value}-new` }]);
const models = batchProtocols.slice(0, 2).map((item) => batchModel({ id: item.capability, capability: item.capability, protocol: item.value }));
const labels = { text: "文本", image: "图片", video: "视频", audio: "音频" };
let post: ReturnType<typeof spyOn>;
let get: ReturnType<typeof spyOn>;
function account(id: string) {
    setActiveUserScope(id);
    useUserStore.getState().setUser({ id, username: id, displayName: id, role: "admin", status: "active" });
}
beforeEach(() => {
    dom.localStorage.clear();
    account("protocol-test");
    post = spyOn(http, "post").mockResolvedValue({ updated: 2 });
    get = spyOn(http, "get").mockRejectedValue(new Error("Unexpected GET"));
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
async function open(capability: keyof typeof labels) {
    const field = document.querySelector(`input[aria-label="${labels[capability]}调用协议"]`)!;
    expect(field).toBeTruthy();
    await act(async () => field.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
    return field;
}
async function choose(capability: keyof typeof labels, protocol = `${capability}-protocol-new`) {
    await open(capability);
    const node = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find((item) => item.textContent === `${capability} · ${protocol}`);
    expect(node).toBeTruthy();
    await act(async () => (node as HTMLElement).click());
}
async function clear(capability: keyof typeof labels) {
    const field = document.querySelector(`input[aria-label="${labels[capability]}调用协议"]`)!;
    const target = field.closest(".ant-select")!.querySelector(".ant-select-clear")!;
    expect(target).toBeTruthy();
    await act(async () => target.dispatchEvent(new dom.MouseEvent("mousedown", { bubbles: true })));
}
async function mount(overrides: Partial<ComponentProps<typeof ChannelModelProtocolDialog>> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const counters = { closed: 0, saved: 0 };
    let props: ComponentProps<typeof ChannelModelProtocolDialog> = {
        channelId: "channel-1",
        items: models,
        currentItems: models,
        contextKey: "group-1",
        protocols,
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
                    <ChannelModelProtocolDialog {...props} />
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

test("混选分组默认不修改，类型选项互不混入且可搜索", async () => {
    const fixture = await mount();
    try {
        expect(button("保存").disabled).toBe(true);
        await open("text");
        const options = [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].map((item) => item.textContent);
        expect(options).toEqual(["text · text-protocol", "text · text-protocol-new"]);
        const field = document.querySelector('input[aria-label="文本调用协议"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(field, "new");
            field.dispatchEvent(new dom.Event("input", { bubbles: true }));
        });
        expect([...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].map((item) => item.textContent)).toEqual(["text · text-protocol-new"]);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("仅部分组修改、清空可撤回，单组接口一次请求", async () => {
    const fixture = await mount();
    try {
        await choose("text");
        await choose("image");
        await clear("image");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0]).toEqual(["/admin/channels/channel-1/models/batch-protocol", { groups: [{ modelIds: ["text"], protocol: "text-protocol-new" }] }]);
        expect(fixture.counters).toEqual({ saved: 1, closed: 1 });
    } finally {
        await fixture.dispose();
    }
});

test("跨渠道混选在一次 groups 请求提交，未配置类型不阻塞其他组", async () => {
    const selected = [...models.map((item, index) => ({ ...item, channelId: `channel-${index}` })), batchModel({ id: "unknown", capability: "" })];
    const fixture = await mount({ channelId: undefined, items: selected, currentItems: selected });
    try {
        expect(document.body.textContent).toContain("1 个模型未配置能力");
        await choose("text");
        await choose("image");
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0]).toEqual([
            "/admin/channel-models/batch-protocol",
            {
                groups: [
                    { modelIds: ["text"], protocol: "text-protocol-new" },
                    { modelIds: ["image"], protocol: "image-protocol-new" },
                ],
            },
        ]);
    } finally {
        await fixture.dispose();
    }
});

test("选择原协议不产生写入，全部清空恢复禁用保存", async () => {
    const fixture = await mount();
    try {
        await choose("text", "text-protocol");
        expect(button("保存").disabled).toBe(true);
        await choose("text");
        expect(button("保存").disabled).toBe(false);
        await clear("text");
        expect(button("保存").disabled).toBe(true);
        expect(post).not.toHaveBeenCalled();
    } finally {
        await fixture.dispose();
    }
});

test("保存失败保留两组选择，主动重试仍为一次完整请求", async () => {
    post.mockRejectedValueOnce(new Error("图片模型价格档冲突"));
    const fixture = await mount();
    try {
        await choose("text");
        await choose("image");
        await click("保存");
        expect(document.body.textContent).toContain("图片模型价格档冲突");
        expect(fixture.counters.closed).toBe(0);
        await click("保存");
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
    } finally {
        await fixture.dispose();
    }
});

test("同步双击只请求一次，保存中禁止取消与编辑", async () => {
    let resolve!: (value: unknown) => void;
    post.mockImplementationOnce(
        () =>
            new Promise((done) => {
                resolve = done;
            }),
    );
    const fixture = await mount();
    try {
        await choose("text");
        await act(async () => {
            button("保存").click();
            button("保存").click();
        });
        expect(post).toHaveBeenCalledTimes(1);
        expect(button("取消").disabled).toBe(true);
        expect((document.querySelector('input[aria-label="图片调用协议"]') as HTMLInputElement).disabled).toBe(true);
        await act(async () => resolve({ updated: 1 }));
        expect(fixture.counters.closed).toBe(1);
    } finally {
        await fixture.dispose();
    }
});

test("写入成功刷新失败只提示一次并关闭，不能重发", async () => {
    const fixture = await mount({
        onSaved: async () => {
            throw new Error("refresh");
        },
    });
    try {
        await choose("text");
        await click("保存");
        expect(document.body.textContent!.match(/已保存，刷新失败/g)).toHaveLength(1);
        expect(document.body.textContent).not.toContain("已修改 2 个模型");
        expect(fixture.counters.closed).toBe(1);
        await click("保存");
        expect(post).toHaveBeenCalledTimes(1);
    } finally {
        await fixture.dispose();
    }
});

for (const scenario of ["protocol", "loading", "read-error", "context", "account", "model"] as const) {
    test(`${scenario} 变化后阻止陈旧协议提交`, async () => {
        const fixture = await mount();
        try {
            await choose("text");
            if (scenario === "protocol") await fixture.rerender({ protocols: batchProtocols });
            if (scenario === "loading") await fixture.rerender({ protocolLoading: true });
            if (scenario === "read-error") await fixture.rerender({ protocolError: "读取失败" });
            if (scenario === "context") await fixture.rerender({ contextKey: "changed" });
            if (scenario === "account") await act(async () => account("another"));
            if (scenario === "model") await fixture.rerender({ currentItems: models.map((item) => ({ ...item, priceVersion: 99 })) });
            expect(button("保存").disabled).toBe(true);
            await click("保存");
            expect(post).not.toHaveBeenCalled();
        } finally {
            await fixture.dispose();
        }
    });
}

test("AdminContext 默认读取失败提示，强刷新错误向保存调用者传播且不重复提示", async () => {
    let reload!: (propagateError?: boolean) => Promise<void>;
    get.mockImplementation(async () => ({ users: [], channels: [] }));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Consumer() {
        reload = useAdminContext().reloadReferences;
        return null;
    }
    try {
        await act(async () =>
            root.render(
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <AdminProvider>
                            <Consumer />
                        </AdminProvider>
                    </App>
                </ConfigProvider>,
            ),
        );
        get.mockRejectedValue(new Error("reference-refresh-failed"));
        await act(async () => {
            await expect(reload(true)).rejects.toThrow("reference-refresh-failed");
        });
        expect(document.body.textContent).not.toContain("reference-refresh-failed");
        await act(async () => reload());
        expect(document.body.textContent).toContain("reference-refresh-failed");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

for (const mode of ["single", "all"] as const) {
    for (const failure of ["model-list", "parent-sync"] as const) {
        for (const action of ["协议", "备注"] as const) {
            test(`${mode} 入口 ${failure} 刷新失败传到${action}弹窗`, async () => {
                let writes = 0,
                    syncStrict: boolean | undefined;
                post.mockImplementation(async () => {
                    writes++;
                    return { updated: 1 };
                });
                get.mockImplementation(async (path) => {
                    if (path === "/admin/references") return { users: [], channels: [] };
                    if (path === "/plugins/catalog") return { providers: protocols.map((item) => ({ id: item.value, name: item.label, version: "1", vendor: "test", categories: [item.capability], scopes: ["admin.system-channel"], enabled: true })) };
                    if (String(path).endsWith("/catalog-status")) return { models: [], stale: false };
                    if (path === "/admin/channel-models" || path === "/admin/channels/channel-1/models") {
                        if (writes && failure === "model-list") throw new Error("列表刷新失败");
                        return { models: models.map((item) => ({ ...item, channelName: "组", channelEnabled: true })) };
                    }
                    throw new Error(`Unexpected ${path}`);
                });
                const host = document.createElement("div");
                document.body.append(host);
                const root = createRoot(host);
                const onChanged = async (strict?: boolean) => {
                    syncStrict = strict;
                    if (failure === "parent-sync") throw new Error("父级刷新失败");
                };
                try {
                    await act(async () =>
                        root.render(
                            <MemoryRouter>
                                <ConfigProvider theme={{ token: { motion: false } }}>
                                    <App>
                                        <AdminProvider>
                                            {mode === "single" ? (
                                                <ChannelModelManager channel={{ id: "channel-1", name: "组", enabled: true } as any} onChanged={onChanged} />
                                            ) : (
                                                <AllChannelModelsPanel channels={[]} health={new Map()} healthLoading={false} onChanged={onChanged} onOpenChannel={() => {}} />
                                            )}
                                        </AdminProvider>
                                    </App>
                                </ConfigProvider>
                            </MemoryRouter>,
                        ),
                    );
                    const selectAll = host.querySelector('thead input[type="checkbox"]') as HTMLInputElement;
                    expect(selectAll).toBeTruthy();
                    await act(async () => selectAll.click());
                    expect([...host.querySelectorAll("button")].some((item) => item.textContent?.trim() === "修改协议")).toBe(false);
                    await click("批量修改");
                    if (action === "协议") await choose("text");
                    else await act(async () => (document.querySelector('input[aria-label="修改备注"]') as HTMLInputElement).click());
                    await click("保存");
                    expect(writes).toBe(1);
                    expect(document.body.textContent!.match(/已保存，刷新失败/g)).toHaveLength(1);
                    expect(document.body.textContent).not.toContain("已修改 1 个模型");
                    expect(document.querySelector('input[aria-label="文本调用协议"]')).toBeNull();
                    expect(document.querySelector('input[aria-label="修改备注"]')).toBeNull();
                    if (failure === "parent-sync") expect(syncStrict).toBe(true);
                } finally {
                    await act(async () => root.unmount());
                    host.remove();
                }
            });
        }
    }
}
