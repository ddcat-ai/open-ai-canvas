import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { isUserScopedPersistenceSuppressed, scopedStorageKey } from "@/lib/user-scope";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

// localforage 需要 localStorage / indexedDB 等浏览器存储驱动；测试进程等环境可能只有 window 而无存储 API，
// 此时直接跳过读写，避免 localforage 内部回退并输出 "No available storage method found"。
function browserStorageAvailable(): boolean {
    if (typeof window === "undefined") return false;
    return typeof window.localStorage !== "undefined" || typeof window.indexedDB !== "undefined";
}

export function localForageStorageForScope(scope?: string): StateStorage {
    const keyFor = (name: string) => scopedStorageKey(name, scope);
    return {
        getItem: async (name) => {
            if (!browserStorageAvailable()) return null;
            return (await localforage.getItem<string>(keyFor(name))) || null;
        },
        setItem: async (name, value) => {
            if (!browserStorageAvailable()) return;
            if (isUserScopedPersistenceSuppressed()) return;
            await localforage.setItem(keyFor(name), value);
        },
        removeItem: async (name) => {
            if (!browserStorageAvailable()) return;
            if (isUserScopedPersistenceSuppressed()) return;
            await localforage.removeItem(keyFor(name));
        },
    };
}

export const localForageStorage: StateStorage = localForageStorageForScope();
