import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
    ensureRuntimeOwnerId,
    normalizeLocalRuntimeConfig,
    type LocalRuntimeConfig,
} from "../src/config.js";
import { startLocalRuntime } from "../src/local-runtime-host.js";

test("Runtime owner is generated once while browser registrations remain separate public-key records", () => {
    const config = normalizeLocalRuntimeConfig({
        url: "http://127.0.0.1:17371",
        token: "master-canary-must-not-leak",
        trustedWebOrigins: ["http://127.0.0.1:3000"],
        browserRegistrations: [],
    });

    const first = ensureRuntimeOwnerId(config);
    const second = ensureRuntimeOwnerId(config);

    assert.match(first, /^[A-Za-z0-9_-]{24}$/);
    assert.equal(second, first);
    assert.deepEqual(config.browserRegistrations, []);
    assert.equal(JSON.stringify(config.browserRegistrations).includes(first), false);
});

test("Runtime config rejects non-exact or non-HTTP trusted origins", () => {
    for (const trustedWebOrigins of [
        ["http://127.0.0.1:3000/path"],
        ["file:///tmp/framefield"],
        ["null"],
        ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
    ]) {
        assert.throws(() => normalizeLocalRuntimeConfig({
            url: "http://127.0.0.1:17371",
            token: "fixture",
            trustedWebOrigins,
        }));
    }
});

test("an explicit startup trusted origin replaces stale persisted origins and survives restart", async () => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), "framefield-runtime-origin-"));
    const configFile = path.join(isolated, "canvas-agent.json");
    try {
        await fs.writeFile(configFile, JSON.stringify({
            url: "http://127.0.0.1:18671",
            token: "test-master-canary",
            trustedWebOrigins: ["http://127.0.0.1:3000"],
            browserRegistrations: [],
        }));

        const applied = loadConfigInChild(isolated, "http://127.0.0.1:18630");
        assert.equal(applied.status, 0, applied.stderr);
        assert.deepEqual(JSON.parse(applied.stdout), {
            trustedWebOrigins: ["http://127.0.0.1:18630"],
        });

        const restarted = loadConfigInChild(isolated);
        assert.equal(restarted.status, 0, restarted.stderr);
        assert.deepEqual(JSON.parse(restarted.stdout), {
            trustedWebOrigins: ["http://127.0.0.1:18630"],
        });
    } finally {
        await fs.rm(isolated, { recursive: true, force: true });
    }
});

test("Runtime config accepts only an absolute startup-only isolated directory", async () => {
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), "framefield-runtime-config-"));
    try {
        const accepted = importConfigInChild(isolated);
        assert.equal(accepted.status, 0, accepted.stderr);
        assert.deepEqual(JSON.parse(accepted.stdout), {
            configDir: isolated,
            configFile: path.join(isolated, "canvas-agent.json"),
        });

        for (const invalid of ["", "relative/runtime-config"] as const) {
            const rejected = importConfigInChild(invalid);
            assert.notEqual(rejected.status, 0);
            assert.equal(rejected.stdout, "");
        }
    } finally {
        await fs.rm(isolated, { recursive: true, force: true });
    }
});

test("Local Runtime starts one isolated loopback server without logging its master token", async () => {
    const token = "master-canary-must-not-leak";
    const config: LocalRuntimeConfig = normalizeLocalRuntimeConfig({
        url: "http://127.0.0.1:17371",
        token,
        trustedWebOrigins: ["http://127.0.0.1:3001"],
        browserRegistrations: [],
    });
    const lines: string[] = [];
    const runtime = startLocalRuntime({
        config,
        modules: [],
        port: 0,
        log: (line) => lines.push(line),
        persistConfig: () => undefined,
    });
    await runtime.ready;

    try {
        const address = runtime.server.address();
        assert(address && typeof address === "object");
        assert.equal(address.address, "127.0.0.1");
        assert.notEqual(address.port, 17371);
        assert.equal(lines.join("\n").includes(token), false);
        assert.equal(lines.join("\n").includes("Connect token"), false);
    } finally {
        await runtime.close();
    }
    assert.equal(runtime.server.listening, false);
});

test("Local Runtime awaits module startup before listening and disposes it symmetrically", async () => {
    const config: LocalRuntimeConfig = normalizeLocalRuntimeConfig({
        url: "http://127.0.0.1:17371",
        token: "startup-fixture-token",
        trustedWebOrigins: ["http://127.0.0.1:3001"],
        browserRegistrations: [],
    });
    let releaseStartup!: () => void;
    let markStartupEntered!: () => void;
    const startupGate = new Promise<void>((resolve) => { releaseStartup = resolve; });
    const startupEntered = new Promise<void>((resolve) => { markStartupEntered = resolve; });
    const events: string[] = [];
    const runtime = startLocalRuntime({
        config,
        port: 0,
        log: () => undefined,
        persistConfig: () => undefined,
        modules: [{
            descriptor: {
                id: "canvas-agent",
                displayName: "startup fixture",
                apiVersion: 1,
                scopes: [],
            },
            routes: [],
            start: async () => {
                events.push("start");
                markStartupEntered();
                await startupGate;
            },
            dispose: async () => { events.push("dispose"); },
        } as never],
    });
    try {
        const first = await Promise.race([
            startupEntered.then(() => "startup" as const),
            runtime.ready.then(() => "listening" as const),
        ]);
        assert.equal(first, "startup");
        assert.equal(runtime.server.listening, false);
        releaseStartup();
        await runtime.ready;
        assert.equal(runtime.server.listening, true);
    } finally {
        releaseStartup();
        await runtime.close();
    }
    assert.deepEqual(events, ["start", "dispose"]);
});

test("Local Runtime surfaces module startup failure without listening or leaking", async () => {
    const config: LocalRuntimeConfig = normalizeLocalRuntimeConfig({
        url: "http://127.0.0.1:17371",
        token: "startup-failure-fixture",
        trustedWebOrigins: ["http://127.0.0.1:3001"],
        browserRegistrations: [],
    });
    const events: string[] = [];
    const runtime = startLocalRuntime({
        config,
        port: 0,
        log: () => undefined,
        persistConfig: () => undefined,
        modules: [{
            descriptor: {
                id: "canvas-agent",
                displayName: "startup failure fixture",
                apiVersion: 1,
                scopes: [],
            },
            routes: [],
            start: async () => {
                events.push("start");
                throw new Error("startup fixture failed");
            },
            dispose: async () => { events.push("dispose"); },
        }],
    });
    await assert.rejects(runtime.ready, /startup fixture failed/);
    assert.equal(runtime.server.listening, false);
    await runtime.close();
    assert.deepEqual(events, ["start", "dispose"]);
});

function importConfigInChild(configDir: string) {
    const canvasAgentRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
    const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const configModule = pathToFileURL(path.join(canvasAgentRoot, "src", "config.ts")).href;
    const source = `import(${JSON.stringify(configModule)}).then((value)=>process.stdout.write(JSON.stringify({configDir:value.CONFIG_DIR,configFile:value.CONFIG_FILE})))`;
    const result = spawnSync(process.execPath, [tsxCli, "-e", source], {
        cwd: canvasAgentRoot,
        encoding: "utf8",
        env: { ...process.env, FRAMEFIELD_LOCAL_RUNTIME_CONFIG_DIR: configDir },
        windowsHide: true,
    });
    return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
    };
}

function loadConfigInChild(configDir: string, trustedWebOrigins?: string) {
    const canvasAgentRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
    const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const configModule = pathToFileURL(path.join(canvasAgentRoot, "src", "config.ts")).href;
    const source = `import(${JSON.stringify(configModule)}).then((value)=>{const config=value.loadConfig(true);process.stdout.write(JSON.stringify({trustedWebOrigins:config.trustedWebOrigins}))})`;
    const env = { ...process.env, FRAMEFIELD_LOCAL_RUNTIME_CONFIG_DIR: configDir };
    delete env.FRAMEFIELD_TRUSTED_WEB_ORIGINS;
    if (trustedWebOrigins !== undefined) env.FRAMEFIELD_TRUSTED_WEB_ORIGINS = trustedWebOrigins;
    const result = spawnSync(process.execPath, [tsxCli, "-e", source], {
        cwd: canvasAgentRoot,
        encoding: "utf8",
        env,
        windowsHide: true,
    });
    return {
        status: result.status,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
    };
}
