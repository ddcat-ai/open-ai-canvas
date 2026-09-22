import { http } from "./request";

export type PublicAPIKey = {
    id: string;
    name: string;
    prefix: string;
    status: "active" | "revoked";
    modelAllowlist?: string[];
    expiresAt?: string;
    lastUsedAt?: string;
    revokedAt?: string;
    createdAt: string;
};

export type CreatedPublicAPIKey = PublicAPIKey & { secret: string };

export function listPublicAPIKeys() {
    return http.get<{ keys: PublicAPIKey[] }>("/developer/api-keys");
}

export function createPublicAPIKey(input: { name: string; modelAllowlist?: string[]; expiresAt?: string }) {
    return http.post<CreatedPublicAPIKey>("/developer/api-keys", input);
}

export function revokePublicAPIKey(id: string) {
    return http.delete<{ revoked: boolean }>(`/developer/api-keys/${encodeURIComponent(id)}`);
}
