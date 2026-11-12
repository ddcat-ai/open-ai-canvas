import { compactApiParams, http } from "@/services/api/request";

export type OfficialAssetRecommendationStatus = "pending" | "approved" | "rejected" | "changes_requested";

export type OfficialAssetRecommendation = {
    id: string;
    assetId: string;
    submitterId: string;
    title: string;
    note: string;
    consentVersion?: string;
    consentAt?: string;
    status: OfficialAssetRecommendationStatus;
    reviewerId?: string;
    reviewerNote?: string;
    officialAssetId?: string;
    reviewedAt?: string;
    createdAt: string;
    updatedAt: string;
    assetKind?: string;
    assetTitle?: string;
    assetDescription?: string;
    assetTags?: string[];
    assetCategory?: string;
    assetResourceId?: string;
    assetPreviewUrl?: string;
    characterSnapshotSource?: "submitted" | "current";
    characterSnapshot?: { versionId?: string; version?: number; definition: Record<string, unknown>; images: Array<{ resourceId?: string; role?: string }>; representations?: Array<{ id?: string; resourceId?: string; mediaType?: string; role?: string; status?: string; failureReason?: string }>; voice?: { profile: { name: string; language: string; timbre: string; sampleResourceId?: string }; instructions?: string }; visualStatus?: string; voiceStatus?: string; partialReasons?: string[] };
};

export type OfficialAssetRecommendationPage = {
    items: OfficialAssetRecommendation[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
};

export async function createOfficialAssetRecommendation(body: { assetId: string; note?: string; consentVersion: string }) {
    const policy = await http.get<{ version: string }>("/official-asset-recommendations/consent-policy");
    if (policy.version !== body.consentVersion) throw new Error("素材授权服务尚未更新，请联系管理员");
    return http.post<OfficialAssetRecommendation>("/official-asset-recommendations", body);
}

export async function fetchAdminOfficialAssetRecommendations(params: { status?: OfficialAssetRecommendationStatus | "all"; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<OfficialAssetRecommendationPage>("/admin/official-asset-recommendations", {
        params: compactApiParams({ status: params.status === "all" ? undefined : params.status, page: params.page, pageSize: params.pageSize }),
        signal,
    });
}

export async function reviewOfficialAssetRecommendation(id: string, body: {
    action: "approve" | "reject" | "changes_requested";
    reviewerNote?: string;
    title?: string;
    description?: string;
    category?: string;
    tags?: string[];
    sourceName?: string;
    sourceUrl?: string;
    licenseNote?: string;
    usageNote?: string;
}) {
    return http.patch<OfficialAssetRecommendation>(`/admin/official-asset-recommendations/${encodeURIComponent(id)}/review`, body);
}

export async function fetchAdminOfficialAssetRecommendation(id: string) {
    return http.get<OfficialAssetRecommendation>(`/admin/official-asset-recommendations/${encodeURIComponent(id)}`);
}

export async function resubmitOfficialAssetRecommendation(id: string, body: { note?: string; consentVersion: string }) {
    return http.post<OfficialAssetRecommendation>(`/official-asset-recommendations/${encodeURIComponent(id)}/resubmit`, body);
}
