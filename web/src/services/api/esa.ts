import { apiClient, request } from "./request";

export interface ESASetting {
    enabled: boolean;
    accessKeyId: string;
    hasAccessKeySecret: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface ESASettingRequest {
    enabled?: boolean;
    accessKeyId?: string;
    accessKeySecret?: string;
}

export interface ESASiteInfo {
    siteId: string;
    siteName: string;
    status: string;
}

export interface ESATopSite {
    siteId: string;
    siteName: string;
    traffic: number;
}

export interface ESATimePoint {
    time: string;
    traffic: number;
    requests: number;
}

export interface ESAOverview {
    range: "today" | "yesterday" | "7d" | "30d" | string;
    siteId: string;
    configured: boolean;
    traffic: number;
    requests: number;
    securityRequests: number;
    pagesRequests: number;
    topSites: ESATopSite[];
    timeseries: ESATimePoint[];
    updatedAt: string;
    error?: string;
}

export interface ESATestConnectionResult {
    success: boolean;
    message: string;
    siteCount?: number;
    sites?: ESASiteInfo[];
}

export function getESASetting(signal?: AbortSignal) {
    return request<{ setting: ESASetting }>(apiClient.get("/admin/esa/settings", { signal }));
}

export function updateESASetting(req: ESASettingRequest) {
    return request<{ setting: ESASetting }>(apiClient.patch("/admin/esa/settings", req));
}

export function testESAConnection(req?: ESASettingRequest) {
    return request<ESATestConnectionResult>(apiClient.post("/admin/esa/test-connection", req || {}));
}

export function getESASites(signal?: AbortSignal) {
    return request<{ sites: ESASiteInfo[] }>(apiClient.get("/admin/esa/sites", { signal }));
}

export function getESAOverview(rangeKey = "today", siteId = "all", refresh = false, signal?: AbortSignal) {
    const params = new URLSearchParams();
    params.set("range", rangeKey);
    params.set("siteId", siteId);
    if (refresh) params.set("refresh", "true");
    return request<ESAOverview>(apiClient.get(`/admin/esa/overview?${params.toString()}`, { signal }));
}
