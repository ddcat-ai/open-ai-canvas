import { channelRequest } from "@/services/api/custom-channel-relay";
import type { ChatCompletionPayload, ChatCompletionStreamState, GeminiPayload, GeminiStreamState, RequestOptions, ResponseApiPayload, ResponseStreamState, ToolResponseResult } from "@/services/api/image-contracts";
import type { AiConfig } from "@/stores/use-config-store";
import {
    consumeChatCompletionStreamText,
    consumeGeminiStreamText,
    consumeResponseStreamText,
    parseChatCompletionPayload,
    parseGeminiToolResponse,
    parseToolResponse,
    readFetchError,
    readJsonPayload,
    validateResponsePayload,
} from "@/services/api/image-response";
import { aiApiUrl, aiHeaders, geminiApiUrl, geminiHeaders } from "@/services/api/image-transport";

export async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const request = channelRequest(config, aiApiUrl(config, "/responses"), { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" });
    const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
        credentials: request.credentials,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as ResponseApiPayload;
        validateResponsePayload(payload);
        return parseToolResponse(payload);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "", reasoning: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta, options?.onReasoning);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, options?.onReasoning, true);
    if (state.error) throw new Error(state.error);
    if (!state.payload) return { content: state.text, toolCalls: [], ...(state.reasoning ? { reasoning: state.reasoning } : {}) };
    validateResponsePayload(state.payload);
    const result = parseToolResponse(state.payload);
    return { ...result, content: state.text || result.content, ...(state.reasoning ? { reasoning: state.reasoning } : {}) };
}

export async function requestStreamingChatCompletion(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const request = channelRequest(config, aiApiUrl(config, "/chat/completions"), { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" });
    const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
        credentials: request.credentials,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    const contentType = response.headers.get("content-type") || "";
    if (!response.body || !contentType.includes("text/event-stream")) {
        const result = parseChatCompletionPayload(await readJsonPayload<ChatCompletionPayload>(response, "请求失败"));
        if (result.reasoning) options?.onReasoning?.(result.reasoning);
        return result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ChatCompletionStreamState = { buffer: "", text: "", reasoning: "", toolCalls: new Map() };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChatCompletionStreamText(state, decoder.decode(value, { stream: true }), onDelta, options?.onReasoning);
        if (state.error) throw new Error(state.error);
    }
    consumeChatCompletionStreamText(state, decoder.decode(), onDelta, options?.onReasoning, true);
    if (state.error) throw new Error(state.error);
    const toolCalls = Array.from(state.toolCalls.entries())
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({ id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments || "{}" } }))
        .filter((call) => call.id && call.function.name);
    return { content: state.text, toolCalls, ...(state.reasoning ? { reasoning: state.reasoning } : {}) };
}

export async function requestStreamingClaude(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const request = channelRequest(config, aiApiUrl(config, "/messages"), { ...aiHeaders(config, "application/json"), Accept: "text/event-stream" });
    const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
        credentials: request.credentials,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "Claude 请求失败"));
    if (!response.body || !(response.headers.get("content-type") || "").includes("text/event-stream")) {
        const payload = (await readJsonPayload<Record<string, unknown>>(response, "Claude 请求失败")) as Record<string, unknown>;
        return parseClaudeResult(payload);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let blockIndex = -1;
    const consume = (chunk: string, final = false) => {
        buffer += chunk;
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = final ? "" : frames.pop() || "";
        for (const frame of frames) {
            const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "";
            const raw = frame.match(/^data:\s*(.+)$/m)?.[1]?.trim() || "";
            if (!raw || raw === "[DONE]") continue;
            let payload: Record<string, unknown>;
            try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("Claude 流式响应格式无效"); }
            if (event === "error" || payload.type === "error") throw new Error(String((payload.error as Record<string, unknown> | undefined)?.message || "Claude 上游返回失败"));
            if (payload.type === "content_block_start") {
                const contentBlock = payload.content_block as Record<string, unknown> | undefined;
                if (contentBlock?.type === "tool_use") {
                    blockIndex = Number(payload.index ?? toolCalls.size);
                    toolCalls.set(blockIndex, { id: String(contentBlock.id || ""), name: String(contentBlock.name || ""), arguments: "" });
                }
            } else if (payload.type === "content_block_delta") {
                const delta = payload.delta as Record<string, unknown> | undefined;
                if (delta?.type === "text_delta" && typeof delta.text === "string") { text += delta.text; onDelta?.(delta.text); }
                if (delta?.type === "input_json_delta" && blockIndex >= 0) toolCalls.get(blockIndex)!.arguments += String(delta.partial_json || "");
            }
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode(), true);
    return { content: text, toolCalls: Array.from(toolCalls.values()).filter((call) => call.id && call.name).map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })) };
}

function parseClaudeResult(payload: Record<string, unknown>): ToolResponseResult {
    const content = Array.isArray(payload.content) ? payload.content : [];
    let text = "";
    const toolCalls: ToolResponseResult["toolCalls"] = [];
    for (const item of content) {
        const block = item as Record<string, unknown>;
        if (block.type === "text") text += String(block.text || "");
        if (block.type === "tool_use") toolCalls.push({ id: String(block.id || ""), type: "function", function: { name: String(block.name || ""), arguments: JSON.stringify(block.input || {}) } });
    }
    if (!text && !toolCalls.length) throw new Error("Claude 接口没有返回内容");
    return { content: text, toolCalls };
}

export async function requestGeminiStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: RequestOptions): Promise<ToolResponseResult> {
    const request = channelRequest(config, `${geminiApiUrl(config, "streamGenerateContent")}?alt=sse`, geminiHeaders(config));
    const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(body),
        signal: options?.signal,
        credentials: request.credentials,
    });
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) {
        const payload = (await response.json()) as GeminiPayload;
        const result = parseGeminiToolResponse(payload);
        if (result.reasoning) options?.onReasoning?.(result.reasoning);
        return result;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: GeminiStreamState = { buffer: "", text: "", reasoning: "", toolCalls: [] };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeGeminiStreamText(state, decoder.decode(value, { stream: true }), onDelta, options?.onReasoning);
        if (state.error) throw new Error(state.error);
    }
    consumeGeminiStreamText(state, decoder.decode(), onDelta, options?.onReasoning, true);
    if (state.error) throw new Error(state.error);
    return { content: state.text, toolCalls: state.toolCalls, ...(state.reasoning ? { reasoning: state.reasoning } : {}) };
}
