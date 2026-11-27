import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://canvas.example/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { MemoryRouter } = await import("react-router");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WorkspaceWalletModal } = await import("../../src/components/layout/workspace-wallet-modal");
const { apiClient } = await import("../../src/services/api/request");
const { MembershipCardsPanel } = await import("../../src/pages/admin/payments/membership-cards-panel");

afterAll(() => dom.happyDOM.abort());

const createdAt = "2026-11-17T10:47:32+08:00";
const product = {
    id: "membership-month",
    name: "月卡",
    kind: "membership",
    membershipDays: 30,
    membershipGroup: "vip",
    amountFen: 1990,
    currency: "CNY",
    creditsMicrocredits: 500_000_000,
    enabled: true,
    canPurchase: true,
    storageBytes: 0,
    storageDurationDays: 0,
    saleStrategy: "unlimited",
    sortOrder: 30,
    createdBy: "admin",
    updatedBy: "admin",
    createdAt,
    updatedAt: createdAt,
} as const;

test("membership admin can save a single card and switch off sales independently", async () => {
    let sales = true;
    const writes: { url: string | undefined; body: unknown }[] = [];
    apiClient.defaults.adapter = async (request) => {
        let payload: unknown;
        if (request.method === "put") {
            const body = JSON.parse(request.data);
            writes.push({ url: request.url, body });
            if (request.url?.endsWith("/sales")) sales = body.enabled;
            payload = { ok: true };
        } else if (request.url === "/payments/membership") payload = { salesEnabled: sales, baseGroup: "default", periods: [] };
        else if (request.url === "/admin/user-groups") payload = { groups: [{ code: "vip", name: "创作会员" }] };
        else throw new Error("unexpected admin request " + request.url);
        return { status: 200, statusText: "OK", config: request, headers: {}, data: { code: 0, data: payload } };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
        await act(async () =>
            root.render(
                <QueryClientProvider client={queryClient}>
                    <App>
                        <MembershipCardsPanel products={[product]} defaultCurrency="CNY" loading={false} reload={async () => {}} />
                    </App>
                </QueryClientProvider>,
            ),
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(host.querySelectorAll("form")).toHaveLength(4);
        await clickButton("保存月卡");
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(writes).toEqual([{ url: "/admin/payments/membership/cards/month", body: { enabled: true, amountFen: 1990, currency: "CNY", membershipGroup: "vip", creditsMicrocredits: 500_000_000 } }]);
        const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"]')!;
        await act(async () => toggle.click());
        expect(writes.at(-1)).toMatchObject({ url: "/admin/payments/membership/sales", body: { enabled: false } });
    } finally {
        await act(async () => root.unmount());
        queryClient.clear();
        host.remove();
    }
});

async function renderWallet() {
    const orders: Record<string, unknown>[] = [];
    apiClient.defaults.adapter = async (request) => {
        const response = (data: unknown) => ({ status: 200, statusText: "OK", headers: {}, config: request, data: { code: 0, data } });
        switch (request.url) {
            case "/payments/products":
                return response({ products: [product, { ...product, id: "credits", kind: "credits", name: "积分补充" }, { ...product, id: "membership-week", name: "周卡", membershipDays: 7, creditsMicrocredits: 0 }] });
            case "/payments/membership":
                return response({
                    salesEnabled: true,
                    baseGroup: "partner",
                    periods: [{ productName: "周卡", membershipGroup: "basic", startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() + 86_400_000).toISOString() }],
                });
            case "/payments/orders":
                orders.push(JSON.parse(request.data));
                return response({
                    order: {
                        id: "order-month",
                        productName: "月卡",
                        productKind: "membership",
                        membershipGroup: "vip",
                        membershipDays: 30,
                        creditsMicrocredits: 500_000_000,
                        status: "pending",
                        checkout: { mode: "" },
                        amountFen: product.amountFen,
                        currency: "CNY",
                        expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    },
                });
            case "/wallet":
                return response({ account: { availableMicrocredits: 0, reservedMicrocredits: 0 }, items: [], total: 0 });
            case "/payments/providers":
                return response({ providers: [{ id: "provider", name: "测试渠道", enabled: true, pluginEnabled: true, configured: true, settlementCurrency: "CNY" }] });
            case "/payments/settings":
                return response({ settings: { defaultCurrency: "CNY", usdCnyRate: "" } });
            case "/resources/storage-grants":
                return response({ grants: [] });
            case "/resources/storage-usage":
                return response({ usage: { usedBytes: 0, totalBytes: 1024 ** 3, baseBytes: 1024 ** 3, purchasedBytes: 0, overLimit: false, readOnly: false } });
            default:
                throw new Error(`Unexpected request ${request.url}`);
        }
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(
            <MemoryRouter>
                <QueryClientProvider client={queryClient}>
                    <App>
                        <WorkspaceWalletModal open initialTab="topup" onClose={() => {}} />
                    </App>
                </QueryClientProvider>
            </MemoryRouter>,
        );
    });
    return {
        orders,
        close: async () => {
            await act(async () => root.unmount());
            queryClient.clear();
            host.remove();
        },
    };
}

async function clickButton(label: string) {
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "") === label || item.getAttribute("aria-label") === label);
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
    await act(async () => button!.click());
}

test("wallet shows the queued switch and sends the displayed membership offer to checkout", async () => {
    const modal = await renderWallet();
    try {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect([...document.querySelectorAll("[data-topup-kind] h3")].map((heading) => heading.textContent)).toEqual(["会员卡", "加油包套餐", "存储空间套餐"]);
        const month = document.querySelector<HTMLButtonElement>('[data-plan="membership-month"]')!;
        const week = document.querySelector<HTMLButtonElement>('[data-plan="membership-week"]')!;
        expect(document.querySelector(".wallet-membership-card")).toBe(week);
        expect(month.textContent).toContain("赠 500 积分");
        expect(month.textContent).toContain("¥19.90");
        expect(week.textContent).not.toContain("赠");
        await act(async () => week.click());
        expect(week.getAttribute("aria-pressed")).toBe("true");
        expect(document.querySelector(".wallet-topup-checkout-summary")?.textContent).not.toContain("赠 0");
        await act(async () => month.click());
        expect(month.getAttribute("aria-pressed")).toBe("true");
        expect(document.body.textContent).toContain("全部会员时段结束后恢复分组 partner");
        expect(document.body.textContent).toContain("预计生效");
        await clickButton("立即支付");
        expect(modal.orders).toHaveLength(1);
        expect(modal.orders[0]).toMatchObject({ productId: "membership-month", providerId: "provider", membershipVersion: createdAt });
    } finally {
        await modal.close();
    }
});
