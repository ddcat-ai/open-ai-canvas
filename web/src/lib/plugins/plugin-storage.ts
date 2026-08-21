import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { PluginStorage } from "./plugin-types";

const PLUGIN_STORAGE_PREFIX = "infinite-canvas:plugin-storage:";

export function pluginStorageFor(pluginId: string): PluginStorage {
    const storage = localForageStorageForScope();
    const keyFor = (key: string) => PLUGIN_STORAGE_PREFIX + pluginId + ":" + key;
    return {
        get: async <T>(key: string) => {
            const value = await storage.getItem(keyFor(key));
            if (!value) return null;
            try {
                return JSON.parse(value) as T;
            } catch {
                return value as T;
            }
        },
        set: async <T>(key: string, value: T) => {
            const serialized = JSON.stringify(value);
            if (serialized === undefined) {
                await storage.removeItem(keyFor(key));
                return;
            }
            await storage.setItem(keyFor(key), serialized);
        },
        remove: async (key) => { await storage.removeItem(keyFor(key)); },
    };
}