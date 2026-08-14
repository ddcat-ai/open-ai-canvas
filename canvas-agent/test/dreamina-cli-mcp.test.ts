import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { AGENT_PROMPT } from "../src/config.js";
import { dreaminaGenerationOperations } from "../src/dreamina-cli-contract.js";
import {
    postDreaminaCliTool,
    registerDreaminaMcp,
} from "../src/modules/dreamina-mcp.js";
import {
    parseDreaminaPublicRuntimeResult,
    projectDreaminaPublicRuntimeResult,
} from "../src/dreamina-public-result.js";

const input = {
    operation: "text2image" as const,
    idempotencyKey: "attempt-mcp-0001",
    prompt: "fixture",
    resolutionType: "2k" as const,
};

test("Dreamina MCP default composition serializes one HTTP public accepted result", async () => {
    let requests = 0;
    let requestBody = "";
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.setEncoding("utf8");
        request.on("data", (chunk) => { requestBody += chunk; });
        request.once("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: true,
                result: { state: "accepted", receiptRecorded: true },
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        let registeredName = "";
        let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
        const mcpServer = {
            registerTool(name: string, _definition: unknown, callback: typeof handler) {
                registeredName = name;
                handler = callback;
            },
        };
        registerDreaminaMcp(mcpServer as never, {
            url: `http://127.0.0.1:${address.port}`,
            token: "fixture",
        });

        assert.equal(registeredName, "dreamina_cli");
        assert.equal(requests, 0);
        assert.ok(handler);
        const result = await handler!(input, {}) as { content: Array<{ type: "text"; text: string }> };
        assert.deepEqual(JSON.parse(result.content[0]!.text), { state: "accepted", receiptRecorded: true });
        assert.doesNotMatch(JSON.stringify(result), /submitId|receipt-must-not-cross/);
        assert.equal(requests, 1);
        assert.deepEqual(JSON.parse(requestBody), input);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP rejects malformed HTTP public results without replaying submission", async () => {
    const invalidResults = [
        { state: "accepted", submitId: "" },
        {
            state: "accepted",
            receiptRecorded: true,
            submitId: "receipt-must-not-cross",
        },
        {
            state: "hostile-unknown",
            receipt: "receipt-must-not-cross",
            prompt: "prompt-must-not-cross",
            path: "C:\\private\\result.png",
            token: "token-must-not-cross",
        },
    ];
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        const result = invalidResults[requests];
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ok: true, result }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        for (const [index] of invalidResults.entries()) {
            await assert.rejects(
                postDreaminaCliTool(
                    { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                    input,
                ),
                (error: unknown) => {
                    assert(error instanceof Error);
                    assert.equal(error.message, "Dreamina CLI request failed (dreamina_submission_unknown)");
                    assert.doesNotMatch(error.message, /submitId|receipt-must-not-cross|prompt-must-not-cross|private|token-must-not-cross/);
                    return true;
                },
            );
            assert.equal(requests, index + 1);
        }
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP maps hostile unknown HTTP error envelopes to submission unknown without replay", async () => {
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: false,
                code: "hostile_transport_code",
                submitId: "receipt-must-not-cross",
                prompt: "prompt-must-not-cross",
                path: "C:\\private\\result.png",
                token: "token-must-not-cross",
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        await assert.rejects(
            postDreaminaCliTool(
                { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                input,
            ),
            (error: unknown) => {
                assert(error instanceof Error);
                assert.equal(error.message, "Dreamina CLI request failed (dreamina_submission_unknown)");
                assert.doesNotMatch(error.message, /hostile_transport_code|submitId|receipt-must-not-cross|prompt-must-not-cross|private|token-must-not-cross/);
                return true;
            },
        );
        assert.equal(requests, 1);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP rejects contradictory or non-exact HTTP envelopes after one dispatch", async () => {
    const hostileEnvelopes = [
        { ok: false, code: "dreamina_request_invalid", submitId: "receipt-must-not-cross" },
        { ok: false, code: "dreamina_request_invalid", result: { state: "accepted", receiptRecorded: true } },
        { ok: true, result: { state: "accepted", receiptRecorded: true }, code: "dreamina_request_invalid" },
        { ok: true, result: { state: "accepted", receiptRecorded: true }, extra: "private-must-not-cross" },
        { ok: "false", code: "dreamina_request_invalid" },
        { ok: false, code: "dreamina_internal_error" },
    ];
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        const envelope = hostileEnvelopes[requests];
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(envelope));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        for (const [index] of hostileEnvelopes.entries()) {
            await assert.rejects(
                postDreaminaCliTool(
                    { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                    input,
                ),
                (error: unknown) => {
                    assert(error instanceof Error);
                    assert.equal(error.message, "Dreamina CLI request failed (dreamina_submission_unknown)");
                    assert.doesNotMatch(error.message, /receipt-must-not-cross|private-must-not-cross|dreamina_internal_error/);
                    return true;
                },
            );
            assert.equal(requests, index + 1);
        }
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP preserves only an exact trusted pre-submit HTTP error envelope", async () => {
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(400, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: false,
                code: "dreamina_request_invalid",
                message: "Dreamina 请求参数无效",
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        await assert.rejects(
            postDreaminaCliTool(
                { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                input,
            ),
            (error: unknown) => error instanceof Error
                && error.message === "Dreamina CLI request failed (dreamina_request_invalid)",
        );
        assert.equal(requests, 1);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP accepts an exact public success on another 2xx status", async () => {
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(201, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: true,
                result: { state: "accepted", receiptRecorded: true },
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        const result = await postDreaminaCliTool(
            { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
            input,
        );
        assert.deepEqual(result, { state: "accepted", receiptRecorded: true });
        assert.equal(requests, 1);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP rejects status and exact public envelope contradictions without replay", async () => {
    const cases = [
        {
            statusCode: 500,
            body: { ok: true, result: { state: "accepted", receiptRecorded: true } },
        },
        {
            statusCode: 200,
            body: { ok: false, code: "dreamina_request_invalid", message: "Dreamina 请求参数无效" },
        },
        {
            statusCode: 503,
            body: { ok: false, code: "dreamina_request_invalid", message: "Dreamina 请求参数无效" },
        },
    ];
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        const fixture = cases[requests];
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(fixture!.statusCode, { "content-type": "application/json" });
            response.end(JSON.stringify(fixture!.body));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        for (const [index] of cases.entries()) {
            await assert.rejects(
                postDreaminaCliTool(
                    { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                    input,
                ),
                (error: unknown) => error instanceof Error
                    && error.message === "Dreamina CLI request failed (dreamina_submission_unknown)",
            );
            assert.equal(requests, index + 1);
        }
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP refuses HTTP redirects without replaying a submission", async () => {
    let requests = 0;
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.resume();
        request.once("end", () => {
            if (request.url === "/dreamina/run") {
                response.writeHead(307, {
                    "content-type": "application/json",
                    location: "/dreamina/redirected-run",
                });
                response.end(JSON.stringify({
                    ok: false,
                    code: "dreamina_request_invalid",
                    message: "Dreamina 请求参数无效",
                }));
                return;
            }
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: true,
                result: { state: "accepted", receiptRecorded: true },
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;

    try {
        await assert.rejects(
            postDreaminaCliTool(
                { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                input,
            ),
            (error: unknown) => error instanceof Error
                && error.message === "Dreamina CLI request failed (dreamina_submission_unknown)",
        );
        assert.equal(requests, 1);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP validates the injected public seam before serializing it", async () => {
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    const server = {
        registerTool(_name: string, _definition: unknown, callback: typeof handler) {
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postPublicTool: async () => ({
            state: "accepted",
            receiptRecorded: true,
            submitId: "receipt-must-not-cross",
        }) as never,
    });

    assert.ok(handler);
    await assert.rejects(handler!(input, {}), (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.message, "Dreamina CLI request failed (dreamina_submission_unknown)");
        assert.doesNotMatch(error.message, /receipt-must-not-cross|submitId/);
        return true;
    });
});

test("Dreamina MCP normalizes injected seam rejection after one call", async () => {
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    let calls = 0;
    const server = {
        registerTool(_name: string, _definition: unknown, callback: typeof handler) {
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postPublicTool: async () => {
            calls += 1;
            throw Object.assign(new Error("private receipt-must-not-cross"), { submitId: "submit-private" });
        },
    });

    assert.ok(handler);
    await assert.rejects(handler!(input, {}), (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.message, "Dreamina CLI request failed (dreamina_submission_unknown)");
        assert.doesNotMatch(error.message, /private|receipt-must-not-cross|submit-private|submitId/);
        return true;
    });
    assert.equal(calls, 1);
});

test("Dreamina MCP preserves pre-dispatch abort semantics at the registered handler", async () => {
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    const server = {
        registerTool(_name: string, _definition: unknown, callback: typeof handler) {
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:1", token: "fixture" });
    const controller = new AbortController();
    controller.abort();

    assert.ok(handler);
    await assert.rejects(
        handler!(input, { signal: controller.signal }),
        (error: unknown) => error instanceof Error
            && error.message === "Dreamina CLI request failed (dreamina_cancelled)",
    );
});

test("Dreamina MCP does not hide schema rejection behind public seam normalization", async () => {
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    let calls = 0;
    const server = {
        registerTool(_name: string, _definition: unknown, callback: typeof handler) {
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postPublicTool: async () => {
            calls += 1;
            return { state: "accepted", receiptRecorded: true };
        },
    });

    assert.ok(handler);
    await assert.rejects(handler!({ ...input, operation: "not-a-dreamina-operation" }, {}), (error: unknown) => {
        assert(error instanceof Error);
        assert.doesNotMatch(error.message, /Dreamina CLI request failed/);
        return true;
    });
    assert.equal(calls, 0);
});

test("Dreamina raw public projector rejects inherited contract fields", () => {
    const inheritedRaw = Object.create({ state: "accepted", submitId: "receipt-prototype-0001" });
    assert.throws(() => projectDreaminaPublicRuntimeResult(inheritedRaw));
});

test("Dreamina public result parser rejects inherited contract fields", () => {
    const inheritedPublic = Object.create({ state: "accepted", receiptRecorded: true });
    assert.throws(() => parseDreaminaPublicRuntimeResult(inheritedPublic));
});

test("Dreamina public result projectors enforce serializable exact fields without getters", () => {
    const rawWithSymbol = { state: "accepted", submitId: "receipt-symbol-extra-0001" } as Record<PropertyKey, unknown>;
    rawWithSymbol[Symbol("private")] = "must-not-cross";
    assert.throws(() => projectDreaminaPublicRuntimeResult(rawWithSymbol));

    const publicWithHidden = { state: "accepted", receiptRecorded: true };
    Object.defineProperty(publicWithHidden, "private", { value: "must-not-cross", enumerable: false });
    assert.throws(() => parseDreaminaPublicRuntimeResult(publicWithHidden));

    let getterCalls = 0;
    const accessorRaw = { submitId: "receipt-getter-guard-0001" } as Record<string, unknown>;
    Object.defineProperty(accessorRaw, "state", {
        enumerable: true,
        get() {
            getterCalls += 1;
            return "accepted";
        },
    });
    assert.throws(() => projectDreaminaPublicRuntimeResult(accessorRaw));
    assert.equal(getterCalls, 0);

    assert.deepEqual(projectDreaminaPublicRuntimeResult({
        state: "accepted",
        submitId: "receipt-plain-object-0001",
    }), { state: "accepted", receiptRecorded: true });
    assert.deepEqual(parseDreaminaPublicRuntimeResult({
        state: "accepted",
        receiptRecorded: true,
    }), { state: "accepted", receiptRecorded: true });

    const nullPrototypeRaw = Object.assign(Object.create(null) as Record<string, unknown>, {
        state: "accepted",
        submitId: "receipt-null-prototype-0001",
    });
    const nullPrototypePublic = Object.assign(Object.create(null) as Record<string, unknown>, {
        state: "accepted",
        receiptRecorded: true,
    });
    assert.deepEqual(projectDreaminaPublicRuntimeResult(nullPrototypeRaw), { state: "accepted", receiptRecorded: true });
    assert.deepEqual(parseDreaminaPublicRuntimeResult(nullPrototypePublic), { state: "accepted", receiptRecorded: true });
});

test("Dreamina raw public projector rejects forged or ambiguous accepted results", () => {
    const invalidRawResults = [
        { state: "accepted", submitId: "" },
        { state: "accepted", submitId: "receipt-forged", receiptRecorded: true },
        {
            state: "accepted",
            submitId: "receipt-extra",
            prompt: "prompt-must-not-cross",
            path: "C:\\private\\result.png",
            token: "token-must-not-cross",
        },
    ];

    for (const result of invalidRawResults) {
        assert.throws(
            () => projectDreaminaPublicRuntimeResult(result),
            (error: unknown) => {
                assert(error instanceof Error);
                assert.doesNotMatch(error.message, /receipt-forged|receipt-extra|prompt-must-not-cross|private|token-must-not-cross/);
                return true;
            },
        );
    }
});

test("Dreamina MCP forwards image auto without inventing resolutionType", async () => {
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    const calls: unknown[] = [];
    const server = {
        registerTool(_name: string, _definition: unknown, callback: typeof handler) {
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postPublicTool: async (_config, value) => {
            calls.push(value);
            return { state: "accepted", receiptRecorded: true };
        },
    });

    assert.ok(handler);
    await handler!({
        operation: "text2image",
        idempotencyKey: "attempt-mcp-auto-0001",
        prompt: "fixture",
        modelVersion: "5.0",
        ratio: "16:9",
        generateNum: 1,
    }, {});
    assert.deepEqual(calls, [{
        operation: "text2image",
        idempotencyKey: "attempt-mcp-auto-0001",
        prompt: "fixture",
        modelVersion: "5.0",
        ratio: "16:9",
        generateNum: 1,
    }]);
});

test("Dreamina public MCP rejects query_result before an injected seam", async () => {
    let seamHandler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    let seamCalls = 0;
    const seamServer = {
        registerTool(_name: string, _definition: unknown, callback: typeof seamHandler) {
            seamHandler = callback;
        },
    };
    registerDreaminaMcp(seamServer as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postPublicTool: async () => {
            seamCalls += 1;
            return { state: "accepted", receiptRecorded: true };
        },
    });
    assert.ok(seamHandler);
    await assert.rejects(seamHandler!({ operation: "query_result", submitId: "receipt-public-query-0001" }, {}));
    assert.equal(seamCalls, 0);
});

test("Dreamina public MCP rejects query_result before the default HTTP dispatch", async () => {
    let requests = 0;
    let httpHandler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    const runtimeServer = createServer((request, response) => {
        requests += 1;
        request.resume();
        request.once("end", () => {
            response.writeHead(400, { "content-type": "application/json" });
            response.end(JSON.stringify({
                ok: false,
                code: "dreamina_request_invalid",
                message: "Dreamina 请求参数无效",
            }));
        });
    });
    runtimeServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => runtimeServer.once("listening", resolve));
    const address = runtimeServer.address() as AddressInfo;
    const httpServer = {
        registerTool(_name: string, _definition: unknown, callback: typeof httpHandler) {
            httpHandler = callback;
        },
    };
    registerDreaminaMcp(httpServer as never, {
        url: `http://127.0.0.1:${address.port}`,
        token: "fixture",
    });
    try {
        assert.ok(httpHandler);
        await assert.rejects(httpHandler!({ operation: "query_result", submitId: "receipt-public-query-0002" }, {}));
        assert.equal(requests, 0);
    } finally {
        runtimeServer.closeAllConnections();
        await new Promise<void>((resolve, reject) => runtimeServer.close((error) => error ? reject(error) : resolve()));
    }
});

test("Dreamina MCP tool guidance exposes only current generation operations", () => {
    let definition: unknown;
    const server = {
        registerTool(_name: string, value: unknown) {
            definition = value;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" });
    const tool = definition as {
        description?: string;
        inputSchema?: {
            operation?: { safeParse(value: unknown): { success: boolean } };
            resolutionType?: { description?: string };
            submitId?: unknown;
        };
    };
    assert.match(tool.description ?? "", /automatic resolution/i);
    assert.match(tool.description ?? "", /omit resolutionType/i);
    assert.doesNotMatch(tool.description ?? "", /query_result|submitId/i);
    assert.equal(Object.hasOwn(tool.inputSchema ?? {}, "submitId"), false);
    assert.equal(tool.inputSchema?.operation?.safeParse("query_result").success, false);
    for (const operation of dreaminaGenerationOperations) {
        assert.equal(tool.inputSchema?.operation?.safeParse(operation).success, true, operation);
    }
    assert.match(tool.inputSchema?.resolutionType?.description ?? "", /automatic image resolution/i);
    assert.match(tool.inputSchema?.resolutionType?.description ?? "", /omit resolutionType/i);
    assert.match(AGENT_PROMPT, /即使用户.*Dreamina/i);
    assert.match(AGENT_PROMPT, /canvas_generate_image/);
    assert.match(AGENT_PROMPT, /quality=auto/i);
    assert.match(AGENT_PROMPT, /禁止.*dreamina_cli/i);
});

test("Dreamina MCP rejects cancellation before dispatch without contacting Runtime", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        postDreaminaCliTool(
            { url: "http://127.0.0.1:1", token: "fixture" },
            input,
            { signal: controller.signal },
        ),
        (error: unknown) => error instanceof Error && error.message.includes("dreamina_cancelled"),
    );
});

test("Dreamina MCP treats a lost response after dispatch as submission unknown", async () => {
    let requests = 0;
    const server = createServer((request) => {
        requests += 1;
        request.resume();
        request.once("end", () => request.socket.destroy());
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    try {
        await assert.rejects(
            postDreaminaCliTool(
                { url: `http://127.0.0.1:${address.port}`, token: "fixture" },
                input,
                { timeoutMs: 1_000 },
            ),
            (error: unknown) => error instanceof Error && error.message.includes("dreamina_submission_unknown"),
        );
        assert.equal(requests, 1);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
