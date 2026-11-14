const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { accountScope } = require("./yingce-session");

// A local administrator is private to one remote identity and is never sent to
// the renderer. Save it before starting the backend, so interrupted first-run
// registration can be resumed without abandoning the database.
function localAccountCredentials({ root, apiUrl, userId, safeStorage }) {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
        throw new Error("系统安全存储不可用，无法准备本地账户");
    }
    const scope = accountScope(apiUrl, userId);
    const accountDir = path.join(root, "accounts", scope);
    const dataDir = path.join(accountDir, "data");
    const credentialFile = path.join(accountDir, "local-account.enc");
    let encrypted;
    try {
        encrypted = fs.readFileSync(credentialFile);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length) {
            throw new Error("本地账户凭据缺失，已保留现有数据，请联系支持人员恢复");
        }
        fs.mkdirSync(accountDir, { recursive: true });
        const credentials = { username: "lite_admin", password: crypto.randomBytes(32).toString("base64url"), relayKey: crypto.randomBytes(32).toString("base64url") };
        const temporary = path.join(accountDir, `local-account.${crypto.randomBytes(8).toString("hex")}.tmp`);
        try {
            fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { flag: "wx", mode: 0o600 });
            fs.renameSync(temporary, credentialFile);
        } finally {
            try { fs.unlinkSync(temporary); } catch (cleanupError) { if (cleanupError.code !== "ENOENT") throw cleanupError; }
        }
        return { scope, dataDir, credentials, legacyProfile: false };
    }
    const credentials = JSON.parse(safeStorage.decryptString(encrypted));
    const validLocalUsername = credentials?.legacyProfile === true
        ? typeof credentials.username === "string" && credentials.username.length >= 3
        : credentials?.username === "lite_admin";
    if (!validLocalUsername || typeof credentials.password !== "string" || credentials.password.length < 8) {
        throw new Error("本地账户凭据无效，已保留现有数据");
    }
    if (credentials.relayKey === undefined) {
        credentials.relayKey = crypto.randomBytes(32).toString("base64url");
        writeEncryptedCredential(credentialFile, credentials, safeStorage);
    }
    if (typeof credentials.relayKey !== "string" || credentials.relayKey.length < 32) {
        throw new Error("本地中转凭据无效，已保留现有数据");
    }
    return {
        scope,
        dataDir,
        credentials,
        legacyProfile: credentials.legacyProfile === true,
        ...(credentials.legacyProfile === true && typeof credentials.legacySourceScope === "string" ? { legacySourceScope: credentials.legacySourceScope } : {}),
    };
}

function writeEncryptedCredential(file, credentials, safeStorage) {
    const temporary = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    try {
        fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(credentials)), { flag: "wx", mode: 0o600 });
        fs.renameSync(temporary, file);
    } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
}

async function authenticateLocalBackend({ baseUrl, credentials, signal, fetchImpl = fetch }) {
    async function request(endpoint, input) {
        const response = await fetchImpl(`${baseUrl}/api/auth/${endpoint}`, {
            method: input ? "POST" : "GET",
            ...(input ? { headers: { "content-type": "application/json" }, body: JSON.stringify(input) } : {}),
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), redirect: "error",
        });
        let body;
        try { body = await response.json(); } catch { throw new Error("本地账户服务响应无效"); }
        if (!response.ok || !body || body.code !== 0) throw new Error("本地账户准备失败，请查看日志并联系支持人员");
        return body.data;
    }
    const settings = await request("settings");
    if (typeof settings?.firstUser !== "boolean") throw new Error("本地账户策略响应无效");
    const result = await request(settings.firstUser ? "register" : "login", {
        username: credentials.username, password: credentials.password,
        ...(settings.firstUser ? { acceptedTerms: true } : {}),
    });
    if (typeof result?.session !== "string" || !result.session || !result.user?.id) throw new Error("本地账户会话响应无效");
    return result.session;
}

module.exports = { localAccountCredentials, authenticateLocalBackend };
