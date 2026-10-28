export const SUPDANCE_SOCIAL_AUTH_PLUGIN_ID = "supdance-social-auth" as const;

export type SocialAuthRegion = "cn" | "intl";

export type SocialAuthStatus = "unconfigured" | "credentials_required" | "ready" | "online";

export interface SocialAuthProviderPublic {
    id: string;
    name: string;
    platform?: string;
    region: SocialAuthRegion;
    icon: string;
    authorizeUrl?: string;
    sandboxEnabled?: boolean;
    status?: SocialAuthStatus;
}

export interface PublicProvidersResponse {
    region: SocialAuthRegion;
    detectedRegion?: SocialAuthRegion;
    regionLabel?: string;
    clientIp: string;
    fallbackRegion?: SocialAuthRegion;
    providers: SocialAuthProviderPublic[];
    cn?: SocialAuthProviderPublic[];
    intl?: SocialAuthProviderPublic[];
    allRegions?: {
        cn?: SocialAuthProviderPublic[];
        intl?: SocialAuthProviderPublic[];
    };
}

export interface SocialAuthProviderAdmin {
    id: string;
    name: string;
    platform?: string;
    region: SocialAuthRegion;
    icon: string;
    enabled: boolean;
    status: SocialAuthStatus;
    statusMessage?: string;
    clientIdMasked?: string;
    clientSecretMasked?: string;
    maskedSecret?: string;
    callbackUrl: string;
    customRedirectUrl?: string;
    testPingUrl?: string;
    latencyMs?: number;
    scopes?: string[];
    docUrl?: string;
    sandboxMockSupported?: boolean;
    sandboxMockEnabled?: boolean;
    updatedAt?: string;
}

export interface AdminSettingsView {
    clientIp: string;
    detectedRegion: SocialAuthRegion;
    detectedRegionLabel?: string;
    ipSourceHeader?: string;
    defaultFallbackRegion: SocialAuthRegion;
    mainlandProviders?: SocialAuthProviderAdmin[];
    intlProviders?: SocialAuthProviderAdmin[];
    providers?: Record<string, SocialAuthProviderAdmin>;
    cnCount?: number;
    intlCount?: number;
    onlineCount?: number;
    updatedAt?: string;
}

export interface ProviderUpdateInput {
    enabled?: boolean;
    clientId?: string;
    clientSecret?: string;
    callbackUrl?: string;
    sandboxMockEnabled?: boolean;
}

export interface UpdateSettingsRequest {
    defaultFallbackRegion?: SocialAuthRegion;
    providers?: Record<string, ProviderUpdateInput>;
}

export interface ProviderTestResult {
    provider: string;
    status: "ok" | "degraded" | "error";
    message: string;
    pingLatencyMs: number;
    testedAt: string;
}
