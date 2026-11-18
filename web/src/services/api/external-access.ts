import { http } from "./request";

export type UserAPIKey = {
    id: string;
    name: string;
    kind: "manual" | "mcp";
    prefix: string;
    createdAt: string;
    lastUsedAt?: string;
    revokedAt?: string;
};

export const listUserAPIKeys = (signal?: AbortSignal) => http.get<{ keys: UserAPIKey[] }>("/auth/api-keys", { signal });
export const createUserAPIKey = (name: string) => http.post<{ key: UserAPIKey; token: string }>("/auth/api-keys", { name });
export const revokeUserAPIKey = (id: string) => http.post<{ revoked: true }>(`/auth/api-keys/${encodeURIComponent(id)}/revoke`, {});

export const getMCPClient = (id: string, signal?: AbortSignal) => http.get<{ name: string }>(`/mcp/oauth/clients/${encodeURIComponent(id)}`, { signal });
export const consentToMCP = (request: { client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method: string; resource: string; response_type: string; scope: string; state: string; decision: "allow" | "deny" }) =>
    http.post<{ redirectUrl: string }>("/mcp/oauth/consent", request);
