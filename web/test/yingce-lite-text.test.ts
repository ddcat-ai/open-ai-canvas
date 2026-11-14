import { describe, expect, test } from "bun:test";
import { prepareYingceTextRequest, parseYingceTextResponse } from "../src/services/api/yingce-lite-text";
import { defaultConfig } from "../src/stores/use-config-store";
import { yingceTextMessagesWithImages } from "../src/services/api/yingce-lite-generation";

const config = { ...defaultConfig, model: "model-key", systemPrompt: "system" };
const messages = [{ role: "user" as const, content: "hello" }];

describe("Lite system text protocol", () => {
    test("serializes each catalog wire with its own path and model key", () => {
        const chat = prepareYingceTextRequest(config, "chat-completion", messages);
        expect(chat).toMatchObject({ providerPath: "/chat/completions", body: { model: "model-key", messages: [{ role: "system", content: "system" }, ...messages], stream: false } });
        const responses = prepareYingceTextRequest(config, "responses", messages);
        expect(responses).toMatchObject({ providerPath: "/responses", body: { model: "model-key", input: [{ role: "system", content: "system" }, ...messages], stream: false } });
        const claude = prepareYingceTextRequest(config, "claude-api", messages);
        expect(claude).toMatchObject({ providerPath: "/messages", body: { model: "model-key", system: "system", messages } });
        expect(() => prepareYingceTextRequest(config, "unknown", messages)).toThrow();
    });

    test("parses each wire and rejects empty or failed responses", () => {
        expect(parseYingceTextResponse("chat-completion", { choices: [{ message: { content: "chat" } }] }).content).toBe("chat");
        expect(parseYingceTextResponse("responses", { output_text: "response" }).content).toBe("response");
        expect(parseYingceTextResponse("claude-api", { content: [{ type: "text", text: "claude" }] }).content).toBe("claude");
        expect(() => parseYingceTextResponse("responses", { error: { message: "failed" } })).toThrow("failed");
        expect(() => parseYingceTextResponse("chat-completion", {})).toThrow();
    });

    test("uses each wire's tool format and preserves Claude tool calls", () => {
        const tools = [{ type: "function" as const, function: { name: "lookup", parameters: { type: "object", properties: {} } } }];
        const choice = { type: "function" as const, name: "lookup" };
        expect(prepareYingceTextRequest(config, "chat-completion", messages, tools, choice).body).toMatchObject({ tool_choice: { type: "function", function: { name: "lookup" } } });
        expect(prepareYingceTextRequest(config, "responses", messages, tools, choice).body).toMatchObject({ tools: [{ type: "function", name: "lookup" }], tool_choice: choice });
        expect(prepareYingceTextRequest(config, "claude-api", messages, tools, choice).body).toMatchObject({ tools: [{ name: "lookup" }], tool_choice: { type: "tool", name: "lookup" } });
        expect(parseYingceTextResponse("claude-api", { content: [{ type: "tool_use", id: "call-1", name: "lookup", input: { key: "value" } }] })).toEqual({
            content: "",
            toolCalls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: '{"key":"value"}' } }],
        });
    });

    test("serializes local image data using the advertised wire", async () => {
        const image = { id: "image", name: "reference", type: "image/png", dataUrl: "", storageKey: "resource:local" };
        const { messages: multimodal } = await yingceTextMessagesWithImages("describe", [], [image], { scope: () => "alice", convert: async () => "data:image/png;base64,AQID" });
        const chat = prepareYingceTextRequest(config, "chat-completion", multimodal);
        expect(chat.body).toMatchObject({
            messages: [
                { role: "system" },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "describe" },
                        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
                    ],
                },
            ],
        });
        expect(prepareYingceTextRequest(config, "responses", multimodal).body).toMatchObject({ input: [{ role: "system" }, { content: [{ type: "input_text" }, { type: "input_image", image_url: "data:image/png;base64,AQID" }] }] });
        expect(prepareYingceTextRequest(config, "claude-api", multimodal).body).toMatchObject({ messages: [{ content: [{ type: "text" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }] }] });
        expect(JSON.stringify(chat.body)).not.toContain("resource:local");
    });

    test("rejects unreadable images and account switches before dispatch", async () => {
        const image = { id: "image", name: "reference", type: "image/png", dataUrl: "" };
        await expect(yingceTextMessagesWithImages("x", [], [image], { scope: () => "alice", convert: async () => "/local/path" })).rejects.toThrow("参考图片无法读取");
        let scope = "alice";
        await expect(
            yingceTextMessagesWithImages("x", [], [image], {
                scope: () => scope,
                convert: async () => {
                    scope = "bob";
                    return "data:image/png;base64,AQID";
                },
            }),
        ).rejects.toThrow("账号已切换");
    });
});
