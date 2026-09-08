import { apiClient, request } from "./request";

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
    build: { version: string; commit: string; buildTime: string; goVersion: string };
};

export type RuntimeCacheClearResult = {
    scope: "runtime";
    deletedKeys: number;
    memoryEntries: number;
    groups: Array<{ id: string; deletedKeys: number }>;
    clearedAt: string;
};

export function getSystemPerformance(signal?: AbortSignal) {
    return request<SystemPerformance>(apiClient.get("/admin/system-performance", { signal }));
}

export function clearRuntimeCache() {
    return request<RuntimeCacheClearResult>(apiClient.post("/admin/system-performance/cache/clear", { scope: "runtime" }));
}
