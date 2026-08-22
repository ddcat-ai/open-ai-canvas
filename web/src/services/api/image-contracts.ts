export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | AiTextContentPart[];
};

export type AiTextContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file_url"; file_url: { url: string; name: string; mimeType: string } };

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage = AiTextMessage | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string } | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
    reasoning?: string;
};

export type ToolChoice = "auto" | "required" | { type: "function"; name: string };

export type BackendToolRequests = {
    responses: Record<string, unknown>;
    chatCompletion: Record<string, unknown>;
};

export type ResponseMessageContent = AiTextMessage["content"] | string;
export type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string } | { type: "input_file"; filename: string; file_data?: string; file_url?: string };
export type ResponseInputItem =
    { role: "system" | "user" | "assistant"; content: string | ResponseInputContent[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
export type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
export type ResponseApiOutputItem = { type?: "message"; content?: Array<{ type?: string; text?: string }> } | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
export type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
export type ResponseStreamState = { buffer: string; text: string; reasoning: string; payload?: ResponseApiPayload; error?: string };
export type ChatCompletionToolCall = { id?: string; type?: "function"; function?: { name?: string; arguments?: string } };
export type ChatCompletionPayload = {
    choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null; tool_calls?: ChatCompletionToolCall[] } }>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
export type ChatCompletionStreamToolCall = { id: string; name: string; arguments: string };
export type ChatCompletionStreamState = { buffer: string; text: string; reasoning: string; toolCalls: Map<number, ChatCompletionStreamToolCall>; error?: string };

export type ImageApiResponse = {
    data?: Array<Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
};

export type GeminiPart = {
    text?: string;
    thought?: boolean;
    inlineData?: { mimeType?: string; data?: string };
    inline_data?: { mime_type?: string; mimeType?: string; data?: string };
    fileData?: { mimeType?: string; fileUri?: string };
    functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
    functionResponse?: { id?: string; name?: string; response?: Record<string, unknown> };
    thoughtSignature?: string;
    thought_signature?: string;
};
export type GeminiContent = { role?: "user" | "model"; parts: GeminiPart[] };
export type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
    models?: Array<{ name?: string }>;
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
};
export type GeminiStreamState = { buffer: string; text: string; reasoning: string; toolCalls: ResponseToolCall[]; error?: string };

export type RequestOptions = { signal?: AbortSignal; promptCacheKey?: string; onReasoning?: (text: string) => void };
