import { http } from "./request";

export type RainyunMonitorSetting = {
    enabled: boolean;
    instanceId: number;
    hasApiKey: boolean;
};

export type RainyunMonitorInput = Omit<RainyunMonitorSetting, "hasApiKey"> & { apiKey: string };

export type RainyunPerformance = {
    enabled: boolean;
    configured: boolean;
    status: "disabled" | "unconfigured" | "healthy" | "warning" | "error" | "unknown";
    statusMessage: string;
    checkedAt?: string;
    latencyMs?: number;
    instanceId?: number;
    planName?: string;
    cloudStatus?: string;
    expiresAt?: string;
    periodStart?: string;
    periodEnd?: string;
    extraAccounting?: boolean;
    storageUsedBytes?: number;
    storageQuotaBytes?: number;
    trafficUsedBytes?: number;
    trafficQuotaBytes?: number;
    statisticsMessage?: string;
    sourceStatus: "disabled" | "unconfigured" | "healthy" | "error" | "unknown";
    sourceMessage: string;
    sourceLatencyMs?: number;
};

export type RainyunRealtimePoint = {
    time: string;
    receivedBytesPerSecond?: number;
    sentBytesPerSecond?: number;
    requestsTotal?: number;
};

export type RainyunRealtime = Pick<RainyunPerformance, "enabled" | "configured" | "status" | "statusMessage" | "instanceId" | "checkedAt"> & {
    sampleIntervalSeconds?: number;
    retryAfterSeconds: number;
    points: RainyunRealtimePoint[];
};

export type DatabasePoolStats = {
    maxOpenConnections: number;
    openConnections: number;
    inUse: number;
    idle: number;
    waitCount: number;
    waitDurationMs: number;
    maxIdleClosed: number;
    maxLifetimeClosed: number;
};

export type SystemPerformanceCacheGroup = {
    id: string;
    label: string;
    keys: number;
    clearable: boolean;
};

export type SystemPerformance = {
    collectedAt: string;
    status: "healthy" | "degraded";
    host: {
        hostname: string;
        os: string;
        arch: string;
        cpuCores: number;
        cpu: {
            status: "ready" | "sampling" | "unavailable";
            usagePercent: number | null;
            sampledAt?: string;
            sampleSeconds: number;
        };
        gomaxprocs: number;
        processId: number;
        uptimeSeconds: number;
        goroutines: number;
        activeWorkerTasks: number;
        loadAverage: [number, number, number];
        loadAverageAvailable: boolean;
    };
    memory: {
        systemAvailable: boolean;
        totalBytes: number;
        usedBytes: number;
        availableBytes: number;
        usagePercent: number;
        heapAllocBytes: number;
        heapSysBytes: number;
        sysBytes: number;
        heapObjects: number;
        gcCount: number;
        lastGCAt?: string;
    };
    disk: {
        available: boolean;
        writable: boolean;
        totalBytes: number;
        usedBytes: number;
        freeBytes: number;
        usagePercent: number;
    };
    database: {
        driver: string;
        connected: boolean;
        latencyMs: number;
        databaseBytes?: number;
        schema: { current: number; expected: number; ready: boolean };
        pool: DatabasePoolStats;
        postgres?: {
            serverVersion?: string;
            databaseBytes?: number;
            connections?: number;
            maxConnections?: number;
            transactions?: number;
            rollbacks?: number;
            cacheHitRate?: number;
            tempFiles?: number;
            tempBytes?: number;
            deadlocks?: number;
        };
    };
    redis: {
        configured: boolean;
        connected: boolean;
        mode: "redis" | "local";
        latencyMs?: number;
        version?: string;
        uptimeSeconds?: number;
        usedMemoryBytes?: number;
        peakMemoryBytes?: number;
        maxMemoryBytes?: number;
        maxMemoryPolicy?: string;
        keys?: number;
        clients?: number;
        blockedClients?: number;
        opsPerSecond?: number;
        hitRate?: number;
        expiredKeys?: number;
        evictedKeys?: number;
        pool: {
            hits: number;
            misses: number;
            timeouts: number;
            totalConnections: number;
            idleConnections: number;
            staleConnections: number;
            pendingRequests: number;
        };
        cacheGroups: SystemPerformanceCacheGroup[];
        statusMessage?: string;
    };
    agents: SystemPerformanceAgent[];
    rainyun: RainyunPerformance;
    build: { version: string; commit: string; buildTime: string; goVersion: string };
};

export type SystemPerformanceAgent = {
    id: string;
    name: string;
    mode: "remote" | "embedded";
    endpoint: string;
    healthy: boolean;
    active: number;
    limit: number;
    queued: number;
    configuredLimit: number;
    statusMessage?: string;
};

export type RuntimeCacheClearResult = {
    scope: "runtime";
    deletedKeys: number;
    memoryEntries: number;
    groups: Array<{ id: string; deletedKeys: number }>;
    clearedAt: string;
};

export function getSystemPerformance(signal?: AbortSignal) {
    return http.get<SystemPerformance>("/admin/system-performance", { signal });
}

export function getRainyunRealtime(signal?: AbortSignal) {
    return http.get<RainyunRealtime>("/admin/system-performance/rainyun-realtime", { signal, timeout: 5_000 });
}

export function updateAgentSessionLimit(maxSessions: number) {
    return http.put<SystemPerformanceAgent>("/admin/system-performance/agent-limit", { maxSessions });
}

export function clearRuntimeCache() {
    return http.post<RuntimeCacheClearResult>("/admin/system-performance/cache/clear", { scope: "runtime" });
}

function rainyunMonitorSetting(value: RainyunMonitorSetting): RainyunMonitorSetting {
    if (!value || typeof value.enabled !== "boolean" || typeof value.hasApiKey !== "boolean" || !Number.isSafeInteger(value.instanceId) || value.instanceId < 0 || (value.enabled && (!value.hasApiKey || value.instanceId === 0))) {
        throw new Error("服务端返回的雨云监控配置格式无效");
    }
    return { enabled: value.enabled, instanceId: value.instanceId, hasApiKey: value.hasApiKey };
}

export async function getRainyunMonitorSetting(signal?: AbortSignal) {
    return rainyunMonitorSetting(await http.get<RainyunMonitorSetting>("/admin/settings/rainyun-monitor", { signal }));
}

export async function updateRainyunMonitorSetting(input: RainyunMonitorInput) {
    return rainyunMonitorSetting(await http.patch<RainyunMonitorSetting>("/admin/settings/rainyun-monitor", input));
}
