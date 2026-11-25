import { http } from "@/services/api/request";
import type { AccountFileStorageUsage } from "@/services/api/resources";

export type UserStorageGrant = {
    id: string;
    userId: string;
    source: "payment" | "admin" | "redeem" | string;
    paymentOrderId?: string;
    productId?: string;
    productName?: string;
    bytes: number;
    durationDays: number;
    startsAt: string;
    /** 为空表示永久有效。 */
    expiresAt?: string;
    revokedAt?: string;
    revokedBy?: string;
    revokeReason?: string;
    note?: string;
    createdBy?: string;
    createdAt: string;
};

export function storageGrantSourceLabel(grant: Pick<UserStorageGrant, "source" | "productName">) {
    if (grant.source === "redeem") return "卡密兑换";
    if (grant.source === "admin") return "管理员赠送";
    return grant.productName || "在线购买";
}

export type AdminUserStorage = {
    usage: AccountFileStorageUsage;
    grants: UserStorageGrant[];
};

export function listMyStorageGrants() {
    return http.get<{ grants: UserStorageGrant[] }>("/resources/storage-grants");
}

export function getAdminUserStorage(userId: string) {
    return http.get<AdminUserStorage>(`/admin/users/${encodeURIComponent(userId)}/storage`);
}

export function grantAdminUserStorage(userId: string, input: { bytes: number; durationDays: number; note?: string }) {
    return http.post<{ grant: UserStorageGrant }>(`/admin/users/${encodeURIComponent(userId)}/storage-grants`, input);
}

export function revokeAdminStorageGrant(grantId: string, reason: string) {
    return http.post<{ grant: UserStorageGrant }>(`/admin/storage-grants/${encodeURIComponent(grantId)}/revoke`, { reason });
}

export function storageGrantActive(grant: UserStorageGrant, now = Date.now()) {
    if (grant.revokedAt) return false;
    if (new Date(grant.startsAt).getTime() > now) return false;
    return !grant.expiresAt || new Date(grant.expiresAt).getTime() > now;
}
