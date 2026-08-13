import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startBrowserRuntimeFixture } from "./fixtures/local-runtime-browser-harness.js";

const trustedOrigin = "http://127.0.0.1:31300";

test("browser Runtime harness uses an isolated port and performs no real CLI work", async () => {
    const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const local = path.join(root, ".local");
    await fs.mkdir(local, { recursive: true });
    const configDir = await fs.mkdtemp(path.join(local, "dreamina-browser-harness-"));
    const port = await availablePort();
    const lines: string[] = [];
    const fixture = await startBrowserRuntimeFixture({
        scenario: "installed",
        port,
        configDir,
        trustedOrigin,
        log: (line) => lines.push(line),
    });
    try {
        const response = await fetch(`${fixture.endpoint}/runtime/info`, {
            headers: { Origin: trustedOrigin },
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json() as { originTrusted?: boolean }).originTrusted, true);
        assert.equal(fixture.pid, process.pid);
        assert.equal(fixture.cliCalls(), 0);
        assert.equal(lines.join("\n").includes("Connect token"), false);
        assert.equal(lines.join("\n").includes("master"), false);
    } finally {
        await fixture.close();
        await fs.rm(configDir, { recursive: true, force: true });
    }
});

test("browser Runtime harness rejects production ports and config outside its worktree", async () => {
    const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const local = path.join(root, ".local");
    await fs.mkdir(local, { recursive: true });
    const inside = await fs.mkdtemp(path.join(local, "dreamina-browser-harness-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "dreamina-browser-harness-outside-"));
    try {
        for (const port of [3000, 8080, 17371]) {
            await assert.rejects(startBrowserRuntimeFixture({
                scenario: "installed",
                port,
                configDir: inside,
                trustedOrigin,
            }));
        }
        await assert.rejects(startBrowserRuntimeFixture({
            scenario: "installed",
            port: await availablePort(),
            configDir: outside,
            trustedOrigin,
        }));
    } finally {
        await fs.rm(inside, { recursive: true, force: true });
        await fs.rm(outside, { recursive: true, force: true });
    }
});

function availablePort() {
    return new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (!address || typeof address === "string") {
                server.close();
                reject(new Error("failed to reserve a test port"));
                return;
            }
            const port = address.port;
            server.close((error) => error ? reject(error) : resolve(port));
        });
    });
}
