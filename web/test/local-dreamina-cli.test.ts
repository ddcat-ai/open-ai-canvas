import { describe, expect, test } from "bun:test";

const privateCanary = "dreamina-private-canary";
const fixedNow = Date.parse("2026-08-10T00:00:00.000Z");

test("Dreamina browser deadlines cover the complete official CLI lifecycle", async () => {
    const module = await import("../src/services/local-dreamina-cli");
    expect(module.DREAMINA_REQUEST_TIMEOUTS).toEqual({
        status: 30_000,
        login: 35_000,
        logout: 20_000,
    });
    for (const [action, expected] of Object.entries(module.DREAMINA_REQUEST_TIMEOUTS)) {
        expect(module.dreaminaRequestTimeout(action as "status" | "login" | "logout")).toBe(expected);
        expect(module.dreaminaRequestTimeout(action as "status" | "login" | "logout", 1_234)).toBe(1_234);
    }
});

describe("signed Dreamina CLI lifecycle client", () => {
    test("status login and logout use only fixed signed Runtime requests", async () => {
        const module = await import("../src/services/local-dreamina-cli").catch(() => ({}));
        expect(typeof (module as Record<string, unknown>).getDreaminaStatus).toBe("function");
        if (!("getDreaminaStatus" in module)) return;

        const calls: Array<{ path: string; method: string; headers: Headers; body: string }> = [];
        const client = {
            async request(path: string, init: RequestInit = {}) {
                calls.push({
                    path,
                    method: String(init.method || "GET"),
                    headers: new Headers(init.headers),
                    body: String(init.body || ""),
                });
                return jsonResponse({ ok: true, status: installedStatus() });
            },
        };

        await module.getDreaminaStatus(client, { now: () => fixedNow });
        await module.loginDreamina(client, { now: () => fixedNow });
        await module.logoutDreamina(client, { now: () => fixedNow });

        expect(calls.map((call) => [call.method, call.path, call.body])).toEqual([
            ["GET", "/dreamina/status", ""],
            ["POST", "/dreamina/login", "{}"],
            ["POST", "/dreamina/logout", "{}"],
        ]);
        expect(calls.every((call) => !call.headers.has("authorization"))).toBe(true);
        expect(calls.every((call) => !call.headers.has("x-canvas-agent-token"))).toBe(true);
        expect(JSON.stringify(calls)).not.toContain("ownerId");
    });

    test("projects bounded lifecycle status without preserving injected messages", async () => {
        const module = await import("../src/services/local-dreamina-cli");
        const result = await module.getDreaminaStatus({
            request: async () => jsonResponse({
                ok: true,
                status: { ...installedStatus(), message: `${privateCanary} C:\\Users\\owner\\Profile` },
            }),
        }, { now: () => fixedNow });

        expect(result).toEqual({
            provider: "dreamina-cli",
            state: "installed",
            installed: true,
            authenticated: false,
            version: "1.2.3",
            code: "dreamina_login_required",
            message: "Dreamina CLI 已安装，需要登录",
        });
        expect(JSON.stringify(result)).not.toContain(privateCanary);
        expect(JSON.stringify(result)).not.toContain("Profile");
    });

    test("projects only a bounded numeric Dreamina credit balance for authenticated status", async () => {
        const module = await import("../src/services/local-dreamina-cli");
        const result = await module.getDreaminaStatus({
            request: async () => jsonResponse({
                ok: true,
                status: { ...authenticatedStatus(), totalCredit: 24_940 },
            }),
        }, { now: () => fixedNow });

        expect(result.totalCredit).toBe(24_940);

        for (const totalCredit of [-1, 1.5, "24940", null, Number.MAX_SAFE_INTEGER]) {
            await expect(module.getDreaminaStatus({
                request: async () => jsonResponse({
                    ok: true,
                    status: { ...authenticatedStatus(), totalCredit },
                }),
            }, { now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_response_invalid" });
        }

        await expect(module.getDreaminaStatus({
            request: async () => jsonResponse({
                ok: true,
                status: { ...installedStatus(), totalCredit: 24_940 },
            }),
        }, { now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_response_invalid" });
    });

    test("keeps official pending verification fields and rejects state contradictions", async () => {
        const module = await import("../src/services/local-dreamina-cli");
        const expiresAt = new Date(fixedNow + 60_000).toISOString();
        const pending = await module.loginDreamina({
            request: async () => jsonResponse({
                ok: true,
                status: {
                    provider: "dreamina-cli",
                    state: "login_pending",
                    installed: true,
                    authenticated: false,
                    code: "dreamina_login_pending",
                    message: privateCanary,
                    verificationUri: "https://jimeng.jianying.com/ai-tool/cli-auth?verification_uri=https%3A%2F%2Fjimeng.jianying.com%2Fpassport%2Fopen",
                    userCode: "ABCD-EFGH",
                    expiresAt,
                },
            }),
        }, { now: () => fixedNow });

        expect(pending).toMatchObject({
            state: "login_pending",
            message: "请在官方页面确认 Dreamina 登录",
            userCode: "ABCD-EFGH",
            expiresAt,
        });
        expect(JSON.stringify(pending)).not.toContain(privateCanary);

        await expect(module.getDreaminaStatus({
            request: async () => jsonResponse({
                ok: true,
                status: { ...installedStatus(), state: "authenticated", authenticated: true },
            }),
        }, { now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_response_invalid" });
    });

    test("maps unknown Runtime errors and oversized bodies to stable public failures", async () => {
        const module = await import("../src/services/local-dreamina-cli");
        const privateError = module.getDreaminaStatus({
            request: async () => jsonResponse({ ok: false, code: "private_error", message: privateCanary }, 500),
        }, { now: () => fixedNow });
        await expect(privateError).rejects.toMatchObject({
            code: "dreamina_internal_error",
            message: "Dreamina CLI 请求失败",
        });
        await expect(privateError).rejects.not.toThrow(privateCanary);

        await expect(module.getDreaminaStatus({
            request: async () => new Response(JSON.stringify({ ok: true, status: installedStatus(), privateCanary }), {
                headers: { "content-length": String(70 * 1024) },
            }),
        }, { now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_response_invalid" });
    });

    test("cancellation and deadlines abort the in-flight signed request", async () => {
        const module = await import("../src/services/local-dreamina-cli");
        const cancelled = new AbortController();
        cancelled.abort();
        let calls = 0;
        await expect(module.getDreaminaStatus({
            request: async () => {
                calls++;
                return jsonResponse({ ok: true, status: installedStatus() });
            },
        }, { signal: cancelled.signal, now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_cancelled" });
        expect(calls).toBe(0);

        await expect(module.getDreaminaStatus({
            request: async (_path, init) => await new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
            }),
        }, { timeoutMs: 5, now: () => fixedNow })).rejects.toMatchObject({ code: "dreamina_timeout" });
    });
});

function installedStatus() {
    return {
        provider: "dreamina-cli",
        state: "installed",
        installed: true,
        authenticated: false,
        version: "1.2.3",
        code: "dreamina_login_required",
        message: "fixture",
    };
}

function authenticatedStatus() {
    return {
        provider: "dreamina-cli",
        state: "authenticated",
        installed: true,
        authenticated: true,
        version: "1.2.3",
        message: "fixture",
    };
}

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}
