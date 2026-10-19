import { http } from "@/services/api/request";
import type { PluginManifest, PluginManifestV2, PluginPermission, SmartCreationContribution } from "@/lib/plugins/plugin-types";

export type BackendPlugin = {
    manifest: PluginManifest | PluginManifestV2;
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
    origin: "official" | "system" | "uploaded";
    kind: "protocol" | "application" | "payment";
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
    return http.get<{ plugins: BackendPlugin[]; states: Record<string, PluginState> }>("/plugins");
}

/** 当前用户已生效的智能创作插件及其声明式策略；创作页据此加载插件包里的最新提示词和参数。 */
export type SmartCreationPluginPolicy = {
    id: string;
    name: string;
    version: string;
    permissions: PluginPermission[];
    smartCreation: SmartCreationContribution;
};

export async function fetchSmartCreationPlugins(options?: { signal?: AbortSignal }) {
    const result = await http.get<{ plugins: SmartCreationPluginPolicy[] }>("/plugins/smart-creation", { signal: options?.signal });
    return result.plugins || [];
}

export async function fetchPluginRuntimeState() {
    return http.get<{ statuses: Record<string, WorkflowPluginStatus>; states: Record<string, PluginState> }>("/plugins/status");
}

export async function uploadPlugin(file: File) {
    const body = new FormData();
    body.append("file", file);
    const result = await http.post<{ plugin: BackendPlugin }>("/plugins", body);
    return result.plugin;
}

export async function setUserPluginEnabled(id: string, enabled: boolean) {
    const result = await http.put<{ state: PluginState }>(`/plugins/${encodeURIComponent(id)}/activation`, { enabled });
    return result.state;
}

export async function fetchAdminPlugins() {
    return http.get<{ plugins: BackendPlugin[]; states: Record<string, AdminPluginState> }>("/admin/plugins");
}

export async function setPluginPlatformAvailability(id: string, available: boolean) {
    const result = await http.put<{ state: AdminPluginState }>(`/admin/plugins/${encodeURIComponent(id)}/availability`, { available });
    return result.state;
}

export async function uninstallPlugin(id: string) {
    await http.delete<{ deleted: boolean }>(`/plugins/${encodeURIComponent(id)}`);
}
