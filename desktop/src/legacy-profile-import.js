const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function inspectLegacyProfile(dataDir, activation) {
    if (!fs.existsSync(dataDir)) return { available: false, reason: "missing_data" };
    const stat = fs.lstatSync(dataDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return { available: false, reason: "invalid_data" };
    if (fs.readdirSync(dataDir).length === 0) return { available: false, reason: "empty_data" };
    if (typeof activation?.username !== "string" || !activation.username || typeof activation?.password !== "string" || activation.password.length < 8) {
        return { available: false, reason: "missing_credentials" };
    }
    return { available: true, reason: "ready" };
}

function hasImportedLegacyProfile({ root, safeStorage }) {
    const accounts = path.join(root, "accounts");
    if (!fs.existsSync(accounts)) return false;
    const stat = fs.lstatSync(accounts);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("本地账号目录无效，已保留旧档案");
    for (const scope of fs.readdirSync(accounts)) {
        if (!/^[a-f0-9]{64}$/.test(scope)) continue;
        const accountDir = path.join(accounts, scope);
        const accountStat = fs.lstatSync(accountDir);
        if (!accountStat.isDirectory() || accountStat.isSymbolicLink()) continue;
        const file = path.join(accounts, scope, "local-account.enc");
        try {
            const credentials = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
            if (credentials?.legacyProfile === true) return true;
        } catch (error) {
            if (error.code !== "ENOENT") continue;
        }
    }
    return false;
}

async function importLegacyProfile({ root, dataDir, scope, activation, legacySourceScope, safeStorage, copyVerified, verify, isCurrent = () => true }) {
    if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error("影策账号分区无效");
    if (typeof legacySourceScope !== "string" || !legacySourceScope || legacySourceScope.length > 200) throw new Error("旧版本地分区无效");
    const inspection = inspectLegacyProfile(dataDir, activation);
    if (!inspection.available) throw new Error("旧版本地档案不可导入，原档案已保留");
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === "basic_text") {
        throw new Error("系统安全存储不可用，无法安全导入旧版档案");
    }

    const accountsDir = path.join(root, "accounts");
    fs.mkdirSync(accountsDir, { recursive: true });
    const accountsStat = fs.lstatSync(accountsDir);
    if (!accountsStat.isDirectory() || accountsStat.isSymbolicLink()) throw new Error("本地账号目录无效，已保留旧档案");
    const accountDir = path.join(accountsDir, scope);
    if (fs.existsSync(accountDir)) throw new Error("当前影策账号已有本地档案，拒绝覆盖");

    const stagingDir = fs.mkdtempSync(path.join(accountsDir, `.legacy-import-${scope}-`));
    const importedDataDir = path.join(stagingDir, "data");
    const credentials = {
        username: activation.username,
        password: activation.password,
        relayKey: crypto.randomBytes(32).toString("base64url"),
        legacyProfile: true,
        legacySourceScope,
    };
    try {
        copyVerified(dataDir, importedDataDir);
        const credentialPath = path.join(stagingDir, "local-account.enc");
        fs.writeFileSync(credentialPath, safeStorage.encryptString(JSON.stringify(credentials)), { flag: "wx", mode: 0o600 });
        await verify({ dataDir: importedDataDir, credentials });
        if (!isCurrent()) throw new Error("账号操作已变化，旧档案未导入");
        if (fs.existsSync(accountDir)) throw new Error("当前影策账号已有本地档案，拒绝覆盖");
        fs.renameSync(stagingDir, accountDir);
        return { scope, accountDir, dataDir: path.join(accountDir, "data"), credentials, legacyProfile: true };
    } catch (error) {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); }
        catch { /* Keep the source archive intact if staging cleanup fails. */ }
        throw error;
    }
}

module.exports = { inspectLegacyProfile, hasImportedLegacyProfile, importLegacyProfile };
