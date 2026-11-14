import { describe, expect, it } from "bun:test";

import { importLegacyWorkspaceState } from "@/services/legacy-workspace-import";

function memoryStore(seed: Record<string, unknown> = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        async keys() {
            return [...values.keys()];
        },
        async getItem<T>(key: string) {
            return (values.get(key) as T | undefined) ?? null;
        },
        async setItem<T>(key: string, value: T) {
            values.set(key, value);
            return value;
        },
    };
}

function memoryLocalStorage(seed: Record<string, string> = {}) {
    const values = new Map(Object.entries(seed));
    return {
        values,
        get length() {
            return values.size;
        },
        key(index: number) {
            return [...values.keys()][index] ?? null;
        },
        getItem(key: string) {
            return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
            values.set(key, value);
        },
    };
}

describe("legacy local workspace import", () => {
    it("copies only the selected legacy scope and preserves the source", async () => {
        const store = memoryStore({
            "canvas-store:user:legacy-local-user": "legacy canvas",
            "asset-store": "legacy assets",
            "canvas-store:user:another-user": "other account",
        });
        const localStorage = memoryLocalStorage({
            "config-store:user:legacy-local-user": "legacy config",
            "yingce:active-user-scope": "legacy-local-user",
            "config-store:user:another-user": "other config",
        });

        const result = await importLegacyWorkspaceState("remote-user", "legacy-local-user", { storage: store, localStorage });

        expect(result).toEqual({ importedLocalForageKeys: 2, importedLocalStorageKeys: 1, skipped: false });
        expect(store.values.get("canvas-store:user:remote-user")).toBe("legacy canvas");
        expect(store.values.get("asset-store:user:remote-user")).toBe("legacy assets");
        expect(store.values.get("canvas-store:user:legacy-local-user")).toBe("legacy canvas");
        expect(store.values.has("canvas-store:user:another-user")).toBe(true);
        expect(localStorage.values.get("config-store:user:remote-user")).toBe("legacy config");
        expect(localStorage.values.get("yingce:active-user-scope")).toBe("legacy-local-user");
    });

    it("does not overwrite destination data and is idempotent", async () => {
        const store = memoryStore({ "canvas-store:user:legacy": "source", "canvas-store:user:remote": "current" });
        const localStorage = memoryLocalStorage({ "yingce:legacy-workspace-imported:remote": "1" });

        const result = await importLegacyWorkspaceState("remote", "legacy", { storage: store, localStorage });

        expect(result).toEqual({ importedLocalForageKeys: 0, importedLocalStorageKeys: 0, skipped: true });
        expect(store.values.get("canvas-store:user:remote")).toBe("current");
        expect(store.values.get("canvas-store:user:legacy")).toBe("source");
    });
});
