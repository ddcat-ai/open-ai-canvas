import { http } from "@/services/api/request";

// 推广中心所有金额字段的单位都是微积分（1 积分 = 1_000_000 微积分），
// 展示统一走 formatCredits，避免各页面各算一套。
export type PromotionOverview = {
    enabled: boolean;
    inviteCode: string;
    ratioBasisPoints: number;
    freezeDays: number;
    invitedCount: number;
    frozenMicrocredits: number;
    availableMicrocredits: number;
    reviewMicrocredits: number;
    transferredMicrocredits: number;
    withdrawnMicrocredits: number;
    totalMicrocredits: number;
    unfrozenMicrocredits: number;
    minWithdrawalMicrocredits: number;
};

export type PromotionInvitationItem = {
    id: string;
    inviteeId: string;
    inviteeName: string;
    inviteeContact: string;
    source: "link" | "code" | "manual" | string;
    contributedMicrocredits: number;
    commissionMicrocredits: number;
    createdAt: string;
};

export type PromotionInvitationPage = {
    items: PromotionInvitationItem[];
    total: number;
    page: number;
    limit: number;
};

export type PromotionCommissionStatus = "frozen" | "available" | "transferred" | "withdrawing" | "withdrawn";

export type PromotionCommissionRecord = {
    id: string;
    inviterId: string;
    inviteeId: string;
    sourceType: string;
    sourceId: string;
    baseMicrocredits: number;
    ratioBasisPoints: number;
    amountMicrocredits: number;
    status: PromotionCommissionStatus;
    availableAt: string;
    withdrawalId?: string;
    createdAt: string;
};

export type PromotionCommissionPage = {
    items: PromotionCommissionRecord[];
    total: number;
    page: number;
    limit: number;
};

export type PromotionWithdrawalStatus = "pending" | "approved" | "rejected";

export type PromotionWithdrawal = {
    id: string;
    userId: string;
    amountMicrocredits: number;
    channel: "alipay" | "wechat" | "bank" | string;
    account: string;
    accountName: string;
    status: PromotionWithdrawalStatus;
    reviewNote?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PromotionWithdrawalPage = {
    items: PromotionWithdrawal[];
    total: number;
    page: number;
    limit: number;
};

export type PromotionPolicy = {
    ratioBasisPoints: number;
    freezeDays: number;
    minWithdrawalMicrocredits: number;
};

export function getPromotionOverview() {
    return http.get<{ overview: PromotionOverview }>("/promotion/overview");
}

// 注册页未登录时使用：返回推广是否开放，并按需校验邀请码是否真实存在。
export function getPublicPromotionStatus(code?: string) {
    return http.get<{ enabled: boolean; inviteCodeValid: boolean }>("/public/promotion-status", {
        params: code ? { code } : undefined,
    });
}

export function listPromotionInvitations(params: { page?: number; pageSize?: number } = {}) {
    return http.get<PromotionInvitationPage>("/promotion/invitations", { params });
}

export function listPromotionCommissions(params: { status?: string; page?: number; pageSize?: number } = {}) {
    return http.get<PromotionCommissionPage>("/promotion/commissions", { params });
}

export function transferPromotionCommission(input: { amountMicrocredits: number; requestId: string }) {
    return http.post<{ account: { availableMicrocredits: number } }>("/promotion/transfer", input);
}

export function listPromotionWithdrawals(params: { page?: number; pageSize?: number } = {}) {
    return http.get<PromotionWithdrawalPage>("/promotion/withdrawals", { params });
}

export function createPromotionWithdrawal(input: { amountMicrocredits: number; channel: string; account: string; accountName?: string }) {
    return http.post<{ request: PromotionWithdrawal }>("/promotion/withdrawals", input);
}

export function getAdminPromotionPolicy() {
    return http.get<{ policy: PromotionPolicy }>("/admin/promotion/policy");
}

export function updateAdminPromotionPolicy(policy: PromotionPolicy) {
    return http.patch<{ policy: PromotionPolicy }>("/admin/promotion/policy", policy);
}

export function listAdminPromotionWithdrawals(params: { status?: string; page?: number; pageSize?: number } = {}) {
    return http.get<PromotionWithdrawalPage>("/admin/promotion/withdrawals", { params });
}

export function reviewAdminPromotionWithdrawal(id: string, input: { approve: boolean; note?: string }) {
    return http.post<{ request: PromotionWithdrawal }>(`/admin/promotion/withdrawals/${encodeURIComponent(id)}/review`, input);
}
