import type { TextWire } from "@/lib/model-protocols";
import { isTextWire } from "@/lib/model-protocols";
import { toChatCompletionMessages, toChatCompletionToolChoice, toClaudeBody, toResponseInput, toResponseTool, withSystemMessage } from "@/services/api/image-protocols";
import { parseChatCompletionPayload, parseToolResponse, validateResponsePayload } from "@/services/api/image-response";
import type { ChatCompletionPayload, ResponseApiPayload, ResponseFunctionTool, ResponseInputMessage, ToolChoice, ToolResponseResult } from "@/services/api/image-contracts";
import type { AiConfig } from "@/stores/use-config-store";

/** The system catalog determines the wire; unknown formats cannot be guessed. */
export function prepareYingceTextRequest(config: AiConfig, textWire: string | undefined, messages: ResponseInputMessage[], tools: ResponseFunctionTool[] = [], toolChoice: ToolChoice = "auto") {
    if (!isTextWire(textWire)) throw new Error("该系统文本模型未声明受支持的请求格式，请选择其他模型");
    if (!config.model.trim()) throw new Error("请选择系统模型");
    if (textWire === "claude-api") {
        const choice = typeof toolChoice === "object" ? { type: "tool", name: toolChoice.name } : { type: toolChoice === "required" ? "any" : "auto" };
        return { providerPath: "/messages", body: { ...toClaudeBody(config, messages, tools), ...(tools.length ? { tool_choice: choice } : {}) }, textWire };
    }
    const input = withSystemMessage(config, messages);
    if (textWire === "chat-completion") return { providerPath: "/chat/completions", body: { model: config.model, messages: toChatCompletionMessages(input), stream: false, ...(tools.length ? { tools, tool_choice: toChatCompletionToolChoice(toolChoice) } : {}) }, textWire };
    return { providerPath: "/responses", body: { model: config.model, input: toResponseInput(input), stream: false, ...(tools.length ? { tools: tools.map(toResponseTool), tool_choice: toolChoice } : {}) }, textWire };
}

export function parseYingceTextResponse(textWire: TextWire, payload: unknown): ToolResponseResult {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("文本服务返回了无效响应");
    let result: ToolResponseResult;
    if (textWire === "chat-completion") {
        result = parseChatCompletionPayload(payload as ChatCompletionPayload);
    } else if (textWire === "responses") {
        validateResponsePayload(payload as ResponseApiPayload);
        result = parseToolResponse(payload as ResponseApiPayload);
    } else {
        const response = payload as Record<string, unknown>;
        if (response.error && typeof response.error === "object") {
            const message = (response.error as Record<string, unknown>).message;
            throw new Error(typeof message === "string" ? message : "Claude 请求失败");
        }
        const content = response.content;
        if (!Array.isArray(content)) throw new Error("Claude 接口没有返回内容");
        const text = content
            .filter((item) => item && typeof item === "object" && item.type === "text" && typeof item.text === "string")
            .map((item) => item.text)
            .join("");
        const toolCalls = content.flatMap((item) => {
            if (!item || typeof item !== "object" || item.type !== "tool_use" || typeof item.id !== "string" || typeof item.name !== "string") return [];
            return [{ id: item.id, type: "function" as const, function: { name: item.name, arguments: JSON.stringify(item.input ?? {}) } }];
        });
        result = { content: text, toolCalls };
    }
    if (!result.content && !result.toolCalls.length) throw new Error("文本服务没有返回内容");
    return result;
}
