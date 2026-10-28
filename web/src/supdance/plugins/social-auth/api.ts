import { compactApiParams, http } from "@/services/api/request";
import type {
    AdminSettingsView,
    ProviderTestResult,
    PublicProvidersResponse,
    SocialAuthRegion,
    UpdateSettingsRequest,
} from "./types";

export async function getPublicSocialAuthProviders(params?: { simulateRegion?: SocialAuthRegion }, signal?: AbortSignal) {
    return http.get<PublicProvidersResponse>("/auth/social/providers", {
        params: compactApiParams({
            simulate_region: params?.simulateRegion,
        }),
        signal,
    });
}

export async function getAdminSocialAuthSettings(signal?: AbortSignal) {
    return http.get<AdminSettingsView>("/admin/social-auth/settings", { signal });
}

export async function updateAdminSocialAuthSettings(req: UpdateSettingsRequest) {
    return http.put<AdminSettingsView>("/admin/social-auth/settings", req);
}

export async function testSocialAuthProvider(providerId: string) {
    return http.post<ProviderTestResult>(`/admin/social-auth/test/${encodeURIComponent(providerId)}`);
}

export async function triggerMockSocialCallback(payload: { provider: string; state: string; code: string }) {
    return http.post<{ user: any; next: string; isNew: boolean }>("/auth/social/mock-callback", payload);
}

export function buildSocialAuthStartUrl(
    providerId: string,
    options?: {
        next?: string;
        acceptedTerms?: boolean;
        mock?: boolean;
        simulateRegion?: SocialAuthRegion;
    }
) {
    const params = new URLSearchParams();
    if (options?.next) params.set("next", options.next);
    if (options?.acceptedTerms) params.set("acceptedTerms", "true");
    if (options?.mock) params.set("mock", "true");
    if (options?.simulateRegion) params.set("simulate_region", options.simulateRegion);
    const query = params.toString();
    return `/api/auth/social/${encodeURIComponent(providerId)}/start${query ? `?${query}` : ""}`;
}
