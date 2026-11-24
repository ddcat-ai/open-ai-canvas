import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Document: dom.Document,
    DocumentFragment: dom.DocumentFragment,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    Element: dom.Element,
    Node: dom.Node,
    ShadowRoot: dom.ShadowRoot,
    SVGElement: dom.SVGElement,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { apiClient } = await import("../src/services/api/request");
const { ChannelModelManager } = await import("../src/pages/admin/components/channel-model-manager");
const { useChannelKeySort } = await import("../src/pages/admin/channels/use-channel-key-sort");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("Key 拖拽保存完整预期顺序，外来拖拽与失败保存不改变列表", async () => {
    const original = apiClient.request;
    const writes: unknown[] = [];
    let order = ["other", "a", "hidden", "b"];
    let rejectWrite = false;
    let refreshed = 0;
    apiClient.request = (async (config: { url: string; method?: string; data?: { ids: string[]; expectedIds: string[] } }) => {
        if (config.url !== "/admin/channels/order") throw new Error(`Unexpected ${config.url}`);
        if (config.method?.toLowerCase() === "put") {
            writes.push(config.data);
            if (rejectWrite) throw new Error("并发修改冲突");
            expect(config.data!.expectedIds).toEqual(order);
            order = config.data!.ids;
        }
        return { data: { code: 0, data: { items: order.map((id) => ({ id, name: id, enabled: true })), saved: true }, msg: "ok" }, status: 200 };
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    function Harness() {
        const keys = order.filter((id) => ["a", "b"].includes(id));
        const sort = useChannelKeySort({
            scopeId: "site",
            groupIds: keys,
            onSaved: async () => {
                refreshed++;
                root.render(
                    <App>
                        <Harness />
                    </App>,
                );
            },
        });
        return (
            <>
                {keys.map((id) => (
                    <section key={id} data-id={id} {...sort.targetProps(id)}>
                        <button {...sort.handleProps(id)}>{id}</button>
                    </section>
                ))}
            </>
        );
    }
    const dragEvent = (name: string) => {
        const event = new dom.Event(name, { bubbles: true, cancelable: true });
        Object.defineProperty(event, "dataTransfer", { value: { setData() {}, effectAllowed: "", dropEffect: "" } });
        return event;
    };
    const drop = async (source: string | null, target: string) => {
        if (source) await act(async () => host.querySelector(`[data-id="${source}"] button`)!.dispatchEvent(dragEvent("dragstart")));
        await act(async () => host.querySelector(`[data-id="${target}"]`)!.dispatchEvent(dragEvent("drop")));
    };
    try {
        await act(async () =>
            root.render(
                <App>
                    <Harness />
                </App>,
            ),
        );
        await drop(null, "b");
        expect(writes).toHaveLength(0);
        await drop("a", "b");
        expect(order).toEqual(["other", "b", "hidden", "a"]);
        expect(writes).toEqual([{ ids: order, expectedIds: ["other", "a", "hidden", "b"] }]);
        expect(refreshed).toBe(1);
        rejectWrite = true;
        await drop("b", "a");
        expect(order).toEqual(["other", "b", "hidden", "a"]);
        expect(refreshed).toBe(1);
        expect(document.body.textContent).toContain("并发修改冲突");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.request = original;
    }
});

test("StrictMode 新 Key 自动读取只请求一次，并保留首次结果和手动重读", async () => {
    const original = apiClient.request;
    let fetches = 0;
    apiClient.request = (async (config: { url: string }) => {
        let data: unknown;
        if (config.url === "/plugins/catalog") data = { providers: [] };
        else if (config.url.endsWith("/catalog-status")) data = { models: [], stale: false };
        else if (config.url.endsWith("/models/fetch")) {
            fetches += 1;
            data = {
                models: ["first-model"],
                added: fetches === 1 ? ["first-model"] : [],
                retained: fetches === 1 ? [] : ["first-model"],
                missing: [],
                firstRead: fetches === 1,
                baselineReset: false,
                readAt: "2026-11-08T00:00:00Z",
            };
        } else if (config.url.endsWith("/models")) data = { models: [] };
        else throw new Error(`Unexpected request ${config.url}`);
        return { data: { code: 0, data, msg: "ok" }, status: 200 };
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let consumed = 0;
    const renderManager = (autoFetch: boolean) => (
        <StrictMode>
            <App>
                <ChannelModelManager
                    channel={{ id: "key-strict", websiteId: "site", name: "Key C", baseUrl: "https://example.invalid/v1", apiFormat: "openai", apiKey: "", models: [] }}
                    autoFetch={autoFetch}
                    onAutoFetchConsumed={() => {
                        consumed += 1;
                    }}
                    onChanged={() => {}}
                />
            </App>
        </StrictMode>
    );
    try {
        await act(async () => root.render(renderManager(true)));
        expect(fetches).toBe(1);
        expect(consumed).toBe(1);
        expect(document.body.textContent).toContain("首次读取");
        expect(document.body.textContent).toContain("新增 1 · 仍在目录 0");
        await act(async () => root.render(renderManager(false)));
        const cancel = Array.from(document.querySelectorAll(".admin-model-import-modal button")).find((button) => button.textContent?.replace(/\s/g, "") === "取消") as HTMLButtonElement | undefined;
        expect(cancel).toBeDefined();
        await act(async () => cancel!.click());
        const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("读取模型"));
        expect(retry).toBeDefined();
        await act(async () => retry!.click());
        expect(fetches).toBe(2);
        expect(consumed).toBe(1);
        expect(document.body.textContent).toContain("与上次成功读取比较");
        expect(document.body.textContent).toContain("新增 0 · 仍在目录 1");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.request = original;
    }
});

test("保存 Key 后读取失败保留组，重新读取显示差异且仅确认后导入", async () => {
    const original = apiClient.request;
    let fetches = 0;
    const writes: Array<{ url: string; data: unknown }> = [];
    apiClient.request = (async (config: { url: string; method?: string; data?: unknown }) => {
        let data: unknown;
        if (config.url === "/plugins/catalog") data = { providers: [] };
        else if (config.url.endsWith("/catalog-status")) data = { models: ["old"], readAt: "2026-11-01T00:00:00Z", stale: true };
        else if (config.url.endsWith("/models/fetch")) {
            fetches += 1;
            if (fetches === 1) throw new Error("上游鉴权失败");
            data = { models: ["new"], added: ["new"], retained: [], missing: ["old"], firstRead: false, baselineReset: false, readAt: "2026-11-08T00:00:00Z" };
        } else if (config.url.endsWith("/models/import")) {
            writes.push({ url: config.url, data: config.data });
            data = { models: ["new"], added: 1 };
        } else if (config.url.endsWith("/models")) data = { models: [] };
        else throw new Error(`Unexpected request ${config.url}`);
        return { data: { code: 0, data, msg: "ok" }, status: 200 };
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let consumed = 0;
    try {
        await act(async () =>
            root.render(
                <App>
                    <ChannelModelManager
                        channel={{ id: "key-a", websiteId: "site", name: "Key A", baseUrl: "https://example.invalid/v1", apiFormat: "openai", apiKey: "", models: [] }}
                        autoFetch
                        onAutoFetchConsumed={() => {
                            consumed += 1;
                        }}
                        onChanged={() => {}}
                    />
                </App>,
            ),
        );
        expect(consumed).toBe(1);
        expect(fetches).toBe(1);
        expect(document.body.textContent).toContain("Key 已保存，模型读取失败");
        expect(host.textContent).toContain("旧 Key 或旧地址");
        expect(writes).toHaveLength(0);
        const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("读取模型"));
        expect(retry).toBeDefined();
        await act(async () => retry!.click());
        expect(document.body.textContent).toContain("本次未返回：old");
        expect(document.body.textContent).toContain("new · 新增");
        expect(writes).toHaveLength(0);
        const all = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.replace(/\s/g, "") === "全选");
        expect(all).toBeDefined();
        await act(async () => all!.click());
        const confirm = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("确认导入"));
        await act(async () => confirm!.click());
        expect(writes).toEqual([{ url: "/admin/channels/key-a/models/import", data: { models: ["new"] } }]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.request = original;
    }
});

test("网站共享筛选重置各组分页和选择，排序仍使用对应 Key", async () => {
    const original = apiClient.request;
    const orders: string[] = [];
    apiClient.request = (async (config: { url: string }) => {
        let data: unknown;
        if (config.url === "/plugins/catalog") data = { providers: [] };
        else if (config.url.endsWith("/catalog-status")) data = { models: [], stale: false };
        else if (config.url.endsWith("/models/order")) {
            orders.push(config.url);
            data = { items: [] };
        } else if (config.url.endsWith("/models")) {
            const key = config.url.includes("key-a") ? "a" : "b";
            data = {
                models: Array.from({ length: key === "a" ? 21 : 2 }, (_, i) => ({
                    id: `${key}-${i}`,
                    modelKey: `${key}-model-${i}`,
                    displayName: `${key}-name-${i}`,
                    capability: "image",
                    enabled: true,
                    priceVersion: 1,
                    priceTiers: [],
                })),
            };
        } else throw new Error(`Unexpected request ${config.url}`);
        return { data: { code: 0, data, msg: "ok" }, status: 200 };
    }) as typeof apiClient.request;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (keyword: string) => (
        <App>
            {["a", "b"].map((key) => (
                <section key={key} data-group={key}>
                    <ChannelModelManager
                        channel={{ id: `key-${key}`, name: key, baseUrl: "https://example.invalid", apiFormat: "openai", apiKey: "", models: [] }}
                        groupHeading={<h3>{key}</h3>}
                        groupActions={(open) => <button onClick={open}>排序 {key}</button>}
                        filters={{ keyword, capability: "all", status: "all" }}
                        onChanged={() => {}}
                    />
                </section>
            ))}
        </App>
    );
    try {
        await act(async () => root.render(render("")));
        const a = host.querySelector('[data-group="a"]')!;
        const b = host.querySelector('[data-group="b"]')!;
        expect(host.querySelectorAll(".admin-list-toolbar")).toHaveLength(0);
        expect(b.querySelector(".admin-table-pagination")).toBeNull();
        await act(async () => (a.querySelector('[aria-label="下一页"]') as HTMLButtonElement).click());
        expect(a.textContent).toContain("a-name-20");
        await act(async () => (a.querySelector('tbody input[type="checkbox"]') as HTMLInputElement).click());
        expect(a.textContent).toContain("统一调价");
        await act(async () => root.render(render("model-0")));
        expect(a.textContent).toContain("a-name-0");
        expect(a.textContent).not.toContain("a-name-20");
        expect(b.textContent).toContain("b-name-0");
        expect(a.querySelector(".admin-table-pagination")).toBeNull();
        expect(a.textContent).not.toContain("统一调价");
        const sort = Array.from(b.querySelectorAll("button")).find((button) => button.textContent === "排序 b")!;
        await act(async () => sort.click());
        expect(orders).toEqual(["/admin/channels/key-b/models/order"]);
        await act(async () => root.render(render("")));
        expect(a.querySelector('[aria-current="page"]')?.textContent).toBe("1");
        expect(b.textContent).toContain("b-name-1");
    } finally {
        await act(async () => root.unmount());
        host.remove();
        apiClient.request = original;
    }
});
