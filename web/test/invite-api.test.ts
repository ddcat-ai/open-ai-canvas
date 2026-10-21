import { afterEach, describe, expect, test } from "bun:test";

import { linuxDOLoginURL, register } from "../src/services/api/auth";
import {
    approveAdminInvite,
    approveAdminWithdrawal,
    createTransfer,
    createWithdrawal,
    deleteAdminInvite,
    freezeAdminInvite,
    getAdminInviteDetail,
    getAdminInviteSetting,
    getAdminWithdrawalDetail,
    getInviteOverview,
    getInvitePolicy,
    getMyWithdrawAccount,
    listAdminInvites,
    listAdminWithdrawals,
    listMyInviteRecords,
    listMyTransfers,
    listMyWithdrawals,
    rejectAdminWithdrawal,
    saveMyWithdrawAccount,
    updateAdminInviteInviters,
    updateAdminInviteSetting,
    type InvitePolicy,
} from "../src/services/api/invite";
import { apiClient, ApiError } from "../src/services/api/request";

const originalAdapter = apiClient.defaults.adapter;

afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

function captureRequests(result: unknown = {}) {
    const calls: Array<{ method: string; url: string; body: unknown; params: unknown; credentials: boolean | undefined }> = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push({ method: config.method || "", url: config.url || "", body: config.data ? JSON.parse(config.data) : undefined, params: config.params, credentials: config.withCredentials });
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: result, msg: "ok" } };
    };
    return calls;
}

const policy: InvitePolicy = {
    enabled: false,
    level: 1,
    rewardScopes: ["product"],
    l1RateBp: 1000,
    l2RateBp: 0,
    rewardCountLimit: 0,
    inviteeCountLimit: 0,
    auditEnabled: true,
    withdrawEnabled: false,
    withdrawMinFen: 100,
    withdrawDailyLimit: 1,
    withdrawFeeBp: 0,
    withdrawMethods: ["alipay"],
    transferEnabled: false,
    transferRateMilli: 1000,
    transferMinFen: 100,
    productRates: { product1: { l1RateBp: 500 } },
};

describe("邀请 API 合同", () => {
    test("读取接口解包一次并使用登录态与分页查询", async () => {
        const result = { records: [], total: 0, page: 2, pageSize: 10 };
        const calls = captureRequests(result);
        await expect(listMyInviteRecords(2, 10)).resolves.toEqual(result);
        await getInvitePolicy();
        await getInviteOverview();
        await listMyWithdrawals(2, 10);
        await listMyTransfers(2, 10);
        await getMyWithdrawAccount();
        expect(calls.map(({ url }) => url)).toEqual(["/invites/me/records", "/invites/policy", "/invites/me/overview", "/invites/me/withdrawals", "/invites/me/transfers", "/invites/me/withdraw-account"]);
        expect(calls[0].params).toEqual({ page: 2, pageSize: 10 });
        expect(calls.every((call) => call.credentials && call.method === "get")).toBe(true);
    });

    test("提现申请按分提交，只传对应实名收款资料，划转使用独立接口", async () => {
        const calls = captureRequests();
        const account = { account: "receiver@example.test", realName: "测试用户" };
        await createWithdrawal({ amountFen: 101, method: "alipay", account, saveAccount: true });
        await saveMyWithdrawAccount({ method: "alipay", info: account });
        await createTransfer({ amountFen: 100 });
        expect(calls[0]).toMatchObject({ method: "post", url: "/invites/me/withdrawals", body: { amountFen: 101, method: "alipay", account, saveAccount: true } });
        expect(calls[1]).toMatchObject({ method: "put", url: "/invites/me/withdraw-account", body: { method: "alipay", info: account } });
        expect(calls[2]).toMatchObject({ method: "post", url: "/invites/me/transfers", body: { amountFen: 100 } });
    });

    test("后台待审核状态 0 不会被过滤掉，金额写入与管理动作使用正确路由", async () => {
        const calls = captureRequests();
        await listAdminWithdrawals({ status: 0, method: "", keyword: "user", page: 1 });
        await listAdminInvites({ status: "pending", page: 2 });
        await getAdminInviteSetting();
        await updateAdminInviteSetting(policy);
        await approveAdminWithdrawal("withdraw-1");
        await rejectAdminWithdrawal("withdraw-1", "收款信息不完整");
        await approveAdminInvite("user-1");
        await freezeAdminInvite("user-1");
        await updateAdminInviteInviters("user-1", { l1InviterId: "a", l2InviterId: "" });
        await deleteAdminInvite("user-1");
        expect(calls[0].params).toEqual({ status: 0, keyword: "user", page: 1 });
        expect(calls[3]).toMatchObject({ method: "patch", url: "/admin/settings/invite", body: policy });
        expect(calls.slice(4).map(({ method, url, body }) => ({ method, url, body }))).toEqual([
            { method: "post", url: "/admin/withdrawals/withdraw-1/approve", body: undefined },
            { method: "post", url: "/admin/withdrawals/withdraw-1/reject", body: { reason: "收款信息不完整" } },
            { method: "post", url: "/admin/invites/user-1/approve", body: undefined },
            { method: "post", url: "/admin/invites/user-1/freeze", body: undefined },
            { method: "patch", url: "/admin/invites/user-1", body: { l1InviterId: "a", l2InviterId: "" } },
            { method: "delete", url: "/admin/invites/user-1", body: undefined },
        ]);
    });

    test("详情 ID 被编码，避免路径或查询字符改变审核目标", async () => {
        const calls = captureRequests();
        await getAdminInviteDetail("user/a?status=approved");
        await getAdminWithdrawalDetail("withdraw/a?approved=1");
        expect(calls[0].url).toBe("/admin/invites/user%2Fa%3Fstatus%3Dapproved");
        expect(calls[1].url).toBe("/admin/withdrawals/withdraw%2Fa%3Fapproved%3D1");
    });

    test("业务失败继续抛出机器可读原因，不能当作提交成功", async () => {
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 409, data: null, reason: "reward_balance_insufficient", msg: "余额不足" } });
        try {
            await createTransfer({ amountFen: 100 });
            throw new Error("expected failure");
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            expect(error).toMatchObject({ code: 409, reason: "reward_balance_insufficient", message: "余额不足" });
        }
    });

    test("取消读取保留 AbortError", async () => {
        const calls = captureRequests();
        const controller = new AbortController();
        controller.abort();
        await expect(getInvitePolicy(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(calls).toHaveLength(0);
    });
});

describe("邀请注册", () => {
    test("普通注册传递邀请码和现有协议确认，不依赖额外站点协议", async () => {
        const calls = captureRequests({ user: { id: "new-user" } });
        await register({ username: "invited-user", password: "fake-password-123", acceptedTerms: true, inviteCode: "ABC123", ticket: "verification-ticket" });
        expect(calls[0]).toMatchObject({ method: "post", url: "/auth/register", body: { username: "invited-user", password: "fake-password-123", acceptedTerms: true, inviteCode: "ABC123", ticket: "verification-ticket" } });
        expect(calls[0].body).not.toHaveProperty("agreeToTerms");
    });

    test("OAuth 保留原跳转和 acceptedTerms，并编码邀请码", () => {
        const result = new URL(linuxDOLoginURL("/projects?q=hello&sort=recent", true, { inviteCode: "AB&CD" }), "https://example.test");
        expect(result.pathname).toBe("/api/auth/linuxdo/start");
        expect(result.searchParams.get("next")).toBe("/projects?q=hello&sort=recent");
        expect(result.searchParams.get("acceptedTerms")).toBe("true");
        expect(result.searchParams.get("inviteCode")).toBe("AB&CD");
        const login = new URL(linuxDOLoginURL("/"), "https://example.test");
        expect(login.searchParams.has("acceptedTerms")).toBe(false);
        expect(login.searchParams.has("inviteCode")).toBe(false);
    });
});
