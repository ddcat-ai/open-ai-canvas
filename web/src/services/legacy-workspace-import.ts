import localforage from "localforage";

import { scopedStorageKey } from "@/lib/user-scope";

type LegacyStorage = {
    keys(): Promise<string[]>;
    getItem<T = unknown>(key: string): Promise<T | null>;
    setItem<T = unknown>(key: string, value: T): Promise<T>;
};

type LegacyLocalStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem">;

export type LegacyWorkspaceImportResult = { importedLocalForageKeys: number; importedLocalStorageKeys: number; skipped: boolean };

function sourceKeyName(key: string, sourceScope: string) {
    const suffix = `:user:${sourceScope}`;
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
    if (!key.includes(":user:")) return key;
    return "";
}

function sourceLocalStorageName(key: string, sourceScope: string) {
    if (key === "yingce:active-user-scope" || key.startsWith("yingce:legacy-workspace-imported:")) return "";
    return sourceKeyName(key, sourceScope);
}

export async function importLegacyWorkspaceState(
    targetScope: string,
    sourceScope: string,
    dependencies: { storage?: LegacyStorage; localStorage?: LegacyLocalStorage } = {},
): Promise<LegacyWorkspaceImportResult> {
    if (!targetScope || targetScope === "guest" || targetScope.length > 200) throw new Error("目标影策账号分区无效");
    if (!sourceScope || sourceScope.length > 200) throw new Error("旧版本地分区无效");
    const storage = dependencies.storage || localforage;
    const localStorage = dependencies.localStorage || window.localStorage;
    const marker = `yingce:legacy-workspace-imported:${targetScope}`;
    if (localStorage.getItem(marker) === "1") return { importedLocalForageKeys: 0, importedLocalStorageKeys: 0, skipped: true };

    let importedLocalForageKeys = 0;
    for (const sourceKey of await storage.keys()) {
        const name = sourceKeyName(sourceKey, sourceScope);
        if (!name) continue;
        const value = await storage.getItem(sourceKey);
        if (value === null) continue;
        const destination = scopedStorageKey(name, targetScope);
        if ((await storage.getItem(destination)) !== null) continue;
        await storage.setItem(destination, value);
        importedLocalForageKeys += 1;
    }

    let importedLocalStorageKeys = 0;
    const sourceKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((key): key is string => Boolean(key));
    for (const sourceKey of sourceKeys) {
        const name = sourceLocalStorageName(sourceKey, sourceScope);
        if (!name) continue;
        const value = localStorage.getItem(sourceKey);
        if (value === null) continue;
        const destination = scopedStorageKey(name, targetScope);
        if (localStorage.getItem(destination) !== null) continue;
        localStorage.setItem(destination, value);
        importedLocalStorageKeys += 1;
    }

    localStorage.setItem(marker, "1");
    return { importedLocalForageKeys, importedLocalStorageKeys, skipped: false };
}
