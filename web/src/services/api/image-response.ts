import { t } from "@/i18n";
import axios from "axios";
import { nanoid } from "nanoid";

import type {
    ChatCompletionPayload,
    ChatCompletionStreamState,
    GeminiPart,
    GeminiPayload,
    GeminiStreamState,
    ImageApiResponse,
    ResponseApiOutputItem,
    ResponseApiPayload,
    ResponseStreamState,
    ResponseToolCall,
    ToolResponseResult,
} from "@/services/api/image-contracts";

function resolveImageDataUrl(item: Record<string, unknown>) {
    if (typeof item.b64_json === "string" && item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (typeof item.url === "string" && item.url) return item.url;
    return null;
}

export function parseImagePayload(payload: ImageApiResponse) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || t("domain:request-failed"));
    const images =
        payload.data
            ?.map(resolveImageDataUrl)
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (images.length === 0) throw new Error(t("domain:the-api-returned-no-image"));
    return images;
}

export function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return t("domain:request-cancelled-3");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || readStatusError(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return t("domain:request-cancelled-3");
    return error instanceof Error ? error.message : fallback;
}

export function readStatusError(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return t("domain:authentication-failed-check-your-api-key-plan-permissions-or-model-acces");
    if (status === 429) return t("domain:rate-limited-or-out-of-quota-try-again-later");
    return status ? `${fallback}：${status}` : fallback;
}

export function parseChatCompletionPayload(payload: ChatCompletionPayload): ToolResponseResult {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || t("domain:request-failed"));
    if (payload.error?.message) throw new Error(payload.error.message);
    const message = payload.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls || [])
        .map((call) => ({
            id: call.id || "",
            type: "function" as const,
            function: { name: call.function?.name || "", arguments: call.function?.arguments || "{}" },
        }))
        .filter((call) => call.id && call.function.name);
    return { content: message?.content || "", toolCalls, ...(message?.reasoning_content ? { reasoning: message.reasoning_content } : {}) };
}

export function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

export function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

export function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || t("domain:request-failed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

export function validateGeminiPayload(payload: GeminiPayload) {
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.promptFeedback?.blockReason) throw new Error(t("domain:gemini-rejected-this-request-param", { blockReason: payload.promptFeedback.blockReason }));
}

export async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return readStatusError(response.status, fallback);
    try {
        return responseErrorMessage(JSON.parse(text)) || readStatusError(response.status, fallback);
    } catch {
        return text.slice(0, 300) || readStatusError(response.status, fallback);
    }
}

export async function readJsonPayload<T>(response: Response, fallback: string): Promise<T> {
    const text = await response.text();
    try {
        return JSON.parse(text) as T;
    } catch {
        if (/^\s*(?:<!doctype|<html)/i.test(text)) throw new Error(t("domain:the-backend-proxy-returned-the-frontend-page-check-vite-canvas-backend-u"));
        throw new Error(t("domain:param-the-api-returned-no-valid-json", { fallback: fallback }));
    }
}

function parseEventBlock(block: string) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    return data && data !== "[DONE]" ? data : undefined;
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void, onReasoning?: (text: string) => void) {
    const data = parseEventBlock(block);
    if (!data) return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (["response.reasoning.delta", "response.reasoning_text.delta", "response.reasoning_summary_text.delta"].includes(type) && typeof event.delta === "string") {
        state.reasoning += event.delta;
        onReasoning?.(state.reasoning);
    }
    if (["response.reasoning.done", "response.reasoning_text.done", "response.reasoning_summary_text.done"].includes(type) && !state.reasoning && typeof event.text === "string") {
        state.reasoning = event.text;
        onReasoning?.(state.reasoning);
    }
    if (type === "response.completed" && isRecord(event.response)) state.payload = event.response as ResponseApiPayload;
    else if (Array.isArray(event.output)) state.payload = event as ResponseApiPayload;
}

export function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, onReasoning?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta, onReasoning);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta, onReasoning);
        state.buffer = "";
    }
}

function consumeChatCompletionStreamBlock(block: string, state: ChatCompletionStreamState, onDelta?: (text: string) => void, onReasoning?: (text: string) => void) {
    const data = parseEventBlock(block);
    if (!data) return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : undefined;
    const delta = choice && isRecord(choice.delta) ? choice.delta : undefined;
    if (!delta) return;
    if (typeof delta.content === "string") {
        state.text += delta.content;
        onDelta?.(state.text);
    }
    const reasoningDelta = stringValue(delta.reasoning_content) || stringValue(delta.reasoning) || stringValue(delta.reasoning_text);
    if (reasoningDelta) {
        state.reasoning += reasoningDelta;
        onReasoning?.(state.reasoning);
    }
    const chunks = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    chunks.forEach((value, fallbackIndex) => {
        if (!isRecord(value)) return;
        const callIndex = typeof value.index === "number" ? value.index : fallbackIndex;
        const current = state.toolCalls.get(callIndex) || { id: "", name: "", arguments: "" };
        const fn = isRecord(value.function) ? value.function : undefined;
        state.toolCalls.set(callIndex, {
            id: stringValue(value.id) || current.id,
            name: stringValue(fn?.name) || current.name,
            arguments: current.arguments + stringValue(fn?.arguments),
        });
    });
}

export function consumeChatCompletionStreamText(state: ChatCompletionStreamState, text: string, onDelta?: (text: string) => void, onReasoning?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeChatCompletionStreamBlock(state.buffer.slice(0, index), state, onDelta, onReasoning);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeChatCompletionStreamBlock(state.buffer, state, onDelta, onReasoning);
        state.buffer = "";
    }
}

function consumeGeminiStreamBlock(block: string, state: GeminiStreamState, onDelta?: (text: string) => void, onReasoning?: (text: string) => void) {
    const data = parseEventBlock(block);
    if (!data) return;
    const result = parseGeminiToolResponse(JSON.parse(data) as GeminiPayload);
    if (result.reasoning) {
        state.reasoning += result.reasoning;
        onReasoning?.(state.reasoning);
    }
    if (result.content) {
        state.text += result.content;
        onDelta?.(state.text);
    }
    state.toolCalls.push(...result.toolCalls);
}

export function consumeGeminiStreamText(state: GeminiStreamState, text: string, onDelta?: (text: string) => void, onReasoning?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeGeminiStreamBlock(state.buffer.slice(0, index), state, onDelta, onReasoning);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeGeminiStreamBlock(state.buffer, state, onDelta, onReasoning);
        state.buffer = "";
    }
}

export function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const parts = payload.candidates?.flatMap((candidate) => candidate.content?.parts || []) || [];
    const content = parts
        .filter((part) => !part.thought)
        .map((part) => part.text || "")
        .join("");
    const reasoning = parts
        .filter((part) => part.thought)
        .map((part) => part.text || "")
        .join("");
    const toolCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is NonNullable<GeminiPart["functionCall"]> => Boolean(call?.name))
        .map((call) => {
            const part = parts.find((item) => item.functionCall === call);
            const thoughtSignature = part?.thoughtSignature || part?.thought_signature;
            return {
                id: call.id || nanoid(),
                type: "function" as const,
                function: { name: call.name || "", arguments: JSON.stringify(call.args || {}) },
                ...(thoughtSignature ? { thoughtSignature } : {}),
            };
        });
    return { content, toolCalls, ...(reasoning ? { reasoning } : {}) };
}

export function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    const images =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => {
                const inlineData = part.inlineData || (part.inline_data ? { mimeType: part.inline_data.mimeType || part.inline_data.mime_type, data: part.inline_data.data } : undefined);
                if (inlineData?.data) return `data:${inlineData.mimeType || "image/png"};base64,${inlineData.data}`;
                return part.fileData?.fileUri || null;
            })
            .filter((value): value is string => Boolean(value))
            .map((dataUrl) => ({ id: nanoid(), dataUrl })) || [];
    if (!images.length) throw new Error(t("domain:the-gemini-api-returned-no-image"));
    return images;
}
