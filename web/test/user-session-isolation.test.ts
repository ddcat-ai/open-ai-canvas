import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AxiosHeaders, type AxiosRequestConfig } from "axios";

import { assertCurrentUserSession, captureUserSession, getActiveUserScope, isUserSessionInvalidated, scopedLocalStorage, setActiveUserScope, subscribeUserSessionInvalidation } from "../src/lib/user-scope";
import { apiClient, http } from "../src/services/api/request";
import { getAuthSession, invalidateAuthSessionCache } from "../src/services/api/auth";
import { subscribeAgentEvents } from "../src/services/api/agent";

const scopeKey = "yingce:active-user-scope";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalRequest = apiClient.request;
const originalFetch = globalThis.fetch;
let browser: EventTarget & { localStorage: Storage };
const cleanups: Array<() => void> = [];

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => (resolve = done));
    return { promise, resolve };
}

function response<T>(data: T) {
    return { data: { code: 0, data, msg: "ok" }, status: 200, headers: {} };
}

function switchOtherTab(scope: string, notify = true) {
    browser.localStorage.setItem(scopeKey, scope);
    if (notify) browser.dispatchEvent(Object.assign(new Event("storage"), { key: scopeKey, newValue: scope }));
}

beforeEach(() => {
    const values = new Map<string, string>();
    browser = Object.assign(new EventTarget(), {
        localStorage: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => void values.set(key, value),
            removeItem: (key: string) => void values.delete(key),
            clear: () => values.clear(),
            key: (index: number) => [...values.keys()][index] ?? null,
            get length() {
                return values.size;
            },
        },
    });
    Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
    setActiveUserScope("user-a");
    invalidateAuthSessionCache();
});

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    apiClient.request = originalRequest;
    globalThis.fetch = originalFetch;
    invalidateAuthSessionCache();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    getActiveUserScope();
});

describe("account identity across browser tabs", () => {
    test("invalidates the old tab without reassigning its cached content to the new account", () => {
        const session = captureUserSession();
        let invalidations = 0;
        cleanups.push(subscribeUserSessionInvalidation(() => invalidations++));

        switchOtherTab("user-b");

        expect(invalidations).toBe(1);
        expect(session.signal.aborted).toBe(true);
        expect(getActiveUserScope()).toBe("user-a");
        expect(isUserSessionInvalidated()).toBe(true);
        expect(() => captureUserSession()).toThrow();
        scopedLocalStorage.setItem("pending-draft", "user-a-content");
        expect(browser.localStorage.getItem("pending-draft:user:user-a")).toBe("user-a-content");
        expect(browser.localStorage.getItem("pending-draft:user:user-b")).toBeNull();

        setActiveUserScope("user-b", captureUserSession(true));
        expect(getActiveUserScope()).toBe("user-b");
        expect(isUserSessionInvalidated()).toBe(false);
        expect(() => assertCurrentUserSession(session)).toThrow();
    });

    test("also invalidates an A to B to A transition and detects missed storage events on focus", () => {
        const session = captureUserSession();
        switchOtherTab("user-b");
        switchOtherTab("user-a");
        expect(() => assertCurrentUserSession(session, true)).toThrow();
        setActiveUserScope("user-a", captureUserSession(true));
        switchOtherTab("user-b", false);
        browser.dispatchEvent(new Event("focus"));
        expect(isUserSessionInvalidated()).toBe(true);
        expect(getActiveUserScope()).toBe("user-a");
    });

    test("binds JSON and binary requests to the tab identity and rejects an explicitly different owner", async () => {
        const requests: AxiosRequestConfig[] = [];
        apiClient.request = (async (config: AxiosRequestConfig) => {
            requests.push(config);
            return response({ ok: true });
        }) as typeof apiClient.request;

        await http.get("/mcp/connections");
        await http.raw({ method: "get", url: "/export", responseType: "blob" });
        expect(requests.map((config) => config.headers?.["X-Canvas-Expected-User"])).toEqual(["user-a", "user-a"]);
        await expect(http.post("/mcp/connections", {}, { headers: { "X-Canvas-Expected-User": "user-b" } })).rejects.toMatchObject({ name: "AbortError" });
        expect(requests).toHaveLength(2);
    });

    test("binds the expected identity without mutating reusable caller headers or dropping method headers", async () => {
        let sent: AxiosRequestConfig | undefined;
        apiClient.request = (async (config: AxiosRequestConfig) => {
            sent = config;
            return response({ ok: true });
        }) as typeof apiClient.request;
        const headers = {
            common: new AxiosHeaders({ "X-Shared": "common", "X-Priority": "common" }),
            get: new AxiosHeaders({ "X-Method": "get", "X-Priority": "method" }),
            "X-Priority": "direct",
            "X-Canvas-Expected-User": false,
            "X-Optional": undefined,
        };
        await http.get("/profile", { headers });
        expect(sent?.headers?.["X-Canvas-Expected-User"]).toBe("user-a");
        expect(sent?.headers?.["X-Shared"]).toBe("common");
        expect(sent?.headers?.["X-Method"]).toBe("get");
        expect(sent?.headers?.["X-Priority"]).toBe("direct");
        expect(headers["X-Canvas-Expected-User"]).toBe(false);
    });

    test("cancels in-flight requests and drops late responses even when the transport ignores abort", async () => {
        const pending = deferred<ReturnType<typeof response>>();
        let signal: AxiosRequestConfig["signal"];
        apiClient.request = (async (config: AxiosRequestConfig) => {
            signal = config.signal;
            return pending.promise;
        }) as typeof apiClient.request;
        const request = http.get("/mcp/connections");

        switchOtherTab("user-b");
        expect(signal?.aborted).toBe(true);
        setActiveUserScope("user-b", captureUserSession(true));
        pending.resolve(response({ items: ["old-account-data"] }));
        await expect(request).rejects.toMatchObject({ name: "AbortError" });
    });

    test("rejects a response after an unobserved cookie/scope switch and blocks new business requests", async () => {
        const pending = deferred<ReturnType<typeof response>>();
        let calls = 0;
        apiClient.request = (async () => {
            calls++;
            return pending.promise;
        }) as typeof apiClient.request;
        const request = http.get("/agent/conversations");
        switchOtherTab("user-b", false);
        pending.resolve(response({ items: [] }));
        await expect(request).rejects.toMatchObject({ name: "AbortError" });
        await expect(http.post("/mcp/connections", {})).rejects.toMatchObject({ name: "AbortError" });
        expect(calls).toBe(1);
    });

    test("allows explicit session recovery while invalidated without sending the old expected-user header", async () => {
        const requests: AxiosRequestConfig[] = [];
        apiClient.request = (async (config: AxiosRequestConfig) => {
            requests.push(config);
            return response({ user: { id: "user-b" } });
        }) as typeof apiClient.request;
        switchOtherTab("user-b");
        const payload = await getAuthSession();
        expect(payload.user?.id).toBe("user-b");
        expect(requests[0]?.headers?.["X-Canvas-Expected-User"]).toBeUndefined();
        await expect(http.get("/auth/profile")).rejects.toMatchObject({ name: "AbortError" });
        setActiveUserScope(payload.user?.id, captureUserSession(true));
        await http.get("/auth/profile");
        expect(requests[1]?.headers?.["X-Canvas-Expected-User"]).toBe("user-b");
    });

    test("does not let an invalidated auth-session response overwrite the new cache or pending request", async () => {
        const first = deferred<ReturnType<typeof response>>();
        const second = deferred<ReturnType<typeof response>>();
        let calls = 0;
        apiClient.request = (async () => (++calls === 1 ? first.promise : second.promise)) as typeof apiClient.request;
        const oldSession = getAuthSession();
        invalidateAuthSessionCache();
        const nextSession = getAuthSession();
        first.resolve(response({ user: { id: "old-user" } }));
        await expect(oldSession).rejects.toMatchObject({ name: "AbortError" });
        expect(getAuthSession()).toBe(nextSession);
        second.resolve(response({ user: { id: "new-user" } }));
        await expect(nextSession).resolves.toMatchObject({ user: { id: "new-user" } });
        await expect(getAuthSession()).resolves.toMatchObject({ user: { id: "new-user" } });
        expect(calls).toBe(2);
    });

    test("cancels an open Agent SSE reader on account change without delivering events or reconnecting", async () => {
        let cancelled = false;
        let calls = 0;
        let headers: HeadersInit | undefined;
        const received: unknown[] = [];
        globalThis.fetch = (async (_input, init) => {
            calls++;
            headers = init?.headers;
            return new Response(new ReadableStream({ cancel: () => void (cancelled = true) }), { headers: { "Content-Type": "text/event-stream" } });
        }) as typeof fetch;
        cleanups.push(subscribeAgentEvents("owned-run", (event) => received.push(event)));
        await new Promise((resolve) => setTimeout(resolve, 0));

        switchOtherTab("user-b");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(new Headers(headers).get("X-Canvas-Expected-User")).toBe("user-a");
        expect(cancelled).toBe(true);
        expect(calls).toBe(1);
        expect(received).toEqual([]);
    });
});
