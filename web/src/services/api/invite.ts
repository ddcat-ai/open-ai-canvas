import { compactApiParams, http } from "@/services/api/request";

export type InviteRewardScope = "product";
export type WithdrawMethod = "wechat" | "alipay" | "bank";

export type InviteItemRate = {
    l1RateBp?: number;
    l2RateBp?: number;
};

export type InvitePolicy = {
    enabled: boolean;
    level: 1 | 2;
    rewardScopes: InviteRewardScope[];
    l1RateBp: number;
    l2RateBp: number;
    rewardCountLimit: number;
    inviteeCountLimit: number;
    auditEnabled: boolean;
    withdrawEnabled: boolean;
    withdrawMinFen: number;
    withdrawDailyLimit: number;
    withdrawFeeBp: number;
    withdrawMethods: WithdrawMethod[];
    transferEnabled: boolean;
    transferRateMilli: number;
    transferMinFen: number;
    productRates?: Record<string, InviteItemRate>;
};

export type PublicInvitePolicy = {
    enabled: boolean;
    level: number;
    rewardScopes: InviteRewardScope[];
    l1RateBp: number;
    l2RateBp: number;
    auditEnabled: boolean;
    withdrawEnabled: boolean;
    withdrawMinFen: number;
    withdrawDailyLimit: number;
    withdrawFeeBp: number;
    withdrawMethods: WithdrawMethod[];
    transferEnabled: boolean;
    transferRateMilli: number;
    transferMinFen: number;
};

export type RewardAccountSummary = {
    totalMicroYuan: number;
    availableMicroYuan: number;
    frozenMicroYuan: number;
    usedMicroYuan: number;
    todayRewardMicroYuan: number;
};

export type InviteOverview = {
    policy: PublicInvitePolicy;
    account: RewardAccountSummary;
    inviteCode: string;
    invitedBy?: { l1Username: string; l2Username: string };
    inviteeCount: number;
};

export type UserInviteRecord = {
    userId: string;
    l1InviterId: string;
    l2InviterId: string;
    codeUsed: string;
    status: "pending" | "approved" | "frozen";
    createdAt: string;
    myLevel: number;
    inviteeUsername: string;
    inviteeDisplayName: string;
    myCreditedMicroYuan: number;
    myPendingMicroYuan: number;
};

export type InviteRecordsPage = {
    records: UserInviteRecord[];
    total: number;
    page: number;
    pageSize: number;
};

export type WithdrawRecord = {
    id: string;
    userId: string;
    amountMicroYuan: number;
    feeMicroYuan: number;
    actualMicroYuan: number;
    method: WithdrawMethod;
    status: 0 | 1 | 2;
    rejectReason: string;
    reviewedAt?: string | null;
    createdAt: string;
};

export type WithdrawAccountInfo = {
    account?: string;
    realName?: string;
    qrCodeUrl?: string;
    bankName?: string;
    cardNumber?: string;
    holderName?: string;
};

export type SavedWithdrawAccount = {
    method: WithdrawMethod;
    info: WithdrawAccountInfo;
};

export type TransferRecord = {
    id: string;
    userId: string;
    amountMicroYuan: number;
    rateMilli: number;
    creditsMicrocredits: number;
    createdAt: string;
};

export type Paged<T> = { records: T[]; total: number; page: number; pageSize: number };

// ===== 用户端 =====

export function getInvitePolicy(signal?: AbortSignal) {
    return http.get<{ policy: PublicInvitePolicy }>("/invites/policy", { signal });
}

export function getInviteOverview(signal?: AbortSignal) {
    return http.get<InviteOverview>("/invites/me/overview", { signal });
}

export function listMyInviteRecords(page: number, pageSize: number, signal?: AbortSignal) {
    return http.get<InviteRecordsPage>("/invites/me/records", { params: compactApiParams({ page, pageSize }), signal });
}

export function listMyWithdrawals(page: number, pageSize: number, signal?: AbortSignal) {
    return http.get<Paged<WithdrawRecord>>("/invites/me/withdrawals", { params: compactApiParams({ page, pageSize }), signal });
}

export function createWithdrawal(input: { amountFen: number; method: WithdrawMethod; account: WithdrawAccountInfo; saveAccount: boolean }) {
    return http.post<{ request: WithdrawRecord }>("/invites/me/withdrawals", input);
}

export function getMyWithdrawAccount(signal?: AbortSignal) {
    return http.get<{ account: SavedWithdrawAccount | null }>("/invites/me/withdraw-account", { signal });
}

export function saveMyWithdrawAccount(input: SavedWithdrawAccount) {
    return http.put<{ saved: boolean }>("/invites/me/withdraw-account", input);
}

export function listMyTransfers(page: number, pageSize: number, signal?: AbortSignal) {
    return http.get<Paged<TransferRecord>>("/invites/me/transfers", { params: compactApiParams({ page, pageSize }), signal });
}

export function createTransfer(input: { amountFen: number }) {
    return http.post<{ record: TransferRecord; account: { availableMicrocredits: number } }>("/invites/me/transfers", input);
}

// ===== 管理端 =====

export type InviteSetting = InvitePolicy & {
    updatedBy: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminInviteRecord = {
    userId: string;
    l1InviterId: string;
    l2InviterId: string;
    codeUsed: string;
    status: "pending" | "approved" | "frozen";
    createdAt: string;
    inviteeUsername: string;
    inviteeDisplayName: string;
    l1Username: string;
    l2Username: string;
    creditedMicroYuan: number;
    pendingMicroYuan: number;
};

export type AdminInviteDetail = {
    record: AdminInviteRecord;
    invitee: AdminInvitePerson | null;
    l1Inviter: AdminInvitePerson | null;
    l2Inviter: AdminInvitePerson | null;
    rewardRecords: InviteRewardRecord[];
};

export type AdminInvitePerson = {
    id: string;
    username: string;
    displayName: string;
};

export type InviteRewardRecord = {
    id: string;
    inviterId: string;
    inviteeId: string;
    level: number;
    source: InviteRewardScope;
    paymentOrderId: string;
    orderAmountFen: number;
    rateBp: number;
    amountMicroYuan: number;
    status: "pending" | "credited" | "voided";
    createdAt: string;
    creditedAt?: string | null;
};

export type AdminWithdrawRecord = WithdrawRecord & {
    username: string;
    displayName: string;
};

export type AdminWithdrawDetail = {
    record: AdminWithdrawRecord;
    account: WithdrawAccountInfo | null;
};

export function getAdminInviteSetting(signal?: AbortSignal) {
    return http.get<{ setting: InviteSetting }>("/admin/settings/invite", { signal });
}

export function updateAdminInviteSetting(policy: InvitePolicy) {
    return http.patch<{ setting: InviteSetting }>("/admin/settings/invite", policy);
}

export function listAdminInvites(params: { status?: string; keyword?: string; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<Paged<AdminInviteRecord>>("/admin/invites", { params: compactApiParams(params), signal });
}

export function getAdminInviteDetail(userId: string, signal?: AbortSignal) {
    return http.get<AdminInviteDetail>(`/admin/invites/${encodeURIComponent(userId)}`, { signal });
}

export function approveAdminInvite(userId: string) {
    return http.post<{ record: { status: string } }>(`/admin/invites/${encodeURIComponent(userId)}/approve`);
}

export function freezeAdminInvite(userId: string) {
    return http.post<{ record: { status: string } }>(`/admin/invites/${encodeURIComponent(userId)}/freeze`);
}

export function updateAdminInviteInviters(userId: string, input: { l1InviterId: string; l2InviterId: string }) {
    return http.patch<{ record: { status: string } }>(`/admin/invites/${encodeURIComponent(userId)}`, input);
}

export function deleteAdminInvite(userId: string) {
    return http.delete<{ deleted: boolean }>(`/admin/invites/${encodeURIComponent(userId)}`);
}

export function listAdminWithdrawals(params: { status?: number | ""; method?: string; keyword?: string; from?: string; until?: string; page?: number; pageSize?: number }, signal?: AbortSignal) {
    return http.get<Paged<AdminWithdrawRecord>>("/admin/withdrawals", { params: compactApiParams(params), signal });
}

export function getAdminWithdrawalDetail(id: string, signal?: AbortSignal) {
    return http.get<AdminWithdrawDetail>(`/admin/withdrawals/${encodeURIComponent(id)}`, { signal });
}

export function approveAdminWithdrawal(id: string) {
    return http.post<{ request: WithdrawRecord }>(`/admin/withdrawals/${encodeURIComponent(id)}/approve`);
}

export function rejectAdminWithdrawal(id: string, reason: string) {
    return http.post<{ request: WithdrawRecord }>(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, { reason });
}
