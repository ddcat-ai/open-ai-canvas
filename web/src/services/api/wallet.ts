import { apiClient, request } from "@/services/api/request";

const api = apiClient;

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
    type: "redeem" | "recharge" | "admin_grant" | "consume" | "refund" | "admin_adjustment" | "signup_bonus" | "checkin_bonus";
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
    providerModelKey: string;
    displayName: string;
    icon: string;
    capability: "text" | "image" | "video" | "audio" | "";
    protocol?: import("@/lib/model-protocols").ModelProtocol;
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
    priceConfigured: boolean;
    enabled: boolean;
    priceVersion: number;
    capabilityVersion?: number;
    capabilityConfig?: import("@/lib/model-capabilities").ModelCapabilityConfig;
    priceTiers: ChannelModelPriceTier[];
    createdAt: string;
    updatedAt: string;
};

export type ChannelModelPriceTier = {
    id: string;
    channelModelId: string;
    selector: Record<string, string>;
    selectorKey: string;
    resolution: string;
    videoSeconds: number;
    providerModelKey: string;
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
    priceConfigured: boolean;
    enabled: boolean;
    priceVersion: number;
    createdAt: string;
    updatedAt: string;
};

// 系统渠道模型的写入合同。标量价格只用于兼容旧管理请求；新的后台界面只提交 priceTiers。
export type ChannelModelMutation = {
    modelKey: string;
    providerModelKey?: string;
    displayName?: string;
    icon?: string;
    capability: ChannelModel["capability"];
    protocol?: ChannelModel["protocol"];
    enabled?: boolean;
    capabilityConfig?: ChannelModel["capabilityConfig"];
    priceTiers?: Array<Omit<ChannelModelPriceTier, "id" | "channelModelId" | "selectorKey" | "priceVersion" | "createdAt" | "updatedAt">>;
    billingMode?: ChannelModel["billingMode"];
    unitPriceMicrocredits?: number;
    inputTokenPriceMicrocredits?: number;
    outputTokenPriceMicrocredits?: number;
    cachedTokenPriceMicrocredits?: number;
    priceConfigured?: boolean;
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
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
    multiplierBasisPoints: number;
    quantity: number;
    amountMicrocredits: number;
    reservedAmountMicrocredits: number;
    actualAmountMicrocredits: number;
    refundedAmountMicrocredits: number;
    inputTokenPriceMicrocredits: number;
    outputTokenPriceMicrocredits: number;
    cachedTokenPriceMicrocredits: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    usageAvailable: boolean;
    status: "reserved" | "running" | "settled" | "refunded" | "uncertain";
    providerRequestId?: string;
    error?: string;
    resolvedBy?: string;
    resolutionNote?: string;
    createdAt: string;
    updatedAt: string;
};

export type CreditPackage = {
    id: string;
    name: string;
    description?: string;
    currency: "CNY" | string;
    amountFen: number;
    baseMicrocredits: number;
    bonusMicrocredits: number;
    enabled: boolean;
    sortOrder: number;
    version: number;
    archivedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentChannel = {
    id: string;
    provider: string;
    method: string;
    name: string;
    description?: string;
    enabled: boolean;
    sortOrder: number;
    activeConfigVersionId?: string;
    activeConfigVersion?: number;
    configured?: boolean;
    lastTestStatus?: "passed" | "failed" | "";
    lastTestError?: string;
    lastTestConfigDigest?: string;
    lastTestedAt?: string;
    archivedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type RechargeCatalogChannel = Pick<PaymentChannel, "id" | "provider" | "method" | "name" | "description" | "sortOrder">;

export type PaymentProviderDescriptor = {
    code: string;
    name: string;
    methods: string[];
    configFields: Array<{ key: string; label: string; kind: "text" | "password" | "textarea"; required: boolean; secret: boolean; placeholder?: string }>;
};

export type RechargeOrderStatus = "created" | "prepay_running" | "awaiting_payment" | "prepay_uncertain" | "paid" | "credited" | "closed" | "failed" | "review_required";

export type RechargeOrder = {
    id: string;
    userId?: string;
    packageId: string;
    packageName: string;
    currency: string;
    amountFen: number;
    baseMicrocredits: number;
    bonusMicrocredits: number;
    totalMicrocredits: number;
    channelId: string;
    channelName: string;
    provider: string;
    method: string;
    status: RechargeOrderStatus;
    providerState?: string;
    providerTransactionId?: string;
    payPayload?: { type?: string; codeUrl?: string };
    expiresAt?: string;
    paidAt?: string;
    creditedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentReconciliationRun = {
    id: string;
    channelId: string;
    provider: string;
    tradeDate: string;
    status: "queued" | "running" | "succeeded" | "failed";
    providerOrderCount: number;
    providerAmountFen: number;
    localOrderCount: number;
    localAmountFen: number;
    anomalyCount: number;
    statementDigest?: string;
    error?: string;
    createdAt: string;
    completedAt?: string;
};

export type PaymentReconciliationAnomaly = {
    id: string;
    runId: string;
    orderId?: string;
    type: string;
    providerTransactionId?: string;
    expectedAmountFen: number;
    actualAmountFen: number;
    detail?: string;
    resolved: boolean;
    createdAt: string;
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

export function testAdminChannelModel(channelId: string, input: Pick<ChannelModel, "modelKey" | "providerModelKey" | "capability" | "protocol"> & { capabilityConfig?: ChannelModel["capabilityConfig"] }) {
    return request<{ durationMs: number }>(api.post(`/admin/channels/${encodeURIComponent(channelId)}/models/test`, input, { timeout: 10 * 60 * 1000 }));
}

export function createAdminChannelModel(channelId: string, input: ChannelModelMutation) {
    return request<{ model: ChannelModel }>(api.post(`/admin/channels/${encodeURIComponent(channelId)}/models`, input));
}

export function updateAdminChannelModel(channelId: string, id: string, input: ChannelModelMutation) {
    return request<{ model: ChannelModel }>(api.patch(`/admin/channels/${encodeURIComponent(channelId)}/models/${encodeURIComponent(id)}`, input));
}

export function deleteAdminChannelModel(channelId: string, id: string) {
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

export function resolveAdminBillingOrders(input: { ids: string[]; action: "settle" | "refund"; note: string }) {
    return request<{ resolvedCount: number; failed: Array<{ id: string; message: string }> }>(api.post("/admin/billing-orders/batch-resolve", input));
}

export function getRechargeCatalog() {
    return request<{ packages: CreditPackage[]; channels: RechargeCatalogChannel[] }>(api.get("/credit-recharge/catalog"));
}

export function createRechargeOrder(input: { packageId: string; channelId: string; idempotencyKey: string }) {
    return request<{ order: RechargeOrder }>(api.post("/credit-recharge/orders", input));
}

export function listRechargeOrders(params: { page?: number; limit?: number } = {}) {
    return request<{ orders: RechargeOrder[]; total: number; page: number; limit: number }>(api.get("/credit-recharge/orders", { params }));
}

export function getRechargeOrder(id: string) {
    return request<{ order: RechargeOrder }>(api.get(`/credit-recharge/orders/${encodeURIComponent(id)}`));
}

export function syncRechargeOrder(id: string) {
    return request<{ order: RechargeOrder }>(api.post(`/credit-recharge/orders/${encodeURIComponent(id)}/sync`));
}

export function closeRechargeOrder(id: string) {
    return request<{ order: RechargeOrder }>(api.post(`/credit-recharge/orders/${encodeURIComponent(id)}/close`));
}

export function listPaymentProviders() {
    return request<{ providers: PaymentProviderDescriptor[] }>(api.get("/admin/payment-providers"));
}

export function listPaymentChannels(params: { includeArchived?: boolean } = {}) {
    return request<{ channels: PaymentChannel[] }>(api.get("/admin/payment-channels", { params }));
}

export function createPaymentChannel(input: { provider: string; method: string; name: string; description?: string; sortOrder?: number }) {
    return request<{ channel: PaymentChannel }>(api.post("/admin/payment-channels", input));
}

export function updatePaymentChannel(id: string, input: { name: string; description?: string; enabled: boolean; sortOrder: number }) {
    return request<{ channel: PaymentChannel }>(api.patch(`/admin/payment-channels/${encodeURIComponent(id)}`, input));
}

export function archivePaymentChannel(id: string) {
    return request<{ archived: boolean }>(api.delete(`/admin/payment-channels/${encodeURIComponent(id)}`));
}

export function savePaymentChannelConfig(id: string, config: Record<string, unknown>) {
    return request<{ configVersion: { id: string; channelId: string; version: number; configDigest: string; createdAt: string } }>(api.post(`/admin/payment-channels/${encodeURIComponent(id)}/config-versions`, { config }));
}

export function testPaymentChannel(id: string) {
    return request<{ channel: PaymentChannel }>(api.post(`/admin/payment-channels/${encodeURIComponent(id)}/test`));
}

export function listCreditPackages() {
    return request<{ packages: CreditPackage[] }>(api.get("/admin/credit-packages"));
}

export type CreditPackageMutation = Omit<CreditPackage, "id" | "version" | "archivedAt" | "createdAt" | "updatedAt"> & { expectedVersion?: number };

export function createCreditPackage(input: CreditPackageMutation) {
    return request<{ package: CreditPackage }>(api.post("/admin/credit-packages", input));
}

export function updateCreditPackage(id: string, input: CreditPackageMutation & { expectedVersion: number }) {
    return request<{ package: CreditPackage }>(api.patch(`/admin/credit-packages/${encodeURIComponent(id)}`, input));
}

export function archiveCreditPackage(id: string) {
    return request<{ archived: boolean }>(api.delete(`/admin/credit-packages/${encodeURIComponent(id)}`));
}

export function listAdminRechargeOrders(params: { status?: string; userId?: string; channelId?: string; page?: number; limit?: number } = {}) {
    return request<{ orders: RechargeOrder[]; total: number; page: number; limit: number }>(api.get("/admin/recharge-orders", { params }));
}

export function reconcilePaymentChannel(input: { channelId: string; tradeDate: string }) {
    return request<{ run: PaymentReconciliationRun; anomalies: PaymentReconciliationAnomaly[] }>(api.post("/admin/payment-reconciliation", input, { timeout: 120_000 }));
}

export function listPaymentReconciliationRuns(params: { channelId?: string; page?: number; limit?: number } = {}) {
    return request<{ runs: PaymentReconciliationRun[]; total: number; page: number; limit: number }>(api.get("/admin/payment-reconciliation", { params }));
}

export function listPaymentReconciliationAnomalies(runId: string) {
    return request<{ anomalies: PaymentReconciliationAnomaly[] }>(api.get(`/admin/payment-reconciliation/${encodeURIComponent(runId)}/anomalies`));
}

export function resolvePaymentReconciliationAnomaly(runId: string, anomalyId: string, note: string) {
    return request<{ resolved: boolean }>(api.post(`/admin/payment-reconciliation/${encodeURIComponent(runId)}/anomalies/${encodeURIComponent(anomalyId)}/resolve`, { note }));
}
