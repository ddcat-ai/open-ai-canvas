import { buildApiUrl, isSystemProxyBaseUrl, resolveBackendApiUrl, type AiConfig } from "@/stores/use-config-store";
import { createClientId } from "@/lib/client-id";
import { createChannelTransport } from "@/services/api/channel-transport";
import type { GeminiPayload, ImageApiResponse, RequestOptions } from "@/services/api/image-contracts";

export function aiApiUrl(config: Pick<AiConfig, "baseUrl">, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

export function aiHeaders(config: Pick<AiConfig, "apiKey" | "baseUrl">, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(isSystemProxyBaseUrl(config.baseUrl) ? { "X-Canvas-Scene": "image", "X-Idempotency-Key": createClientId() } : {}),
    };
}

export async function postVolcengineArkImage(config: Parameters<typeof createChannelTransport>[0], payload: Record<string, unknown>, options?: RequestOptions) {
    if (options?.imageRequest) return (await options.imageRequest("/images/generations", payload)) as ImageApiResponse;
    return createChannelTransport(config, "image").postJson<ImageApiResponse>(aiApiUrl(config, "/images/generations"), payload, options);
}

export function geminiBaseUrl(config: Pick<AiConfig, "baseUrl">) {
    const normalizedBaseUrl = resolveBackendApiUrl(config.baseUrl).replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    return isSystemProxyBaseUrl(normalizedBaseUrl) || lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/v1beta") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1beta`;
}

export function geminiModelName(model: string) {
    return model.trim().replace(/^models\//, "");
}

export function geminiApiUrl(config: Pick<AiConfig, "baseUrl" | "model">, action?: "generateContent" | "streamGenerateContent") {
    const baseUrl = geminiBaseUrl(config);
    if (!action) return `${baseUrl}/models`;
    return `${baseUrl}/models/${encodeURIComponent(geminiModelName(config.model))}:${action}`;
}

export function geminiHeaders(config: Pick<AiConfig, "apiKey">) {
    return {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
    };
}

export async function postChannelJSON<T>(config: Parameters<typeof createChannelTransport>[0], upstreamUrl: string, body: unknown, options?: RequestOptions) {
    if (options?.imageRequest) return (await options.imageRequest(upstreamUrl.endsWith("/images/edits") ? "/images/edits" : "/images/generations", body as Record<string, unknown>)) as T;
    return createChannelTransport(config, "image").postJson<T>(upstreamUrl, body, options);
}

export async function postGeminiJSON(config: Parameters<typeof createChannelTransport>[0] & Pick<AiConfig, "model">, body: unknown, options?: RequestOptions) {
    if (options?.imageRequest) return (await options.imageRequest(`/models/${encodeURIComponent(geminiModelName(config.model))}:generateContent`, body as Record<string, unknown>)) as GeminiPayload;
    return createChannelTransport(config, "image").postJson<GeminiPayload>(geminiApiUrl(config, "generateContent"), body, {
        ...options,
        headers: geminiHeaders(config),
    });
}

export function imageChannelTransport(config: Parameters<typeof createChannelTransport>[0]) {
    return createChannelTransport(config, "image");
}
