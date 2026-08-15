import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DreaminaProviderArtifactStore } from "../src/dreamina-provider-artifacts.js";

test("provider artifact store is private, binding-scoped, crash-readable, and scavenges only orphan sets", async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-provider-artifacts-"));
    const root = path.join(sandbox, "private");
    let nowMs = Date.now();
    const store = new DreaminaProviderArtifactStore({
        root,
        now: () => new Date(nowMs),
    });
    const bytes = Buffer.from([0x00, 0x00, 0x00, 0x10, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const binding = {
        ownerId: "owner-runtime-0001",
        idempotencyKey: "dreamina-artifact-0001",
        accountBinding: "a".repeat(64),
        fenceEpoch: 17,
        mode: "video" as const,
    };

    try {
        const outputs = await store.persistResult({
            mode: "video",
            video: {
                dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
                mimeType: "video/mp4",
                bytes: bytes.byteLength,
            },
        }, binding);

        assert.equal(outputs.length, 1);
        assert.match(outputs[0]!.providerArtifactRef, /^dreamina-provider-artifact:[a-f0-9-]{36}:0$/);
        const entries = await fs.readdir(root);
        assert.equal(entries.length, 1);
        assert.match(entries[0]!, /^set-[a-f0-9-]{36}$/);

        const setRoot = path.join(root, entries[0]!);
        const manifestPath = path.join(setRoot, "manifest.json");
        const manifest = await fs.readFile(manifestPath, "utf8");
        assert.equal(manifest.includes(binding.ownerId), false);
        assert.equal(manifest.includes(binding.idempotencyKey), false);
        assert.equal(manifest.includes(root), false);
        assert.doesNotMatch(manifest, /data:|base64|stdout|stderr|token|cookie/i);

        if (process.platform !== "win32") {
            assert.equal((await fs.stat(root)).mode & 0o777, 0o700);
            assert.equal((await fs.stat(setRoot)).mode & 0o777, 0o700);
            assert.equal((await fs.stat(manifestPath)).mode & 0o777, 0o600);
            assert.equal((await fs.stat(path.join(setRoot, "000.media"))).mode & 0o777, 0o600);
        }

        const recovered = await new DreaminaProviderArtifactStore({ root }).readResult(outputs, binding);
        assert.deepEqual(recovered, {
            mode: "video",
            video: {
                dataUrl: `data:video/mp4;base64,${bytes.toString("base64")}`,
                mimeType: "video/mp4",
                bytes: bytes.byteLength,
            },
        });
        await assert.rejects(store.readResult(outputs, { ...binding, ownerId: "owner-runtime-0002" }));
        await assert.rejects(store.readResult(outputs, { ...binding, accountBinding: "b".repeat(64) }));
        await assert.rejects(store.readResult(outputs, { ...binding, fenceEpoch: 18 }));

        nowMs += 25 * 60 * 60 * 1_000;
        await store.scavenge(outputs);
        assert.deepEqual(await fs.readdir(root), entries);
        await store.scavenge([]);
        assert.deepEqual(await fs.readdir(root), []);
    } finally {
        await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 10 });
    }
});

test("artifact scavenge tolerates only an enumerated candidate disappearing before lstat", async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-provider-artifact-race-"));
    const root = path.join(sandbox, "private");
    const candidate = path.join(root, ".tmp-11111111-1111-4111-8111-111111111111");
    let statCalls = 0;
    try {
        await fs.mkdir(candidate, { recursive: true });
        const store = new DreaminaProviderArtifactStore({
            root,
            now: () => new Date(Date.now() + 25 * 60 * 60 * 1_000),
            statScavengeCandidate: async (target) => {
                statCalls += 1;
                assert.equal(target, candidate);
                await fs.rm(target, { recursive: true });
                return fs.lstat(target);
            },
        });
        await assert.doesNotReject(store.scavenge([]));
        assert.equal(statCalls, 1);
        assert.deepEqual(await fs.readdir(root), []);

        await fs.mkdir(candidate);
        const denied = new DreaminaProviderArtifactStore({
            root,
            statScavengeCandidate: async () => {
                throw Object.assign(new Error("denied"), { code: "EACCES" });
            },
        });
        await assert.rejects(denied.scavenge([]), (error: unknown) => (error as NodeJS.ErrnoException).code === "EACCES");
        assert.deepEqual(await fs.readdir(root), [path.basename(candidate)]);
    } finally {
        await fs.rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 10 });
    }
});
