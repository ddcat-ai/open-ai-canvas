const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { localAccountCredentials, authenticateLocalBackend } = require("../src/local-account");

function encryptedStorage() {
    const key = crypto.randomBytes(32);
    return {
        isEncryptionAvailable: () => true,
        encryptString(value) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
            const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), body]);
        },
        decryptString(value) {
            const cipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
            cipher.setAuthTag(value.subarray(12, 28));
            return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8");
        },
    };
}

test("local credentials are encrypted, stable per account and environment, and do not overwrite orphaned data", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lite-account-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const safeStorage = encryptedStorage();
    const options = { root, apiUrl: "https://example.test/api", userId: "one", safeStorage };
    const first = localAccountCredentials(options);
    const again = localAccountCredentials(options);
    assert.deepEqual(again, first);
    const other = localAccountCredentials({ ...options, userId: "two" });
    const environment = localAccountCredentials({ ...options, apiUrl: "https://other.test/api" });
    assert.notEqual(first.dataDir, other.dataDir);
    assert.notEqual(first.dataDir, environment.dataDir);
    assert.notEqual(first.credentials.password, other.credentials.password);
    const file = path.join(path.dirname(first.dataDir), "local-account.enc");
    assert.equal(fs.readFileSync(file).includes(Buffer.from(first.credentials.password)), false);
    fs.mkdirSync(first.dataDir);
    fs.writeFileSync(path.join(first.dataDir, "open_ai_canvas.db"), "preserve");
    fs.unlinkSync(file);
    assert.throws(() => localAccountCredentials(options), /凭据缺失/);
    assert.equal(fs.readFileSync(path.join(first.dataDir, "open_ai_canvas.db"), "utf8"), "preserve");
    assert.throws(() => localAccountCredentials({ ...options, safeStorage: { isEncryptionAvailable: () => false } }), /安全存储/);
});

test("existing local account credentials gain a relay key without changing the local password", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lite-account-relay-migration-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const safeStorage = encryptedStorage();
    const options = { root, apiUrl: "https://example.test/api", userId: "one", safeStorage };
    const first = localAccountCredentials(options);
    const file = path.join(path.dirname(first.dataDir), "local-account.enc");
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify({ username: "lite_admin", password: first.credentials.password })));
    const upgraded = localAccountCredentials(options);
    assert.equal(upgraded.credentials.password, first.credentials.password);
    assert.ok(upgraded.credentials.relayKey.length >= 32);
    assert.deepEqual(localAccountCredentials(options), upgraded);
});

test("local bootstrap registers only a first user, otherwise logs in, and validates the envelope", async () => {
    const credentials = { username: "lite_admin", password: "random-secret" };
    for (const firstUser of [true, false]) {
        const calls = [];
        const session = await authenticateLocalBackend({ baseUrl: "http://127.0.0.1:1", credentials, fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return new Response(JSON.stringify({ code: 0, data: calls.length === 1 ? { firstUser } : { user: { id: "local" }, session: "local-session" } }));
        } });
        assert.equal(session, "local-session");
        assert.ok(calls[1].url.endsWith(firstUser ? "/register" : "/login"));
        assert.deepEqual(JSON.parse(calls[1].options.body), { ...credentials, ...(firstUser ? { acceptedTerms: true } : {}) });
    }
    await assert.rejects(authenticateLocalBackend({ baseUrl: "http://127.0.0.1:1", credentials, fetchImpl: async () => new Response(JSON.stringify({ code: 8, msg: "failure" })) }), /本地账户准备失败/);
});

test("local authentication aborts an in-flight request when the account changes", async () => {
    const controller = new AbortController();
    let requestStarted;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    const authentication = authenticateLocalBackend({
        baseUrl: "http://127.0.0.1:1",
        credentials: { username: "lite_admin", password: "random-secret" },
        signal: controller.signal,
        fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
            requestStarted();
        }),
    });
    await started;
    controller.abort();
    await assert.rejects(authentication, { name: "AbortError" });
});
