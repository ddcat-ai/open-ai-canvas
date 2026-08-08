import { apiClient, request } from "@/services/api/request";

export type UserStyleProfile = {
    id: string;
    userId: string;
    name: string;
    description: string;
    coverUrl: string;
    tagsJson: string;
    profileJson: string;
    favorite: boolean;
    lastUsedAt?: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
};

export function listStyleProfiles() {
    return request<{ profiles: UserStyleProfile[] }>(apiClient.get("/style-profiles"));
}

export function createStyleProfile(profileJson: string) {
    return request<{ profile: UserStyleProfile }>(apiClient.post("/style-profiles", { profileJson }));
}

export function updateStyleProfile(id: string, profileJson: string) {
    return request<{ profile: UserStyleProfile }>(apiClient.patch(`/style-profiles/${encodeURIComponent(id)}`, { profileJson }));
}

export function setStyleProfileFavorite(id: string, favorite: boolean) {
    return request<{ id: string; favorite: boolean }>(apiClient.patch(`/style-profiles/${encodeURIComponent(id)}/favorite`, { favorite }));
}

export function touchStyleProfile(id: string) {
    return request<{ id: string }>(apiClient.post(`/style-profiles/${encodeURIComponent(id)}/use`));
}

export function deleteStyleProfile(id: string) {
    return request<{ id: string }>(apiClient.delete(`/style-profiles/${encodeURIComponent(id)}`));
}
