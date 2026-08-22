import axios from "axios";

import { createClientId } from "@/lib/client-id";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { buildApiUrl, isSystemProxyBaseUrl } from "@/stores/use-config-store";

import type { RequestOptions, ResolvedAiConfig } from "./video-contracts";

export type VideoTransport = {
    apiUrl: (path: string) => string;
    post: <T>(upstreamUrl: string, body: unknown, options?: RequestOptions) => Promise<T>;
    postForm: <T>(upstreamUrl: string, body: FormData, options?: RequestOptions) => Promise<T>;
    get: <T>(upstreamUrl: string, options?: RequestOptions) => Promise<T>;
    getBlob: (upstreamUrl: string, options?: RequestOptions) => Promise<Blob>;
    getExternalBlob: (url: string, headers: Record<string, string>, options?: RequestOptions) => Promise<Blob>;
};

/**
 * 统一视频 Provider 的 HTTP 边界。Provider 只负责协议和 payload，不再重复拼接中转请求。
 */
export function createVideoTransport(config: ResolvedAiConfig): VideoTransport {
    const headers = (contentType?: string) => ({
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(isSystemProxyBaseUrl(config.baseUrl) ? { "X-Canvas-Scene": "video", "X-Idempotency-Key": createClientId() } : {}),
    });
    const requestOptions = (options?: RequestOptions) => ({
        withCredentials: false,
        signal: options?.signal,
    });

    return {
        apiUrl: (path) => buildApiUrl(config.baseUrl, path),
        post: async <T>(upstreamUrl: string, body: unknown, options?: RequestOptions) => {
            const request = channelRequest(config, upstreamUrl, headers("application/json"));
            return (await axios.post<T>(request.url, body, { ...requestOptions(options), headers: request.headers, withCredentials: request.credentials === "include" })).data;
        },
        postForm: async <T>(upstreamUrl: string, body: FormData, options?: RequestOptions) => {
            const request = channelRequest(config, upstreamUrl, headers());
            return (await axios.post<T>(request.url, body, { ...requestOptions(options), headers: request.headers, withCredentials: request.credentials === "include" })).data;
        },
        get: async <T>(upstreamUrl: string, options?: RequestOptions) => {
            const request = channelRequest(config, upstreamUrl);
            return (await axios.get<T>(request.url, { ...requestOptions(options), headers: request.headers, withCredentials: request.credentials === "include" })).data;
        },
        getBlob: async (upstreamUrl: string, options?: RequestOptions) => {
            const request = channelRequest(config, upstreamUrl);
            return (await axios.get<Blob>(request.url, { ...requestOptions(options), headers: request.headers, withCredentials: request.credentials === "include", responseType: "blob" })).data;
        },
        getExternalBlob: async (url: string, externalHeaders: Record<string, string>, options?: RequestOptions) => {
            return (await axios.get<Blob>(url, { headers: externalHeaders, responseType: "blob", signal: options?.signal })).data;
        },
    };
}
