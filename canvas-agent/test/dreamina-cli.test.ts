import assert from "node:assert/strict";
import { test } from "node:test";

import {
    DreaminaCliService,
    type DreaminaProcessRequest,
    type DreaminaProcessResult,
} from "../src/dreamina-cli.js";
import { DreaminaCliError } from "../src/dreamina-cli-process.js";

const installation = { installed: true as const, executable: "dreamina-fixture" };
const ownerId = "owner-fixture-0001";
const verificationUri = "https://jimeng.jianying.com/ai-tool/cli-auth";

test("Dreamina status recognizes the current OS-user CLI login state with fixed argv", async () => {
    const calls: DreaminaProcessRequest[] = [];
    const env = { HOME: "fixture-home", USERPROFILE: "fixture-profile" };
    const service = new DreaminaCliService({
        ownerId,
        env,
        discover: async () => installation,
        runProcess: async (request) => {
            calls.push(request);
            return request.args[0] === "--version"
                ? result(0, '{"version":"1.2.3","token":"private"}')
                : result(0, '{"total_credit":24940,"account":"private"}');
        },
    });

    const status = await service.status();

    assert.deepEqual(calls.map((call) => call.args), [["--version"], ["user_credit"]]);
    assert.ok(calls.every((call) => call.env === env));
    assert.ok(calls.every((call) => !call.args.join(" ").includes(ownerId)));
    assert.equal(status.state, "authenticated");
    assert.equal(status.version, "1.2.3");
    assert.equal(status.totalCredit, 24_940);
    assert.match(status.accountBinding || "", /^[A-Za-z0-9._:-]{8,160}$/);
    assert.equal(Number.isSafeInteger(status.sessionEpoch), true);
    assert.equal(Number.isFinite(Date.parse(status.creditObservedAt || "")), true);
    assert.equal(JSON.stringify(status).includes("private"), false);
    assert.equal(JSON.stringify(status).includes("total_credit"), false);
});

test("Dreamina status omits malformed credit values from the public authenticated DTO", async () => {
    for (const totalCredit of [-1, 1.5, "24940", null, Number.MAX_SAFE_INTEGER]) {
        const service = new DreaminaCliService({
            ownerId,
            discover: async () => installation,
            runProcess: async (request) => request.args[0] === "--version"
                ? result(0, '{"version":"1.2.3"}')
                : result(0, JSON.stringify({ total_credit: totalCredit })),
        });

        const status = await service.status();

        assert.equal(status.state, "authenticated");
        assert.equal("totalCredit" in status, false);
    }
});

test("Dreamina login keeps device code private and coalesces an active flow", async () => {
    const calls: DreaminaProcessRequest[] = [];
    const service = new DreaminaCliService({
        ownerId,
        discover: async () => installation,
        runProcess: async (request) => {
            calls.push(request);
            if (request.args[0] === "--version") return result(0, '{"version":"1.2.3"}');
            return result(0, JSON.stringify({
                verification_uri: verificationUri,
                user_code: "ABCD-EFGH",
                device_code: "private-device-code",
                expires_in: 600,
            }));
        },
        now: () => new Date("2026-08-10T00:00:00.000Z"),
    });

    const first = await service.login();
    const second = await service.login();

    assert.deepEqual(calls.map((call) => call.args), [["--version"], ["login", "--headless"]]);
    assert.deepEqual(second, first);
    assert.equal(first.state, "login_pending");
    assert.equal(first.verificationUri, verificationUri);
    assert.equal(first.userCode, "ABCD-EFGH");
    assert.equal(JSON.stringify(first).includes("private-device-code"), false);
});

test("Dreamina status completes a private headless login flow", async () => {
    const calls: string[][] = [];
    const service = new DreaminaCliService({
        ownerId,
        discover: async () => installation,
        runProcess: async (request) => {
            calls.push(request.args);
            if (request.args[0] === "--version") return result(0, '{"version":"1.2.3"}');
            if (request.args[0] === "login" && request.args[1] === "--headless") {
                return result(0, `{"verification_uri":"${verificationUri}","user_code":"CODE","device_code":"private-device-code","expires_in":600}`);
            }
            if (request.args[0] === "login") return result(0, '{"authenticated":true}');
            return result(1, "", "not authenticated");
        },
    });

    await service.login();
    const status = await service.status();

    assert.deepEqual(calls.at(-1), ["login", "checklogin", "--device_code=private-device-code", "--poll=0"]);
    assert.equal(status.state, "authenticated");
    assert.equal(JSON.stringify(status).includes("private-device-code"), false);
});

test("Dreamina logout cancels earlier lifecycle work and invokes only fixed logout argv", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const calls: string[][] = [];
    let discoveries = 0;
    const service = new DreaminaCliService({
        ownerId,
        discover: async () => {
            discoveries += 1;
            if (discoveries === 1) await waiting;
            return installation;
        },
        runProcess: async (request) => {
            calls.push(request.args);
            return result(0, "logged out");
        },
    });

    const login = service.login();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const logout = service.logout();
    release();

    await assert.rejects(
        login,
        (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_cancelled",
    );
    assert.equal((await logout).authenticated, false);
    assert.deepEqual(calls, [["logout"]]);
});

test("Dreamina rejects non-official OAuth verification pages", async () => {
    const service = new DreaminaCliService({
        ownerId,
        discover: async () => installation,
        runProcess: async (request) => request.args[0] === "--version"
            ? result(0, '{"version":"1.2.3"}')
            : result(0, '{"verification_uri":"https://example.test/device","user_code":"CODE","device_code":"private","expires_in":600}'),
    });

    await assert.rejects(
        service.login(),
        (error: unknown) => error instanceof DreaminaCliError && error.code === "dreamina_login_response_invalid",
    );
});

function result(exitCode: number | null, stdout = "", stderr = ""): DreaminaProcessResult {
    return { exitCode, stdout, stderr };
}
