import { afterEach, describe, expect, test } from "bun:test";

import { systemChannelModelChannels } from "../src/lib/user-session";
import { requestImageQuestion, requestToolResponse } from "../src/services/api/image";
import { createModelChannel, defaultConfig, resolveModelRequestConfig, type AiConfig, type TextRequestFormat } from "../src/stores/use-config-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function textConfig(protocol: string, requestFormat?: TextRequestFormat): AiConfig {
    const channel = createModelChannel({
        id: "text-channel",
        name: "Text",
        baseUrl: "https://text.example/v1",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        interfaceType: protocol,
        models: ["text-model"],
        modelCosts: [{ model: "text-model", capability: "text", protocol, ...(requestFormat ? { requestFormat } : {}), billingMode: "token", unitPriceMicrocredits: 0 }],
    });
    return { ...defaultConfig, channels: [channel], model: "text-channel::text-model", textModel: "text-channel::text-model" };
}

function streamResponse(events: unknown[]) {
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

type CapturedRequest = { url: string; headers: Record<string, string> };

/** 自定义渠道经站内中转发出：上游地址在 X-Canvas-Upstream-URL 头里。 */
function captureRequests(events: unknown[]) {
    const requests: CapturedRequest[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url ?? "");
        const headers = new Headers((init?.headers ?? (input as Request)?.headers ?? {}) as HeadersInit);
        requests.push({ url, headers: Object.fromEntries(headers.entries()) });
        return streamResponse(events);
    }) as typeof fetch;
    return requests;
}

function upstreamPath(requests: CapturedRequest[]): string {
    const raw = requests[0]?.headers["x-canvas-upstream-url"] || requests[0]?.url || "";
    try {
        return new URL(raw).pathname;
    } catch {
        return raw;
    }
}

describe("text request format", () => {
    // 后端随模型目录下发的 requestFormat 决定端点：vendor-chat 不再被当成 Responses。
    test("requestToolResponse follows requestFormat chat-completion", async () => {
        const requests = captureRequests([{ choices: [{ delta: { content: "ok" } }] }]);
        const result = await requestToolResponse(textConfig("vendor-chat", "chat-completion"), [{ role: "user", content: "写一句" }], []);
        expect(result.content).toBe("ok");
        expect(requests).toHaveLength(1);
        expect(upstreamPath(requests)).toBe("/v1/chat/completions");
    });

    test("requestImageQuestion follows requestFormat chat-completion", async () => {
        const requests = captureRequests([{ choices: [{ delta: { content: "ok" } }] }]);
        const answer = await requestImageQuestion(textConfig("vendor-chat", "chat-completion"), [{ role: "user", content: "写一句" }], () => {});
        expect(answer).toBe("ok");
        expect(upstreamPath(requests)).toBe("/v1/chat/completions");
    });

    // 内置协议 ID 的映射与行为不变。
    test("author builtin protocols keep their endpoints", async () => {
        const chatRequests = captureRequests([{ choices: [{ delta: { content: "ok" } }] }]);
        await requestToolResponse(textConfig("chat-completion"), [{ role: "user", content: "写一句" }], []);
        expect(upstreamPath(chatRequests)).toBe("/v1/chat/completions");

        const responsesRequests = captureRequests([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } }]);
        await requestToolResponse(textConfig("openai-response"), [{ role: "user", content: "写一句" }], []);
        expect(upstreamPath(responsesRequests)).toBe("/v1/responses");
    });

    // 没有 requestFormat 的未知协议保持原来的 responses 行为（不新增兜底）。
    test("unknown protocol without requestFormat keeps author fallback", async () => {
        const requests = captureRequests([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] } }]);
        await requestToolResponse(textConfig("legacy-custom-text"), [{ role: "user", content: "写一句" }], []);
        expect(upstreamPath(requests)).toBe("/v1/responses");
    });

    test("resolveModelRequestConfig exposes requestFormat and apiFormat", () => {
        const resolved = resolveModelRequestConfig(textConfig("vendor-chat", "chat-completion"), "text-channel::text-model");
        expect(resolved.requestFormat).toBe("chat-completion");
        expect(resolved.apiFormat).toBe("openai");

        const claude = resolveModelRequestConfig(textConfig("vendor-chat", "claude-api"), "text-channel::text-model");
        expect(claude.requestFormat).toBe("claude-api");
        expect(claude.apiFormat).toBe("claude");

        // 内置协议照旧映射。
        expect(resolveModelRequestConfig(textConfig("openai-response"), "text-channel::text-model").requestFormat).toBe("responses");
        expect(resolveModelRequestConfig(textConfig("chat-completion"), "text-channel::text-model").requestFormat).toBe("chat-completion");
    });
});

describe("system channel catalog plumbing", () => {
    // 后端随模型目录下发的 requestFormat 要经 modelCosts 进入 resolveModelRequestConfig，并让工具调用走 /chat/completions。
    test("catalog requestFormat reaches requestToolResponse", async () => {
        const channels = systemChannelModelChannels([
            {
                id: "sys-1",
                name: "系统模型",
                displayName: "系统模型",
                sortOrder: 0,
                models: [
                    {
                        id: "cm-1",
                        modelKey: "vendor-model",
                        displayName: "Vendor Model",
                        channelLabel: "Vendor",
                        tags: [],
                        description: "",
                        icon: "",
                        capability: "text",
                        protocol: "vendor-chat",
                        requestFormat: "chat-completion",
                        priceTiers: [{ id: "t1", selector: {}, resolution: "*", videoSeconds: 0, billingMode: "token", unitPriceMicrocredits: 0, inputTokenPriceMicrocredits: 0, outputTokenPriceMicrocredits: 0, cachedTokenPriceMicrocredits: 0 }],
                        pricingMode: "tier",
                        priceLabel: "0",
                        available: true,
                    },
                ],
            },
        ]);
        const config: AiConfig = { ...defaultConfig, channels, model: "sys-1::vendor-model", textModel: "sys-1::vendor-model" };
        expect(resolveModelRequestConfig(config, "sys-1::vendor-model").requestFormat).toBe("chat-completion");

        const requests = captureRequests([{ choices: [{ delta: { content: "ok" } }] }]);
        const result = await requestToolResponse(config, [{ role: "user", content: "写一句" }], []);
        expect(result.content).toBe("ok");
        // 系统渠道经站内代理发出，路径带渠道前缀（/api/sys-1/chat/completions），所以只看端点后缀。
        const target = requests[0]?.headers["x-canvas-upstream-url"] || requests[0]?.url || "";
        expect(target.endsWith("/chat/completions")).toBe(true);
    });
});
