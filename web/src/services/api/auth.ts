import axios from "axios";

import type { ModelChannel } from "@/stores/use-config-store";
import type { CreditLedgerEntry } from "@/services/api/wallet";

const api = axios.create({ baseURL: import.meta.env.VITE_CANVAS_BACKEND_URL || "/api", withCredentials: true });

export type LocalUser = {
    id: string;
    username: string;
    email?: string;
    displayName: string;
    avatarUrl?: string;
    identityProvider?: string;
    identityId?: string;
    identityUsername?: string;
    role: "admin" | "user";
    status: "active" | "disabled";
    lastLoginAt?: string;
    createdAt: string;
    updatedAt: string;
};

export type AdminUser = LocalUser & {
    availableMicrocredits: number;
    reservedMicrocredits: number;
};

export type AuthSessionPayload = {
    user: LocalUser | null;
    systemChannels?: ModelChannel[];
};

export type ApiCallLog = {
    id: string;
    userId: string;
    channelId: string;
    channelName: string;
    taskId?: string;
    source: string;
    capability: "text" | "image" | "video" | "audio" | "";
    operation?: string;
    requestKind: "create" | "poll" | "download" | "repair" | "";
    billable: boolean;
    apiFormat: string;
    method: string;
    path: string;
    model: string;
    status: "succeeded" | "failed";
    statusCode: number;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    usageAvailable: boolean;
    mediaCount: number;
    videoSeconds: number;
    providerRequestId?: string;
    estimatedCostMicros: number;
    costAvailable: boolean;
    currency?: string;
    errorCode?: string;
    error?: string;
    concurrencyLimit: number;
    upstreamUrl: string;
    createdAt: string;
};

export type AdminAuditEvent = {
    id: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    summary: string;
    metadataJson?: string;
    createdAt: string;
};

export type AdminUserDetail = {
    user: LocalUser;
    account: { userId: string; availableMicrocredits: number; reservedMicrocredits: number; version: number };
    counts: { ledgerEntries: number; tasks: number; apiCalls: number; auditEvents: number };
};

export type AdminUserTask = {
    id: string;
    type: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    stage: string;
    progress: number;
    model?: string;
    providerRequestId?: string;
    createdAt: string;
};

export type AnalyticsFilters = {
    from?: string;
    to?: string;
    userId?: string;
    model?: string;
    channelId?: string;
    capability?: string;
};

export type AdminReferenceData = {
    users: Array<{ id: string; username: string; displayName: string }>;
    channels: Array<{ id: string; name: string; models: string[] }>;
};

export type AdminAnalytics = {
    from: string;
    to: string;
    kpi: {
        activeUsers: number;
        dau: number;
        wau: number;
        mau: number;
        generationTasks: number;
        upstreamRequests: number;
        successRate: number;
        p95DurationMs: number;
        currentQueuedTasks: number;
        estimatedCostMicros: number;
        costAvailable: boolean;
        currency?: string;
    };
    trend: Array<{ day: string; tasks: number; requests: number; activeUsers: number; requestSuccessRate: number }>;
    models: Array<{
        model: string;
        capability: string;
        tasks: number;
        requests: number;
        uniqueUsers: number;
        taskSuccessRate: number;
        requestSuccessRate: number;
        p50DurationMs: number;
        p95DurationMs: number;
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        usageAvailable: boolean;
        mediaCount: number;
        videoSeconds: number;
        estimatedCostMicros: number;
        costAvailable: boolean;
        currency?: string;
    }>;
    users: Array<{ userId: string; name: string; activeDays: number; tasks: number; agentMessages: number; canvasDays: number; assets: number; resources: number; commonModel?: string }>;
    failures: Array<{ type: string; model: string; count: number; lastError?: string; lastSeenAt: string }>;
};

export type ModelPricing = {
    id: string;
    channelId?: string;
    model: string;
    capability: "text" | "image" | "video" | "audio";
    currency: string;
    inputPerMillionMicros: number;
    outputPerMillionMicros: number;
    cachedPerMillionMicros: number;
    perRequestMicros: number;
    perMediaMicros: number;
    perVideoSecondMicros: number;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardPromptTemplate = {
    id: string;
    name: string;
    content: string;
    enabled: boolean;
    createdBy?: string;
    createdAt: string;
    updatedAt: string;
};

export type StoryboardPromptVariable = {
    label: string;
    placeholder: string;
};

export type AdminOSSSetting = {
    enabled: boolean;
    provider: "aliyun";
    region: string;
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret?: string;
    hasAccessKeySecret: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RuntimeConcurrencySetting = {
    workerConcurrency: number;
    channelConcurrency: number;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

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

export function getAuthSettings() {
    return request<{ firstUser: boolean; registrationEnabled: boolean; linuxdoEnabled: boolean; emailEnabled: boolean; emailCodeRequired: boolean }>(api.get("/auth/settings"));
}

export function linuxDOLoginURL(next: string) {
    const base = String(api.defaults.baseURL || "/api").replace(/\/$/, "");
    return `${base}/auth/linuxdo/start?next=${encodeURIComponent(next)}`;
}

export function getAuthSession() {
    return request<AuthSessionPayload>(api.get("/auth/session"));
}

export function getSystemChannels() {
    return request<{ channels: ModelChannel[] }>(api.get("/channels/system"));
}

export function login(input: { username: string; password: string }) {
    return request<{ user: LocalUser }>(api.post("/auth/login", input));
}

export function sendRegistrationEmailCode(email: string) {
    return request<{ sent: boolean }>(api.post("/auth/email-code", { email }));
}

export function register(input: { username: string; email?: string; emailCode?: string; displayName?: string; password: string }) {
    return request<{ user: LocalUser }>(api.post("/auth/register", input));
}

export function logout() {
    return request<{ ok: boolean }>(api.post("/auth/logout"));
}

export type AdminListParams = { keyword?: string; status?: string; role?: string; interfaceType?: string; page?: number; limit?: number };

export function listAdminUsers(params: AdminListParams = {}) {
    return request<{ users: AdminUser[]; total: number; page: number; limit: number }>(api.get("/admin/users", { params }));
}

export function getAdminReferences() {
    return request<AdminReferenceData>(api.get("/admin/references"));
}

export function getAdminUserDetail(id: string) {
    return request<AdminUserDetail>(api.get(`/admin/users/${encodeURIComponent(id)}/detail`));
}

export function listAdminUserLedger(id: string, params: { page?: number; limit?: number; type?: string } = {}) {
    return request<{ entries: CreditLedgerEntry[]; total: number; page: number; limit: number }>(api.get(`/admin/users/${encodeURIComponent(id)}/ledger`, { params }));
}

export function listAdminUserTasks(id: string, params: { page?: number; limit?: number } = {}) {
    return request<{ tasks: AdminUserTask[]; total: number; page: number; limit: number }>(api.get(`/admin/users/${encodeURIComponent(id)}/tasks`, { params }));
}

export function listAdminUserAuditEvents(id: string, params: { page?: number; limit?: number } = {}) {
    return request<{ events: AdminAuditEvent[]; total: number; page: number; limit: number }>(api.get(`/admin/users/${encodeURIComponent(id)}/audit-events`, { params }));
}

export function updateAdminUser(id: string, input: Partial<Pick<LocalUser, "displayName" | "email" | "role" | "status">> & { password?: string }) {
    return request<{ user: LocalUser }>(api.patch(`/admin/users/${encodeURIComponent(id)}`, input));
}

export function deleteAdminUser(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/users/${encodeURIComponent(id)}`));
}

export function bulkDisableAdminUsers(userIds: string[]) {
    return request<{ users: LocalUser[]; disabledCount: number }>(api.post("/admin/users/bulk-disable", { userIds }));
}

export function listAdminChannels(params: AdminListParams = {}) {
    return request<{ channels: ModelChannel[]; total: number; page: number; limit: number }>(api.get("/admin/channels", { params }));
}

export function createAdminChannel(input: Partial<ModelChannel> & { useGlobalConcurrency?: boolean }) {
    return request<{ channel: ModelChannel }>(api.post("/admin/channels", input));
}

export function updateAdminChannel(id: string, input: Partial<ModelChannel> & { useGlobalConcurrency?: boolean }) {
    return request<{ channel: ModelChannel }>(api.patch(`/admin/channels/${encodeURIComponent(id)}`, input));
}

export function deleteAdminChannel(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/channels/${encodeURIComponent(id)}`));
}

export function listAdminStoryboardPromptTemplates() {
    return request<{ templates: StoryboardPromptTemplate[]; variables: StoryboardPromptVariable[] }>(api.get("/admin/storyboard-prompts"));
}

export function createAdminStoryboardPromptTemplate(input: Partial<Pick<StoryboardPromptTemplate, "name" | "content" | "enabled">>) {
    return request<{ template: StoryboardPromptTemplate }>(api.post("/admin/storyboard-prompts", input));
}

export function updateAdminStoryboardPromptTemplate(id: string, input: Partial<Pick<StoryboardPromptTemplate, "name" | "content" | "enabled">>) {
    return request<{ template: StoryboardPromptTemplate }>(api.patch(`/admin/storyboard-prompts/${encodeURIComponent(id)}`, input));
}

export function deleteAdminStoryboardPromptTemplate(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/storyboard-prompts/${encodeURIComponent(id)}`));
}

export function getAdminOSSSetting() {
    return request<{ setting: AdminOSSSetting }>(api.get("/admin/settings/oss"));
}

export function updateAdminOSSSetting(input: Partial<AdminOSSSetting>) {
    return request<{ setting: AdminOSSSetting }>(api.patch("/admin/settings/oss", input));
}

export function getAdminRuntimeConcurrencySetting() {
    return request<{ setting: RuntimeConcurrencySetting }>(api.get("/admin/settings/concurrency"));
}

export function updateAdminRuntimeConcurrencySetting(input: Pick<RuntimeConcurrencySetting, "workerConcurrency" | "channelConcurrency">) {
    return request<{ setting: RuntimeConcurrencySetting }>(api.patch("/admin/settings/concurrency", input));
}

export function listAdminApiLogs(params: AdminListParams = {}) {
    return request<{ logs: ApiCallLog[]; total: number; page: number; limit: number }>(api.get("/admin/api-logs", { params }));
}

export function getAdminApiLog(id: string) {
    return request<{ log: ApiCallLog }>(api.get(`/admin/api-logs/${encodeURIComponent(id)}`));
}

export async function exportAdminApiLogs(params: AdminListParams & { ids?: string[] } = {}) {
    const response = await api.get<Blob>("/admin/api-logs-export.csv", { params: { ...params, ids: params.ids?.join(",") }, responseType: "blob" });
    return response.data;
}

export function getAdminAnalytics(params: AnalyticsFilters) {
    return request<AdminAnalytics>(api.get("/admin/analytics/overview", { params }));
}

export async function exportAdminAnalytics(params: AnalyticsFilters) {
    const response = await api.get<Blob>("/admin/analytics/export.csv", { params, responseType: "blob" });
    return response.data;
}

export function listAdminModelPricings() {
    return request<{ pricings: ModelPricing[] }>(api.get("/admin/model-pricings"));
}

export function createAdminModelPricing(input: Omit<ModelPricing, "id" | "createdAt" | "updatedAt">) {
    return request<{ pricing: ModelPricing }>(api.post("/admin/model-pricings", input));
}

export function updateAdminModelPricing(id: string, input: Omit<ModelPricing, "id" | "createdAt" | "updatedAt">) {
    return request<{ pricing: ModelPricing }>(api.patch(`/admin/model-pricings/${encodeURIComponent(id)}`, input));
}

export function deleteAdminModelPricing(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/model-pricings/${encodeURIComponent(id)}`));
}
