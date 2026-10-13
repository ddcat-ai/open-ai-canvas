import type { LocalUser } from "./auth";
import { apiBaseURL, http } from "./request";

export type UserProfile = {
    user: LocalUser;
    hasPassword: boolean;
    emailEnabled: boolean;
    linuxdoEnabled: boolean;
    reauthenticatedUntil?: string;
};

export type ProfileEmailTicket = { ticket: string; expiresIn: number; retryAfter: number };
export type ProfileEmailResult = { changed: true; notificationStatus: "sent" | "failed" | "not_needed" };

export const getUserProfile = (signal?: AbortSignal) => http.get<UserProfile>("/auth/profile", { signal });

export function uploadProfileAvatar(file: File) {
    const data = new FormData();
    data.append("file", file);
    return http.put<{ user: LocalUser }>("/auth/profile/avatar", data);
}

export const resetProfileAvatar = () => http.delete<{ user: LocalUser }>("/auth/profile/avatar");
export const selectDefaultProfileAvatar = (preset: string) => http.post<{ user: LocalUser }>("/auth/profile/avatar/default", { preset });
export const changeProfilePassword = (input: { currentPassword: string; newPassword: string }) => http.post<{ changed: true }>("/auth/profile/password", input);
export const requestProfileEmailCode = (input: { email: string; currentPassword: string }) => http.post<ProfileEmailTicket>("/auth/profile/email-code", input);
export const changeProfileEmail = (input: { ticket: string; emailCode: string; currentPassword: string }) => http.post<ProfileEmailResult>("/auth/profile/email", input);

export const profileLinuxDOReauthURL = () => `${apiBaseURL.replace(/\/$/, "")}/auth/profile/linuxdo/start`;
