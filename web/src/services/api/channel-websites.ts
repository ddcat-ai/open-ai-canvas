import { http } from "./request";
import type { ChannelHeader } from "@/stores/use-config-store";

export type ChannelWebsite = {
    id: string;
    name: string;
    baseUrl: string;
    apiFormat: "openai" | "gemini" | "chatgpt-plan";
    proxyUrl: string;
    headers: ChannelHeader[];
    keyCount: number;
    createdAt: string;
    updatedAt: string;
};

export type ChannelWebsiteInput = Pick<ChannelWebsite, "name" | "baseUrl" | "proxyUrl" | "headers"> & { apiFormat: "openai" | "gemini"; expectedUpdatedAt?: string };

export function listAdminChannelWebsites() {
    return http.get<{ websites: ChannelWebsite[] }>("/admin/channel-websites");
}

export function saveAdminChannelWebsite(id: string | undefined, input: ChannelWebsiteInput) {
    return id ? http.patch<{ website: ChannelWebsite }>(`/admin/channel-websites/${encodeURIComponent(id)}`, input) : http.post<{ website: ChannelWebsite }>("/admin/channel-websites", input);
}

export function deleteAdminChannelWebsite(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/channel-websites/${encodeURIComponent(id)}`);
}
