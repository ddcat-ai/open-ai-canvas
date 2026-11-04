import { http } from "@/services/api/request";

/** 方舟真人素材组内的一份素材；active 后可用 asset://arkAssetId 参与视频生成。 */
export type ArkPortraitAsset = {
    id: string;
    groupId: string;
    resourceId: string;
    arkAssetId: string;
    assetType: "Image" | "Video" | "Audio" | string;
    name: string;
    status: "processing" | "active" | "failed" | string;
    error?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
    createdAt: string;
};

/** 一位真人对应一个素材组；available=false 表示管理员已更换站点、Region 或项目。 */
export type ArkPortraitGroup = {
    id: string;
    name: string;
    groupId: string;
    source: "liveness" | "manual" | string;
    available: boolean;
    createdAt: string;
    assets: ArkPortraitAsset[];
};

export type ArkPortraitSession = {
    id: string;
    name: string;
    status: "pending" | "verified" | "failed" | "expired" | string;
    /** 仅发起时返回，内含方舟临时凭据，不落本地存储。 */
    h5Link?: string;
    groupId?: string;
    error?: string;
    expiresAt: string;
};

export type ArkPortraitOverview = {
    enabled: boolean;
    site?: "volcengine" | "byteplus" | string;
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

export function checkArkPortraitSession(id: string) {
    return http.post<{ session: ArkPortraitSession }>(`/ark-portraits/sessions/${encodeURIComponent(id)}/check`);
}

/** 管理员登记在方舟控制台扫码授权创建的素材组。 */
export function bindArkPortraitGroup(input: { name: string; groupId: string }) {
    return http.post<{ group: ArkPortraitGroup }>("/ark-portraits/groups", input);
}

export function renameArkPortraitGroup(id: string, name: string) {
    return http.patch<{ group: ArkPortraitGroup }>(`/ark-portraits/groups/${encodeURIComponent(id)}`, { name });
}

export function deleteArkPortraitGroup(id: string) {
    return http.delete<{ id: string }>(`/ark-portraits/groups/${encodeURIComponent(id)}`);
}

export function createArkPortraitAsset(groupId: string, input: { resourceId: string; name?: string }) {
    return http.post<{ asset: ArkPortraitAsset }>(`/ark-portraits/groups/${encodeURIComponent(groupId)}/assets`, input);
}

export function refreshArkPortraitAsset(id: string) {
    return http.post<{ asset: ArkPortraitAsset }>(`/ark-portraits/assets/${encodeURIComponent(id)}/refresh`);
}

export function deleteArkPortraitAsset(id: string) {
    return http.delete<{ id: string }>(`/ark-portraits/assets/${encodeURIComponent(id)}`);
}
