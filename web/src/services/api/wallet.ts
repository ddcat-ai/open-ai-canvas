import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

type BackendEnvelope<T> = { code: number; data: T; msg: string };

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    try {
        const response = await promise;
        if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
        return response.data.data;
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) throw new Error(error.response?.data?.msg || error.message || "请求失败");
        throw error;
    }
}

export type CreditAccount = {
    userId: string;
    availableMicrocredits: number;
    reservedMicrocredits: number;
    version: number;
    createdAt: string;
    updatedAt: string;
};

export type CreditLedgerEntry = {
    id: string;
    userId: string;
    type: "redeem" | "admin_grant" | "consume" | "refund" | "admin_adjustment" | "signup_bonus" | "checkin_bonus";
    amountMicrocredits: number;
    availableAfterMicrocredits: number;
    reservedAfterMicrocredits: number;
    billingOrderId?: string;
    model?: string;
    channelId?: string;
    scene?: string;
    note?: string;
    createdAt: string;
};

export type WalletSummary = {
    account: CreditAccount;
    entries: CreditLedgerEntry[];
    total: number;
    page: number;
    limit: number;
    policy: {
        signupBonusMicrocredits: number;
        checkinBonusMicrocredits: number;
        checkedInToday: boolean;
    };
};

export type CreditPolicy = {
    signupBonusMicrocredits: number;
    checkinBonusMicrocredits: number;
    defaultMultiplierBasisPoints: number;
    modelMultiplierBasisPoints: Record<string, number>;
};

export type ChannelModel = {
    id: string;
    channelId: string;
    modelKey: string;
    displayName: string;
    capability: "text" | "image" | "video" | "audio";
    billingMode: "fixed_request";
    unitPriceMicrocredits: number;
    priceConfigured: boolean;
    enabled: boolean;
    priceVersion: number;
    createdAt: string;
    updatedAt: string;
};

export type LinuxDOSetting = {
    enabled: boolean;
    clientId: string;
    clientSecret?: string;
    hasClientSecret: boolean;
    authorizationUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    redirectUrl: string;
    scopes: string[];
    clientAuthMethod: "client_secret_post" | "client_secret_basic";
    subjectField: string;
    usernameField: string;
    displayNameField: string;
    emailField: string;
    avatarField: string;
    updatedAt?: string;
};

export type RegistrationSetting = {
    enabled: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type EmailSetting = {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password?: string;
    encryption: "starttls" | "tls" | "none";
    fromEmail: string;
    fromName: string;
    hasPassword: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RedeemBatch = {
    id: string;
    amountMicrocredits: number;
    count: number;
    note?: string;
    createdBy: string;
    expiresAt?: string;
    createdAt: string;
    availableCount: number;
    redeemedCount: number;
    disabledCount: number;
    expiredCount: number;
};

export type AdminRedeemCode = {
    id: string;
    code?: string;
    codeSuffix: string;
    status: "unused" | "redeemed" | "disabled" | "expired";
    redeemedBy?: string;
    redeemedUsername?: string;
    redeemedDisplayName?: string;
    redeemedAt?: string;
    redeemedIp?: string;
    expiresAt?: string;
    amountMicrocredits: number;
};

export type AdminRedeemCodePage = {
    batch: RedeemBatch;
    codes: AdminRedeemCode[];
    plaintextAvailable: boolean;
    total: number;
    page: number;
    limit: number;
};

export type BillingOrder = {
    id: string;
    userId: string;
    taskId?: string;
    channelId: string;
    model: string;
    capability: string;
    scene: string;
    amountMicrocredits: number;
    status: "reserved" | "running" | "settled" | "refunded" | "uncertain";
    providerRequestId?: string;
    error?: string;
    resolvedBy?: string;
    resolutionNote?: string;
    createdAt: string;
    updatedAt: string;
};

export function getWallet(page = 1, limit = 30, type = "all") {
    return request<WalletSummary>(api.get("/wallet", { params: { type, page, limit } }));
}

export function redeemCredits(code: string) {
    return request<{ account: CreditAccount }>(api.post("/wallet/redeem", { code }));
}

export function checkinCredits() {
    return request<{ account: CreditAccount; granted: boolean }>(api.post("/wallet/checkin"));
}

export function getAdminCreditPolicy() {
    return request<{ policy: CreditPolicy }>(api.get("/admin/settings/credits"));
}

export function updateAdminCreditPolicy(policy: CreditPolicy) {
    return request<{ policy: CreditPolicy }>(api.patch("/admin/settings/credits", policy));
}

export function getAdminLinuxDOSetting() {
    return request<{ setting: LinuxDOSetting }>(api.get("/admin/settings/linuxdo"));
}

export function updateAdminLinuxDOSetting(input: Partial<LinuxDOSetting>) {
    return request<{ setting: LinuxDOSetting }>(api.patch("/admin/settings/linuxdo", input));
}

export function getAdminRegistrationSetting() {
    return request<{ setting: RegistrationSetting }>(api.get("/admin/settings/registration"));
}

export function updateAdminRegistrationSetting(enabled: boolean) {
    return request<{ setting: RegistrationSetting }>(api.patch("/admin/settings/registration", { enabled }));
}

export function getAdminEmailSetting() {
    return request<{ setting: EmailSetting }>(api.get("/admin/settings/email"));
}

export function updateAdminEmailSetting(input: Partial<EmailSetting>) {
    return request<{ setting: EmailSetting }>(api.patch("/admin/settings/email", input));
}

export function listAdminChannelModels(channelId: string) {
    return request<{ models: ChannelModel[] }>(api.get(`/admin/channels/${encodeURIComponent(channelId)}/models`));
}

// 管理员从上游拉取模型目录；服务端只导入缺失项，价格和启用仍需人工确认。
export function fetchAdminChannelModels(channelId: string) {
    return request<{ models: string[]; added: number }>(api.post(`/admin/channels/${encodeURIComponent(channelId)}/models/fetch`));
}

export function createAdminChannelModel(channelId: string, input: Omit<ChannelModel, "id" | "channelId" | "priceVersion" | "createdAt" | "updatedAt">) {
    return request<{ model: ChannelModel }>(api.post(`/admin/channels/${encodeURIComponent(channelId)}/models`, input));
}

export function updateAdminChannelModel(channelId: string, id: string, input: Omit<ChannelModel, "id" | "channelId" | "priceVersion" | "createdAt" | "updatedAt">) {
    return request<{ model: ChannelModel }>(api.patch(`/admin/channels/${encodeURIComponent(channelId)}/models/${encodeURIComponent(id)}`, input));
}

export function disableAdminChannelModel(channelId: string, id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/channels/${encodeURIComponent(channelId)}/models/${encodeURIComponent(id)}`));
}

export type AdminFinanceListParams = { keyword?: string; status?: string; validity?: string; page?: number; limit?: number };

export function listAdminRedeemBatches(params: AdminFinanceListParams = {}) {
    return request<{ batches: RedeemBatch[]; total: number; page: number; limit: number }>(api.get("/admin/redeem-batches", { params }));
}

export function createAdminRedeemBatch(input: { amountMicrocredits: number; count: number; note?: string; expiresAt?: string }) {
    return request<{ batch: RedeemBatch; codes: string[] }>(api.post("/admin/redeem-batches", input, { timeout: 30_000 }));
}

export function listAdminRedeemBatchCodes(batchId: string, params: { status?: string; page?: number; limit?: number } = {}) {
    return request<AdminRedeemCodePage>(api.get(`/admin/redeem-batches/${encodeURIComponent(batchId)}/codes`, { params }));
}

export function disableAdminRedeemBatch(batchId: string) {
    return request<{ disabledCount: number }>(api.post(`/admin/redeem-batches/${encodeURIComponent(batchId)}/disable`));
}

export function disableAdminRedeemCode(batchId: string, codeId: string) {
    return request<{ ok: boolean }>(api.post(`/admin/redeem-batches/${encodeURIComponent(batchId)}/codes/${encodeURIComponent(codeId)}/disable`));
}

export function adjustAdminUserCredits(userId: string, input: { amountMicrocredits: number; note: string }) {
    return request<{ account: CreditAccount }>(api.post(`/admin/users/${encodeURIComponent(userId)}/credits/adjust`, input));
}

export function listAdminBillingOrders(params: AdminFinanceListParams = {}) {
    return request<{ orders: BillingOrder[]; total: number; page: number; limit: number }>(api.get("/admin/billing-orders", { params }));
}

export function resolveAdminBillingOrder(id: string, input: { action: "settle" | "refund"; note: string }) {
    return request<{ order: BillingOrder }>(api.post(`/admin/billing-orders/${encodeURIComponent(id)}/resolve`, input));
}
