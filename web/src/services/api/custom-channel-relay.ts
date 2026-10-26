import { assertPersonalOpenAIConfig, requirePersonalChannelUrl, validatePersonalChannelHeaders } from "@/lib/personal-channel";
import { apiBaseURL } from "@/services/api/request";
import { isSystemProxyBaseUrl, type AiConfig, type ChannelHeader } from "@/stores/use-config-store";

type RelayConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "channelScope" | "interfaceType"> & { headers?: ChannelHeader[] };

export type ChannelRequest = {
    url: string;
    headers: Record<string, string>;
    credentials: RequestCredentials;
};

/** Scope decides execution location; URLs never grant personal or system identity. */
export function channelRequest(config: RelayConfig, upstreamUrl: string, headers: HeadersInit = {}): ChannelRequest {
    const normalizedHeaders = new Headers(headers);
    if (config.channelScope === "user") {
        assertPersonalOpenAIConfig(config);
        const invalid = validatePersonalChannelHeaders(config.headers);
        if (invalid) throw new Error(invalid);
        const base = new URL(requirePersonalChannelUrl(config.baseUrl));
        const target = new URL(requirePersonalChannelUrl(upstreamUrl));
        if (base.origin !== target.origin || !(target.pathname === base.pathname.replace(/\/$/u, "") || target.pathname.startsWith(base.pathname.replace(/\/$/u, "") + "/"))) throw new Error("请求地址超出所选个人渠道范围");
        for (const name of [...normalizedHeaders.keys()]) {
            if (/^(?:x-canvas|x-forward|proxy-|cookie|host$)/iu.test(name)) normalizedHeaders.delete(name);
        }
        normalizedHeaders.delete("Authorization");
        if (config.apiKey) normalizedHeaders.set("Authorization", `Bearer ${config.apiKey}`);
        for (const header of config.headers || []) if (header.name.trim()) normalizedHeaders.set(header.name.trim(), header.value.trim());
        return { url: target.toString(), headers: Object.fromEntries(normalizedHeaders.entries()), credentials: "omit" };
    }
    if (isSystemProxyBaseUrl(config.baseUrl)) {
        return { url: upstreamUrl, headers: Object.fromEntries(normalizedHeaders.entries()), credentials: "include" };
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
