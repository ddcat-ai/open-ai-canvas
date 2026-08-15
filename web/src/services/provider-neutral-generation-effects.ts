import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { GenerationTaskEffectClaim, GenerationTaskEffectResult, GenerationTaskEffectStore } from "@/services/generation-task-materializer";

type EffectRecord = {
    version: 1;
    taskId: string;
    effectKey: string;
    state: "pending" | "completed" | "released";
    fence: number;
    leaseToken?: string;
    leaseExpiresAt?: string;
    completedAt?: string;
    releasedAt?: string;
    result?: GenerationTaskEffectResult;
};

type EffectLease = {
    scope: string;
    taskId: string;
    effectKey: string;
    leaseToken: string;
    expiresAt: string;
    fence: number;
};

type AsyncLock = {
    request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

type EffectStorage = {
    getItem(name: string): string | null | Promise<string | null>;
    setItem(name: string, value: string): unknown | Promise<unknown>;
};

const EFFECT_STORAGE_PREFIX = "infinite-canvas:generation-effect:";
const EFFECT_LOCK_PREFIX = "infinite-canvas:generation-effect-lock:";
const DEFAULT_LEASE_MS = 30_000;
const inProcessRecords = new Map<string, string>();
const inProcessLockTails = new Map<string, Promise<void>>();

function effectStorage(scope: string): EffectStorage {
    if (typeof window !== "undefined") return localForageStorageForScope(scope);
    return {
        getItem: async (name) => inProcessRecords.get(name) ?? null,
        setItem: async (name, value) => {
            inProcessRecords.set(name, value);
        },
    };
}

function effectLock(): AsyncLock {
    if (typeof window !== "undefined") {
        const locks = navigator.locks;
        if (!locks) throw new Error("当前浏览器不支持跨页面生成副作用互斥");
        return locks;
    }
    return {
        async request<T>(name: string, callback: () => Promise<T>) {
            const prior = inProcessLockTails.get(name) ?? Promise.resolve();
            let release!: () => void;
            const tail = new Promise<void>((resolve) => {
                release = resolve;
            });
            const queued = prior.then(() => tail);
            inProcessLockTails.set(name, queued);
            await prior;
            try {
                return await callback();
            } finally {
                release();
                if (inProcessLockTails.get(name) === queued) inProcessLockTails.delete(name);
            }
        },
    };
}

function recordKey(scope: string, effectKey: string) {
    return `${EFFECT_STORAGE_PREFIX}${scope}:${effectKey}`;
}

function lockKey(scope: string, effectKey: string) {
    return `${EFFECT_LOCK_PREFIX}${scope}:${effectKey}`;
}

function leaseKey(scope: string, taskId: string, effectKey: string) {
    return `${scope}\0${taskId}\0${effectKey}`;
}

function validResult(value: unknown): value is GenerationTaskEffectResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    return Object.keys(result).every((key) => key === "materializedAssetId") && (result.materializedAssetId === undefined || typeof result.materializedAssetId === "string");
}

function parseRecord(value: string | null, taskId: string, effectKey: string): EffectRecord | undefined {
    if (!value) return undefined;
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("生成副作用持久状态无效");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("生成副作用持久状态无效");
    const record = parsed as EffectRecord;
    const allowed = new Set(["version", "taskId", "effectKey", "state", "fence", "leaseToken", "leaseExpiresAt", "completedAt", "releasedAt", "result"]);
    if (
        Object.keys(record).some((key) => !allowed.has(key)) ||
        record.version !== 1 ||
        record.taskId !== taskId ||
        record.effectKey !== effectKey ||
        !Number.isSafeInteger(record.fence) ||
        record.fence < 1 ||
        !["pending", "completed", "released"].includes(record.state)
    ) {
        throw new Error("生成副作用持久状态无效");
    }
    if (record.state === "pending") {
        if (typeof record.leaseToken !== "string" || typeof record.leaseExpiresAt !== "string" || !Number.isFinite(Date.parse(record.leaseExpiresAt)) || record.completedAt !== undefined || record.releasedAt !== undefined || record.result !== undefined) {
            throw new Error("生成副作用持久状态无效");
        }
    } else if (record.state === "completed") {
        if (typeof record.completedAt !== "string" || !Number.isFinite(Date.parse(record.completedAt)) || record.leaseToken !== undefined || record.leaseExpiresAt !== undefined || record.releasedAt !== undefined || !validResult(record.result ?? {})) {
            throw new Error("生成副作用持久状态无效");
        }
    } else if (typeof record.releasedAt !== "string" || !Number.isFinite(Date.parse(record.releasedAt)) || record.leaseToken !== undefined || record.leaseExpiresAt !== undefined || record.completedAt !== undefined || record.result !== undefined) {
        throw new Error("生成副作用持久状态无效");
    }
    return record;
}

export function createProviderNeutralGenerationTaskEffectStore(
    dependencies: {
        now?: () => Date;
        leaseMs?: number;
    } = {},
): GenerationTaskEffectStore {
    const now = dependencies.now ?? (() => new Date());
    const leaseMs = dependencies.leaseMs ?? DEFAULT_LEASE_MS;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 100 || leaseMs > 3_600_000) {
        throw new Error("生成副作用租约时长无效");
    }
    const leases = new Map<string, EffectLease>();
    const leasesByBinding = new Map<string, EffectLease>();

    function ownedLease(effectKey: string, taskId: string, binding?: string) {
        if (binding) {
            const owned = leasesByBinding.get(binding);
            if (owned?.taskId === taskId && owned.effectKey === effectKey) return owned;
            return undefined;
        }
        const matches = [...leases.values()].filter((lease) => lease.taskId === taskId && lease.effectKey === effectKey);
        return matches.length === 1 ? matches[0] : undefined;
    }

    function forgetLease(owned: EffectLease) {
        leases.delete(leaseKey(owned.scope, owned.taskId, owned.effectKey));
        leasesByBinding.delete(owned.leaseToken);
    }

    async function withRecord<T>(scope: string, taskId: string, effectKey: string, action: (record: EffectRecord | undefined, storage: EffectStorage, key: string) => Promise<T>) {
        return effectLock().request(lockKey(scope, effectKey), async () => {
            const storage = effectStorage(scope);
            const key = recordKey(scope, effectKey);
            return action(parseRecord(await storage.getItem(key), taskId, effectKey), storage, key);
        });
    }

    return {
        async claim(effectKey, taskId): Promise<GenerationTaskEffectClaim> {
            const scope = getActiveUserScope();
            return withRecord(scope, taskId, effectKey, async (record, storage, key) => {
                if (record?.state === "completed") {
                    return { status: "completed", result: { ...(record.result ?? {}) } };
                }
                const current = now();
                if (record?.state === "pending" && Date.parse(record.leaseExpiresAt!) > current.getTime()) {
                    return { status: "busy", retryAt: record.leaseExpiresAt };
                }
                const lease: EffectLease = {
                    scope,
                    taskId,
                    effectKey,
                    leaseToken: crypto.randomUUID(),
                    expiresAt: new Date(current.getTime() + leaseMs).toISOString(),
                    fence: (record?.fence ?? 0) + 1,
                };
                await storage.setItem(
                    key,
                    JSON.stringify({
                        version: 1,
                        taskId,
                        effectKey,
                        state: "pending",
                        fence: lease.fence,
                        leaseToken: lease.leaseToken,
                        leaseExpiresAt: lease.expiresAt,
                    } satisfies EffectRecord),
                );
                leases.set(leaseKey(scope, taskId, effectKey), lease);
                leasesByBinding.set(lease.leaseToken, lease);
                return { status: "claimed", fence: lease.fence, binding: lease.leaseToken };
            });
        },
        async renew(effectKey, taskId, binding) {
            const owned = ownedLease(effectKey, taskId, binding);
            if (!owned) throw new Error("生成副作用租约缺失");
            return withRecord(owned.scope, taskId, effectKey, async (record, storage, key) => {
                const current = now();
                if (record?.state !== "pending" || record.leaseToken !== owned.leaseToken || record.fence !== owned.fence || Date.parse(record.leaseExpiresAt!) <= current.getTime()) {
                    throw new Error("生成副作用租约已失效");
                }
                owned.expiresAt = new Date(current.getTime() + leaseMs).toISOString();
                await storage.setItem(key, JSON.stringify({ ...record, leaseExpiresAt: owned.expiresAt } satisfies EffectRecord));
                return { fence: owned.fence };
            });
        },
        async complete(effectKey, taskId, result, binding) {
            if (!validResult(result)) throw new Error("生成副作用结果无效");
            const owned = ownedLease(effectKey, taskId, binding);
            if (!owned) throw new Error("生成副作用租约缺失");
            await withRecord(owned.scope, taskId, effectKey, async (record, storage, key) => {
                const current = now();
                if (record?.state !== "pending" || record.leaseToken !== owned.leaseToken || record.fence !== owned.fence || Date.parse(record.leaseExpiresAt!) <= current.getTime()) {
                    throw new Error("生成副作用租约已失效");
                }
                await storage.setItem(
                    key,
                    JSON.stringify({
                        version: 1,
                        taskId,
                        effectKey,
                        state: "completed",
                        fence: owned.fence,
                        completedAt: current.toISOString(),
                        result: { ...result },
                    } satisfies EffectRecord),
                );
                forgetLease(owned);
            });
        },
        async release(effectKey, taskId, binding) {
            const owned = ownedLease(effectKey, taskId, binding);
            if (!owned) throw new Error("生成副作用租约缺失");
            await withRecord(owned.scope, taskId, effectKey, async (record, storage, key) => {
                const current = now();
                if (record?.state !== "pending" || record.leaseToken !== owned.leaseToken || record.fence !== owned.fence || Date.parse(record.leaseExpiresAt!) <= current.getTime()) {
                    throw new Error("生成副作用租约已失效");
                }
                await storage.setItem(
                    key,
                    JSON.stringify({
                        version: 1,
                        taskId,
                        effectKey,
                        state: "released",
                        fence: owned.fence,
                        releasedAt: current.toISOString(),
                    } satisfies EffectRecord),
                );
                forgetLease(owned);
            });
        },
    };
}
