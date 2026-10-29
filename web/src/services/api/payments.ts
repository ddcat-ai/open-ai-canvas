import { ApiError, compactApiParams, http } from "@/services/api/request";

export type PaymentProvider = {
    id: "wechat-native" | "alipay-page-pay" | string;
    pluginId: string;
    name: string;
    icon: string;
    checkoutMode: "qr_code" | "redirect";
    enabled: boolean;
    pluginEnabled: boolean;
    configured: boolean;
    closeAfterMinutes: number;
};

export type TopupSaleStrategy = "unlimited" | "periodic" | "inventory" | "timed";

/** credits 发放积分；storage 扩容账号文件容量，storageDurationDays 为 0 表示永久。 */
export type TopupProductKind = "credits" | "storage";

export type TopupProduct = {
    id: string;
    name: string;
    description?: string;
    kind: TopupProductKind;
    /** 售价，单位是 currency 的最小单位（分 / 美分）。 */
    amountFen: number;
    currency: PaymentCurrency;
    creditsMicrocredits: number;
    storageBytes: number;
    storageDurationDays: number;
    enabled: boolean;
    sortOrder: number;
    saleStrategy: TopupSaleStrategy;
    periodDays?: number;
    periodPurchaseLimit?: number;
    stockTotal?: number;
    stockRemaining?: number;
    saleStartAt?: string;
    saleEndAt?: string;
    saleStatus?: "disabled" | "on_sale" | "upcoming" | "ended" | "sold_out" | string;
    canPurchase: boolean;
    createdBy: string;
    updatedBy: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentOrderStatus = "created" | "pending" | "closing" | "closed" | "credited" | "create_failed";

export type PaymentOrder = {
    id: string;
    userId?: string;
    merchantOrderNo: string;
    productId: string;
    productName: string;
    productKind: TopupProductKind;
    providerId: string;
    amountFen: number;
    currency: "CNY" | string;
    creditsMicrocredits: number;
    storageBytes?: number;
    storageDurationDays?: number;
    status: PaymentOrderStatus;
    providerStatus?: string;
    providerTradeNo?: string;
    checkout: {
        mode: "qr_code" | "redirect" | "";
        value?: string;
        url?: string;
        expiresAt?: string;
    };
    expiresAt: string;
    providerPaidAt?: string;
    creditedAt?: string;
    closedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentConfigField = {
    name: string;
    type: "string" | "password" | "textarea" | "url" | string;
    label?: string;
    required?: boolean;
    secret?: boolean;
    default?: unknown;
    description?: string;
};

export type AdminPaymentProvider = PaymentProvider & {
    configId?: string;
    configEnabled: boolean;
    version: number;
    values: Record<string, string>;
    secretConfigured: Record<string, boolean>;
    configFields: PaymentConfigField[];
    updatedAt?: string;
};

export function listPaymentProviders() {
    return http.get<{ providers: PaymentProvider[] }>("/payments/providers");
}

export function listTopupProducts() {
    return http.get<{ products: TopupProduct[] }>("/payments/products");
}

export function createPaymentOrder(input: { productId: string; providerId: string; idempotencyKey: string }) {
    return http.post<{ order: PaymentOrder }>("/payments/orders", input);
}

export function getPaymentOrder(id: string) {
    return http.get<{ order: PaymentOrder }>(`/payments/orders/${encodeURIComponent(id)}`);
}

export function queryPaymentOrder(id: string) {
    return http.post<{ order: PaymentOrder }>(`/payments/orders/${encodeURIComponent(id)}/query`);
}

export function closePaymentOrder(id: string) {
    return http.post<{ order: PaymentOrder }>(`/payments/orders/${encodeURIComponent(id)}/close`);
}

export function refreshPaymentCheckout(id: string) {
    return http.post<{ order: PaymentOrder }>(`/payments/orders/${encodeURIComponent(id)}/checkout/refresh`);
}

export function listAdminPaymentProviders() {
    return http.get<{ providers: AdminPaymentProvider[] }>("/admin/payments/providers");
}

export function updateAdminPaymentProvider(id: string, input: { enabled: boolean; closeAfterMinutes: number; values: Record<string, string> }) {
    return http.put<{ provider: AdminPaymentProvider }>(`/admin/payments/providers/${encodeURIComponent(id)}/config`, input);
}

export type PaymentCurrency = "CNY" | "USD";
export type PaymentSettings = { defaultCurrency: PaymentCurrency };

export function getPaymentSettings() {
    return http.get<{ settings: PaymentSettings }>("/payments/settings");
}
export function getAdminPaymentSettings() {
    return http.get<{ settings: PaymentSettings }>("/admin/payments/settings");
}
export function updateAdminPaymentSettings(input: PaymentSettings) {
    return http.put<{ settings: PaymentSettings }>("/admin/payments/settings", input);
}

/** 按货币格式化最小单位金额：CNY → ¥12.00，USD → $12.00。 */
export function formatPaymentAmount(amountMinor: number, currency?: string) {
    const symbol = currency === "USD" ? "$" : "¥";
    return `${symbol}${(amountMinor / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function listAdminTopupProducts() {
    return http.get<{ products: TopupProduct[] }>("/admin/payments/products");
}

export type TopupProductInput = Pick<TopupProduct, "name" | "kind" | "amountFen" | "currency" | "creditsMicrocredits" | "storageBytes" | "storageDurationDays" | "enabled" | "sortOrder" | "saleStrategy"> & {
    description?: string;
    periodDays?: number;
    periodPurchaseLimit?: number;
    stockTotal?: number;
    saleStartAt?: string;
    saleEndAt?: string;
};

export function createAdminTopupProduct(input: TopupProductInput) {
    return http.post<{ product: TopupProduct }>("/admin/payments/products", input);
}

export function updateAdminTopupProduct(id: string, input: TopupProductInput) {
    return http.put<{ product: TopupProduct }>(`/admin/payments/products/${encodeURIComponent(id)}`, input);
}

export type AdminPaymentOrder = PaymentOrder & {
    user: { id: string; username: string; displayName: string; email: string } | null;
};

export type PaymentOrderFilters = { status?: string; keyword?: string; providerId?: string; timeField?: "created" | "paid" | "credited"; from?: string; to?: string };
export type PaymentReconciliationFilters = { providerId?: string; status?: string; from?: string; to?: string };

export function listAdminPaymentOrders(params: PaymentOrderFilters & { page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
    return http.get<{ orders: AdminPaymentOrder[]; total: number; page: number; pageSize: number }>("/admin/payments/orders", { params: compactApiParams(params), signal });
}

export function queryAdminPaymentOrder(id: string) {
    return http.post<{ order: PaymentOrder }>(`/admin/payments/orders/${encodeURIComponent(id)}/query`);
}

export function closeAdminPaymentOrder(id: string) {
    return http.post<{ order: PaymentOrder }>(`/admin/payments/orders/${encodeURIComponent(id)}/close`);
}

export type PaymentReconciliationStatus = "running" | "completed" | "failed";

export type PaymentReconciliationResult = "matched" | "recovered" | "local_order_not_found" | "provider_record_missing" | "amount_mismatch" | "trade_no_mismatch" | "credit_failed";

export type PaymentReconciliationRun = {
    id: string;
    providerId: string;
    configId: string;
    billDate: string;
    status: PaymentReconciliationStatus;
    totalItems: number;
    matchItems: number;
    recoveredItems: number;
    errorItems: number;
    error?: string;
    startedBy?: string;
    startedAt: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type PaymentReconciliationItem = {
    id: string;
    runId: string;
    providerId: string;
    paymentOrderId?: string;
    merchantOrderNo: string;
    providerTradeNo?: string;
    amountFen: number;
    currency: string;
    result: PaymentReconciliationResult;
    resolved: boolean;
    detail?: string;
    createdAt: string;
};

export function runAdminPaymentReconciliation(input: { providerId: string; billDate: string }) {
    return http.post<{ run: PaymentReconciliationRun }>("/admin/payments/reconciliations", input);
}

export function listAdminPaymentReconciliations(params: PaymentReconciliationFilters & { page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
    return http.get<{ runs: PaymentReconciliationRun[]; total: number; page: number; pageSize: number }>("/admin/payments/reconciliations", { params: compactApiParams(params), signal });
}

export function listAdminPaymentReconciliationItems(id: string, params: { result?: string; page?: number; pageSize?: number } = {}, signal?: AbortSignal) {
    return http.get<{ run: PaymentReconciliationRun; items: PaymentReconciliationItem[]; total: number; page: number; pageSize: number }>(`/admin/payments/reconciliations/${encodeURIComponent(id)}/items`, { params: compactApiParams(params), signal });
}

export function exportAdminPaymentOrders(params: PaymentOrderFilters) {
    return downloadPaymentCSV("/admin/payments/orders/export.csv", params);
}

export function exportAdminPaymentReconciliations(params: PaymentReconciliationFilters) {
    return downloadPaymentCSV("/admin/payments/reconciliations/export.csv", params);
}

export function exportAdminPaymentReconciliationItems(id: string, result?: string) {
    return downloadPaymentCSV(`/admin/payments/reconciliations/${encodeURIComponent(id)}/items/export.csv`, { result });
}

async function downloadPaymentCSV(url: string, params: Record<string, string | undefined>) {
    try {
        const response = await http.raw<Blob>({ method: "get", url, params: compactApiParams(params), responseType: "blob" });
        return response.data;
    } catch (error) {
        // Axios also wraps JSON error envelopes in a Blob for download requests.
        const blob = error instanceof ApiError ? (error.cause as { response?: { data?: unknown } } | undefined)?.response?.data : undefined;
        if (blob instanceof Blob) {
            let envelope: { msg?: string; code?: number; reason?: string } | undefined;
            try {
                envelope = JSON.parse(await blob.text());
            } catch {
                /* Keep the original transport error. */
            }
            if (envelope?.msg && error instanceof ApiError) {
                throw new ApiError(envelope.msg, { status: error.status, code: envelope.code, reason: envelope.reason, cause: error });
            }
        }
        throw error;
    }
}
