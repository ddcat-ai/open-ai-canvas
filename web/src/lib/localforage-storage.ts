import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

import { scopedStorageKey } from "@/lib/user-scope";

localforage.config({
    name: "infinite-canvas",
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const key = scopedStorageKey(name);
        try {
            return (await localforage.getItem<string>(key)) || null;
        } catch {
            return window.localStorage.getItem(key);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        const key = scopedStorageKey(name);
        try {
            await localforage.setItem(key, value);
        } catch {
            window.localStorage.setItem(key, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        const key = scopedStorageKey(name);
        try {
            await localforage.removeItem(key);
        } catch {
            window.localStorage.removeItem(key);
        }
    },
};
