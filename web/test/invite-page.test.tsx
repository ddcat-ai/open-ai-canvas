import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { InviteOverview } from "../src/services/api/invite";

const dom = new Window({ url: "https://canvas.example.test/invite" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    __APP_VERSION__: "test",
    __APP_CHANGELOG__: "",
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { createMemoryRouter, RouterProvider } = await import("react-router");
const { default: InvitePage } = await import("../src/pages/invite");
const { default: InviteSettingsPage } = await import("../src/pages/admin/settings/invite-settings-page");
const { apiClient } = await import("../src/services/api/request");
const originalAdapter = apiClient.defaults.adapter;

afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function overview(enabled = false): InviteOverview {
    return {
        inviteCode: "ABC123",
        inviteeCount: 1,
        account: { totalMicroYuan: 2_000_000, availableMicroYuan: 1_006_000, frozenMicroYuan: 994_000, usedMicroYuan: 0, todayRewardMicroYuan: 2_000_000 },
        policy: {
            enabled,
            level: 1,
            rewardScopes: ["product"],
            l1RateBp: 1000,
            l2RateBp: 0,
            auditEnabled: true,
            withdrawEnabled: enabled,
            withdrawMinFen: 100,
            withdrawDailyLimit: 1,
            withdrawFeeBp: 0,
            withdrawMethods: ["alipay"],
            transferEnabled: enabled,
            transferRateMilli: 1000,
            transferMinFen: 100,
        },
    };
}

async function fixture(options: { enabled?: boolean; overviewFailsOnce?: boolean } = {}) {
    const requests: Array<{ url: string; body?: unknown }> = [];
    let overviewReads = 0;
    apiClient.defaults.adapter = async (config) => {
        requests.push({ url: config.url || "", body: config.data ? JSON.parse(config.data) : undefined });
        const empty = { records: [], total: 0, page: 1, pageSize: 10 };
        let data: unknown = empty;
        let code = 0;
        let msg = "ok";
        if (config.url === "/invites/me/overview") {
            overviewReads += 1;
            if (options.overviewFailsOnce && overviewReads === 1) {
                code = 503;
                msg = "邀请服务暂不可用";
            }
            data = overview(options.enabled);
        } else if (config.url === "/invites/me/records") {
            data = {
                ...empty,
                total: 1,
                records: [
                    {
                        userId: "invited-1",
                        l1InviterId: "inviter-1",
                        l2InviterId: "",
                        codeUsed: "ABC123",
                        status: "approved",
                        createdAt: "2026-10-21T10:00:00Z",
                        myLevel: 1,
                        inviteeUsername: "friend",
                        inviteeDisplayName: "受邀好友",
                        myCreditedMicroYuan: 2_000_000,
                        myPendingMicroYuan: 0,
                    },
                ],
            };
        } else if (config.url === "/invites/me/withdrawals") {
            data = {
                ...empty,
                total: 1,
                records: [
                    {
                        id: "withdraw-1",
                        userId: "inviter-1",
                        amountMicroYuan: 1_000_000,
                        feeMicroYuan: 0,
                        actualMicroYuan: 1_000_000,
                        method: "alipay",
                        status: 1,
                        rejectReason: "请核对收款姓名",
                        createdAt: "2026-10-21T10:00:00Z",
                    },
                ],
            };
        } else if (config.url === "/invites/me/withdraw-account") {
            data = { account: null };
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code, data, msg } };
    };
    const host = document.createElement("div");
    document.body.append(host);
    const errors: unknown[] = [];
    const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
    await act(async () =>
        root.render(
            <App>
                <InvitePage />
            </App>,
        ),
    );
    return {
        host,
        requests,
        errors,
        dispose: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}

function buttonWithText(label: string, within: ParentNode = document) {
    const button = Array.from(within.querySelectorAll("button")).find((candidate) => candidate.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    if (!button) throw new Error(`Button not found: ${label}`);
    return button;
}

test("默认关闭邀请与提现划转时仍可查看历史邀请和奖励余额", async () => {
    const page = await fixture();
    try {
        expect(page.errors).toEqual([]);
        expect(page.host.textContent).toContain("邀请活动已暂停");
        expect(page.host.textContent).toContain("受邀好友");
        expect(page.host.textContent).toContain("2.00");
        const labels = Array.from(page.host.querySelectorAll("button")).map((button) => button.textContent?.trim());
        expect(labels).not.toContain("复制邀请链接");
        expect(labels).not.toContain("提现");
        expect(labels).not.toContain("划转积分");
    } finally {
        await page.dispose();
    }
});

test("概览读取失败会展示错误，重试后恢复真实邀请码和邀请操作", async () => {
    const page = await fixture({ enabled: true, overviewFailsOnce: true });
    try {
        expect(page.host.querySelector('[role="alert"]')?.textContent).toContain("邀请服务暂不可用");
        expect(page.host.querySelector(".invite-balances")?.textContent).not.toContain("2.00");
        await act(async () => buttonWithText("重试", page.host).click());
        expect(page.host.querySelector('[role="alert"]')).toBeNull();
        expect(page.host.textContent).toContain("ABC123");
        expect(buttonWithText("复制邀请链接", page.host)).toBeDefined();
        expect(page.requests.filter((request) => request.url === "/invites/me/overview")).toHaveLength(2);
        expect(page.errors).toEqual([]);
    } finally {
        await page.dispose();
    }
});

test("提现标签加载独立记录，并显示后端驳回原因", async () => {
    const page = await fixture();
    try {
        await act(async () => buttonWithText("提现记录", page.host).click());
        const tab = page.host.querySelector("#invite-tab-withdrawals");
        expect(tab?.getAttribute("aria-selected")).toBe("true");
        expect(page.host.querySelector("#invite-panel-withdrawals")?.textContent).toContain("已驳回 · 请核对收款姓名");
        expect(page.requests.some((request) => request.url === "/invites/me/withdrawals")).toBe(true);
        expect(page.errors).toEqual([]);
    } finally {
        await page.dispose();
    }
});

test("实际划转弹窗的全部按钮向下取整到分，并发送整分金额", async () => {
    const page = await fixture({ enabled: true });
    try {
        await act(async () => buttonWithText("划转积分", page.host).click());
        await act(async () => await new Promise((resolve) => setTimeout(resolve, 30)));
        const modal = document.querySelector<HTMLElement>(".invite-modal");
        expect(modal).not.toBeNull();
        await act(async () => buttonWithText("全部", modal!).click());
        expect(modal!.querySelector("input")?.value).toBe("1.00");
        const submit = buttonWithText("确认划转", modal!);
        expect(submit.disabled).toBe(false);
        await act(async () => {
            submit.click();
            submit.click();
        });
        const transfers = page.requests.filter((request) => request.url === "/invites/me/transfers" && request.body);
        expect(transfers).toHaveLength(1);
        expect(transfers[0].body).toEqual({ amountFen: 100 });
        expect(page.errors).toEqual([]);
    } finally {
        await page.dispose();
    }
});

test("邀请关闭时仍可独立开启提现和划转，保存时不会启用新邀请", async () => {
    let savedPolicy: Record<string, unknown> | null = null;
    const initial = {
        ...overview().policy,
        rewardCountLimit: 0,
        inviteeCountLimit: 0,
        productRates: {},
        updatedBy: "admin",
        createdAt: "2026-10-21T10:00:00Z",
        updatedAt: "2026-10-21T10:00:00Z",
    };
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") savedPolicy = JSON.parse(config.data);
        const data = config.url === "/admin/payments/products" ? { products: [] } : { setting: { ...initial, ...savedPolicy } };
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } };
    };
    const router = createMemoryRouter(
        [
            {
                path: "/admin/settings/invite",
                element: (
                    <App>
                        <InviteSettingsPage />
                    </App>
                ),
            },
        ],
        { initialEntries: ["/admin/settings/invite"] },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<RouterProvider router={router} />));
        expect(host.textContent).toContain("邀请功能已关闭");
        expect(host.textContent).toContain("提现设置");
        expect(host.textContent).toContain("划转设置");
        expect(host.textContent).not.toContain("一级邀请奖励率");
        const switches = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
        expect(switches).toHaveLength(3);
        await act(async () => switches[1].click());
        await act(async () => switches[2].click());
        await act(async () => buttonWithText("保存", host).click());
        expect(savedPolicy).toMatchObject({ enabled: false, withdrawEnabled: true, transferEnabled: true, rewardScopes: ["product"] });
        expect(savedPolicy).not.toHaveProperty("planRates");
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        host.remove();
    }
});
