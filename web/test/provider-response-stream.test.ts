import { describe, expect, spyOn, test } from "bun:test";
import { consumeJsonEvents } from "../src/lib/json-event-stream";
import {
    consumeChatCompletionStreamText,
    consumeGeminiStreamText,
    consumeResponseStreamText,
    parseGeminiImagePayload,
    parseGeminiToolResponse,
    parseToolResponse,
    readFetchError,
    readJsonPayload,
    responseErrorMessage,
} from "../src/services/api/image-response";
import { blobToDataUrl, delay } from "../src/services/api/video-response";
import type { ChatCompletionStreamState, GeminiStreamState, ResponseStreamState } from "../src/services/api/image-contracts";

const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\r\n\r\n`;

describe("provider response replacement contracts", () => {
    test("JSON event framing survives every chunk boundary, comments, multiple data lines and EOF", () => {
        const stream = ': heartbeat\r\nevent: message\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"last":true}';
        for (let split = 0; split <= stream.length; split++) {
            const state = { buffer: "" };
            const result: unknown[] = [];
            consumeJsonEvents(state, stream.slice(0, split), (value) => result.push(value));
            consumeJsonEvents(state, stream.slice(split), (value) => result.push(value), true);
            expect(result).toEqual([{ text: "你好" }, { last: true }]);
            expect(state.buffer).toBe("");
        }
    });

    test("invalid JSON fails without dropping the failed frame or its unprocessed tail", () => {
        const state = { buffer: "" };
        const result: unknown[] = [];
        const invalid = 'data: not-json\n\ndata: {"after":true}\n\n';
        expect(() => consumeJsonEvents(state, frame({ before: true }) + invalid, (value) => result.push(value))).toThrow();
        expect(result).toEqual([{ before: true }]);
        expect(state.buffer).toBe(invalid);
    });

    test("Responses delta, done and completion preserve separate channels for every split", () => {
        const payload = { output_text: "AB" };
        const stream = [
            { type: "response.output_text.delta", delta: "A" },
            { type: "response.reasoning_summary_text.delta", delta: "why" },
            { type: "response.output_text.delta", delta: "B" },
            { type: "response.output_text.done", text: "AB" },
            { type: "response.reasoning_summary_text.done", text: "why" },
            { type: "constructor.delta", delta: "ignore" },
            { type: "response.completed", response: payload },
        ]
            .map(frame)
            .join("");
        for (let split = 0; split <= stream.length; split++) {
            const state: ResponseStreamState = { buffer: "", text: "", reasoning: "" };
            const visible: string[] = [],
                reasoning: string[] = [];
            consumeResponseStreamText(
                state,
                stream.slice(0, split),
                (value) => visible.push(value),
                (value) => reasoning.push(value),
            );
            consumeResponseStreamText(
                state,
                stream.slice(split),
                (value) => visible.push(value),
                (value) => reasoning.push(value),
                true,
            );
            expect(visible).toEqual(["A", "AB"]);
            expect(reasoning).toEqual(["why"]);
            expect(state.payload).toEqual(payload);
            expect(state.buffer).toBe("");
        }
        const state: ResponseStreamState = { buffer: "", text: "", reasoning: "" };
        consumeResponseStreamText(state, frame({ type: "response.output_text.done", text: "complete" }) + frame({ type: "response.reasoning.done", text: "reason" }));
        expect(state).toMatchObject({ text: "complete", reasoning: "reason" });
        consumeResponseStreamText(state, frame({ type: "response.failed", response: { error: { message: "quota" } } }));
        expect(state.error).toBe("quota");
    });

    test("Chat Completions interleaves indexed tool fragments and reasoning aliases", () => {
        const stream = [
            {
                choices: [
                    {
                        delta: {
                            content: "OK",
                            reasoning: "r",
                            tool_calls: [
                                { index: 3, id: "three", function: { name: "search", arguments: '{"q":' } },
                                { index: 1, id: "one", function: { name: "read", arguments: '{"id":' } },
                            ],
                        },
                    },
                ],
            },
            {
                choices: [
                    {
                        delta: {
                            reasoning_text: "s",
                            tool_calls: [
                                { index: 1, function: { arguments: "1}" } },
                                { index: 3, function: { arguments: '"画布"}' } },
                            ],
                        },
                    },
                ],
            },
        ]
            .map(frame)
            .join("");
        for (let split = 0; split <= stream.length; split++) {
            const state: ChatCompletionStreamState = { buffer: "", text: "", reasoning: "", toolCalls: new Map() };
            consumeChatCompletionStreamText(state, stream.slice(0, split));
            consumeChatCompletionStreamText(state, stream.slice(split), undefined, undefined, true);
            expect(state.text).toBe("OK");
            expect(state.reasoning).toBe("rs");
            expect(state.toolCalls.get(1)).toEqual({ id: "one", name: "read", arguments: '{"id":1}' });
            expect(state.toolCalls.get(3)).toEqual({ id: "three", name: "search", arguments: '{"q":"画布"}' });
        }
    });

    test("Gemini preserves thought signatures and tool order without mixing thought text", () => {
        const payload = {
            candidates: [
                { content: { parts: [{ thought: true, text: "plan" }, { text: "answer" }, { functionCall: { id: "a", name: "read", args: { id: 1 } }, thought_signature: "sig-a" }] } },
                { content: { parts: [{ functionCall: { id: "b", name: "search" }, thoughtSignature: "sig-b" }] } },
            ],
        };
        const result = parseGeminiToolResponse(payload);
        expect(result).toEqual({
            content: "answer",
            reasoning: "plan",
            toolCalls: [
                { id: "a", type: "function", function: { name: "read", arguments: '{"id":1}' }, thoughtSignature: "sig-a" },
                { id: "b", type: "function", function: { name: "search", arguments: "{}" }, thoughtSignature: "sig-b" },
            ],
        });
        const stream = frame(payload);
        const state: GeminiStreamState = { buffer: "", text: "", reasoning: "", toolCalls: [] };
        for (const character of stream) consumeGeminiStreamText(state, character);
        expect(state).toMatchObject({ text: "answer", reasoning: "plan", toolCalls: result.toolCalls });
        expect(() => parseGeminiToolResponse({ promptFeedback: { blockReason: "BLOCKED" } })).toThrow("Gemini 拒绝了本次请求：BLOCKED");
    });

    test("image sources preserve MIME and source order; Responses chooses explicit output text", () => {
        expect(
            parseGeminiImagePayload({
                candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "AAA=" } }, { inline_data: { mime_type: "image/webp", data: "BBB=" } }, { fileData: { fileUri: "https://example.test/image" } }, { text: "ignored" }] } }],
            }).map((image) => image.dataUrl),
        ).toEqual(["data:image/jpeg;base64,AAA=", "data:image/webp;base64,BBB=", "https://example.test/image"]);
        expect(() => parseGeminiImagePayload({ candidates: [] })).toThrow("Gemini 接口没有返回图片");
        expect(
            parseToolResponse({
                output_text: "explicit",
                output: [
                    { type: "message", content: [{ text: "fallback" }] },
                    { type: "function_call", id: "item", call_id: "call", name: "read" },
                ],
            }),
        ).toEqual({
            content: "explicit",
            toolCalls: [{ id: "call", type: "function", function: { name: "read", arguments: "{}" } }],
        });
    });

    test("HTTP and JSON errors retain precedence and distinguish proxy HTML", async () => {
        expect(responseErrorMessage({ msg: "first", error: { message: "second" }, response: { error: { message: "third" } } })).toBe("first");
        expect(await readFetchError(new Response('{"error":{"message":"denied"}}', { status: 403 }), "失败")).toBe("denied");
        expect(await readFetchError(new Response("{}", { status: 429 }), "失败")).toBe("请求被限流或额度不足，请稍后重试");
        expect(await readFetchError(new Response("x".repeat(400), { status: 500 }), "失败")).toHaveLength(300);
        await expect(readJsonPayload(new Response("<!doctype html><html>"), "失败")).rejects.toThrow("后端代理返回了前端网页");
        await expect(readJsonPayload(new Response("not-json"), "失败")).rejects.toThrow("接口没有返回有效 JSON");
    });

    test("video polling removes abort listeners on completion and cancellation", async () => {
        const controller = new AbortController();
        const remove = spyOn(controller.signal, "removeEventListener");
        try {
            await delay(0, controller.signal);
            expect(remove).toHaveBeenCalledTimes(1);
            const pending = delay(60_000, controller.signal);
            controller.abort();
            await expect(pending).rejects.toMatchObject({ name: "AbortError" });
            expect(remove).toHaveBeenCalledTimes(2);
            await expect(delay(0, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            remove.mockRestore();
        }
    });

    test("video data URLs preserve raw bytes and MIME without FileReader", async () => {
        const data = Uint8Array.from({ length: 256 }, (_, i) => i);
        const url = await blobToDataUrl(new Blob([data], { type: "video/webm" }));
        expect(url.startsWith("data:video/webm;base64,")).toBe(true);
        expect(new Uint8Array(await (await fetch(url)).arrayBuffer())).toEqual(data);
    });
});
