import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReferenceSelection } from "@/pages/ecommerce/tryon/reference-catalog";

const dom = new Window({ url: "https://reference.example.com/ecommerce", settings: { enableImageFileLoading: false } });
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    location: dom.location,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { apiClient } = await import("@/services/api/request");
const originalAdapter = apiClient.defaults.adapter;
apiClient.defaults.adapter = async (config) => ({
    status: 200,
    statusText: "OK",
    headers: {},
    config,
    data: {
        code: 0,
        data: {
            poses: [
                {
                    key: "ZX-P001",
                    code: "P001",
                    name: "S形站姿·侧移重心",
                    system: "基础",
                    category: "站姿",
                    sourceKey: "own",
                    items: [
                        { id: "front-1", angle: "正面", width: 600, height: 900, version: 1 },
                        { id: "below-1", angle: "仰视", width: 600, height: 900, version: 1 },
                    ],
                },
                { key: "ZX-P002", code: "P002", name: "双手拨发·舒展肩背", system: "基础", category: "站姿", sourceKey: "own", items: [{ id: "front-2", angle: "正面", width: 600, height: 900, version: 1 }] },
            ],
            total: 2,
            page: 1,
            pageSize: 40,
            facets: { categories: [{ name: "站姿", count: 2 }], systems: [], angles: [] },
        },
    },
});
const { TryOnReferenceLibrary } = await import("@/pages/ecommerce/tryon/reference-library");
afterAll(() => {
    apiClient.defaults.adapter = originalAdapter;
    dom.happyDOM.abort();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("角度只切预览，确认后才写入姿势位，选择不能超过空位", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let picked: ReferenceSelection[] = [],
        closed = false;
    try {
        await act(async () =>
            root.render(
                <App>
                    <TryOnReferenceLibrary
                        kind="pose"
                        room={1}
                        onClose={() => {
                            closed = true;
                        }}
                        onPersonal={() => {}}
                        onPick={async (items) => {
                            picked = items;
                        }}
                    />
                </App>,
            ),
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 260));
        });
        const click = (element: Element) => act(async () => (element as HTMLElement).click());
        await click(document.querySelector('[aria-label="S形站姿·侧移重心 · 仰视"]')!);
        expect(picked).toEqual([]);
        expect(document.querySelector('[aria-label="选择S形站姿·侧移重心 · 仰视"]')).not.toBeNull();
        await click(document.querySelector('[aria-label="选择S形站姿·侧移重心 · 仰视"]')!);
        expect(picked).toEqual([]);
        expect((document.querySelector('[aria-label="选择双手拨发·舒展肩背 · 正面"]') as HTMLButtonElement).disabled).toBe(true);
        const confirm = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.replace(/\s/g, "").includes("确认添加1张"))!;
        await click(confirm);
        expect(picked.map((item) => [item.entry.id, item.angle])).toEqual([["ZX-P001", "below"]]);
        expect(closed).toBe(true);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
