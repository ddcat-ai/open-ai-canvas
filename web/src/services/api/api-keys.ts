import { http } from "./request";

export type APIKeyMetadata = {
    id: string;
    name: string;
    prefix: string;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
};

export type CreatedAPIKey = APIKeyMetadata & { key: string };
export type CreateAPIKeyInput = { name: string; expiresAt?: string };

export const listAPIKeys = (signal?: AbortSignal) => http.get<{ keys: APIKeyMetadata[] }>("/api-keys", { signal });
export const createAPIKey = (input: CreateAPIKeyInput) => http.post<CreatedAPIKey>("/api-keys", input);
export const revokeAPIKey = (id: string) => http.delete<{ revoked: true }>(`/api-keys/${encodeURIComponent(id)}`);

export function apiKeyStatus(key: Pick<APIKeyMetadata, "revokedAt" | "expiresAt">, now = Date.now()): "active" | "expired" | "revoked" {
    if (key.revokedAt) return "revoked";
    if (key.expiresAt && Date.parse(key.expiresAt) <= now) return "expired";
    return "active";
}
