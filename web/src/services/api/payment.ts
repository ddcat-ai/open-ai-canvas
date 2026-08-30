import { apiClient, request } from "@/services/api/request";

export type RechargeProduct = {
    id: string;
    sku: string;
    name: string;
    description?: string;
    amountFen: number;
    creditsMicrocredits: number;
    enabled?: boolean;
    sortOrder: number;
    createdAt?: string;
    updatedAt?: string;
};

export type PublicPaymentChannel = {
    id: string;
    code: string;
    name: string;
    provider: string;
    paymentMethod: string;
    isDefault: boolean;
};

export type PaymentOrderStatus = "created" | "pending" | "closing" | "succeeded" | "closed" | "failed" | "exception";

export type PaymentOrder = {
    id: string;
    outTradeNo: string;
    userId: string;
    channelId: string;
    channelVersionId: string;
    productId: string;
    productName: string;
    amountFen: number;
    creditsMicrocredits: number;
    currency: "CNY";
    expireMinutes: number;
    expiresAt: string;
    status: PaymentOrderStatus;
    providerTradeState?: string;
    providerTradeStateDesc?: string;
    transactionId?: string;
    codeUrl?: string;
    providerRequestId?: string;
    lastQueryAt?: string;
    queryAttempts: number;
    paidAt?: string;
    creditedAt?: string;
    closedAt?: string;
    lastErrorCode?: string;
    lastErrorMessage?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentChannel = {
    id: string;
    code: string;
    name: string;
    provider: "wechatpay";
    paymentMethod: "native";
    enabled: boolean;
    isDefault: boolean;
    activeVersionId?: string;
    notifyBaseUrl: string;
    orderExpireMinutes: number;
    createdBy: string;
    updatedBy: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentChannelCredentials = {
    appId: string;
    merchantId: string;
    merchantCertSerial: string;
    merchantPrivateKey: string;
    apiV3Key: string;
    verifyMode: "public_key" | "platform_certificate";
    wechatPayPublicKeyId?: string;
    wechatPayPublicKey?: string;
};

export type PaymentChannelVersion = {
    id: string;
    channelId: string;
    version: number;
    appId: string;
    merchantId: string;
    merchantCertSerial: string;
    verifyMode: PaymentChannelCredentials["verifyMode"];
    wechatPayPublicKeyId?: string;
    configFingerprint: string;
    status: "active" | "archived";
    hasMerchantPrivateKey: boolean;
    hasApiV3Key: boolean;
    hasWechatPayPublicKey: boolean;
    createdBy: string;
    createdAt: string;
};

export type PaymentChannelDetail = {
    channel: PaymentChannel;
    versions: PaymentChannelVersion[];
    callbackUrl?: string;
};

export type AdminPaymentOrder = PaymentOrder & {
    username?: string;
    userDisplayName?: string;
    channelName?: string;
};

export type PaymentReconciliationRun = {
    id: string;
    merchantId: string;
    channelId: string;
    channelVersionId: string;
    billDate: string;
    status: "pending" | "running" | "completed" | "failed";
    billHash?: string;
    wechatOrderCount: number;
    localOrderCount: number;
    matchedCount: number;
    differenceCount: number;
    externalRefundCount: number;
    attempts: number;
    lastError?: string;
    startedAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentReconciliationDifference = {
    id: string;
    runId: string;
    type: "wechat_order_missing_local" | "local_status_mismatch" | "amount_mismatch" | "transaction_mismatch" | "local_order_missing_wechat" | "external_refund";
    outTradeNo: string;
    paymentOrderId?: string;
    transactionId?: string;
    wechatAmountFen: number;
    wechatRefundFen: number;
    localAmountFen: number;
    localStatus?: string;
    description: string;
    createdAt: string;
};

export type PaymentReconciliationDetail = { run: PaymentReconciliationRun; differences: PaymentReconciliationDifference[] };

export function listRechargeProducts() {
    return request<{ products: RechargeProduct[] }>(apiClient.get("/recharge-products"));
}

export function listPublicPaymentChannels() {
    return request<{ channels: PublicPaymentChannel[] }>(apiClient.get("/payment-channels"));
}

export function createRechargeOrder(productId: string, channelId: string, idempotencyKey: string) {
    return request<{ order: PaymentOrder; serverTime: string }>(apiClient.post("/recharge-orders", { productId, channelId }, { headers: { "X-Idempotency-Key": idempotencyKey } }));
}

export function listRechargeOrders(page = 1, limit = 20) {
    return request<{ orders: PaymentOrder[]; total: number; page: number; limit: number; serverTime: string }>(apiClient.get("/recharge-orders", { params: { page, limit } }));
}

export function getRechargeOrder(id: string) {
    return request<{ order: PaymentOrder; serverTime: string }>(apiClient.get(`/recharge-orders/${encodeURIComponent(id)}`));
}

export function syncRechargeOrder(id: string) {
    return request<{ order: PaymentOrder; serverTime: string }>(apiClient.post(`/recharge-orders/${encodeURIComponent(id)}/sync`));
}

export function closeRechargeOrder(id: string) {
    return request<{ order: PaymentOrder; serverTime: string }>(apiClient.post(`/recharge-orders/${encodeURIComponent(id)}/close`));
}

export function listAdminPaymentChannels() {
    return request<{ channels: PaymentChannel[] }>(apiClient.get("/admin/payment-channels"));
}

export function getAdminPaymentChannel(id: string) {
    return request<PaymentChannelDetail>(apiClient.get(`/admin/payment-channels/${encodeURIComponent(id)}`));
}

export function createAdminPaymentChannel(input: Omit<PaymentChannel, "id" | "provider" | "paymentMethod" | "activeVersionId" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt"> & PaymentChannelCredentials) {
    return request<PaymentChannelDetail>(apiClient.post("/admin/payment-channels", input));
}

export function updateAdminPaymentChannel(id: string, input: Partial<Pick<PaymentChannel, "name" | "enabled" | "isDefault" | "notifyBaseUrl" | "orderExpireMinutes">>) {
    return request<PaymentChannelDetail>(apiClient.patch(`/admin/payment-channels/${encodeURIComponent(id)}`, input));
}

export function rotateAdminPaymentChannelCredentials(id: string, input: PaymentChannelCredentials) {
    return request<PaymentChannelDetail>(apiClient.post(`/admin/payment-channels/${encodeURIComponent(id)}/versions`, input));
}

export function testAdminPaymentChannel(id: string) {
    return request<{ ok: boolean }>(apiClient.post(`/admin/payment-channels/${encodeURIComponent(id)}/test`, undefined, { timeout: 30_000 }));
}

export function listAdminRechargeProducts() {
    return request<{ products: RechargeProduct[] }>(apiClient.get("/admin/recharge-products"));
}

export function createAdminRechargeProduct(input: Omit<RechargeProduct, "id" | "createdAt" | "updatedAt">) {
    return request<{ product: RechargeProduct }>(apiClient.post("/admin/recharge-products", input));
}

export function updateAdminRechargeProduct(id: string, input: Omit<RechargeProduct, "id" | "createdAt" | "updatedAt">) {
    return request<{ product: RechargeProduct }>(apiClient.patch(`/admin/recharge-products/${encodeURIComponent(id)}`, input));
}

export function listAdminPaymentOrders(params: { keyword?: string; status?: string; page?: number; limit?: number } = {}) {
    return request<{ orders: AdminPaymentOrder[]; total: number; page: number; limit: number }>(apiClient.get("/admin/payment-orders", { params }));
}

export function queryAdminPaymentOrder(id: string) {
    return request<{ order: PaymentOrder }>(apiClient.post(`/admin/payment-orders/${encodeURIComponent(id)}/query`));
}

export function closeAdminPaymentOrder(id: string) {
    return request<{ order: PaymentOrder }>(apiClient.post(`/admin/payment-orders/${encodeURIComponent(id)}/close`));
}

export function listAdminPaymentReconciliations(page = 1, limit = 20) {
    return request<{ runs: PaymentReconciliationRun[]; total: number; page: number; limit: number }>(apiClient.get("/admin/payment-reconciliations", { params: { page, limit } }));
}

export function getAdminPaymentReconciliation(id: string) {
    return request<PaymentReconciliationDetail>(apiClient.get(`/admin/payment-reconciliations/${encodeURIComponent(id)}`));
}

export function runAdminPaymentReconciliation(channelId: string, billDate: string) {
    return request<PaymentReconciliationDetail>(apiClient.post("/admin/payment-reconciliations/run", { channelId, billDate }, { timeout: 60_000 }));
}
