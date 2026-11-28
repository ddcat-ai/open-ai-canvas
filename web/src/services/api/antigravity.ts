import { http } from "./request";

export type AntigravityAuthMethod = "oauth-personal" | "oauth-business" | "gemini-api-key" | "agent-platform";

export type AntigravityRuntime = {
    installed: boolean;
    version?: string;
    target: string;
    supported: boolean;
};

export type AntigravityModel = {
    id: string;
    name: string;
    description?: string;
};

export type AntigravityConnection = {
    checkedAt: string;
    signedIn: boolean;
    models: AntigravityModel[];
    defaultModel?: string;
    agentVersion?: string;
    error?: string;
};

export type AntigravityLogin = {
    phase: "idle" | "waiting" | "verifying" | "succeeded" | "failed";
    authorizationUrl?: string;
    expiresAt?: string;
    message?: string;
};

export type AntigravityStatus = {
    runtime: AntigravityRuntime;
    authMethod: AntigravityAuthMethod;
    gcpProject: string;
    gcpLocation: string;
    hasApiKey: boolean;
    connection?: AntigravityConnection;
    login: AntigravityLogin;
};

export type AntigravitySettingsInput = {
    authMethod: AntigravityAuthMethod;
    apiKey?: string;
    gcpProject?: string;
    gcpLocation?: string;
};

const channelPath = (channelId: string) => `/admin/channels/${encodeURIComponent(channelId)}/antigravity`;

export function getAdminAntigravityStatus(channelId: string, refresh = false) {
    return http.get<{ antigravity: AntigravityStatus }>(channelPath(channelId), { params: refresh ? { refresh: 1 } : undefined });
}

export function installAdminAntigravityRuntime() {
    return http.post<{ runtime: AntigravityRuntime }>("/admin/antigravity/runtime/install");
}

export function saveAdminAntigravitySettings(channelId: string, input: AntigravitySettingsInput) {
    return http.put<{ antigravity: AntigravityStatus }>(`${channelPath(channelId)}/settings`, input);
}

export function startAdminAntigravityLogin(channelId: string) {
    return http.post<{ antigravity: AntigravityStatus }>(`${channelPath(channelId)}/login`);
}

export function submitAdminAntigravityLoginCode(channelId: string, code: string) {
    return http.post<{ antigravity: AntigravityStatus }>(`${channelPath(channelId)}/login/code`, { code });
}

export function cancelAdminAntigravityLogin(channelId: string) {
    return http.post<{ antigravity: AntigravityStatus }>(`${channelPath(channelId)}/login/cancel`);
}

export function logoutAdminAntigravity(channelId: string) {
    return http.post<{ antigravity: AntigravityStatus }>(`${channelPath(channelId)}/logout`);
}
