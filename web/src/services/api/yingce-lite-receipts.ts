import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";
import type { StateStorage } from "zustand/middleware";

const RECEIPT_KEY = "yingce-lite-generation-receipts-v1";
export const YINGCE_RECEIPT_PREFIX = "yingce-local:";

type ReceiptDependencies = {
    storageForScope: (scope: string) => StateStorage;
    getScope: () => string;
    lock: <T>(scope: string, operation: () => Promise<T>) => Promise<T>;
};

// The in-process queue also covers environments without the Web Locks API.
const pending = new Map<string, Promise<void>>();
async function withReceiptLock<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    const run = async () => {
        const previous = pending.get(scope) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        pending.set(scope, current);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (pending.get(scope) === current) pending.delete(scope);
        }
    };
    if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(`${RECEIPT_KEY}:${scope}`, run);
    return run();
}

const defaults: ReceiptDependencies = { storageForScope: localForageStorageForScope, getScope: getActiveUserScope, lock: withReceiptLock };

function parseReceipts(value: string | null): GenerationTask[] {
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => item && typeof item === "object" && typeof item.id === "string" && item.id.startsWith(YINGCE_RECEIPT_PREFIX) && item.status === "succeeded")) {
        throw new Error("本地生成回执格式无效，请保留本地数据并联系支持人员");
    }
    return parsed as GenerationTask[];
}

export function createYingceReceiptStore(dependencies: ReceiptDependencies = defaults) {
    return {
        async save(task: GenerationTask, scope = dependencies.getScope()) {
            if (!scope || scope === "guest" || !task.id.startsWith(YINGCE_RECEIPT_PREFIX) || task.status !== "succeeded") throw new Error("无法保存无账号或未完成的生成回执");
            await dependencies.lock(scope, async () => {
                const storage = dependencies.storageForScope(scope);
                const receipts = parseReceipts(await storage.getItem(RECEIPT_KEY));
                const serialized = JSON.stringify([...receipts.filter((receipt) => receipt.id !== task.id), task]);
                await storage.setItem(RECEIPT_KEY, serialized);
                if ((await storage.getItem(RECEIPT_KEY)) !== serialized) throw new Error("生成已完成，但本地回执保存失败；请保留当前页面并检查本地存储");
            });
        },
        async saveIfAbsent(task: GenerationTask, scope = dependencies.getScope()) {
            if (!scope || scope === "guest" || !task.id.startsWith(YINGCE_RECEIPT_PREFIX) || task.status !== "succeeded") throw new Error("无法保存无账号或未完成的生成回执");
            await dependencies.lock(scope, async () => {
                const storage = dependencies.storageForScope(scope);
                const receipts = parseReceipts(await storage.getItem(RECEIPT_KEY));
                if (receipts.some((receipt) => receipt.id === task.id)) return;
                const serialized = JSON.stringify([...receipts, task]);
                await storage.setItem(RECEIPT_KEY, serialized);
                if ((await storage.getItem(RECEIPT_KEY)) !== serialized) throw new Error("生成已完成，但本地回执保存失败；请保留当前页面并检查本地存储");
            });
        },
        async list(scope = dependencies.getScope()) {
            if (!scope || scope === "guest") return [];
            return dependencies.lock(scope, async () => parseReceipts(await dependencies.storageForScope(scope).getItem(RECEIPT_KEY)));
        },
        async get(id: string, scope = dependencies.getScope()) {
            return (await this.list(scope)).find((task) => task.id === id);
        },
    };
}

export const yingceReceiptStore = createYingceReceiptStore();
