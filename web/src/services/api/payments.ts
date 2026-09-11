import { http } from "@/services/api/request";

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

export type TopupProduct = {
    id: string;
    name: string;
    description?: string;
    amountFen: number;
    creditsMicrocredits: number;
    enabled: boolean;
    sortOrder: number;
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
    providerId: string;
    amountFen: number;
    currency: "CNY" | string;
    creditsMicrocredits: number;
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

export function listAdminTopupProducts() {
    return http.get<{ products: TopupProduct[] }>("/admin/payments/products");
}

export type TopupProductInput = Pick<TopupProduct, "name" | "amountFen" | "creditsMicrocredits" | "enabled" | "sortOrder"> & { description?: string };

export function createAdminTopupProduct(input: TopupProductInput) {
    return http.post<{ product: TopupProduct }>("/admin/payments/products", input);
}

export function updateAdminTopupProduct(id: string, input: TopupProductInput) {
    return http.put<{ product: TopupProduct }>(`/admin/payments/products/${encodeURIComponent(id)}`, input);
}

export type AdminPaymentOrder = PaymentOrder & {
    user: { id: string; username: string; displayName: string; email: string } | null;
};

export function listAdminPaymentOrders(params: { status?: string; keyword?: string; page?: number; pageSize?: number } = {}) {
    return http.get<{ orders: AdminPaymentOrder[]; total: number; page: number; pageSize: number }>("/admin/payments/orders", { params });
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

export function listAdminPaymentReconciliations(params: { providerId?: string; status?: string; page?: number; pageSize?: number } = {}) {
    return http.get<{ runs: PaymentReconciliationRun[]; total: number; page: number; pageSize: number }>("/admin/payments/reconciliations", { params });
}

export function listAdminPaymentReconciliationItems(id: string, params: { result?: string; page?: number; pageSize?: number } = {}) {
    return http.get<{ run: PaymentReconciliationRun; items: PaymentReconciliationItem[]; total: number; page: number; pageSize: number }>(`/admin/payments/reconciliations/${encodeURIComponent(id)}/items`, { params });
}
