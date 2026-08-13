import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { AGENT_PROMPT } from "../src/config.js";
import {
    postDreaminaCliTool,
    registerDreaminaMcp,
} from "../src/modules/dreamina-mcp.js";

const input = {
    operation: "text2image" as const,
    idempotencyKey: "attempt-mcp-0001",
    prompt: "fixture",
    resolutionType: "2k" as const,
};

test("Dreamina MCP registers one explicit tool without running the CLI during registration", async () => {
    let registeredName = "";
    let handler: ((input: unknown, extra: { signal?: AbortSignal }) => Promise<unknown>) | undefined;
    const calls: unknown[] = [];
    const server = {
        registerTool(name: string, _definition: unknown, callback: typeof handler) {
            registeredName = name;
            handler = callback;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" }, {
        postTool: async (_config, value) => {
            calls.push(value);
            return { state: "accepted", submitId: "receipt-mcp" };
        },
    });

    assert.equal(registeredName, "dreamina_cli");
    assert.deepEqual(calls, []);
    assert.ok(handler);
    const result = await handler!(input, {});
    assert.equal(JSON.stringify(result).includes("receipt-mcp"), true);
    assert.deepEqual(calls, [input]);
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
        postTool: async (_config, value) => {
            calls.push(value);
            return { state: "accepted", submitId: "receipt-auto-mcp" };
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

test("Dreamina MCP tool guidance tells agents to omit resolutionType for image auto", () => {
    let definition: unknown;
    const server = {
        registerTool(_name: string, value: unknown) {
            definition = value;
        },
    };
    registerDreaminaMcp(server as never, { url: "http://127.0.0.1:17371", token: "fixture" });
    const tool = definition as { description?: string; inputSchema?: { resolutionType?: { description?: string } } };
    assert.match(tool.description ?? "", /automatic resolution/i);
    assert.match(tool.description ?? "", /omit resolutionType/i);
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
    const server = createServer((request) => {
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
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
