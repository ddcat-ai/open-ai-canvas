import { localForageStorageForScope } from "@/lib/localforage-storage";

export function createPluginStorage(pluginId: string) {
    const storage = localForageStorageForScope();
    const keyFor = (key: string) => `infinite-canvas:plugin:${pluginId}:${key}`;
    return {
        get: async <T>(key: string) => {
            const value = await storage.getItem(keyFor(key));
            if (!value) return null;
            try {
                return JSON.parse(value) as T;
            } catch {
                throw new Error(`插件 ${pluginId} 的配置数据损坏`);
            }
        },
        set: async <T>(key: string, value: T) => storage.setItem(keyFor(key), JSON.stringify(value)),
        remove: (key: string) => storage.removeItem(keyFor(key)),
    };
}

