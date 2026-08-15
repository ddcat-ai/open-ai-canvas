import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { RequestHandler } from "express";

import type { LocalRuntimeConfig } from "../../src/config.js";
import { startLocalRuntime } from "../../src/local-runtime-host.js";
import type { LocalRuntimeModule } from "../../src/local-runtime.js";

const FORBIDDEN_PORTS = new Set([3000, 8080, 17371]);
const WORKTREE_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_TRUSTED_ORIGIN = "http://127.0.0.1:31300";

export type BrowserRuntimeScenario =
    | "missing"
    | "installed"
    | "login_pending"
    | "authenticated"
    | "error"
    | "origin_denied";

export type BrowserRuntimeFixtureOptions = {
    scenario: BrowserRuntimeScenario;
    port: number;
    configDir: string;
    trustedOrigin: string;
    log?: (line: string) => void;
};

export async function startBrowserRuntimeFixture(options: BrowserRuntimeFixtureOptions) {
    validatePort(options.port);
    await requireContainedConfigDirectory(options.configDir);
    const trustedOrigin = exactWebOrigin(options.trustedOrigin);
    const calls = { count: 0 };
    const dreamina = fakeDreaminaModule(options.scenario, calls);
    const config: LocalRuntimeConfig = {
        url: `http://127.0.0.1:${options.port}`,
        token: "browser-harness-master-canary-must-not-leak",
        ownerId: "browser-harness-owner-01",
        origins: [],
        trustedWebOrigins: options.scenario === "origin_denied" ? [] : [trustedOrigin],
        browserRegistrations: [],
    };
    const runtime = startLocalRuntime({
        config,
        modules: [fakeCanvasModule(), dreamina],
        port: options.port,
        log: options.log ?? (() => undefined),
        persistConfig: () => undefined,
    });
    await runtime.ready;
    return {
        pid: process.pid,
        endpoint: `http://127.0.0.1:${options.port}`,
        cliCalls: () => calls.count,
        close: runtime.close,
    };
}

function fakeCanvasModule(): LocalRuntimeModule {
    return {
        descriptor: {
            id: "canvas-agent",
            displayName: "Canvas Agent",
            apiVersion: 1,
            scopes: ["canvas:connect"],
        },
        routes: [],
    };
}

function fakeDreaminaModule(
    initialScenario: BrowserRuntimeScenario,
    calls: { count: number },
): LocalRuntimeModule {
    let scenario = initialScenario === "origin_denied" ? "installed" : initialScenario;
    const status: RequestHandler = (_req, res) => {
        calls.count += 1;
        if (scenario === "error") {
            res.status(500).json({
                ok: false,
                code: "dreamina_internal_error",
                message: "Dreamina CLI 请求失败",
            });
            return;
        }
        res.json({ ok: true, status: dreaminaStatus(scenario) });
    };
    const login: RequestHandler = (_req, res) => {
        calls.count += 1;
        if (scenario === "missing") {
            res.status(404).json({
                ok: false,
                code: "dreamina_missing",
                message: "未检测到 Dreamina CLI",
            });
            return;
        }
        scenario = "login_pending";
        res.json({ ok: true, status: dreaminaStatus(scenario) });
    };
    const logout: RequestHandler = (_req, res) => {
        calls.count += 1;
        scenario = "installed";
        res.json({ ok: true, status: dreaminaStatus(scenario) });
    };
    return {
        descriptor: {
            id: "dreamina",
            displayName: "Dreamina CLI",
            apiVersion: 1,
            scopes: ["dreamina:status", "dreamina:login", "dreamina:logout", "dreamina:run"],
        },
        routes: [
            { method: "GET", path: "/dreamina/status", scope: "dreamina:status", handler: status },
            { method: "POST", path: "/dreamina/login", scope: "dreamina:login", handler: login },
            { method: "POST", path: "/dreamina/logout", scope: "dreamina:logout", handler: logout },
        ],
    };
}

function dreaminaStatus(scenario: Exclude<BrowserRuntimeScenario, "origin_denied" | "error">) {
    if (scenario === "missing") {
        return {
            provider: "dreamina-cli",
            state: "missing",
            installed: false,
            authenticated: false,
            code: "dreamina_missing",
            message: "未检测到 Dreamina CLI",
        };
    }
    if (scenario === "authenticated") {
        return {
            provider: "dreamina-cli",
            state: "authenticated",
            installed: true,
            authenticated: true,
            version: "fixture-1.0.0",
            message: "Dreamina CLI 已登录",
        };
    }
    if (scenario === "login_pending") {
        return {
            provider: "dreamina-cli",
            state: "login_pending",
            installed: true,
            authenticated: false,
            version: "fixture-1.0.0",
            code: "dreamina_login_pending",
            message: "请在官方页面确认 Dreamina 登录",
            verificationUri: "https://jimeng.jianying.com/ai-tool/cli-auth",
            userCode: "DREAMINA-FIXTURE",
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        };
    }
    return {
        provider: "dreamina-cli",
        state: "installed",
        installed: true,
        authenticated: false,
        version: "fixture-1.0.0",
        code: "dreamina_login_required",
        message: "Dreamina CLI 已安装，需要登录",
    };
}

function validatePort(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535 || FORBIDDEN_PORTS.has(port)) {
        throw new Error("Browser Runtime fixture requires an isolated non-production port");
    }
}

async function requireContainedConfigDirectory(configDir: string) {
    if (!path.isAbsolute(configDir)) {
        throw new Error("Browser Runtime fixture config directory must be absolute");
    }
    const [worktreeRoot, resolvedConfigDir] = await Promise.all([
        fs.realpath(WORKTREE_ROOT),
        fs.realpath(configDir),
    ]);
    if (resolvedConfigDir === worktreeRoot
        || !resolvedConfigDir.startsWith(`${worktreeRoot}${path.sep}`)) {
        throw new Error("Browser Runtime fixture config directory must stay inside the worktree");
    }
}

function exactWebOrigin(value: string) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
        || url.username
        || url.password
        || url.pathname !== "/"
        || url.search
        || url.hash
        || url.origin !== value) {
        throw new Error("Browser Runtime fixture trusted origin is invalid");
    }
    return url.origin;
}

function parseCliArguments(argv: readonly string[]): BrowserRuntimeFixtureOptions {
    const values = new Map<string, string>();
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key?.startsWith("--") || value === undefined || values.has(key)) {
            throw new Error("Browser Runtime fixture arguments are invalid");
        }
        values.set(key, value);
    }
    const allowed = new Set(["--scenario", "--port", "--config-dir", "--trusted-origin"]);
    if ([...values.keys()].some((key) => !allowed.has(key))) {
        throw new Error("Browser Runtime fixture arguments are invalid");
    }
    const scenario = values.get("--scenario");
    if (!isScenario(scenario)) throw new Error("Browser Runtime fixture scenario is invalid");
    return {
        scenario,
        port: Number(values.get("--port")),
        configDir: values.get("--config-dir") ?? "",
        trustedOrigin: values.get("--trusted-origin") ?? DEFAULT_TRUSTED_ORIGIN,
    };
}

function isScenario(value: unknown): value is BrowserRuntimeScenario {
    return value === "missing"
        || value === "installed"
        || value === "login_pending"
        || value === "authenticated"
        || value === "error"
        || value === "origin_denied";
}

async function runCli() {
    const fixture = await startBrowserRuntimeFixture(parseCliArguments(process.argv.slice(2)));
    console.log(`Browser Runtime fixture listening at ${fixture.endpoint}`);
    console.log(`Browser Runtime fixture PID: ${fixture.pid}`);
    await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
    });
    await fixture.close();
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(fileURLToPath(import.meta.url))) {
    runCli().catch(() => {
        console.error("Browser Runtime fixture failed to start");
        process.exitCode = 1;
    });
}
