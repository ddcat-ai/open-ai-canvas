const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { copyVerified } = require("../src/storage-paths");
const { inspectLegacyProfile, hasImportedLegacyProfile, importLegacyProfile } = require("../src/legacy-profile-import");

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

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-profile-import-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const source = path.join(root, "legacy", "data");
    fs.mkdirSync(path.join(source, "uploads"), { recursive: true });
    fs.writeFileSync(path.join(source, "canvas.db"), "legacy database");
    fs.writeFileSync(path.join(source, "uploads", "image.bin"), "local image");
    return { root, source };
}

test("legacy profile import requires local credentials and keeps the source archive", async (t) => {
    const { root, source } = fixture(t);
    const safeStorage = encryptedStorage();
    const scope = "a".repeat(64);
    const activation = { username: "old-local-user", password: "old-local-password" };
    assert.equal(inspectLegacyProfile(source, activation).available, true);
    assert.equal(inspectLegacyProfile(source, {}).reason, "missing_credentials");

    let verified = false;
    const imported = await importLegacyProfile({
        root,
        dataDir: source,
        scope,
        activation,
        legacySourceScope: "guest",
        safeStorage,
        copyVerified,
        verify: async ({ dataDir, credentials }) => {
            verified = true;
            assert.equal(fs.readFileSync(path.join(dataDir, "canvas.db"), "utf8"), "legacy database");
            assert.equal(credentials.username, activation.username);
            assert.equal(credentials.password, activation.password);
            assert.equal(typeof credentials.relayKey, "string");
            assert.equal(credentials.legacyProfile, true);
            assert.equal(credentials.legacySourceScope, "guest");
        },
    });

    assert.equal(verified, true);
    assert.equal(imported.legacyProfile, true);
    assert.equal(fs.readFileSync(path.join(imported.dataDir, "uploads", "image.bin"), "utf8"), "local image");
    assert.equal(fs.readFileSync(path.join(source, "canvas.db"), "utf8"), "legacy database");
    assert.equal(hasImportedLegacyProfile({ root, safeStorage }), true);
    const stored = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(imported.accountDir, "local-account.enc"))));
    assert.equal(stored.password, activation.password);
});

test("legacy profile import removes only its staging copy when validation fails", async (t) => {
    const { root, source } = fixture(t);
    await assert.rejects(importLegacyProfile({
        root,
        dataDir: source,
        scope: "b".repeat(64),
        activation: { username: "old-local-user", password: "old-local-password" },
        legacySourceScope: "guest",
        safeStorage: encryptedStorage(),
        copyVerified,
        verify: async () => { throw new Error("legacy local login failed"); },
    }), /legacy local login failed/);
    assert.equal(fs.readFileSync(path.join(source, "canvas.db"), "utf8"), "legacy database");
    assert.deepEqual(fs.readdirSync(path.join(root, "accounts")), []);
});
