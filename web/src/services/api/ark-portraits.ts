import { apiBaseURL, compactApiParams, http } from "@/services/api/request";

/** real 真人人像（H5 认证生成）、virtual 虚拟人像、ip 版权 IP（仅管理员创建并授权）。 */
export type ArkGroupKind = "real" | "virtual" | "ip";
/** user 为用户自建、只属于本人；platform 为管理员创建、按授权只读使用。 */
export type ArkGroupScope = "user" | "platform";
export type ArkAssetStatus = "pending_review" | "rejected" | "processing" | "active" | "failed";
export type ArkExpiryStatus = "none" | "valid" | "expiring" | "expired";

export type ArkUserSummary = { id: string; username: string; displayName: string };

/** 素材组内的一份素材；active 后可用 asset://arkAssetId 参与视频生成。 */
export type ArkPortraitAsset = {
    id: string;
    groupId: string;
    resourceId: string;
    arkAssetId: string;
    assetType: "Image" | "Video" | "Audio" | string;
    name: string;
    status: ArkAssetStatus | string;
    error?: string;
    libraryAssetId?: string;
    inLibrary: boolean;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
    reviewedAt?: string;
    createdAt: string;
    uploader?: ArkUserSummary;
    group?: { id: string; name: string; kind: ArkGroupKind; scope: ArkGroupScope };
};

/** available=false 表示管理员已更换站点、Region 或项目；expiresAt 只有真人组有。 */
export type ArkPortraitGroup = {
    id: string;
    name: string;
    description: string;
    kind: ArkGroupKind;
    scope: ArkGroupScope;
    source: "liveness" | "created" | "manual" | string;
    groupId: string;
    owned: boolean;
    available: boolean;
    authorizedAt?: string;
    expiresAt?: string;
    expiryStatus: ArkExpiryStatus;
    createdAt: string;
    assets: ArkPortraitAsset[];
    owner?: ArkUserSummary;
    grantAll: boolean;
    grantUsers?: ArkUserSummary[];
    assetCounts?: Partial<Record<ArkAssetStatus, number>>;
};

export type ArkPortraitSession = {
    id: string;
    name: string;
    scope: ArkGroupScope;
    status: "pending" | "verified" | "failed" | "expired" | "cancelled" | string;
    /** 仅发起时返回，内含方舟临时凭据，不落本地存储。 */
    h5Link?: string;
    /** 认证成功后为方舟素材组 ID（group-…）。 */
    groupId?: string;
    error?: string;
    reservedMicrocredits: number;
    expiresAt: string;
};

export type ArkAssetConfig = {
    realEnabled: boolean;
    virtualEnabled: boolean;
    realGroupLimit: number;
    virtualGroupLimit: number;
    /** 已叠加平台积分开关的实际收费状态。 */
    billingEnabled: boolean;
    realGroupPriceMicrocredits: number;
    virtualGroupPriceMicrocredits: number;
    realReviewRequired: boolean;
    virtualReviewRequired: boolean;
    realAuthorizationDays: number;
};

export type ArkPortraitOverview = {
    enabled: boolean;
    site?: "volcengine" | "byteplus" | string;
    config: ArkAssetConfig;
    usage: { real: number; virtual: number };
    groups: ArkPortraitGroup[];
    sessions: ArkPortraitSession[];
};

export const arkPortraitOverviewQueryKey = ["ark-portraits"] as const;

export function getArkPortraitOverview(signal?: AbortSignal) {
    return http.get<ArkPortraitOverview>("/ark-portraits", { signal });
}

export function createArkPortraitSession(input: { name: string; lang: string }) {
    return http.post<{ session: ArkPortraitSession }>("/ark-portraits/sessions", input);
}

/** 只读本地会话状态（回调结果），不调用方舟；用于电脑端轮询。 */
export function getArkPortraitSession(id: string, signal?: AbortSignal) {
    return http.get<{ session: ArkPortraitSession }>(`/ark-portraits/sessions/${encodeURIComponent(id)}`, { signal });
}

/** 回调未到达时主动向方舟查询认证结果。 */
export function checkArkPortraitSession(id: string) {
    return http.post<{ session: ArkPortraitSession }>(`/ark-portraits/sessions/${encodeURIComponent(id)}/check`);
}

export function cancelArkPortraitSession(id: string) {
    return http.post<{ session: ArkPortraitSession }>(`/ark-portraits/sessions/${encodeURIComponent(id)}/cancel`);
}

export function createArkVirtualGroup(input: { name: string; description?: string }) {
    return http.post<{ group: ArkPortraitGroup }>("/ark-portraits/groups", { kind: "virtual", ...input });
}

export function updateArkGroup(id: string, input: { name: string; description: string }) {
    return http.patch<{ group: ArkPortraitGroup }>(`/ark-portraits/groups/${encodeURIComponent(id)}`, input);
}

export function deleteArkGroup(id: string) {
    return http.delete<{ id: string }>(`/ark-portraits/groups/${encodeURIComponent(id)}`);
}

/** libraryAssetId 非空表示从素材库提交认证，通过后原素材移入「方舟认证」分类。 */
export function createArkPortraitAsset(groupId: string, input: { resourceId: string; name?: string; libraryAssetId?: string }) {
    return http.post<{ asset: ArkPortraitAsset }>(`/ark-portraits/groups/${encodeURIComponent(groupId)}/assets`, input);
}

export function refreshArkPortraitAsset(id: string) {
    return http.post<{ asset: ArkPortraitAsset }>(`/ark-portraits/assets/${encodeURIComponent(id)}/refresh`);
}

export function deleteArkPortraitAsset(id: string) {
    return http.delete<{ id: string }>(`/ark-portraits/assets/${encodeURIComponent(id)}`);
}

/** 把已通过的图片加入素材库「方舟认证」分类，返回素材库素材 ID；平台素材会复制成本人资源。 */
export function addArkPortraitAssetToLibrary(id: string) {
    return http.post<{ assetId: string }>(`/ark-portraits/assets/${encodeURIComponent(id)}/library`);
}

/** 素材预览地址：上传者、被授权用户与管理员可访问，平台素材不暴露上传者的资源。 */
export function arkPortraitAssetFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/ark-portraits/assets/${encodeURIComponent(id)}/file`;
}

export type AdminArkGroupStats = { real: number; virtual: number; ip: number; expiring: number; expired: number };

export type AdminArkGroupPage = {
    items: ArkPortraitGroup[];
    total: number;
    page: number;
    pageSize: number;
    stats: AdminArkGroupStats;
    pendingReview: number;
    sessions: ArkPortraitSession[];
};

export type AdminArkGroupQuery = { kind?: ArkGroupKind; scope?: ArkGroupScope; expiry?: Exclude<ArkExpiryStatus, "none">; keyword?: string; page: number; pageSize: number };

export function listAdminArkGroups(query: AdminArkGroupQuery, signal?: AbortSignal) {
    return http.get<AdminArkGroupPage>("/admin/ark-portraits/groups", { params: compactApiParams(query), signal });
}

export function getAdminArkGroup(id: string, signal?: AbortSignal) {
    return http.get<{ group: ArkPortraitGroup }>(`/admin/ark-portraits/groups/${encodeURIComponent(id)}`, { signal });
}

/** groupId 为空时在方舟新建（虚拟 / 版权 IP）；非空时登记控制台已有的素材组。 */
export function createAdminArkGroup(input: { kind: ArkGroupKind; name: string; description?: string; groupId?: string; grantAll: boolean; grantUserIds: string[] }) {
    return http.post<{ group: ArkPortraitGroup }>("/admin/ark-portraits/groups", input);
}

export function updateAdminArkGroup(id: string, input: { name?: string; description?: string; grantAll?: boolean; grantUserIds?: string[]; expiresAt?: string }) {
    return http.patch<{ group: ArkPortraitGroup }>(`/admin/ark-portraits/groups/${encodeURIComponent(id)}`, input);
}

export function deleteAdminArkGroup(id: string) {
    return http.delete<{ id: string }>(`/admin/ark-portraits/groups/${encodeURIComponent(id)}`);
}

export function createAdminArkAsset(groupId: string, input: { resourceId: string; name?: string }) {
    return http.post<{ asset: ArkPortraitAsset }>(`/admin/ark-portraits/groups/${encodeURIComponent(groupId)}/assets`, input);
}

export function deleteAdminArkAsset(id: string) {
    return http.delete<{ id: string }>(`/admin/ark-portraits/assets/${encodeURIComponent(id)}`);
}

/** 管理员为平台真人素材组发起 H5 认证；不收费。 */
export function createAdminArkSession(input: { name: string; description?: string; lang: string }) {
    return http.post<{ session: ArkPortraitSession }>("/admin/ark-portraits/sessions", input);
}

export type AdminArkReviewPage = { items: ArkPortraitAsset[]; total: number; page: number; pageSize: number };
export type AdminArkReviewResult = { succeeded: string[]; failed: Array<{ id: string; error: string }> };

export function listAdminArkReviews(query: { status?: "pending_review" | "rejected"; page: number; pageSize: number }, signal?: AbortSignal) {
    return http.get<AdminArkReviewPage>("/admin/ark-portraits/reviews", { params: compactApiParams(query), signal });
}

export function approveAdminArkAssets(ids: string[]) {
    return http.post<AdminArkReviewResult>("/admin/ark-portraits/reviews/approve", { ids });
}

export function rejectAdminArkAssets(ids: string[], reason: string) {
    return http.post<AdminArkReviewResult>("/admin/ark-portraits/reviews/reject", { ids, reason });
}
