import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    localStorage: dom.localStorage,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { WorkspaceWalletModal } = await import("../src/components/layout/workspace-wallet-modal");
const { http } = await import("../src/services/api/request");
const { useAppearanceStore } = await import("../src/stores/use-appearance-store");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function fixture(online: boolean, links: boolean, legacy = "") {
    const originalGet = http.get;
    const appearance = useAppearanceStore.getState().appearance;
    useAppearanceStore.setState({ appearance: { ...appearance, redeemPurchaseUrl: legacy } });
    http.get = (async (path: string) => {
        if (path === "/wallet") return { account: { availableMicrocredits: 1000000, reservedMicrocredits: 0 }, entries: [], total: 0 };
        if (path === "/payments/products") return { products: online ? [{ id: "package", name: "在线积分套餐", enabled: true, canPurchase: true, amountFen: 100, creditsMicrocredits: 1000000 }] : [] };
        if (path === "/payments/providers") return { providers: online ? [{ id: "epay", name: "易支付", enabled: true, pluginEnabled: true, configured: true }] : [] };
        if (path === "/payments/wallet-links") return { links: links ? [{ id: "code", label: "兑换码套餐", url: "https://example.com/code" }] : [] };
        throw new Error(`Unexpected request: ${path}`);
    }) as typeof http.get;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const dispose = async () => {
        await act(async () => root.unmount());
        host.remove();
        http.get = originalGet;
        useAppearanceStore.setState({ appearance });
    };
    try {
        await act(async () =>
            root.render(
                <ConfigProvider theme={{ token: { motion: false } }}>
                    <App>
                        <WorkspaceWalletModal open onClose={() => {}} />
                    </App>
                </ConfigProvider>,
            ),
        );
        return { dispose, text: () => document.querySelector(".workspace-wallet-content")?.textContent || "" };
    } catch (error) {
        await dispose();
        throw error;
    }
}

test("online payment and code packages switch independently, with redemption still accessible", async () => {
    const f = await fixture(true, true);
    try {
        expect(f.text()).toContain("在线积分套餐");
        expect(f.text()).toContain("易支付");
        expect(f.text()).not.toContain("兑换码套餐");
        const label = Array.from(document.querySelectorAll("label")).find((node) => node.textContent === "购买兑换码")!;
        expect(label).toBeDefined();
        await act(async () => (label.querySelector("input") as HTMLInputElement).click());
        expect(f.text()).toContain("兑换码套餐");
        expect(f.text()).not.toContain("在线积分套餐");
        expect(f.text()).not.toContain("易支付");
        expect(f.text()).not.toContain("立即充值");
        const online = Array.from(document.querySelectorAll("label")).find((node) => node.textContent === "在线支付")!;
        await act(async () => (online.querySelector("input") as HTMLInputElement).click());
        expect(f.text()).toContain("在线积分套餐");
        expect(document.querySelector('.workspace-wallet-product[aria-pressed="true"]')?.textContent).toContain("在线积分套餐");
        expect(f.text()).not.toContain("兑换码套餐");
        await act(async () => (label.querySelector("input") as HTMLInputElement).click());
        const redeem = Array.from(document.querySelectorAll("button")).find((node) => node.textContent?.includes("已有兑换码，去兑换"))!;
        await act(async () => redeem.click());
        expect(document.querySelector('input[placeholder="输入 32 位兑换码"]')).not.toBeNull();
    } finally {
        await f.dispose();
    }
});

test("online-only and unavailable configurations keep their own content", async () => {
    for (const online of [true, false]) {
        const f = await fixture(online, false);
        try {
            expect(f.text()).not.toContain("购买兑换码");
            expect(f.text()).toContain(online ? "在线积分套餐" : "在线充值暂不可用");
        } finally {
            await f.dispose();
        }
    }
});

test("code-only configuration and legacy purchase link do not show online-payment errors", async () => {
    for (const links of [true, false]) {
        const f = await fixture(false, links, links ? "" : "https://example.com/legacy");
        try {
            expect(f.text()).toContain("购买兑换码");
            expect(f.text()).not.toContain("在线充值暂不可用");
            expect(document.querySelector('.workspace-wallet-content a[target="_blank"]')).not.toBeNull();
        } finally {
            await f.dispose();
        }
    }
});
