import { apiBaseURL } from "@/services/api/request";
import { isSystemProxyBaseUrl, type AiConfig, type ChannelHeader } from "@/stores/use-config-store";

type RelayConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { headers?: ChannelHeader[] };

export type ChannelRequest = {
    url: string;
    headers: Record<string, string>;
    credentials: RequestCredentials;
};

/**
 * DMC 官方网关的 CORS 是全开的（实测 2026-11-17：OPTIONS 204，
 * Access-Control-Allow-Origin: * / Allow-Headers: * / Allow-Methods: GET,POST,...）。
 * 且这里用的是用户自己填的 DMC Key，不该经影策登录态后端中转。
 * 只对 DMC 官方域名放行直连，其他第三方渠道仍按原逻辑走 /ai/custom。
 */
function isLL2DirectBaseUrl(value: string) {
    try {
        const host = new URL(String(value || "").trim()).hostname.toLowerCase();
        return host === "api.ll2.cn" || host === "ll2.cn";
    } catch {
        return false;
    }
}

/** 自定义渠道统一经登录态后端中转，避免依赖第三方服务的浏览器 CORS。 */
export function channelRequest(config: RelayConfig, upstreamUrl: string, headers: HeadersInit = {}): ChannelRequest {
    const normalizedHeaders = new Headers(headers);
    if (isSystemProxyBaseUrl(config.baseUrl)) {
        return { url: upstreamUrl, headers: Object.fromEntries(normalizedHeaders.entries()), credentials: "include" };
    }

    if (isLL2DirectBaseUrl(config.baseUrl)) {
        const directUrl = requireHttpUrl(upstreamUrl, "DMC 请求地址");
        const apiKey = String(config.apiKey || "").trim();
        if (apiKey) normalizedHeaders.set("Authorization", `Bearer ${apiKey}`);
        // 中转专用头不能发给 DMC，否则会被网关当成未知字段或误路由。
        for (const name of ["X-Canvas-Upstream-Headers", "X-Canvas-Upstream-URL", "X-Canvas-Upstream-Format", "X-Canvas-Upstream-Base-URL", "X-Canvas-Scene", "X-Idempotency-Key"]) {
            normalizedHeaders.delete(name);
        }
        return { url: directUrl, headers: Object.fromEntries(normalizedHeaders.entries()), credentials: "omit" };
    }

    const normalizedBaseUrl = requireHttpUrl(config.baseUrl, "当前模型渠道 Base URL");
    const normalizedUpstreamUrl = requireHttpUrl(upstreamUrl, "当前模型请求地址");
    normalizedHeaders.delete("X-Canvas-Upstream-Headers");
    normalizedHeaders.delete("x-goog-api-key");
    normalizedHeaders.set("Authorization", `Bearer ${config.apiKey}`);
    normalizedHeaders.set("X-Canvas-Upstream-URL", normalizedUpstreamUrl);
    normalizedHeaders.set("X-Canvas-Upstream-Format", config.apiFormat === "gemini" ? "gemini" : config.apiFormat === "claude" ? "claude" : "openai");
    normalizedHeaders.set("X-Canvas-Upstream-Base-URL", normalizedBaseUrl);
    if (config.headers?.length) normalizedHeaders.set("X-Canvas-Upstream-Headers", encodeChannelHeaders(config.headers));
    return {
        url: `${apiBaseURL.replace(/\/+$/u, "")}/ai/custom`,
        headers: Object.fromEntries(normalizedHeaders.entries()),
        credentials: "include",
    };
}

function requireHttpUrl(value: string, label: string) {
    const normalized = value.trim();
    let parsed: URL;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error(`${label} 无效，请填写完整地址，例如：https://api.example.com/v1`);
    }
    if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
        throw new Error(`${label} 无效，请填写完整地址，例如：https://api.example.com/v1`);
    }
    return parsed.toString();
}

function encodeChannelHeaders(headers: ChannelHeader[]) {
    const bytes = new TextEncoder().encode(JSON.stringify(headers));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}
