import { describe, expect, it } from "bun:test";

import { desktopAuthorizationCallback, parseDesktopAuthorizationRequest } from "@/services/api/desktop-auth";

function request(overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
        client_id: "peekreel-lite",
        redirect_uri: "http://127.0.0.1:49152/oauth/callback",
        code_challenge: "c".repeat(43),
        code_challenge_method: "S256",
        state: "s".repeat(43),
        ...overrides,
    });
    return `?${params.toString()}`;
}

describe("desktop authorization request", () => {
    it("accepts only the registered client, S256, and a dynamic IPv4 loopback callback", () => {
        expect(parseDesktopAuthorizationRequest(request())).toEqual({
            clientId: "peekreel-lite",
            redirectUri: "http://127.0.0.1:49152/oauth/callback",
            codeChallenge: "c".repeat(43),
            codeChallengeMethod: "S256",
            state: "s".repeat(43),
        });
    });

    it.each([
        request({ client_id: "other-client" }),
        request({ redirect_uri: "https://127.0.0.1:49152/oauth/callback" }),
        request({ redirect_uri: "http://localhost:49152/oauth/callback" }),
        request({ redirect_uri: "http://127.0.0.1:49152/oauth/callback?next=https://example.com" }),
        request({ redirect_uri: "http://127.0.0.1/oauth/callback" }),
        request({ code_challenge_method: "plain" }),
        request({ code_challenge: "short" }),
        request({ state: "bad" }),
        `${request()}&state=${"t".repeat(43)}`,
    ])("rejects invalid authorization input", (input) => {
        expect(() => parseDesktopAuthorizationRequest(input)).toThrow();
    });

    it("returns only the one-time code and state to the validated loopback URI", () => {
        const callback = new URL(desktopAuthorizationCallback("http://127.0.0.1:49152/oauth/callback", "one-time-code", "s".repeat(43)));
        expect(callback.origin).toBe("http://127.0.0.1:49152");
        expect(callback.pathname).toBe("/oauth/callback");
        expect(callback.searchParams.get("code")).toBe("one-time-code");
        expect(callback.searchParams.get("state")).toBe("s".repeat(43));
        expect(callback.searchParams.has("session")).toBe(false);
    });
});
