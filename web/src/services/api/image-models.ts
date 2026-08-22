import axios from "axios";

import { sanitizeChannelModelCatalogItem, type ChannelModelCatalogItem } from "@/lib/channel-model-catalog";
import { projectDesktopLocalChannelRuntime } from "@/lib/desktop-local-channel";
import { channelRequest } from "@/services/api/custom-channel-relay";
import { readAxiosError, validateGeminiPayload } from "@/services/api/image-response";
import { geminiApiUrl, geminiHeaders } from "@/services/api/image-transport";
import { buildApiUrl, resolveBackendApiUrl, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

const defaultGeminiConfig: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat" | "model" | "systemPrompt"> = {
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey: "",
    apiFormat: "gemini",
    model: "",
    systemPrompt: "",
};

type GeminiModelPayload = { models?: Array<{ name?: string }> };
type OpenAIModelPayload = { data?: Array<{ id?: string }>; error?: { message?: string } };

export async function fetchImageModels(config: Pick<AiConfig, "baseUrl" | "apiKey" | "apiFormat"> & { allowLocalChannel?: boolean }) {
    try {
        if (config.apiFormat === "gemini") {
            const requestConfig = { ...defaultGeminiConfig, ...config };
            const request = channelRequest(requestConfig, geminiApiUrl(requestConfig), geminiHeaders(requestConfig));
            const response = await axios.get<GeminiModelPayload>(request.url, { headers: request.headers, withCredentials: request.credentials === "include" });
            validateGeminiPayload(response.data);
            return (response.data.models || [])
                .map((model) => model.name?.replace(/^models\//, ""))
                .filter((id): id is string => Boolean(id))
                .sort((a, b) => a.localeCompare(b));
        }
        const request = channelRequest(config, buildApiUrl(config.baseUrl, "/models"), { Authorization: `Bearer ${config.apiKey}` });
        const response = await axios.get<OpenAIModelPayload>(request.url, { headers: request.headers, withCredentials: request.credentials === "include" });
        return (response.data.data || [])
            .map((model) => model.id)
            .filter((id): id is string => Boolean(id))
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}

export type ChannelModelFetchResult = { models: string[]; catalog: ChannelModelCatalogItem[] };

export async function fetchChannelModels(channel: ModelChannel, viaBackend = false): Promise<ChannelModelFetchResult> {
    const runtimeChannel = projectDesktopLocalChannelRuntime(channel);
    if (!viaBackend) {
        const models = await fetchImageModels({ baseUrl: runtimeChannel.baseUrl, allowLocalChannel: runtimeChannel.allowLocalChannel === true, apiKey: runtimeChannel.apiKey, apiFormat: runtimeChannel.apiFormat });
        return { models, catalog: models.map((id) => ({ id })) };
    }
    try {
        // 登录态由同源后端代取模型目录，避免每个 OpenAI 兼容服务分别维护浏览器 CORS 白名单。
        const response = await axios.post<{ code?: number; data?: { models?: Array<string | ChannelModelCatalogItem> }; msg?: string }>(
            resolveBackendApiUrl("/api/ai/models"),
            {
                baseUrl: runtimeChannel.baseUrl,
                allowLocalChannel: runtimeChannel.allowLocalChannel === true,
                apiKey: runtimeChannel.apiKey,
                apiFormat: runtimeChannel.apiFormat,
                headers: runtimeChannel.headers,
            },
            { withCredentials: true },
        );
        if (typeof response.data.code === "number" && response.data.code !== 0) {
            throw new Error(response.data.msg || "读取模型失败");
        }
        const catalog = new Map<string, ChannelModelCatalogItem>();
        for (const item of response.data.data?.models || []) {
            const entry = typeof item === "string" ? sanitizeChannelModelCatalogItem({ id: item }) : sanitizeChannelModelCatalogItem(item);
            if (!entry) continue;
            const existing = catalog.get(entry.id);
            catalog.set(entry.id, existing || entry);
        }
        const models = Array.from(catalog.keys()).sort((a, b) => a.localeCompare(b));
        const sortedCatalog = Array.from(catalog.values()).sort((a, b) => a.id.localeCompare(b.id));
        return { models, catalog: sortedCatalog };
    } catch (error) {
        throw new Error(readAxiosError(error, "读取模型失败"));
    }
}
