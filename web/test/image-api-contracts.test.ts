import { describe, expect, test } from "bun:test";

import { consumeChatCompletionStreamText, consumeGeminiStreamText, consumeResponseStreamText, parseChatCompletionPayload, parseGeminiToolResponse, parseImagePayload, parseToolResponse } from "../src/services/api/image-response";
import { normalizeQuality, resolveRequestSize, validateImageSize } from "../src/services/api/image-validation";

describe("image api contracts", () => {
    test("规范化质量和尺寸，拒绝超出边界的图像", () => {
        expect(normalizeQuality("1k")).toBe("low");
        expect(normalizeQuality("2k")).toBe("medium");
        expect(normalizeQuality("4k")).toBe("high");
        expect(resolveRequestSize("medium", "16:9")).toMatch(/^\d+x\d+$/);
        expect(resolveRequestSize("medium", "9:16")).toMatch(/^\d+x\d+$/);
        expect(() => validateImageSize(1025, 1024)).toThrow("16 的倍数");
        expect(() => validateImageSize(3072, 1008)).toThrow("宽高比");
        expect(() => validateImageSize(3840, 2176)).toThrow("总像素");
    });

    test("解包 b64_json、url 和业务错误", () => {
        expect(parseImagePayload({ data: [{ b64_json: "abc" }, { url: "https://example.com/image.png" }] })).toEqual([
            { id: expect.any(String), dataUrl: "data:image/png;base64,abc" },
            { id: expect.any(String), dataUrl: "https://example.com/image.png" },
        ]);
        expect(() => parseImagePayload({ data: [] })).toThrow("接口没有返回图片");
        expect(() => parseImagePayload({ code: 1001, msg: "额度不足" })).toThrow("额度不足");
    });

    test("统一解析 Responses、Chat Completions 和 Gemini 工具调用", () => {
        expect(
            parseToolResponse({
                output: [{ type: "function_call", call_id: "call-1", name: "search", arguments: '{"q":"canvas"}' }],
            }),
        ).toMatchObject({ toolCalls: [{ id: "call-1", function: { name: "search", arguments: '{"q":"canvas"}' } }] });
        expect(
            parseChatCompletionPayload({
                choices: [{ message: { content: "done", tool_calls: [{ id: "call-2", function: { name: "search", arguments: "{}" } }] } }],
            }),
        ).toMatchObject({ content: "done", toolCalls: [{ id: "call-2", function: { name: "search" } }] });
        expect(
            parseGeminiToolResponse({
                candidates: [
                    {
                        content: {
                            parts: [
                                { text: "thinking", thought: true },
                                { functionCall: { id: "call-3", name: "search", args: { q: "canvas" } }, thoughtSignature: "sig" },
                            ],
                        },
                    },
                ],
            }),
        ).toMatchObject({ reasoning: "thinking", toolCalls: [{ id: "call-3", thoughtSignature: "sig", function: { name: "search", arguments: '{"q":"canvas"}' } }] });
    });

    test("SSE 增量解析保留正文、reasoning 和工具调用", () => {
        const responseState = { buffer: "", text: "", reasoning: "" };
        consumeResponseStreamText(responseState, 'data: {"type":"response.output_text.delta","delta":"hel"}\n\n');
        consumeResponseStreamText(responseState, 'data: {"type":"response.reasoning.delta","delta":"why"}\n\n');
        consumeResponseStreamText(responseState, 'data: {"type":"response.output_text.delta","delta":"lo"}', undefined, undefined, true);
        expect(responseState).toMatchObject({ text: "hello", reasoning: "why", buffer: "" });

        const chatState = { buffer: "", text: "", reasoning: "", toolCalls: new Map() };
        consumeChatCompletionStreamText(chatState, 'data: {"choices":[{"delta":{"content":"ok","reasoning_content":"r"}}]}\n\n');
        expect(chatState).toMatchObject({ text: "ok", reasoning: "r" });

        const geminiState = { buffer: "", text: "", reasoning: "", toolCalls: [] };
        consumeGeminiStreamText(geminiState, 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n');
        expect(geminiState).toMatchObject({ text: "hi" });
    });
});
