import { describe, expect, test } from "bun:test";

import {
    LOCAL_RUNTIME_ENDPOINT,
    LocalRuntimeClientError,
    LocalRuntimeSessionClient,
    resolveLocalRuntimeEndpoint,
    type RuntimeBrowserKeyRecord,
    type RuntimeBrowserKeyStore,
} from "../src/services/local-runtime-session";

const origin = "http://127.0.0.1:3001";
const runtimeInstanceId = "web-runtime-fixture";
const canary = "master-token-canary-must-not-leak";

describe("Local Runtime signed browser session", () => {
    test("build-time endpoint accepts one exact isolated loopback origin without scanning", () => {
        expect(resolveLocalRuntimeEndpoint(undefined)).toBe("http://127.0.0.1:17371");
        expect(resolveLocalRuntimeEndpoint("http://127.0.0.1:31731")).toBe("http://127.0.0.1:31731");
        for (const invalid of [
            "http://localhost:31731",
            "http://127.0.0.1:31731/path",
            "http://127.0.0.1:31731?next=1",
            "https://127.0.0.1:31731",
            "http://127.0.0.1:17371,http://127.0.0.1:31731",
        ]) {
            expect(() => resolveLocalRuntimeEndpoint(invalid)).toThrow();
        }
    });

    test("first trusted connection persists only a non-extractable browser key and returns a signed session", async () => {
        const keyStore = memoryKeyStore();
        const runtime = runtimeFetchFixture();
        const client = new LocalRuntimeSessionClient({
            origin,
            keyStore,
            fetch: runtime.fetch,
            now: () => runtime.now,
        });

        const result = await client.connect();

        expect(result.state).toBe("connected");
        if (result.state !== "connected") throw new Error("expected connected");
        expect(JSON.stringify(result)).not.toContain("pair");
        expect(keyStore.record?.privateKey.extractable).toBe(false);
        expect(keyStore.record?.privateKey.usages).toEqual(["sign"]);
        expect(keyStore.record?.publicKeyJwk.d).toBeUndefined();
        expect(JSON.stringify(keyStore.record)).not.toContain(canary);
        expect(client.currentSession()?.keyId).toBe(keyStore.record?.keyId);
        expect(runtime.requests[0].url).toBe(`${LOCAL_RUNTIME_ENDPOINT}/runtime/info`);
        expect(runtime.requests.every((request) => request.credentials === "omit")).toBe(true);
        expect(runtime.requests.every((request) => request.redirect === "error")).toBe(true);
    });

    test("silent trusted connection creates only an in-memory session and signs each protected request", async () => {
        const keyStore = memoryKeyStore();
        const runtime = runtimeFetchFixture();
        const client = new LocalRuntimeSessionClient({
            origin,
            keyStore,
            fetch: runtime.fetch,
            now: () => runtime.now,
        });

        expect((await client.connect()).state).toBe("connected");
        const session = client.currentSession();
        expect(session?.sessionId).toBe("session-fixture-000000000001");
        expect(JSON.stringify(keyStore.record)).not.toContain(session?.sessionId ?? "missing");

        const response = await client.request("/dreamina/status", { method: "GET" });
        expect(response.status).toBe(200);
        const protectedRequest = runtime.requests.at(-1)!;
        expect(protectedRequest.url).toBe(`${LOCAL_RUNTIME_ENDPOINT}/dreamina/status`);
        expect(protectedRequest.url).not.toContain("token");
        expect(protectedRequest.headers.get("x-framefield-runtime-session")).toBe(session?.sessionId);
        expect(protectedRequest.headers.get("x-framefield-runtime-nonce")).toMatch(/^[A-Za-z0-9_-]{22}$/);
        expect(protectedRequest.headers.get("x-framefield-runtime-proof")).toMatch(/^[A-Za-z0-9_-]{86}$/);
        expect(protectedRequest.headers.has("authorization")).toBe(false);
        expect(protectedRequest.headers.has("x-canvas-agent-token")).toBe(false);
        expect(JSON.stringify(runtime.requests)).not.toContain(canary);
    });

    test("a new page reuses the browser key but obtains a new session without a bearer fallback", async () => {
        const keyStore = memoryKeyStore();
        const runtime = runtimeFetchFixture();
        const first = new LocalRuntimeSessionClient({ origin, keyStore, fetch: runtime.fetch, now: () => runtime.now });
        await first.connect();
        const savedKeyId = keyStore.record?.keyId;

        const second = new LocalRuntimeSessionClient({ origin, keyStore, fetch: runtime.fetch, now: () => runtime.now });
        const result = await second.connect();

        expect(result.state).toBe("connected");
        expect(second.currentSession()?.keyId).toBe(savedKeyId);
        const challengeBody = runtime.requests
            .filter((request) => request.url.endsWith("/runtime/session/challenge"))
            .at(-1)?.body;
        expect(challengeBody).toBe(JSON.stringify({ keyId: savedKeyId }));
        expect(challengeBody).not.toContain("publicKeyJwk");
    });

    test("untrusted Runtime error bodies cannot enter browser errors", async () => {
        const client = new LocalRuntimeSessionClient({
            origin,
            keyStore: memoryKeyStore(),
            fetch: async () => new Response(JSON.stringify({
                code: "private_runtime_error",
                message: canary,
                detail: "C:\\Users\\owner\\Cookies",
            }), { status: 500, headers: { "content-type": "application/json" } }),
        });

        let caught: unknown;
        try {
            await client.connect();
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(LocalRuntimeClientError);
        expect(caught).toMatchObject({ code: "runtime_request_failed", message: "本机运行时请求失败", status: 500 });
        expect(String(caught)).not.toContain(canary);
        expect(String(caught)).not.toContain("Cookies");
    });

    test("client fails closed if an obsolete browser-confirmation response is returned", async () => {
        const runtime = runtimeFetchFixture();
        runtime.obsoleteChallenge = true;
        const client = new LocalRuntimeSessionClient({ origin, keyStore: memoryKeyStore(), fetch: runtime.fetch, now: () => runtime.now });

        await expect(client.connect()).rejects.toBeInstanceOf(LocalRuntimeClientError);
    });
});

function memoryKeyStore(): RuntimeBrowserKeyStore & { record?: RuntimeBrowserKeyRecord } {
    return {
        record: undefined,
        async load() { return this.record; },
        async save(record) { this.record = record; },
        async clear() { this.record = undefined; },
    };
}

function runtimeFetchFixture() {
    const requests: Array<{
        url: string;
        method: string;
        headers: Headers;
        body?: string;
        credentials?: RequestCredentials;
        redirect?: RequestRedirect;
    }> = [];
    const fixture = {
        now: Date.parse("2026-08-10T00:00:00.000Z"),
        obsoleteChallenge: false,
        keyId: "",
        requests,
        fetch: async (input: string | URL | Request, init: RequestInit = {}) => {
            const url = String(input);
            const headers = new Headers(init.headers);
            const body = typeof init.body === "string" ? init.body : undefined;
            requests.push({
                url,
                method: init.method ?? "GET",
                headers,
                body,
                credentials: init.credentials,
                redirect: init.redirect,
            });
            if (url.endsWith("/runtime/info")) {
                return jsonResponse(200, {
                    runtime: "framefield-local-runtime",
                    apiVersion: 2,
                    protocolVersion: "framefield-runtime-session-v1",
                    runtimeInstanceId,
                    originTrusted: true,
                });
            }
            if (url.endsWith("/runtime/session/challenge")) {
                const payload = JSON.parse(body ?? "{}") as { keyId?: string; publicKeyJwk?: JsonWebKey };
                fixture.keyId = payload.keyId ?? await keyIdForJwk(payload.publicKeyJwk!);
                const base = {
                    challengeId: "challenge-fixture-000001",
                    nonce: "bm9uY2UtZml4dHVyZS0wMDAwMDAwMDAwMDAwMDAwMDAwMDA",
                    runtimeInstanceId,
                    expiresAt: new Date(fixture.now + 60_000).toISOString(),
                    keyId: fixture.keyId,
                };
                return jsonResponse(200, fixture.obsoleteChallenge ? {
                    state: "obsolete_browser_confirmation",
                    ...base,
                } : { state: "challenge", ...base });
            }
            if (url.endsWith("/runtime/session/exchange")) {
                return jsonResponse(200, {
                    sessionId: "session-fixture-000000000001",
                    keyId: fixture.keyId,
                    scopes: ["runtime:status", "dreamina:status", "dreamina:login", "dreamina:logout", "canvas:connect"],
                    expiresAt: new Date(fixture.now + 10 * 60_000).toISOString(),
                });
            }
            if (url.endsWith("/dreamina/status")) {
                return jsonResponse(200, { ok: true, status: { provider: "dreamina-cli", state: "installed" } });
            }
            return jsonResponse(404, { ok: false });
        },
    };
    return fixture;
}

function jsonResponse(status: number, value: unknown) {
    return new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

async function keyIdForJwk(jwk: JsonWebKey) {
    const canonical = JSON.stringify({ crv: "P-256", kty: "EC", x: jwk.x, y: jwk.y });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
    return base64Url(digest);
}

function base64Url(value: Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
