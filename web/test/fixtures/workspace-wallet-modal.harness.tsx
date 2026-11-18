import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { WalletHistoryEntry, WalletHistoryType, WalletSummary } from "../../src/services/api/wallet";

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

afterAll(() => dom.happyDOM.abort());

type WalletRequest = {
    type: WalletHistoryType;
    page: number;
    reply: (entries: WalletHistoryEntry[], total?: number) => void;
    fail: (message: string) => void;
};
const createdAt = "2026-11-17T10:47:32+08:00";
const billing: WalletHistoryEntry = {
    id: "billing",
    type: "billing",
    billingOrderId: "billing",
    billingStatus: "settled",
    reservedMicrocredits: 11_666,
    chargedMicrocredits: 3_904,
    refundedMicrocredits: 7_762,
    createdAt,
};
const income: WalletHistoryEntry = {
    id: "income",
    type: "payment_topup",
    amountMicrocredits: 1_000_000,
    paymentProviderId: "wechat-native",
    paymentProviderName: "微信支付",
    createdAt,
};

async function renderWallet(initialTab: "income" | "history" = "history") {
    const requests: WalletRequest[] = [];
    apiClient.defaults.adapter = async (request) => {
        const response = (data: unknown) => ({ status: 200, statusText: "OK", headers: {}, config: request, data: { code: 0, data } });
        if (request.url === "/wallet") {
            return new Promise((resolve, reject) => {
                requests.push({
                    type: request.params.type,
                    page: request.params.page,
                    reply: (entries, total = entries.length) =>
                        resolve(
                            response({
                                account: { userId: "member", availableMicrocredits: 1_000_000, reservedMicrocredits: 0, version: 1, createdAt, updatedAt: createdAt },
                                entries,
                                total,
                                page: request.params.page,
                                pageSize: request.params.pageSize,
                                policy: { signupBonusMicrocredits: 0, checkinBonusMicrocredits: 0, checkedInToday: false },
                            } satisfies WalletSummary),
                        ),
                    fail: (message) => reject(new Error(message)),
                });
            });
        }
        switch (request.url) {
            case "/payments/products":
                return response({ products: [] });
            case "/payments/providers":
                return response({ providers: [] });
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
                        <WorkspaceWalletModal open initialTab={initialTab} onClose={() => {}} />
                    </App>
                </QueryClientProvider>
            </MemoryRouter>,
        );
    });
    return {
        requests,
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

test("income sits before expenses, paginates separately and ignores late responses from the other tab", async () => {
    const modal = await renderWallet();
    try {
        const labels = [...document.querySelectorAll('[role="tab"]')].map((item) => item.textContent);
        expect(labels.indexOf("充值记录") + 1).toBe(labels.indexOf("积分消耗历史"));
        expect(modal.requests[0]).toMatchObject({ type: "expenses", page: 1 });
        await act(async () => modal.requests[0]!.reply([billing], 21));
        expect(document.body.textContent).toContain("实际消耗 0.003904 积分");
        await clickButton("下一页");
        expect(modal.requests[1]).toMatchObject({ type: "expenses", page: 2 });

        await clickButton("充值记录");
        expect(modal.requests[2]).toMatchObject({ type: "income", page: 1 });
        expect(document.body.textContent).not.toContain("实际消耗 0.003904 积分");
        await act(async () => modal.requests[2]!.reply([income], 21));
        expect(document.body.textContent).toContain("充值渠道：微信支付");
        expect(document.body.textContent).toContain("第 1 / 2 页");
        await act(async () => modal.requests[1]!.reply([{ ...billing, note: "过期消费响应" }], 41));
        expect(document.body.textContent).not.toContain("过期消费响应");
        expect(document.body.textContent).toContain("充值渠道：微信支付");

        await clickButton("下一页");
        expect(modal.requests[3]).toMatchObject({ type: "income", page: 2 });
        await act(async () => modal.requests[3]!.reply([{ ...income, id: "redeem", type: "redeem" }], 21));
        expect(document.body.textContent).toContain("兑换码充值");
        expect(document.body.textContent).toContain("第 2 / 2 页");

        await clickButton("积分消耗历史");
        expect(modal.requests[4]).toMatchObject({ type: "expenses", page: 1 });
        expect(document.body.textContent).not.toContain("兑换码充值");
        await act(async () => modal.requests[4]!.reply([]));
        expect(document.body.textContent).toContain("提交生成任务后，消费与结算记录会显示在这里。");
        expect(document.body.textContent).not.toContain("还没有充值记录");
    } finally {
        await modal.close();
    }
});

test("opening income directly uses its own empty state and retry filter", async () => {
    const modal = await renderWallet("income");
    try {
        expect(modal.requests[0]).toMatchObject({ type: "income", page: 1 });
        expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("充值记录");
        await act(async () => modal.requests[0]!.fail("充值历史暂时无法读取"));
        expect(document.body.textContent).toContain("充值历史暂时无法读取");
        expect(document.body.textContent).not.toContain("还没有充值记录");
        await clickButton("重试");
        expect(modal.requests[1]).toMatchObject({ type: "income", page: 1 });
        await act(async () => modal.requests[1]!.reply([]));
        expect(document.body.textContent).toContain("还没有充值记录");
        expect(document.body.textContent).not.toContain("充值历史暂时无法读取");
        expect(document.body.textContent).not.toContain("提交生成任务后，消费与结算记录会显示在这里。");
    } finally {
        await modal.close();
    }
});
