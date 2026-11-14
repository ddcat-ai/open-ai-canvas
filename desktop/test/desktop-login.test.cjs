const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createDesktopLogin } = require("../src/desktop-login");

async function waitFor(predicate, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("timed out waiting for desktop authorization URL");
}

test("desktop login uses loopback, S256, state validation, and exchanges only the code", async () => {
    let authorizationUrl;
    let exchanged;
    const login = createDesktopLogin({
        consoleUrl: "https://console.example.test",
        shell: { openExternal: async (url) => { authorizationUrl = url; } },
        client: { exchangeDesktopAuthorizationCode: async (input) => { exchanged = input; return { user: { id: "user-1" } }; } },
        randomBytes: (() => {
            const values = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
            return () => values.shift();
        })(),
    });

    const pending = login.begin();
    const url = new URL(await waitFor(() => authorizationUrl));
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const verifier = Buffer.alloc(32, 1).toString("base64url");
    const expectedChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    assert.equal(url.origin, "https://console.example.test");
    assert.equal(url.pathname, "/auth/desktop/authorize");
    assert.equal(url.searchParams.get("client_id"), "peekreel-lite");
    assert.equal(url.searchParams.get("code_challenge"), expectedChallenge);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const callback = new URL(redirectUri);
    assert.equal(callback.hostname, "127.0.0.1");
    assert.notEqual(callback.port, "0");
    assert.equal(callback.pathname, "/oauth/callback");

    const wrong = await fetch(`${redirectUri}?code=bad&state=${"x".repeat(43)}`);
    assert.equal(wrong.status, 400);
    assert.equal(exchanged, undefined);

    const response = await fetch(`${redirectUri}?code=one-time-code&state=${state}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /登录完成/);
    assert.deepEqual(await pending, { id: "user-1" });
    assert.deepEqual(exchanged, {
        clientId: "peekreel-lite",
        redirectUri,
        code: "one-time-code",
        codeVerifier: verifier,
    });
});

test("desktop login can be canceled and times out without completing an exchange", async () => {
    let authorizationUrl;
    const login = createDesktopLogin({
        consoleUrl: "https://console.example.test",
        shell: { openExternal: async (url) => { authorizationUrl = url; } },
        client: { exchangeDesktopAuthorizationCode: async () => assert.fail("must not exchange") },
        timeoutMs: 1000,
    });
    const pending = login.begin();
    await waitFor(() => authorizationUrl);
    assert.equal(login.cancel(), true);
    await assert.rejects(pending, /登录已取消/);
    assert.equal(login.cancel(), false);

    const timeoutLogin = createDesktopLogin({
        consoleUrl: "https://console.example.test",
        shell: { openExternal: async () => {} },
        client: { exchangeDesktopAuthorizationCode: async () => assert.fail("must not exchange") },
        timeoutMs: 10,
    });
    await assert.rejects(timeoutLogin.begin(), /超时/);
});
