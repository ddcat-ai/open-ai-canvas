import { projectDesktopLocalChannelRuntime } from "@/lib/desktop-local-channel";
import { isSystemProxyBaseUrl, resolveBackendApiUrl, type AiConfig, type ChannelHeader } from "@/stores/use-config-store";

type RelayConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { allowLocalChannel?: boolean; headers?: ChannelHeader[] };

export type ChannelRequest = {
    url: string;
    headers: Record<string, string>;
    credentials: RequestCredentials;
};

/** 自定义渠道统一经登录态后端中转，避免依赖第三方服务的浏览器 CORS。 */
export function channelRequest(config: RelayConfig, upstreamUrl: string, headers: HeadersInit = {}): ChannelRequest {
    const runtimeConfig = projectDesktopLocalChannelRuntime(config);
    const normalizedHeaders = new Headers(headers);
    if (isSystemProxyBaseUrl(runtimeConfig.baseUrl)) {
        return { url: upstreamUrl, headers: Object.fromEntries(normalizedHeaders.entries()), credentials: "include" };
    }

    const normalizedUpstreamUrl = new URL(upstreamUrl).toString();
    normalizedHeaders.delete("X-Canvas-Upstream-Headers");
    normalizedHeaders.delete("x-goog-api-key");
    normalizedHeaders.set("Authorization", `Bearer ${runtimeConfig.apiKey}`);
    normalizedHeaders.set("X-Canvas-Upstream-URL", normalizedUpstreamUrl);
    normalizedHeaders.set("X-Canvas-Upstream-Format", runtimeConfig.apiFormat === "gemini" ? "gemini" : "openai");
    if (runtimeConfig.allowLocalChannel === true) {
        normalizedHeaders.set("X-Canvas-Allow-Local-Channel", "1");
        normalizedHeaders.set("X-Canvas-Upstream-Base-URL", new URL(runtimeConfig.baseUrl).toString());
    } else {
        normalizedHeaders.delete("X-Canvas-Allow-Local-Channel");
        normalizedHeaders.delete("X-Canvas-Upstream-Base-URL");
    }
    if (runtimeConfig.headers?.length) normalizedHeaders.set("X-Canvas-Upstream-Headers", encodeChannelHeaders(runtimeConfig.headers));
    return {
        url: resolveBackendApiUrl("/api/ai/custom"),
        headers: Object.fromEntries(normalizedHeaders.entries()),
        credentials: "include",
    };
}

function encodeChannelHeaders(headers: ChannelHeader[]) {
    const bytes = new TextEncoder().encode(JSON.stringify(headers));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}
