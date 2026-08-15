import assert from "node:assert/strict";
import { test } from "node:test";

type CliChildEnvironmentModule = {
    buildCliChildEnvironment?: (source: Record<string, string | undefined>) => Record<string, string>;
};

async function loadSharedChildEnvironment(): Promise<CliChildEnvironmentModule | undefined> {
    return import("../src/cli-child-environment.js").catch(() => undefined) as Promise<CliChildEnvironmentModule | undefined>;
}

function requireBuilder(module: CliChildEnvironmentModule | undefined) {
    if (typeof module?.buildCliChildEnvironment !== "function") {
        assert.fail("shared CLI child environment builder is unavailable");
    }
    return module.buildCliChildEnvironment;
}

test("shared CLI child environment keeps OS home and valid proxy settings while dropping sensitive inputs", async () => {
    const build = requireBuilder(await loadSharedChildEnvironment());
    const actual = build({
        PATH: "fixture-path",
        HOME: "fixture-home",
        USERPROFILE: "fixture-profile",
        HTTP_PROXY: "http://proxy.example.test:8080",
        HTTPS_PROXY: "https://secure-proxy.example.test",
        NO_PROXY: "localhost,.example.test,127.0.0.1,[::1]:443",
        CANVAS_AGENT_TOKEN: "fixture-secret",
        CANVAS_AGENT_SESSION_KEY: "fixture-secret",
        DREAMINA_TOKEN: "fixture-secret",
        GFLOW_CLI_HOME: "fixture-gflow-home",
        BROWSER: "fixture-browser",
    });

    assert.deepEqual(actual, process.platform === "win32"
        ? {
            PATH: "fixture-path",
            USERPROFILE: "fixture-profile",
            HTTP_PROXY: "http://proxy.example.test:8080",
            HTTPS_PROXY: "https://secure-proxy.example.test",
            NO_PROXY: "localhost,.example.test,127.0.0.1,[::1]:443",
        }
        : {
            PATH: "fixture-path",
            HOME: "fixture-home",
            HTTP_PROXY: "http://proxy.example.test:8080",
            HTTPS_PROXY: "https://secure-proxy.example.test",
            NO_PROXY: "localhost,.example.test,127.0.0.1,[::1]:443",
        });
});

test("shared CLI child environment preserves Windows Program Files discovery for Dreamina and gflow without leaking private inputs", async (context) => {
    if (process.platform !== "win32") return context.skip("Windows-specific environment semantics");
    const build = requireBuilder(await loadSharedChildEnvironment());

    const actual = build({
        PROGRAMFILES: "fixture-program-files",
        "PROGRAMFILES(X86)": "fixture-program-files-x86",
        PROGRAMW6432: "fixture-program-files-w6432",
        CANVAS_AGENT_TOKEN: "fixture-secret",
        GFLOW_CLI_HOME: "fixture-gflow-home",
        PRIVATE_TOKEN: "fixture-secret",
    });

    assert.deepEqual(actual, {
        PROGRAMFILES: "fixture-program-files",
        "PROGRAMFILES(X86)": "fixture-program-files-x86",
        PROGRAMW6432: "fixture-program-files-w6432",
    });
});

test("shared CLI child environment rejects credentialed proxies", async () => {
    const build = requireBuilder(await loadSharedChildEnvironment());

    assert.throws(
        () => build({ HTTP_PROXY: "http://user:secret@proxy.example.test" }),
        (error: unknown) => typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "cli_environment_invalid",
    );
});

test("shared CLI child environment rejects non-HTTP proxies and invalid NO_PROXY entries", async () => {
    const build = requireBuilder(await loadSharedChildEnvironment());

    assert.throws(
        () => build({ HTTPS_PROXY: "socks5://proxy.example.test" }),
        (error: unknown) => typeof error === "object"
            && error !== null
            && "code" in error
            && "reason" in error
            && error.code === "cli_environment_invalid"
            && error.reason === "proxy",
    );
    assert.throws(
        () => build({ NO_PROXY: "localhost,,example.test" }),
        (error: unknown) => typeof error === "object"
            && error !== null
            && "code" in error
            && "reason" in error
            && error.code === "cli_environment_invalid"
            && error.reason === "no_proxy",
    );
});

test("shared CLI child environment rejects conflicting Windows key casing", async (context) => {
    if (process.platform !== "win32") return context.skip("Windows-specific environment semantics");
    const build = requireBuilder(await loadSharedChildEnvironment());

    assert.throws(
        () => build({ PATH: "fixture-a", Path: "fixture-b" }),
        (error: unknown) => typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "cli_environment_invalid",
    );
});

test("shared CLI child environment rejects conflicting Windows Program Files casing", async (context) => {
    if (process.platform !== "win32") return context.skip("Windows-specific environment semantics");
    const build = requireBuilder(await loadSharedChildEnvironment());

    assert.throws(
        () => build({ PROGRAMFILES: "fixture-a", ProgramFiles: "fixture-b" }),
        (error: unknown) => typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "cli_environment_invalid",
    );
});
