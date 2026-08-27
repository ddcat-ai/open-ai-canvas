import { apiClient, request } from "@/services/api/request";
import type { PluginManifest } from "@/lib/plugins/plugin-types";

export type BackendPlugin = {
    manifest: PluginManifest;
    source: "bundled" | "uploaded" | string;
    fileName: string;
    package: string;
    sha256: string;
    installedAt: string;
    updatedAt: string;
    status: "enabled" | "disabled" | "invalid" | string;
    error?: string;
    management: PluginManagement;
};

export type WorkflowPluginStatus = "enabled" | "disabled" | "invalid" | string;

export type PluginManagement = {
    origin: "official" | "uploaded";
    kind: "protocol" | "application";
    activationScope: "system" | "user";
    configurationScope: "none" | "system" | "user";
};

export type PluginState = {
    pluginId: string;
    platformAvailable: boolean;
    userEnabled: boolean;
    userConfigured: boolean;
    effectiveEnabled: boolean;
    canToggle: boolean;
    canConfigure: boolean;
    blockedReason?: string;
};

export type AdminPluginState = PluginState & { enabledUserCount: number };

export async function fetchPlugins() {
    return request<{ plugins: BackendPlugin[]; states: Record<string, PluginState> }>(apiClient.get("/plugins"));
}

export async function fetchPluginRuntimeState() {
    return request<{ statuses: Record<string, WorkflowPluginStatus>; states: Record<string, PluginState> }>(apiClient.get("/plugins/status"));
}

export async function uploadPlugin(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await request<{ plugin: BackendPlugin }>(apiClient.post("/plugins", body));
    return result.plugin;
}

export async function setUserPluginEnabled(id: string, enabled: boolean) {
    const result = await request<{ state: PluginState }>(apiClient.put(`/plugins/${encodeURIComponent(id)}/activation`, { enabled }));
    return result.state;
}

export async function fetchAdminPlugins() {
    return request<{ plugins: BackendPlugin[]; states: Record<string, AdminPluginState> }>(apiClient.get("/admin/plugins"));
}

export async function setPluginPlatformAvailability(id: string, available: boolean) {
    const result = await request<{ state: AdminPluginState }>(apiClient.put(`/admin/plugins/${encodeURIComponent(id)}/availability`, { available }));
    return result.state;
}

export async function uninstallPlugin(id: string) {
    await request<{ deleted: boolean }>(apiClient.delete(`/plugins/${encodeURIComponent(id)}`));
}
