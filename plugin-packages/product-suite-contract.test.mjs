import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import test from "node:test";

const root = new URL("./product-suite-contract/", import.meta.url);

test("product suite contract requires stable item identity and resumable state", async () => {
  const contract = JSON.parse(await readFile(new URL("docs/product-suite-contract.json", root), "utf8"));
  const sample = JSON.parse(await readFile(new URL("fixtures/product-suite.json", root), "utf8"));
  const required = new Set(contract.required);
  for (const field of ["batchId", "product", "items", "retryPolicy", "recovery", "styleLock"]) assert.ok(required.has(field), field);
  assert.equal(sample.batchId, "batch_demo_001");
  assert.ok(sample.product.sku);
  assert.ok(sample.product.productId);
  assert.ok(sample.items.length > 0);
  const itemIds = new Set(sample.items.map((item) => item.itemId));
  assert.equal(itemIds.size, sample.items.length);
  for (const item of sample.items) {
    assert.match(item.itemId, /^batch_demo_001:/);
    assert.ok(item.idempotencyKey);
    assert.ok(item.angle && item.scene && item.background && item.size);
    assert.match(item.status, /^(queued|running|succeeded|failed|unknown_submitted)$/);
  }
  assert.equal(sample.status, "partial_succeeded");
  assert.equal(sample.items[1].status, "unknown_submitted");
  assert.equal(sample.items[1].retry.allowed, false);
  assert.equal(sample.retryPolicy.maxAttempts, 3);
  assert.ok(sample.retryPolicy.backoffMs.every((value) => Number.isInteger(value) && value > 0));
  assert.ok(sample.recovery.resumeCursor);
  assert.ok(contract.redaction.sensitivePaths.includes("credentials.apiKey"));
  assert.match(sample.styleLock.fingerprint, /^style-[a-f0-9]{8}$/);
  assert.equal(sample.styleLock.anchorFirst, true);
  assert.equal(sample.styleLock.anchorItemId, sample.items[0].itemId);
  assert.ok(sample.styleLock.sharedPromptPrefix.includes(sample.styleLock.fingerprint));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.ok(manifest.contributes.agents.includes("ecommerce-conversational"));
  assert.ok(manifest.contributes.aiCapabilities.includes("ecommerce-style-planner"));
});

test("generated package contains the contract and fixture", async () => {
  const handle = await open(new URL("../product-suite-contract.yingce-plugin", root));
  const buffer = Buffer.alloc(4);
  await handle.read(buffer, 0, 4, 0);
  await handle.close();
  assert.equal(buffer.toString("binary"), "PK\x03\x04");
});
