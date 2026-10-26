import axios from "axios";

import { createClientId } from "@/lib/client-id";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { isSystemProxyBaseUrl } from "@/stores/use-config-store";

export type ChannelScene = "image" | "video" | "audio";

export type ChannelTransportConfig = Parameters<typeof channelRequest>[0] & {
    apiKey?: string;
    baseUrl?: string;
};

export type ChannelCallOptions = {
    signal?: AbortSignal;
    headers?: Record<string, string>;
};

export type ChannelTransport = {
    postJson: <T>(upstreamUrl: string, body: unknown, options?: ChannelCallOptions) => Promise<T>;
    postBlob: (upstreamUrl: string, body: unknown, options?: ChannelCallOptions) => Promise<Blob>;
    postForm: <T>(upstreamUrl: string, body: FormData, options?: ChannelCallOptions) => Promise<T>;
    get: <T>(upstreamUrl: string, options?: ChannelCallOptions) => Promise<T>;
    getBlob: (upstreamUrl: string, options?: ChannelCallOptions) => Promise<Blob>;
    getExternalBlob: (url: string, headers?: Record<string, string>, options?: ChannelCallOptions) => Promise<Blob>;
};

/**
 * 自定义渠道的唯一 HTTP 边界。image / video / audio 只组协议 payload，不再各自 axios + channelRequest。
 */
export function createChannelTransport(config: ChannelTransportConfig, scene?: ChannelScene): ChannelTransport {
    const sceneHeaders = (contentType?: string, extra?: Record<string, string>) => ({
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(config.channelScope !== "user" && scene && config.baseUrl && isSystemProxyBaseUrl(config.baseUrl)
            ? { "X-Canvas-Scene": scene, "X-Idempotency-Key": createClientId() }
            : {}),
        ...extra,
    });

    const send = async <T>(method: "get" | "post", upstreamUrl: string, body: unknown, options?: ChannelCallOptions & { contentType?: string; responseType?: "blob" }) => {
        const request = channelRequest(config, upstreamUrl, sceneHeaders(options?.contentType, options?.headers));
        const response = await axios.request<T>({
            method,
            url: request.url,
            data: method === "get" ? undefined : body,
            headers: request.headers,
            withCredentials: request.credentials === "include",
            signal: options?.signal,
            responseType: options?.responseType,
        });
        return response.data;
    };

    return {
        postJson: (upstreamUrl, body, options) => send("post", upstreamUrl, body, { ...options, contentType: "application/json" }),
        postBlob: (upstreamUrl, body, options) => send("post", upstreamUrl, body, { ...options, contentType: "application/json", responseType: "blob" }),
        postForm: (upstreamUrl, body, options) => send("post", upstreamUrl, body, options),
        get: (upstreamUrl, options) => send("get", upstreamUrl, undefined, options),
        getBlob: (upstreamUrl, options) => send("get", upstreamUrl, undefined, { ...options, responseType: "blob" }),
        getExternalBlob: async (url, headers, options) => (
            await axios.get<Blob>(url, { headers, responseType: "blob", signal: options?.signal })
        ).data,
    };
}
