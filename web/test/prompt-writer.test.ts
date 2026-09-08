import { afterEach, describe, expect, test } from "bun:test";
import { promptOptimizerPlugin } from "../src/lib/plugins/builtin/prompt-optimizer";
import { createPluginHostContext } from "../src/services/plugin-host";
import { requestImageQuestion, requestTextResponse } from "../src/services/api/image";
import { defaultConfig, createModelChannel, normalizeConfigSnapshot } from "../src/stores/use-config-store";
import { parseWriterHistory } from "../src/components/canvas/use-prompt-writer";
import type { PluginHostContext, PluginTextRequest, PromptOptimizationInput, PluginInstallation } from "../src/lib/plugins/plugin-types";

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});
const base: PromptOptimizationInput = { prompt: "雨夜街头的一只猫", mode: "expand", generationMode: "image" };

function providerWith(requestText: (request: PluginTextRequest) => Promise<string>) {
    return promptOptimizerPlugin.createPromptOptimizer!({ services: { ai: { text: { requestText } } } } as PluginHostContext);
}

describe("prompt writer", () => {
    test("one plain text request streams a draft without tool schema or extra versions", async () => {
        const requests: PluginTextRequest[] = [];
        const deltas: string[] = [];
        const provider = providerWith(async (request) => {
            requests.push(request);
            request.onDelta?.("雨夜");
            request.onDelta?.("雨夜街头的猫");
            return "雨夜街头的猫";
        });
        expect(await provider.optimize(base, { onDelta: (text) => deltas.push(text) })).toMatchObject({ optimizedPrompt: "雨夜街头的猫" });
        expect(requests).toHaveLength(1);
        expect(requests[0].tools).toBeUndefined();
        expect(requests[0].toolChoice).toBeUndefined();
        expect(deltas).toEqual(["雨夜", "雨夜街头的猫"]);
        expect(JSON.stringify(requests[0].messages)).not.toContain("optimize_prompt");
    });

    test("revision receives the currently edited draft and explicit instruction", async () => {
        const provider = providerWith(async (request) => {
            const messages = JSON.stringify(request.messages);
            expect(messages).toContain("手工编辑后的猫");
            expect(messages).toContain("只调整景别");
            expect(messages).toContain("其余已明确内容保持不变");
            return "猫的近景";
        });
        await provider.optimize({ ...base, action: "revise", currentPrompt: "手工编辑后的猫", prompt: "只调整景别" });
    });

    test("variants only generate when explicitly requested and selected references are passed", async () => {
        const provider = providerWith(async (request) => {
            const messages = JSON.stringify(request.messages);
            expect(messages).toContain("另写一份创作版本");
            expect(messages).toContain("https://example.com/cat.png");
            return "另一个构图";
        });
        await provider.optimize({ ...base, action: "variant", currentPrompt: "猫的近景", context: { images: [{ title: "猫", url: "https://example.com/cat.png" }] } });
    });

    test("empty response is failure, never the original prompt", async () => {
        await expect(providerWith(async () => " ").optimize(base)).rejects.toThrow("没有返回正文");
        await expect(providerWith(async () => "正文").optimize({ ...base, action: "revise" })).rejects.toThrow("选择要修改");
    });

    test("late response after cancellation is rejected", async () => {
        const controller = new AbortController();
        const provider = providerWith(async () => {
            controller.abort();
            return "迟到的正文";
        });
        await expect(provider.optimize(base, { signal: controller.signal })).rejects.toThrow();
    });

    test("history validates shape and bounds versions, excludes unrelated data", () => {
        expect(parseWriterHistory(null)).toBeNull();
        expect(() => parseWriterHistory('{"versions":[]}')).toThrow();
        const saved = { source: "想法", selectedId: "24", secret: "not-history", versions: Array.from({ length: 25 }, (_, i) => ({ id: String(i), label: "起草", result: { optimizedPrompt: `稿 ${i}` } })) };
        const history = parseWriterHistory(JSON.stringify(saved))!;
        expect(history.versions).toHaveLength(20);
        expect(history.versions[0].id).toBe("5");
        expect(history.selectedId).toBe("24");
        expect(history).not.toHaveProperty("secret");
    });

    test("plugin text service enforces ai.text permission", async () => {
        const context = createPluginHostContext({ ...promptOptimizerPlugin, manifest: { ...promptOptimizerPlugin.manifest, permissions: [] } }, { config: {} } as PluginInstallation, defaultConfig);
        await expect(context.services!.ai!.text!.requestText({ messages: [] })).rejects.toThrow("权限");
    });
});

function configFor(protocol: string) {
    const channel = createModelChannel({
        id: "writer-test",
        name: "Test",
        baseUrl: "https://example.com/v1",
        apiKey: "fake-test-key",
        apiFormat: protocol === "gemini" ? "gemini" : protocol === "claude-api" ? "claude" : "openai",
        interfaceType: protocol === "gemini" ? undefined : (protocol as "chat-completion"),
        models: ["test-model"],
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "writer-test::test-model", textModel: "writer-test::test-model", systemPrompt: "" } }).config;
}

describe("plain text protocol contract", () => {
    test("existing Claude callers still receive fragments", async () => {
        globalThis.fetch = (async () =>
            new Response(["猫", "咪"].map((text) => `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } })}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
        const updates: string[] = [];
        expect(await requestImageQuestion(configFor("claude-api"), [], (text) => updates.push(text))).toBe("猫咪");
        expect(updates).toEqual(["猫", "咪"]);
    });
    for (const [protocol, frames] of [
        ["chat-completion", [{ choices: [{ delta: { content: "猫" } }] }, { choices: [{ delta: { content: "咪" } }] }]],
        [
            "openai-response",
            [
                { type: "response.output_text.delta", delta: "猫" },
                { type: "response.output_text.delta", delta: "咪" },
            ],
        ],
        ["gemini", [{ candidates: [{ content: { parts: [{ text: "猫" }] } }] }, { candidates: [{ content: { parts: [{ text: "咪" }] } }] }]],
        [
            "claude-api",
            [
                { type: "content_block_delta", delta: { type: "text_delta", text: "猫" } },
                { type: "content_block_delta", delta: { type: "text_delta", text: "咪" } },
            ],
        ],
    ] as const) {
        test(`${protocol} returns cumulative text with no tools and no retries`, async () => {
            let calls = 0;
            globalThis.fetch = (async (_url, init) => {
                calls++;
                const body = JSON.parse(init!.body as string);
                expect(body.tools).toBeUndefined();
                expect(body.tool_choice).toBeUndefined();
                return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
            }) as typeof fetch;
            const updates: string[] = [];
            expect(await requestTextResponse(configFor(protocol), [{ role: "user", content: "猫" }], (text) => updates.push(text))).toBe("猫咪");
            expect(updates).toEqual(["猫", "猫咪"]);
            expect(calls).toBe(1);
        });
    }

    test("empty non-stream response and HTTP failure are not success", async () => {
        globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: "" } }] })) as typeof fetch;
        await expect(requestTextResponse(configFor("chat-completion"), [], () => {})).rejects.toThrow("没有返回正文");
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            return new Response("unavailable", { status: 503 });
        }) as typeof fetch;
        await expect(requestTextResponse(configFor("chat-completion"), [], () => {})).rejects.toThrow();
        expect(calls).toBe(1);
    });
});
