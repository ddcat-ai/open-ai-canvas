import { describe, expect, test } from "bun:test";
import { apiClient, ApiError } from "../src/services/api/request";
import { cancelWechatRegistration, completeWechatRegistration, getAdminWechatSetting, getWechatRegistration, profileWechatURL, updateAdminWechatSetting, wechatLoginURL } from "../src/services/api/wechat";

describe("WeChat authentication request contract", () => {
    test("encodes the return path and agreement without adding credentials to URLs", () => {
        const next = "/projects?title=a&tab=mine#image";
        const url = new URL(wechatLoginURL(next, true), "https://canvas.example.com");
        expect(url.pathname).toEndWith("/auth/wechat/start");
        expect(url.searchParams.get("next")).toBe(next);
        expect(url.searchParams.get("acceptedTerms")).toBe("true");
        expect([...url.searchParams.keys()].sort()).toEqual(["acceptedTerms", "next"]);
        expect(profileWechatURL("bind")).toEndWith("/auth/profile/wechat/bind");
        expect(profileWechatURL("reauth")).toEndWith("/auth/profile/wechat/start");
    });
    test("keeps the app secret and verification codes in request bodies and uses the pending cookie", async () => {
        const original = apiClient.request;
        const requests: Array<Record<string, unknown>> = [];
        apiClient.request = (async (config: Record<string, unknown>) => {
            requests.push(config);
            return { data: { code: 0, data: { user: { id: "user-1" }, next: "/projects" }, msg: "ok" }, status: 200 };
        }) as typeof apiClient.request;
        try {
            const signal = new AbortController().signal;
            await getAdminWechatSetting();
            await updateAdminWechatSetting({ enabled: true, appId: "wx-app", appSecret: "private-secret", redirectUrl: "https://canvas.example.com/api/auth/wechat/callback" });
            await getWechatRegistration(signal);
            await completeWechatRegistration({ email: "creator@example.com", ticket: "verification-ticket", emailCode: "123456", acceptedTerms: true });
            await cancelWechatRegistration();
            expect(requests[1]).toMatchObject({ url: "/admin/settings/wechat", method: "patch", data: { appSecret: "private-secret" } });
            expect(requests[2]).toMatchObject({ url: "/auth/wechat/registration", method: "get", signal });
            expect(requests[3]).toMatchObject({ url: "/auth/wechat/registration", method: "post", data: { ticket: "verification-ticket", emailCode: "123456" } });
            expect(requests[4]).toMatchObject({ url: "/auth/wechat/registration", method: "delete" });
            expect(requests.every((request) => !String(request.url).includes("?") && request.params === undefined)).toBe(true);
        } finally {
            apiClient.request = original;
        }
    });
    test("propagates registration rejection instead of treating HTTP 200 as success", async () => {
        const original = apiClient.request;
        apiClient.request = (async () => ({ data: { code: 40001, data: null, msg: "验证码无效", reason: "bad_auth_request" }, status: 200 })) as typeof apiClient.request;
        try {
            let failure: unknown;
            try {
                await completeWechatRegistration({ email: "creator@example.com", acceptedTerms: true });
            } catch (cause) {
                failure = cause;
            }
            expect(failure).toBeInstanceOf(ApiError);
            expect((failure as ApiError).reason).toBe("bad_auth_request");
        } finally {
            apiClient.request = original;
        }
    });
});
