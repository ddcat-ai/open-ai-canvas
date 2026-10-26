import type { AiConfig, ChannelHeader } from "@/stores/use-config-store";

// IDs used by the installed standard adapters, plus explicit standard aliases.
export const PERSONAL_OPENAI_PROTOCOLS = new Set(["chat-completion", "openai-response", "openai-image", "newapi", "openai-video", "openai-audio"]);

export function assertPersonalOpenAIConfig(config: Pick<AiConfig, "apiFormat" | "interfaceType">): void {
    if (config.apiFormat !== "openai" || (config.interfaceType !== undefined && config.interfaceType !== "" && !PERSONAL_OPENAI_PROTOCOLS.has(config.interfaceType))) {
        throw new Error("个人渠道仅支持标准 OpenAI 协议，请选择 Chat Completions、Responses、OpenAI 图片、视频或音频协议");
    }
}

const BLOCKED_HEADERS = new Set([
    "authorization", "proxy-authorization", "cookie", "cookie2", "set-cookie", "host", "content-length", "content-type", "accept",
    "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "forwarded", "x-goog-api-key",
    "x-api-key", "api-key",
]);

/** Pure transport-side counterpart of the header editor validation; inspect raw CR/LF before trimming. */
export function validatePersonalChannelHeaders(headers?: ChannelHeader[]): string {
    if (!headers?.length) return "";
    if (headers.length > 32) return "自定义请求头最多支持 32 项";
    const seen = new Set<string>();
    let bytes = 0;
    for (const header of headers) {
        if (typeof header?.name !== "string" || typeof header?.value !== "string") return "请求头格式无效";
        if (/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(header.name + header.value)) return "请求头包含非法控制字符";
        const name = header.name.trim();
        const value = header.value.trim();
        if (!name && !value) continue;
        if (!name || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) return "请求头名称无效，请使用标准 HTTP Header 名称";
        const lower = name.toLowerCase();
        if (BLOCKED_HEADERS.has(lower) || lower.startsWith("x-canvas") || lower.startsWith("x-forward") || lower.startsWith("proxy-") || lower.startsWith("sec-")) return "该请求头由系统管理，不允许自定义";
        if (seen.has(lower)) return "请求头不能重复";
        if (name.length > 128 || value.length > 4096) return "单个请求头名称或值过长";
        bytes += new TextEncoder().encode(name + value).length;
        if (bytes > 16 * 1024) return "自定义请求头总大小不能超过 16KB";
        seen.add(lower);
    }
    return "";
}

export function requirePersonalChannelUrl(value: string): string {
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw new Error("个人渠道地址无效，请填写完整 HTTP(S) 地址"); }
    if (!url.hostname || !["http:", "https:"].includes(url.protocol) || url.username || url.password || /[\r\n]/u.test(value)) {
        throw new Error("个人渠道地址必须是无 userinfo 的 HTTP(S) 地址");
    }
    return url.toString();
}

export function rethrowIfChannelAborted(error: unknown, signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (error && typeof error === "object" && (("name" in error && error.name === "AbortError") || ("code" in error && error.code === "ERR_CANCELED"))) throw error;
}
