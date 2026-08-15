import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DreaminaCliRuntime } from "../src/dreamina-cli-runtime.js";
import { acquireStateLock, recoverStateReplacement } from "../src/dreamina-cli-state.js";

const ownerId = "owner-fixture-0001";
const request = {
    operation: "text2image" as const,
    idempotencyKey: "attempt-windows-replace-1",
    prompt: "must never persist",
    resolutionType: "2k" as const,
};

test("Dreamina journal replacement fails closed on divergent same-version evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-state-divergence-"));
    const stateFile = path.join(root, "state.json");
    const backupFile = `${stateFile}.replace-backup`;
    const record = {
        ownerId,
        idempotencyKey: "dreamina-state-divergence-0001",
        requestHash: "a".repeat(64),
        state: "accepted",
        journalVersion: 5,
        submitId: "provider-task-state-fixture",
        updatedAt: "2026-08-13T00:05:00.000Z",
        taskVersion: 1,
        operation: "text2video",
        mode: "video",
        model: "seedance2.0mini",
        createdAt: "2026-08-13T00:00:00.000Z",
        officialStatus: "pending",
    } as const;
    try {
        await fs.writeFile(backupFile, JSON.stringify({ version: 1, records: [record] }));
        await fs.writeFile(stateFile, JSON.stringify({
            version: 1,
            records: [{ ...record, officialStatus: "processing" }],
        }));
        let lease = await acquireStateLock(stateFile);
        try {
            await assert.rejects(
                recoverStateReplacement(stateFile, ownerId, lease),
                (error: unknown) => (error as { code?: string }).code === "dreamina_state_invalid",
            );
            await fs.access(backupFile);
        } finally {
            await lease();
        }

        await fs.writeFile(backupFile, JSON.stringify({ version: 1, records: [record] }));
        await fs.writeFile(stateFile, JSON.stringify({ version: 1, records: [record] }));
        lease = await acquireStateLock(stateFile);
        try {
            await recoverStateReplacement(stateFile, ownerId, lease);
            await assert.rejects(fs.stat(backupFile), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
        } finally {
            await lease();
        }

        await fs.writeFile(backupFile, JSON.stringify({ version: 1, records: [record] }));
        await fs.writeFile(stateFile, JSON.stringify({
            version: 1,
            records: [{ ...record, journalVersion: 6, officialStatus: "processing", updatedAt: "2026-08-13T00:06:00.000Z" }],
        }));
        lease = await acquireStateLock(stateFile);
        try {
            await recoverStateReplacement(stateFile, ownerId, lease);
            await assert.rejects(fs.stat(backupFile), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
        } finally {
            await lease();
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test("Dreamina receipt replaces an existing state on Windows semantics without deleting it first", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-state-"));
    const stateFile = path.join(root, "state.json");
    const mutableFs = fs as unknown as {
        rename: (...args: any[]) => Promise<void>;
        rm: (...args: any[]) => Promise<void>;
    };
    const originalRename = mutableFs.rename;
    const originalRm = mutableFs.rm;
    let overwriteFailures = 0;
    let removedState = false;
    mutableFs.rename = async (...args: any[]) => {
        if (String(args[1]) === stateFile) {
            try {
                await fs.access(stateFile);
                overwriteFailures += 1;
                throw Object.assign(new Error("fixture Windows replace denial"), { code: "EPERM" });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
        return originalRename(...args);
    };
    mutableFs.rm = async (...args: any[]) => {
        if (String(args[0]) === stateFile) removedState = true;
        return originalRm(...args);
    };

    const runtime = new DreaminaCliRuntime({
        ownerId,
        stateFile,
        ensureReady: async () => undefined,
        discover: async () => ({ installed: true, executable: "dreamina-fixture" }),
        runProcess: async (input) => {
            input.onSpawn?.(4242);
            return { exitCode: 0, stdout: '{"submit_id":"receipt-windows-replace"}', stderr: "" };
        },
    });
    try {
        assert.deepEqual(await runtime.run(request), {
            state: "accepted",
            submitId: "receipt-windows-replace",
        });
        assert.ok(overwriteFailures >= 1);
        assert.equal(removedState, false);
        const disk = await fs.readFile(stateFile, "utf8");
        assert.equal(disk.includes(request.prompt), false);
        assert.equal(JSON.parse(disk).records[0].state, "accepted");
        await assert.rejects(
            fs.stat(`${stateFile}.replace-backup`),
            (error: NodeJS.ErrnoException) => error.code === "ENOENT",
        );
        assert.deepEqual(
            (await fs.readdir(root)).filter((entry) => entry.endsWith(".tmp")),
            [],
        );
    } finally {
        mutableFs.rename = originalRename;
        mutableFs.rm = originalRm;
        await runtime.dispose();
        await fs.rm(root, { recursive: true, force: true });
    }
});
