import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { PluginInstallation, PluginManifest } from "@/lib/plugins/plugin-types";

export const PLUGIN_STORE_KEY = "infinite-canvas:plugin-store";

type PluginStore = {
    hydrated: boolean;
    installations: PluginInstallation[];
    ensurePlugin: (manifest: PluginManifest) => void;
    setEnabled: (pluginId: string, enabled: boolean) => void;
    updateConfig: (pluginId: string, config: Record<string, string | number | boolean>) => void;
    setError: (pluginId: string, error?: string) => void;
    removePlugin: (pluginId: string) => void;
};

function now() {
    return new Date().toISOString();
}

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => ({
            hydrated: false,
            installations: [],
            ensurePlugin: (manifest) =>
                set((state) => {
                    const current = state.installations.find((item) => item.manifest.id === manifest.id);
                    if (current && current.manifest.version === manifest.version) return { hydrated: true };
                    const timestamp = now();
                    const next: PluginInstallation = current
                        ? { ...current, manifest, updatedAt: timestamp }
                        : { manifest, enabled: false, config: {}, installedAt: timestamp, updatedAt: timestamp };
                    return { hydrated: true, installations: [...state.installations.filter((item) => item.manifest.id !== manifest.id), next] };
                }),
            setEnabled: (pluginId, enabled) =>
                set((state) => ({
                    installations: state.installations.map((item) => item.manifest.id === pluginId ? { ...item, enabled, updatedAt: now(), lastError: undefined } : item),
                })),
            updateConfig: (pluginId, config) =>
                set((state) => ({
                    installations: state.installations.map((item) => item.manifest.id === pluginId ? { ...item, config: { ...item.config, ...config }, updatedAt: now() } : item),
                })),
            setError: (pluginId, error) =>
                set((state) => ({
                    installations: state.installations.map((item) => item.manifest.id === pluginId ? { ...item, lastError: error, updatedAt: now() } : item),
                })),
            removePlugin: (pluginId) => set((state) => ({ installations: state.installations.filter((item) => item.manifest.id !== pluginId) })),
        }),
        {
            name: PLUGIN_STORE_KEY,
            storage: createJSONStorage(() => localForageStorageForScope()),
            partialize: (state) => ({ installations: state.installations }),
            onRehydrateStorage: () => (state) => {
                if (state) state.hydrated = true;
            },
        },
    ),
);
