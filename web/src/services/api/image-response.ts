import axios from "axios";
import { nanoid } from "nanoid";
import { consumeJsonEvents } from "@/lib/json-event-stream";
import type { ChatCompletionPayload, ChatCompletionStreamState, GeminiPart, GeminiPayload, GeminiStreamState, ImageApiResponse, ResponseApiPayload, ResponseStreamState, ResponseToolCall, ToolResponseResult } from "@/services/api/image-contracts";

type TextSink = (text: string) => void;
type TextState = { text: string; reasoning: string };

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function assertEnvelope(payload: { code?: number; msg?: string }) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
}

function imagesFrom(sources: Iterable<string | undefined | null>, emptyMessage: string) {
    const images: { id: string; dataUrl: string }[] = [];
    for (const dataUrl of sources) if (dataUrl) images.push({ id: nanoid(), dataUrl });
    if (!images.length) throw new Error(emptyMessage);
    return images;
}

function addTool(result: ToolResponseResult, id: string | undefined, name: string | undefined, args: string | undefined, signature?: string) {
    if (!id || !name) return;
    const call: ResponseToolCall = { type: "function", id, function: { name, arguments: args || "{}" } };
    if (signature) call.thoughtSignature = signature;
    result.toolCalls.push(call);
}

function* geminiParts(payload: GeminiPayload): Generator<GeminiPart> {
    for (const candidate of payload.candidates ?? []) yield* candidate.content?.parts ?? [];
}

export function parseImagePayload(payload: ImageApiResponse) {
    assertEnvelope(payload);
    function* sources() {
        for (const item of payload.data ?? []) {
            const encoded = text(item.b64_json);
            yield encoded ? `data:image/png;base64,${encoded}` : text(item.url);
        }
    }
    return imagesFrom(sources(), "接口没有返回图片");
}

export function parseChatCompletionPayload(payload: ChatCompletionPayload): ToolResponseResult {
    validateResponsePayload(payload);
    const message = payload.choices?.[0]?.message;
    const result: ToolResponseResult = { content: message?.content || "", toolCalls: [] };
    if (message?.reasoning_content) result.reasoning = message.reasoning_content;
    for (const call of message?.tool_calls ?? []) addTool(result, call.id, call.function?.name, call.function?.arguments);
    return result;
}

export function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const result: ToolResponseResult = { content: "", toolCalls: [] };
    for (const item of payload.output ?? []) {
        switch (item.type) {
            case "message":
                for (const part of item.content ?? []) result.content += part.text || "";
                break;
            case "function_call":
                addTool(result, item.call_id || item.id, item.name, item.arguments);
                break;
        }
    }
    if (payload.output_text) result.content = payload.output_text;
    return result;
}

export function parseGeminiToolResponse(payload: GeminiPayload): ToolResponseResult {
    validateGeminiPayload(payload);
    const result: ToolResponseResult = { content: "", toolCalls: [] };
    let reasoning = "";
    for (const part of geminiParts(payload)) {
        if (part.thought) reasoning += part.text || "";
        else result.content += part.text || "";
        const call = part.functionCall;
        if (call?.name) addTool(result, call.id || nanoid(), call.name, JSON.stringify(call.args || {}), part.thoughtSignature || part.thought_signature);
    }
    if (reasoning) result.reasoning = reasoning;
    return result;
}

export function parseGeminiImagePayload(payload: GeminiPayload) {
    validateGeminiPayload(payload);
    function* sources() {
        for (const part of geminiParts(payload)) {
            const inline = part.inlineData ?? part.inline_data;
            const mime = part.inlineData ? part.inlineData.mimeType : part.inline_data?.mimeType || part.inline_data?.mime_type;
            yield inline?.data ? `data:${mime || "image/png"};base64,${inline.data}` : part.fileData?.fileUri;
        }
    }
    return imagesFrom(sources(), "Gemini 接口没有返回图片");
}

export function responseErrorMessage(value: unknown) {
    const payload = record(value);
    return text(payload.msg) || text(record(payload.error).message) || text(record(record(payload.response).error).message);
}

export function validateResponsePayload(payload: ResponseApiPayload) {
    assertEnvelope(payload);
    if (payload.error?.message) throw new Error(payload.error.message);
}

export function validateGeminiPayload(payload: GeminiPayload) {
    const failure = payload.error?.message || (payload.promptFeedback?.blockReason ? `Gemini 拒绝了本次请求：${payload.promptFeedback.blockReason}` : "");
    if (failure) throw new Error(failure);
}

export function readStatusError(status: number | undefined, fallback: string) {
    const known: Record<number, string> = {
        401: "鉴权失败，请检查 API Key、套餐权限或模型权限",
        403: "鉴权失败，请检查 API Key、套餐权限或模型权限",
        429: "请求被限流或额度不足，请稍后重试",
    };
    return status ? known[status] || `${fallback}：${status}` : fallback;
}

export function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError")) return "请求已取消";
    if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
    const payload = record(error.response?.data);
    return text(payload.msg) || text(record(payload.error).message) || readStatusError(error.response?.status, fallback);
}

export async function readFetchError(response: Response, fallback: string) {
    const body = await response.text();
    const status = readStatusError(response.status, fallback);
    if (!body) return status;
    let payload: unknown;
    try {
        payload = JSON.parse(body);
    } catch {
        return body.slice(0, 300) || status;
    }
    return responseErrorMessage(payload) || status;
}

export async function readJsonPayload<T>(response: Response, fallback: string): Promise<T> {
    const body = await response.text();
    try {
        return JSON.parse(body) as T;
    } catch {
        const detail = /^\s*(?:<!doctype|<html)/i.test(body) ? "后端代理返回了前端网页，请检查 VITE_CANVAS_BACKEND_URL 和反向代理配置" : `${fallback}：接口没有返回有效 JSON`;
        throw new Error(detail);
    }
}

function updateText(state: TextState, field: keyof TextState, value: unknown, sink: TextSink | undefined, final = false) {
    if (typeof value !== "string" || (final && state[field])) return;
    state[field] = final ? value : state[field] + value;
    sink?.(state[field]);
}

const responseChannels: Record<string, keyof TextState> = {
    "response.output_text": "text",
    "response.reasoning": "reasoning",
    "response.reasoning_text": "reasoning",
    "response.reasoning_summary_text": "reasoning",
};

export function consumeResponseStreamText(state: ResponseStreamState, chunk: string, onDelta?: TextSink, onReasoning?: TextSink, flush = false) {
    consumeJsonEvents(
        state,
        chunk,
        (payload) => {
            const event = record(payload);
            const failure = responseErrorMessage(event);
            if (failure) state.error = failure;
            const type = text(event.type);
            const separator = type.lastIndexOf(".");
            const field = Object.hasOwn(responseChannels, type.slice(0, separator)) ? responseChannels[type.slice(0, separator)] : undefined;
            const action = type.slice(separator + 1);
            if (field && (action === "delta" || action === "done")) {
                updateText(state, field, action === "done" ? event.text : event.delta, field === "text" ? onDelta : onReasoning, action === "done");
            }
            if (type === "response.completed" && event.response !== null && typeof event.response === "object" && !Array.isArray(event.response)) {
                state.payload = event.response as ResponseApiPayload;
            } else if (Array.isArray(event.output)) state.payload = event as ResponseApiPayload;
        },
        flush,
    );
}

export function consumeChatCompletionStreamText(state: ChatCompletionStreamState, chunk: string, onDelta?: TextSink, onReasoning?: TextSink, flush = false) {
    consumeJsonEvents(
        state,
        chunk,
        (payload) => {
            const event = record(payload);
            const failure = responseErrorMessage(event);
            if (failure) state.error = failure;
            const first = Array.isArray(event.choices) ? record(event.choices[0]) : {};
            const delta = record(first.delta);
            updateText(state, "text", delta.content, onDelta);
            const reasoning = text(delta.reasoning_content) || text(delta.reasoning) || text(delta.reasoning_text);
            if (reasoning) updateText(state, "reasoning", reasoning, onReasoning);
            if (!Array.isArray(delta.tool_calls)) return;
            for (const [fallback, raw] of delta.tool_calls.entries()) {
                if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
                const call = record(raw);
                const index = typeof call.index === "number" ? call.index : fallback;
                const previous = state.toolCalls.get(index);
                const fn = record(call.function);
                state.toolCalls.set(index, {
                    id: text(call.id) || previous?.id || "",
                    name: text(fn.name) || previous?.name || "",
                    arguments: (previous?.arguments || "") + text(fn.arguments),
                });
            }
        },
        flush,
    );
}

export function consumeGeminiStreamText(state: GeminiStreamState, chunk: string, onDelta?: TextSink, onReasoning?: TextSink, flush = false) {
    consumeJsonEvents(
        state,
        chunk,
        (payload) => {
            const result = parseGeminiToolResponse(payload as GeminiPayload);
            if (result.reasoning) updateText(state, "reasoning", result.reasoning, onReasoning);
            if (result.content) updateText(state, "text", result.content, onDelta);
            state.toolCalls.push(...result.toolCalls);
        },
        flush,
    );
}
