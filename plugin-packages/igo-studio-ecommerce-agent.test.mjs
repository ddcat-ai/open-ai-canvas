import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { open } from "node:fs/promises";
import test from "node:test";

const root = new URL("./igo-studio-ecommerce-agent/", import.meta.url);

test("电商智能创作 manifest declares the smart creation entry", async () => {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

    assert.equal(manifest.id, "igo-studio-ecommerce-agent");
    assert.equal(manifest.name, "电商智能创作");
    assert.equal(manifest.apiVersion, "yingce.plugin/v2");
    assert.ok(manifest.permissions.includes("ai.text"));
    assert.ok(manifest.permissions.includes("generation.run"));
    assert.ok(manifest.contributes.aiCapabilities.includes("amazon-set-planner"));
    assert.equal(manifest.contributes.smartCreation?.entry, "smart-creation");
    assert.equal(manifest.contributes.smartCreation?.planner?.tool?.name, "create_smart_creation_plan");
    assert.equal(manifest.contributes.smartCreation?.execution?.maxConcurrency, 4);
    assert.equal(manifest.contributes.homepageCreation, undefined);
    assert.equal(manifest.contributes.agents, undefined);
});

test("电商智能创作 package is a real yingce plugin archive", async () => {
    const handle = await open(new URL("../igo-studio-ecommerce-agent.yingce-plugin", root));
    const buffer = Buffer.alloc(4);
    await handle.read(buffer, 0, 4, 0);
    await handle.close();
    assert.equal(buffer.toString("binary"), "PK\x03\x04");
});
