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
