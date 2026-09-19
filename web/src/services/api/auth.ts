import type { ModelChannel } from "@/stores/use-config-store";
import type { BillingOrder, CreditLedgerEntry } from "@/services/api/wallet";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import type { CanvasDrawingEngineSetting } from "@/lib/canvas/canvas-drawing-engine";
import type { FeatureAvailability } from "@/stores/use-user-store";
import { http, apiBaseURL } from "@/services/api/request";
import type { PublicLogicalModel } from "@/services/api/logical-models";
import type { OSSConnectionTestInput, OSSConnectionTestResult, OSSProvider, S3Preset } from "@/lib/oss-settings";


let authSessionRequest: Promise<AuthSessionPayload> | null = null;
let authSessionCache: { payload: AuthSessionPayload; expiresAt: number } | null = null;

function invalidateAuthSessionCache() {
    authSessionCache = null;
}

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
    logicalModels?: PublicLogicalModel[];
    runtimeLimits?: RuntimeLimits;
    drawingEngine?: CanvasDrawingEngineSetting;
    features?: FeatureAvailability;
};

export type RuntimeLimits = {
    activeTaskLimit: number;
    resourceUploadMB: number;
    recycleBinRetentionDays?: number;
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
    billingOrderId?: string;
    billingStatus?: BillingOrder["status"];
    billingAmountMicrocredits: number;
    billingAvailable: boolean;
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
    creditCostConfigured?: boolean;
    creditCostMicrocredits?: number;
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
        assetCount: number;
        assetBytes: number;
        canvasCount: number;
        canvasBytes: number;
        taskCount: number;
        taskBytes: number;
        apiCallCount: number;
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
    channels: Array<{ id: string; name: string; enabled: boolean; models: string[] }>;
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
    provider: OSSProvider;
    s3Preset: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret?: string;
    hasAccessKeySecret: boolean;
    sessionToken?: string;
    hasSessionToken: boolean;
    pathStyle: boolean;
    allowUserS3: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    testedAt?: string;
    testedDigest?: string;
    historyCount?: number;
    referencedResourceCount?: number;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type AdminArkPrivateAssetSetting = {
    enabled: boolean;
    region: string;
    projectName: string;
    accessKeyId: string;
    accessKeySecret?: string;
    hasAccessKeySecret: boolean;
    updatedBy?: string;
    createdAt?: string;
    updatedAt?: string;
};

export type RuntimeResourcePolicy = {
    resourceUploadMB: number;
    generatedFileMB: number;
    dailyUploadMB: number;
    storedFileGB: number;
    structuredDataMB: number;
    taskDataGB: number;
    assetCount: number;
    canvasCount: number;
    taskCount: number;
    apiCallLogCount: number;
    recycleBinRetentionDays?: number;
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
    resourceUploadPerMinute: number;
    resourceImportPerMinute: number;
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
    return http.get<{ firstUser: boolean; registrationEnabled: boolean; linuxdoEnabled: boolean; emailEnabled: boolean; emailCodeRequired: boolean }>("/auth/settings");
}

export function linuxDOLoginURL(next: string) {
    const base = String(apiBaseURL).replace(/\/$/, "");
    return `${base}/auth/linuxdo/start?next=${encodeURIComponent(next)}`;
}

export function getAuthSession() {
    const now = Date.now();
    if (authSessionCache && authSessionCache.expiresAt > now) return Promise.resolve(authSessionCache.payload);
    if (authSessionRequest) return authSessionRequest;
    authSessionRequest = http.get<AuthSessionPayload>("/auth/session")
        .then((payload) => {
            authSessionCache = { payload, expiresAt: Date.now() + 5_000 };
            return payload;
        })
        .finally(() => {
            authSessionRequest = null;
        });
    return authSessionRequest;
}

export function getSystemChannels() {
    return http.get<{ channels: ModelChannel[] }>("/channels/system");
}

export function getFeatureAvailability() {
    return http.get<{ features: FeatureAvailability }>("/features");
}

export function getAdminFeatureAvailability() {
    return http.get<{ features: FeatureAvailability }>("/admin/settings/features");
}

export function updateAdminFeatureAvailability(features: Partial<Pick<FeatureAvailability, "welcomeEnabled" | "shortDramaEnabled" | "taskCenterEnabled" | "creditsEnabled" | "customChannelsEnabled" | "frontendModelsEnabled" | "pluginCenterEnabled" | "systemPluginsVisibleToUsers">>) {
    return http.patch<{ features: FeatureAvailability }>("/admin/settings/features", features);
}

export async function login(input: { username: string; password: string }) {
    const result = await http.post<{ user: LocalUser }>("/auth/login", input);
    // 登录会改变服务端会话身份，不能让登录前缓存的游客 session 污染后续恢复。
    invalidateAuthSessionCache();
    return result;
}

export function sendRegistrationEmailCode(email: string) {
    return http.post<{ sent: boolean }>("/auth/email-code", { email });
}

export function sendPasswordResetEmailCode(email: string) {
    return http.post<{ sent: boolean }>("/auth/password-reset-code", { email });
}

export function resetPassword(input: { email: string; emailCode: string; password: string }) {
    return http.post<{ reset: boolean }>("/auth/password-reset", input);
}

export function register(input: { username: string; email?: string; emailCode?: string; displayName?: string; password: string }) {
    return http.post<{ user: LocalUser }>("/auth/register", input);
}

export async function logout() {
    const result = await http.post<{ ok: boolean }>("/auth/logout");
    invalidateAuthSessionCache();
    return result;
}

export type AdminListParams = { keyword?: string; status?: string; role?: string; page?: number; pageSize?: number };

export function listAdminUsers(params: AdminListParams = {}) {
    return http.get<{ users: AdminUser[]; total: number; page: number; pageSize: number }>("/admin/users", { params });
}

export function createAdminUser(input: { username: string; displayName: string; email?: string; password: string; role: LocalUser["role"]; status: LocalUser["status"] }) {
    return http.post<{ user: AdminUser }>("/admin/users", input);
}

export function getAdminReferences() {
    return http.get<AdminReferenceData>("/admin/references");
}

export function getAdminUserDetail(id: string) {
    return http.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/detail`);
}

export function listAdminUserLedger(id: string, params: { page?: number; pageSize?: number; type?: string } = {}) {
    return http.get<{ entries: CreditLedgerEntry[]; total: number; page: number; pageSize: number }>(`/admin/users/${encodeURIComponent(id)}/ledger`, { params });
}

export function listAdminUserTasks(id: string, params: { page?: number; pageSize?: number } = {}) {
    return http.get<{ tasks: AdminUserTask[]; total: number; page: number; pageSize: number }>(`/admin/users/${encodeURIComponent(id)}/tasks`, { params });
}

export function listAdminUserAuditEvents(id: string, params: { page?: number; pageSize?: number } = {}) {
    return http.get<{ events: AdminAuditEvent[]; total: number; page: number; pageSize: number }>(`/admin/users/${encodeURIComponent(id)}/audit-events`, { params });
}

export function updateAdminUser(id: string, input: Partial<Pick<LocalUser, "displayName" | "email" | "role" | "status">> & { password?: string }) {
    return http.patch<{ user: LocalUser }>(`/admin/users/${encodeURIComponent(id)}`, input);
}

export function deleteAdminUser(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/users/${encodeURIComponent(id)}`);
}

export function bulkDisableAdminUsers(userIds: string[]) {
    return http.post<{ users: LocalUser[]; disabledCount: number }>("/admin/users/bulk-disable", { userIds });
}

export function listAdminChannels(params: AdminListParams = {}) {
    return http.get<{ channels: ModelChannel[]; total: number; page: number; pageSize: number }>("/admin/channels", { params });
}

export function createAdminChannel(input: Partial<ModelChannel> & { useGlobalConcurrency?: boolean }) {
    return http.post<{ channel: ModelChannel }>("/admin/channels", input);
}

export function duplicateAdminChannel(id: string) {
    return http.post<{ channel: ModelChannel }>(`/admin/channels/${encodeURIComponent(id)}/duplicate`);
}

export function updateAdminChannel(id: string, input: Partial<ModelChannel> & { useGlobalConcurrency?: boolean }) {
    return http.patch<{ channel: ModelChannel }>(`/admin/channels/${encodeURIComponent(id)}`, input);
}

export function deleteAdminChannel(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/channels/${encodeURIComponent(id)}`);
}

export function listAdminPromptTemplates() {
    return http.get<{ templates: PromptTemplate[]; definitions: PromptOperationDefinition[] }>("/admin/prompt-templates");
}

export function createAdminPromptTemplate(input: Pick<PromptTemplate, "operation" | "name" | "content"> & { enabled?: boolean }) {
    return http.post<{ template: PromptTemplate }>("/admin/prompt-templates", input);
}

export function updateAdminPromptTemplate(id: string, input: Pick<PromptTemplate, "operation" | "name" | "content"> & { enabled?: boolean }) {
    return http.patch<{ template: PromptTemplate }>(`/admin/prompt-templates/${encodeURIComponent(id)}`, input);
}

export function deleteAdminPromptTemplate(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/prompt-templates/${encodeURIComponent(id)}`);
}

export function listUserPromptPreferences() {
    return http.get<{ preferences: UserPromptPreference[] }>("/settings/prompt-templates");
}

export function updateUserPromptCustomization(operation: string, input: Pick<UserPromptCustomization, "mode" | "content">) {
    return http.patch<{ customization: UserPromptCustomization }>(`/settings/prompt-templates/${encodeURIComponent(operation)}`, input);
}

export function resetUserPromptCustomization(operation: string) {
    return http.delete<{ ok: boolean }>(`/settings/prompt-templates/${encodeURIComponent(operation)}`);
}

export function getAdminOSSSetting() {
    return http.get<{ setting: AdminOSSSetting }>("/admin/settings/oss");
}

export function updateAdminOSSSetting(input: Partial<AdminOSSSetting>) {
    return http.patch<{ setting: AdminOSSSetting }>("/admin/settings/oss", input);
}

export function testAdminOSSConnection(input: OSSConnectionTestInput) {
    return http.post<OSSConnectionTestResult>("/admin/settings/oss/test", input);
}

export function getAdminArkPrivateAssetSetting() {
    return http.get<{ setting: AdminArkPrivateAssetSetting }>("/admin/settings/ark-private-assets");
}

export function updateAdminArkPrivateAssetSetting(input: Partial<AdminArkPrivateAssetSetting>) {
    return http.patch<{ setting: AdminArkPrivateAssetSetting }>("/admin/settings/ark-private-assets", input);
}

export function getAdminRuntimePolicySetting() {
    return http.get<{ setting: RuntimePolicySetting }>("/admin/settings/runtime-policy");
}

export function getAdminSelfUseRuntimePolicy() {
    return http.get<{ setting: RuntimePolicySetting }>("/admin/settings/runtime-policy/self-use");
}

export function updateAdminRuntimePolicySetting(input: Pick<RuntimePolicySetting, "resource" | "task" | "request">) {
    return http.put<{ setting: RuntimePolicySetting }>("/admin/settings/runtime-policy", input);
}

export function resetAdminRuntimePolicySetting() {
    return http.delete<{ setting: RuntimePolicySetting }>("/admin/settings/runtime-policy");
}

export function getAdminDrawingEngineSetting() {
    return http.get<{ setting: CanvasDrawingEngineSetting }>("/admin/settings/drawing-engine");
}

export function updateAdminDrawingEngineSetting(input: Pick<CanvasDrawingEngineSetting, "defaultEngine" | "tldrawLicenseKey">) {
    return http.patch<{ setting: CanvasDrawingEngineSetting }>("/admin/settings/drawing-engine", input);
}

export type AdminApiLogParams = AdminListParams & { recordType?: "request" | "download" | "all" };

export function listAdminApiLogs(params: AdminApiLogParams = {}) {
    return http.get<{ logs: ApiCallLog[]; total: number; page: number; pageSize: number }>("/admin/api-logs", { params });
}

export function getAdminApiLog(id: string) {
    return http.get<{ log: ApiCallLog }>(`/admin/api-logs/${encodeURIComponent(id)}`);
}

export function queryAdminApiLogTask(id: string) {
    return http.post<AdminProviderTaskQueryResult>(`/admin/api-logs/${encodeURIComponent(id)}/query-task`);
}

export async function exportAdminApiLogs(params: AdminApiLogParams & { ids?: string[] } = {}) {
    const response = await http.raw<Blob>({ method: "get", url: "/admin/api-logs-export.csv", params: { ...params, ids: params.ids?.join(",") }, responseType: "blob" });
    return response.data;
}

export function getAdminAnalytics(params: AnalyticsFilters) {
    return http.get<AdminAnalytics>("/admin/analytics/overview", { params });
}

export async function exportAdminAnalytics(params: AnalyticsFilters) {
    const response = await http.raw<Blob>({ method: "get", url: "/admin/analytics/export.csv", params, responseType: "blob" });
    return response.data;
}

export function listAdminModelPricings() {
    return http.get<{ pricings: ModelPricing[] }>("/admin/model-pricings");
}

export function createAdminModelPricing(input: Omit<ModelPricing, "id" | "createdAt" | "updatedAt">) {
    return http.post<{ pricing: ModelPricing }>("/admin/model-pricings", input);
}

export function updateAdminModelPricing(id: string, input: Omit<ModelPricing, "id" | "createdAt" | "updatedAt">) {
    return http.patch<{ pricing: ModelPricing }>(`/admin/model-pricings/${encodeURIComponent(id)}`, input);
}

export function deleteAdminModelPricing(id: string) {
    return http.delete<{ ok: boolean }>(`/admin/model-pricings/${encodeURIComponent(id)}`);
}
