const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createGenerationJournal } = require("../src/yingce-generation-journal");

test("journal isolates accounts, persists completed audio and requires acknowledgement", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const alice = "a".repeat(64), bob = "b".repeat(64);
    const context = { id: "yingce-local:abc", capability: "audio", prompt: "hello", model: "speech", createdAt: "2026-01-01" };
    const journal = createGenerationJournal(root);
    journal.begin(alice, context);
    assert.equal(journal.list(alice)[0].status, "pending");
    assert.deepEqual(journal.list(bob), []);
    assert.throws(() => journal.begin(alice, context));
    assert.throws(() => journal.acknowledge(alice, context.id));
    journal.complete(alice, context, { contentType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) });
    const reopened = createGenerationJournal(root);
    assert.deepEqual(reopened.list(alice)[0].result, { contentType: "audio/mpeg", bytesBase64: "AQID" });
    assert.throws(() => reopened.acknowledge(bob, context.id));
    reopened.acknowledge(alice, context.id);
    assert.deepEqual(reopened.list(alice), []);
});

test("interrupted and duplicate requests remain unknown without replay; context excludes request bodies", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scope = "a".repeat(64);
    const context = { id: "yingce-local:abc", capability: "text", prompt: "hello", model: "model", createdAt: "2026-01-01" };
    const journal = createGenerationJournal(root);
    assert.throws(() => journal.begin(scope, { ...context, body: { session: "secret" } }));
    journal.begin(scope, context);
    assert.equal(createGenerationJournal(root).list(scope)[0].status, "unknown");
    journal.fail(scope, context, { code: 40901 });
    assert.equal(journal.list(scope)[0].status, "unknown");
    journal.fail(scope, context, { status: 502, reason: "upstream_failure", outcomeUnknown: true });
    assert.equal(createGenerationJournal(root).list(scope)[0].status, "unknown");
    assert.throws(() => journal.acknowledge(scope, context.id));
});

test("canvas recovery metadata survives restart and rejects invalid values", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scope = "a".repeat(64);
    const context = { id: "yingce-local:canvas", capability: "image", prompt: "hello", model: "model", createdAt: "2026-01-01", nodeId: "node", sourceNodeId: "source", domainProjectId: "domain", edit: "mask", layerDecomposition: true };
    const journal = createGenerationJournal(root);
    assert.throws(() => journal.begin(scope, { ...context, layerDecomposition: "true" }));
    journal.begin(scope, context);
    journal.complete(scope, context, { data: [] });
    assert.deepEqual(createGenerationJournal(root).list(scope)[0].context, context);
});

test("a damaged record does not prevent other completed results from being recovered", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yingce-journal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const scope = "a".repeat(64);
    const context = { id: "yingce-local:good", capability: "text", prompt: "hello", model: "model", createdAt: "2026-01-01" };
    const journal = createGenerationJournal(root);
    journal.begin(scope, context);
    journal.complete(scope, context, { choices: [] });
    const damaged = path.join(root, "accounts", scope, "generation-journal", "damaged.json");
    fs.writeFileSync(damaged, "{bad json");
    const unreadable = path.join(root, "accounts", scope, "generation-journal", "unreadable.json");
    fs.mkdirSync(unreadable);
    const records = journal.list(scope);
    assert.equal(records.find((record) => record.context.id === context.id).status, "completed");
    assert.equal(records.find((record) => record.context.id === "yingce-local:damaged").status, "invalid");
    assert.equal(records.find((record) => record.context.id === "yingce-local:unreadable").status, "invalid");
    assert.equal(fs.readFileSync(damaged, "utf8"), "{bad json");
});
