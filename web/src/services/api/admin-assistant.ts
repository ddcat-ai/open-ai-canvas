import { http } from "@/services/api/request";

const prefix = "/admin-assistant";

export type AssistantCredential = {
    id: string;
    name: string;
    scopes: string[];
    grantId?: string;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
};
export type AssistantGrant = Omit<AssistantCredential, "name"> & { clientId: string };
export type AssistantCall = {
    id: string;
    operation: string;
    credentialId: string;
    argumentsHash: string;
    previewJson: string;
    status: string;
    source: string;
    createdAt: string;
    expiresAt: string;
    durationMs: number;
};
export type AssistantSkillRelease = {
    name: string;
    version: string;
    serverVersion: string;
    apiVersion: number;
    sha256: string;
    size: number;
    downloadUrl: string;
};
export type AssistantConsent = { clientId: string; clientName: string; redirectUri: string; resource: string; scopes: string[] };

export const getAssistantSetup = () => http.get<{ mcpUrl: string; scopes: string[]; skillUrl: string }>(`${prefix}/setup`);
export const listAssistantTokens = (page: number) => http.get<{ items: AssistantCredential[]; hasMore: boolean }>(`${prefix}/tokens`, { params: { page } });
export const createAssistantToken = (input: { name: string; scopes: string[]; days: number }) => http.post<{ token: string; credential: AssistantCredential }>(`${prefix}/tokens`, input);
export const revokeAssistantToken = (id: string) => http.delete(`${prefix}/tokens/${encodeURIComponent(id)}`);
export const listAssistantGrants = (page: number) => http.get<{ items: AssistantGrant[]; hasMore: boolean }>(`${prefix}/grants`, { params: { page } });
export const revokeAssistantGrant = (id: string) => http.delete(`${prefix}/grants/${encodeURIComponent(id)}`);
export const listAssistantCalls = (page: number) => http.get<{ items: AssistantCall[] }>(`${prefix}/calls`, { params: { page } });
export const getAssistantCall = (id: string) => http.get<AssistantCall>(`${prefix}/calls/${encodeURIComponent(id)}`);
export const confirmAssistantCall = (id: string, approve: boolean) => http.post(`${prefix}/calls/${encodeURIComponent(id)}/confirm`, { approve });
export const getAssistantSkillRelease = () => http.get<AssistantSkillRelease>(`${prefix}/skill/latest`);
export const getAssistantConsent = (query: string) => http.get<AssistantConsent>(`${prefix}/oauth/consent?${query}`);
export const authorizeAssistant = (params: Record<string, string>, approve: boolean) => http.post<{ redirectUrl: string }>(`${prefix}/oauth/consent`, { ...params, approve });
