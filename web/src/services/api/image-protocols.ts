import type { AiConfig } from "@/stores/use-config-store";
import type { BackendToolRequests, GeminiContent, GeminiPart, ResponseApiToolDefinition, ResponseFunctionTool, ResponseInputContent, ResponseInputItem, ResponseInputMessage, ResponseMessageContent, ToolChoice } from "@/services/api/image-contracts";

export function withSystemMessage<T extends ResponseInputMessage>(config: AiConfig, messages: T[]): ResponseInputMessage[] {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...messages] : messages;
}

export function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => {
        if (item.type === "text") return { type: "input_text" as const, text: item.text };
        if (item.type === "image_url") return { type: "input_image" as const, image_url: item.image_url.url };
        return item.file_url.url.startsWith("data:") ? { type: "input_file" as const, filename: item.file_url.name, file_data: item.file_url.url } : { type: "input_file" as const, filename: item.file_url.name, file_url: item.file_url.url };
    });
}

export function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

export function toClaudeBody(config: AiConfig, messages: ResponseInputMessage[], tools: ResponseFunctionTool[] = []) {
    const system = [config.systemPrompt.trim(), ...messages.flatMap((message) => !(("type" in message)) && message.role === "system" ? [String(message.content || "")] : [])].filter(Boolean).join("\n\n");
    const bodyMessages: Array<Record<string, unknown>> = [];
    for (const message of messages) {
        if ("type" in message) {
            bodyMessages.push({ role: "assistant", content: [{ type: "tool_use", id: message.call_id, name: message.name, input: jsonObject(message.arguments) }] });
        } else if (message.role === "system") {
            continue;
        } else if (message.role === "tool") {
            bodyMessages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }] });
        } else {
            bodyMessages.push({ role: message.role === "assistant" ? "assistant" : "user", content: toClaudeContent(message.content) });
        }
    }
    return {
        model: config.model,
        max_tokens: 4096,
        messages: bodyMessages,
        ...(system ? { system } : {}),
        ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters })) } : {}),
    };
}

function toClaudeContent(content: ResponseMessageContent): unknown {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => {
        if (item.type === "text") return { type: "text", text: item.text };
        const value = item.type === "image_url" ? item.image_url.url : item.file_url.url;
        const match = value.match(/^data:([^;,]+);base64,(.+)$/);
        if (match) return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
        return item.type === "image_url" ? { type: "image", source: { type: "url", url: value } } : { type: "text", text: `${item.file_url.name}: ${value}` };
    });
}

export function toChatCompletionMessages(messages: ResponseInputMessage[]) {
    const result: Array<Record<string, unknown>> = [];
    for (let index = 0; index < messages.length;) {
        const message = messages[index];
        if ("type" in message) {
            const toolCalls: Array<Record<string, unknown>> = [];
            while (index < messages.length && "type" in messages[index]) {
                const call = messages[index] as Extract<ResponseInputMessage, { type: "function_call" }>;
                toolCalls.push({ id: call.call_id, type: "function", function: { name: call.name, arguments: call.arguments } });
                index += 1;
            }
            result.push({ role: "assistant", content: null, tool_calls: toolCalls });
            continue;
        }
        if (message.role === "tool") result.push({ role: "tool", tool_call_id: message.tool_call_id, content: message.content });
        else result.push({ role: message.role, content: toChatCompletionContent(message.content) });
        index += 1;
    }
    return result;
}

function toChatCompletionContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return content;
    return content.map((item) => {
        if (item.type !== "file_url") return item;
        const file = item.file_url.url.startsWith("data:") ? { filename: item.file_url.name, file_data: item.file_url.url } : { filename: item.file_url.name, file_url: item.file_url.url };
        return { type: "file", file };
    });
}

export function toChatCompletionToolChoice(toolChoice: ToolChoice) {
    return typeof toolChoice === "object" ? { type: "function", function: { name: toolChoice.name } } : toolChoice;
}

export function buildBackendToolRequests(messages: ResponseInputMessage[], tools: ResponseFunctionTool[], toolChoice: ToolChoice): BackendToolRequests {
    return {
        responses: {
            input: toResponseInput(messages),
            tools: tools.map(toResponseTool),
            tool_choice: toolChoice,
            parallel_tool_calls: false,
        },
        chatCompletion: {
            messages: toChatCompletionMessages(messages),
            tools,
            tool_choice: toChatCompletionToolChoice(toolChoice),
            parallel_tool_calls: false,
        },
    };
}

export function toGeminiBody(config: AiConfig, messages: ResponseInputMessage[], extra?: Record<string, unknown>) {
    const systemText = [config.systemPrompt.trim(), ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [geminiTextContent(message.content)] : []))].filter(Boolean).join("\n\n");
    const contents = toGeminiContents(messages.filter((message) => ("type" in message ? true : message.role !== "system")));
    return {
        contents,
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        ...extra,
    };
}

function toGeminiContents(messages: ResponseInputMessage[]): GeminiContent[] {
    const callNameById = new Map<string, string>();
    return messages.flatMap((message): GeminiContent[] => {
        if ("type" in message) {
            callNameById.set(message.call_id, message.name);
            return [{ role: "model", parts: [{ functionCall: { id: message.call_id, name: message.name, args: jsonObject(message.arguments) }, ...(message.thoughtSignature ? { thoughtSignature: message.thoughtSignature } : {}) }] }];
        }
        if (message.role === "tool") {
            const name = callNameById.get(message.tool_call_id) || "tool_result";
            return [{ role: "user", parts: [{ functionResponse: { id: message.tool_call_id, name, response: { result: jsonValue(message.content) } } }] }];
        }
        return [{ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }];
    });
}

function toGeminiParts(content: ResponseMessageContent): GeminiPart[] {
    if (!Array.isArray(content)) return [{ text: String(content || "") }];
    return content.map((item) => {
        if (item.type === "text") return { text: item.text };
        if (item.type === "image_url") return toGeminiFilePart(item.image_url.url, "image/png");
        return toGeminiFilePart(item.file_url.url, item.file_url.mimeType);
    });
}

function toGeminiFilePart(url: string, mimeType: string): GeminiPart {
    const match = url.match(/^data:([^;,]+);base64,(.+)$/);
    if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
    return { fileData: { fileUri: url, mimeType } };
}

function geminiTextContent(content: ResponseMessageContent) {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? item.text : item.type === "image_url" ? item.image_url.url : `${item.file_url.name}: ${item.file_url.url}`)).join("\n");
}

function jsonObject(value: string): Record<string, unknown> {
    const parsed = jsonValue(value);
    return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function jsonValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

export function toGeminiToolOptions(tools: ResponseFunctionTool[], toolChoice: ToolChoice) {
    if (!tools.length) return {};
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
    }));
    const functionCallingConfig = typeof toolChoice === "object" ? { mode: "ANY", allowedFunctionNames: [toolChoice.name] } : { mode: toolChoice === "required" ? "ANY" : "AUTO" };
    return {
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig },
    };
}
