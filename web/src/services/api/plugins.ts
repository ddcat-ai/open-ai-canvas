import { apiClient, request } from "@/services/api/request";
import type { PluginManifest, ProtocolCapability, ProtocolScope } from "@/lib/plugins/plugin-types";

export type BackendPlugin = {
    manifest: {
        id: string;
        name: string;
        version: string;
        apiVersion: string;
        category: "protocol";
        description?: string;
        author?: string;
        surfaces: string[];
        permissions: string[];
        trusted: boolean;
        kind: "protocol";
        protocol: {
            categories: ProtocolCapability[];
            scopes: ProtocolScope[];
            create?: string;
            poll?: string;
            cancel?: string;
            contentType?: string;
            documentation?: string;
            parameters?: NonNullable<PluginManifest["protocol"]>["parameters"];
        };
    };
    source: "bundled" | "uploaded" | string;
    fileName: string;
    sha256: string;
    installedAt: string;
    updatedAt: string;
    status: "enabled" | "disabled" | "invalid" | string;
    error?: string;
};

export async function fetchPlugins() {
    const result = await request<{ plugins: BackendPlugin[] }>(apiClient.get("/plugins"));
    return result.plugins;
}

export async function uploadPlugin(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await request<{ plugin: BackendPlugin }>(apiClient.post("/plugins", body));
    return result.plugin;
}

export async function setPluginEnabled(id: string, enabled: boolean) {
    const result = await request<{ plugin: BackendPlugin }>(apiClient.post(`/plugins/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`));
    return result.plugin;
}

export async function uninstallPlugin(id: string) {
    await request<{ deleted: boolean }>(apiClient.delete(`/plugins/${encodeURIComponent(id)}`));
}
