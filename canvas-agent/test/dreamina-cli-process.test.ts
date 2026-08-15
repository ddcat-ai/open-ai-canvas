import assert from "node:assert/strict";
import { test } from "node:test";

import {
    DreaminaCliError,
    runDreaminaProcess,
    sanitizeDreaminaDiagnostic,
} from "../src/dreamina-cli-process.js";

test("Dreamina process runs fixed argv without a shell", async () => {
    const result = await runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(process.argv[1])", "literal;$(unsafe)"],
        timeoutMs: 5_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "literal;$(unsafe)");
});

test("Dreamina process keeps OS-user home variables and drops unrelated or sensitive variables", async () => {
    const result = await runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", [
            "const keys=['HOME','USERPROFILE','BROWSER','CANVAS_AGENT_TOKEN','GFLOW_CLI_HOME','DREAMINA_TOKEN']",
            "process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key)=>[key,process.env[key]??null]))))",
        ].join(";")],
        timeoutMs: 5_000,
        env: {
            HOME: "fixture-home",
            USERPROFILE: "fixture-profile",
            BROWSER: "fixture-browser",
            CANVAS_AGENT_TOKEN: "fixture-secret",
            GFLOW_CLI_HOME: "fixture-gflow-home",
            DREAMINA_TOKEN: "fixture-secret",
        },
    });

    assert.deepEqual(JSON.parse(result.stdout), {
        HOME: process.platform === "win32" ? null : "fixture-home",
        USERPROFILE: process.platform === "win32" ? "fixture-profile" : null,
        BROWSER: null,
        CANVAS_AGENT_TOKEN: null,
        GFLOW_CLI_HOME: null,
        DREAMINA_TOKEN: null,
    });
});

test("Dreamina process keeps Windows Program Files discovery while dropping unrelated or sensitive variables", async (context) => {
    if (process.platform !== "win32") return context.skip("Windows-specific environment semantics");
    const result = await runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", [
            "const keys=['PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','CANVAS_AGENT_TOKEN','GFLOW_CLI_HOME','PRIVATE_TOKEN']",
            "process.stdout.write(JSON.stringify(Object.fromEntries(keys.map((key)=>[key,process.env[key]??null]))))",
        ].join(";")],
        timeoutMs: 5_000,
        env: {
            PROGRAMFILES: "fixture-program-files",
            "PROGRAMFILES(X86)": "fixture-program-files-x86",
            PROGRAMW6432: "fixture-program-files",
            CANVAS_AGENT_TOKEN: "fixture-secret",
            GFLOW_CLI_HOME: "fixture-gflow-home",
            PRIVATE_TOKEN: "fixture-secret",
        },
    });

    assert.deepEqual(JSON.parse(result.stdout), {
        PROGRAMFILES: "fixture-program-files",
        "PROGRAMFILES(X86)": "fixture-program-files-x86",
        PROGRAMW6432: "fixture-program-files",
        CANVAS_AGENT_TOKEN: null,
        GFLOW_CLI_HOME: null,
        PRIVATE_TOKEN: null,
    });
});

test("Dreamina process rejects conflicting Windows environment key casing", async (context) => {
    if (process.platform !== "win32") return context.skip("Windows-specific environment semantics");

    await assert.rejects(
        runDreaminaProcess({
            executable: process.execPath,
            args: ["--version"],
            timeoutMs: 5_000,
            env: { PATH: "fixture-a", Path: "fixture-b" },
        }),
        (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_environment_invalid",
    );
});

test("Dreamina process preserves its public error contract for invalid proxy settings", async () => {
    await assert.rejects(
        runDreaminaProcess({
            executable: process.execPath,
            args: ["--version"],
            timeoutMs: 5_000,
            env: { NO_PROXY: "localhost,,example.test" },
        }),
        (error: unknown) => error instanceof DreaminaCliError
            && error.code === "dreamina_environment_invalid"
            && error.statusCode === 500
            && error.message === "Dreamina 代理绕过列表无效",
    );
});

test("Dreamina process rejects oversized output and terminates the child", async () => {
    let pid = 0;
    await assert.rejects(
        runDreaminaProcess({
            executable: process.execPath,
            args: ["-e", "process.stdout.write('x'.repeat(2*1024*1024+1));setInterval(()=>{},1000)"],
            timeoutMs: 5_000,
            onSpawn: (childPid) => { pid = childPid; },
        }),
        (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_output_too_large",
    );
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0));
});

test("Dreamina cancellation waits for exact process cleanup", async () => {
    const controller = new AbortController();
    let pid = 0;
    const running = runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        timeoutMs: 30_000,
        signal: controller.signal,
        onSpawn: (childPid) => {
            pid = childPid;
            controller.abort();
        },
    });

    await assert.rejects(
        running,
        (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_cancelled",
    );
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0));
});

test("Dreamina early JSON completion waits for the original child close after tree termination completes", async () => {
    let childToClose: import("node:child_process").ChildProcess | undefined;
    let markTerminatorCalled!: () => void;
    const terminatorCalled = new Promise<void>((resolve) => { markTerminatorCalled = resolve; });
    let markTerminationDone!: () => void;
    const terminationDone = new Promise<void>((resolve) => { markTerminationDone = resolve; });
    let resolved = false;

    const running = runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({submit_id:'receipt-close-barrier'})+'\\n');setInterval(()=>{},1000)"],
        timeoutMs: 5_000,
        completeOnJsonOutput: (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).submit_id === "receipt-close-barrier"),
    }, {
        terminateProcessTree: async (child) => {
            childToClose = child;
            markTerminatorCalled();
            await terminationDone;
        },
    }).then((result) => {
        resolved = true;
        return result;
    });

    await terminatorCalled;
    markTerminationDone();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);

    assert.ok(childToClose);
    childToClose.kill();
    const result = await running;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"submit_id":"receipt-close-barrier"}');
});

test("Dreamina process accepts one exact submit receipt line and cleans up a long-lived child", async () => {
    let pid = 0;
    const result = await runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({submit_id:'receipt-process-cleanup'})+'\\n');setInterval(()=>{},1000)"],
        timeoutMs: 5_000,
        completeOnJsonOutput: (value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const record = value as Record<string, unknown>;
            return Object.keys(record).length === 1 && typeof record.submit_id === "string" && /^receipt-[a-z-]+$/.test(record.submit_id);
        },
        onSpawn: (childPid) => { pid = childPid; },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '{"submit_id":"receipt-process-cleanup"}');
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0));
});

test("Dreamina process does not accept a progress event that happens to carry a submit id", async () => {
    let pid = 0;
    const startedAt = Date.now();
    await assert.rejects(runDreaminaProcess({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(JSON.stringify({event:'progress',submit_id:'receipt-progress-event'})+'\\n');setInterval(()=>{},1000)"],
        timeoutMs: 50,
        completeOnJsonOutput: (value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const record = value as Record<string, unknown>;
            return Object.keys(record).length === 1 && typeof record.submit_id === "string";
        },
        onSpawn: (childPid) => { pid = childPid; },
    }), (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_command_timeout");
    assert.ok(Date.now() - startedAt >= 40);
    assert.ok(pid > 0);
    assert.throws(() => process.kill(pid, 0));
});

test("Dreamina diagnostics redact secrets, URLs, paths, and account identifiers", () => {
    const diagnostic = sanitizeDreaminaDiagnostic(
        "token=secret https://oauth.example.test C:\\Users\\owner\\Cookies owner@example.test",
    );

    assert.equal(diagnostic.includes("secret"), false);
    assert.equal(diagnostic.includes("oauth.example.test"), false);
    assert.equal(diagnostic.includes("Cookies"), false);
    assert.equal(diagnostic.includes("owner@example.test"), false);
    assert.ok(diagnostic.length <= 240);
});
