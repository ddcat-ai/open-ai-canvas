import type { ModelChannel } from "@/stores/use-config-store";
import type { CreditLedgerEntry } from "@/services/api/wallet";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import type { CanvasDrawingEngineSetting } from "@/lib/canvas/canvas-drawing-engine";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { apiClient, request } from "@/services/api/request";

const api = apiClient;

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
    runtimeLimits?: RuntimeLimits;
    drawingEngine?: CanvasDrawingEngineSetting;
    features?: FeatureAvailability;
};

export type RuntimeLimits = {
    activeTaskLimit: number;
    resourceUploadMB: number;
    sessionUploadMB: number;
};

export type ApiCallLog = {
    id: string;
    userId: string;
    userDisplayName?: string;
    userAccount?: string;
    channelId: string;
    channelName: string;
    taskId?: string;
    taskStatus?: TaskStatus;
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
    pollCount: number;
    providerStatus?: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    usageAvailable: boolean;
    mediaCount: number;
    mediaPreviewUrl?: string;
    mediaPreviewKind?: "image" | "video";
    videoSeconds: number;
    providerRequestId?: string;
    estimatedCostMicros: number;
    costAvailable: boolean;
    currency?: string;
    errorCode?: string;
    error?: string;
    concurrencyLimit: number;
    upstreamUrl: string;
    requestContentType?: string;
    requestBody?: string;
    responseBody?: string;
    startedAt?: string;
    createdAt: string;
};

export type AdminProviderTaskQueryResult = {
    task: GenerationTask;
    providerStatus: string;
    recovered: boolean;
    billingSettled: boolean;
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
    storageUsage: {
        assetCount: number; assetBytes: number; canvasCount: number; canvasBytes: number;
        sessionCount: number; sessionBytes: number; taskCount: number; taskBytes: number; apiCallCount: number;
    };
    storedFileBytes: number;
    dailyUploadBytes: number;
    quota: RuntimeResourcePolicy;
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

export type PromptTemplate = {
    id: string;
    operation: string;
    name: string;
    version: number;
    content: string;
    outputType: "json" | "text";
    enabled: boolean;
    createdBy?: string;
    createdAt: string;
    updatedAt: string;
};

export type PromptTemplateVariable = {
    label: string;
    placeholder: string;
};

export type PromptOperationDefinition = {
    operation: string;
    label: string;
    category: string;
    description: string;
    outputType: "json" | "text";
    schemaKey?: string;
    variables: PromptTemplateVariable[];
    outputContract: string;
};

export type UserPromptCustomization = {
    id: string;
    operation: string;
    mode: "inherit" | "append" | "rewrite";
    content: string;
    baseTemplateId: string;
    updatedAt: string;
};

export type UserPromptPreference = {
    definition: PromptOperationDefinition;
    template: PromptTemplate | null;
    customization?: UserPromptCustomization;
    outdated: boolean;
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

export type RuntimeResourcePolicy = {
    resourceUploadMB: number;
    sessionUploadMB: number;
    generatedFileMB: number;
    dailyUploadMB: number;
    storedFileGB: number;
    structuredDataMB: number;
    taskDataGB: number;
    assetCount: number;
    canvasCount: number;
    sessionCount: number;
    taskCount: number;
    apiCallLogCount: number;
};

export type RuntimeTaskPolicy = {
    workerConcurrency: number;
    channelConcurrency: number;
    activeTaskLimit: number;
    imageTimeoutMinutes: number;
    textTimeoutMinutes: number;
    audioTimeoutMinutes: number;
    videoTimeoutMinutes: number;
    storyboardTimeoutMinutes: number;
    defaultTimeoutMinutes: number;
};

export type RuntimeRequestPolicy = {
    taskCreatePerMinute: number;
    sessionCreatePerMinute: number;
    resourceUploadPerMinute: number;
    resourceImportPerMinute: number;
    sessionFilePerMinute: number;
    assetWritePerMinute: number;
    canvasWritePerMinute: number;
    registerPerHour: number;
    emailCodePerHour: number;
    loginIPPerTenMinutes: number;
    loginAccountPerTenMinutes: number;
    systemRelayPerMinute: number;
    customRelayPerMinute: number;
    customRelayConcurrency: number;
    customRelayRequestMB: number;
    customRelayResponseMB: number;
    customRelayTimeoutMinutes: number;
    systemRelayRequestMB: number;
    systemRelayResponseMB: number;
    channelCircuitFailureCount: number;
    channelCircuitOpenSeconds: number;
};

export type RuntimePolicySetting = {
    resource: RuntimeResourcePolicy;
    task: RuntimeTaskPolicy;
    request: RuntimeRequestPolicy;
    configured?: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};


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

export function getFeatureAvailability() {
    return request<{ features: FeatureAvailability }>(api.get("/features"));
}

export function getAdminFeatureAvailability() {
    return request<{ features: FeatureAvailability }>(api.get("/admin/settings/features"));
}

export function updateAdminFeatureAvailability(features: Pick<FeatureAvailability, "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled">) {
    return request<{ features: FeatureAvailability }>(api.patch("/admin/settings/features", features));
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

export type AdminListParams = { keyword?: string; status?: string; role?: string; page?: number; limit?: number };

export function listAdminUsers(params: AdminListParams = {}) {
    return request<{ users: AdminUser[]; total: number; page: number; limit: number }>(api.get("/admin/users", { params }));
}

export function createAdminUser(input: { username: string; displayName: string; email?: string; password: string; role: LocalUser["role"]; status: LocalUser["status"] }) {
    return request<{ user: AdminUser }>(api.post("/admin/users", input));
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

export function listAdminPromptTemplates() {
    return request<{ templates: PromptTemplate[]; definitions: PromptOperationDefinition[] }>(api.get("/admin/prompt-templates"));
}

export function createAdminPromptTemplate(input: Pick<PromptTemplate, "operation" | "name" | "content"> & { enabled?: boolean }) {
    return request<{ template: PromptTemplate }>(api.post("/admin/prompt-templates", input));
}

export function updateAdminPromptTemplate(id: string, input: Pick<PromptTemplate, "operation" | "name" | "content"> & { enabled?: boolean }) {
    return request<{ template: PromptTemplate }>(api.patch(`/admin/prompt-templates/${encodeURIComponent(id)}`, input));
}

export function deleteAdminPromptTemplate(id: string) {
    return request<{ ok: boolean }>(api.delete(`/admin/prompt-templates/${encodeURIComponent(id)}`));
}

export function listUserPromptPreferences() {
    return request<{ preferences: UserPromptPreference[] }>(api.get("/settings/prompt-templates"));
}

export function updateUserPromptCustomization(operation: string, input: Pick<UserPromptCustomization, "mode" | "content">) {
    return request<{ customization: UserPromptCustomization }>(api.patch(`/settings/prompt-templates/${encodeURIComponent(operation)}`, input));
}

export function resetUserPromptCustomization(operation: string) {
    return request<{ ok: boolean }>(api.delete(`/settings/prompt-templates/${encodeURIComponent(operation)}`));
}

export function getAdminOSSSetting() {
    return request<{ setting: AdminOSSSetting }>(api.get("/admin/settings/oss"));
}

export function updateAdminOSSSetting(input: Partial<AdminOSSSetting>) {
    return request<{ setting: AdminOSSSetting }>(api.patch("/admin/settings/oss", input));
}

export function getAdminRuntimePolicySetting() {
    return request<{ setting: RuntimePolicySetting }>(api.get("/admin/settings/runtime-policy"));
}

export function getAdminSelfUseRuntimePolicy() {
    return request<{ setting: RuntimePolicySetting }>(api.get("/admin/settings/runtime-policy/self-use"));
}

export function updateAdminRuntimePolicySetting(input: Pick<RuntimePolicySetting, "resource" | "task" | "request">) {
    return request<{ setting: RuntimePolicySetting }>(api.put("/admin/settings/runtime-policy", input));
}

export function resetAdminRuntimePolicySetting() {
    return request<{ setting: RuntimePolicySetting }>(api.delete("/admin/settings/runtime-policy"));
}

export function getAdminDrawingEngineSetting() {
    return request<{ setting: CanvasDrawingEngineSetting }>(api.get("/admin/settings/drawing-engine"));
}

export function updateAdminDrawingEngineSetting(input: Pick<CanvasDrawingEngineSetting, "defaultEngine" | "tldrawLicenseKey">) {
    return request<{ setting: CanvasDrawingEngineSetting }>(api.patch("/admin/settings/drawing-engine", input));
}

export function listAdminApiLogs(params: AdminListParams = {}) {
    return request<{ logs: ApiCallLog[]; total: number; page: number; limit: number }>(api.get("/admin/api-logs", { params }));
}

export function getAdminApiLog(id: string) {
    return request<{ log: ApiCallLog }>(api.get(`/admin/api-logs/${encodeURIComponent(id)}`));
}

export function queryAdminApiLogTask(id: string) {
    return request<AdminProviderTaskQueryResult>(api.post(`/admin/api-logs/${encodeURIComponent(id)}/query-task`));
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
