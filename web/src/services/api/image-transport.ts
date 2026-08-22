import axios from "axios";

import { buildApiUrl, isSystemProxyBaseUrl, resolveBackendApiUrl, type AiConfig } from "@/stores/use-config-store";
import { createClientId } from "@/lib/client-id";
import { channelRequest } from "@/services/api/custom-channel-relay";
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

export async function postVolcengineArkImage(config: Parameters<typeof channelRequest>[0], payload: Record<string, unknown>, options?: RequestOptions) {
    const upstreamUrl = aiApiUrl(config, "/images/generations");
    const request = channelRequest(config, upstreamUrl, aiHeaders(config, "application/json"));
    return (
        await axios.post<ImageApiResponse>(request.url, payload, {
            headers: request.headers,
            withCredentials: request.credentials === "include",
            signal: options?.signal,
        })
    ).data;
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

export async function postChannelJSON<T>(config: Parameters<typeof channelRequest>[0], upstreamUrl: string, body: unknown, options?: RequestOptions) {
    const request = channelRequest(config, upstreamUrl, aiHeaders(config, "application/json"));
    return (
        await axios.post<T>(request.url, body, {
            headers: request.headers,
            withCredentials: request.credentials === "include",
            signal: options?.signal,
        })
    ).data;
}

export async function postGeminiJSON(config: Parameters<typeof channelRequest>[0] & Pick<AiConfig, "model">, body: unknown, options?: RequestOptions) {
    const request = channelRequest(config, geminiApiUrl(config, "generateContent"), geminiHeaders(config));
    return (
        await axios.post<GeminiPayload>(request.url, body, {
            headers: request.headers,
            withCredentials: request.credentials === "include",
            signal: options?.signal,
        })
    ).data;
}
