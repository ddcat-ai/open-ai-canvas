import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorageForScope } from "@/lib/localforage-storage";
import type { PluginInstallation, PluginManifest } from "@/lib/plugins/plugin-types";
import type { PluginState } from "@/services/api/plugins";

export const PLUGIN_STORE_KEY = "infinite-canvas:plugin-store";

type PluginStore = {
    hydrated: boolean;
    installations: PluginInstallation[];
    runtimeStatuses: Record<string, string>;
    pluginStates: Record<string, PluginState>;
    ensurePlugin: (manifest: PluginManifest) => void;
    setRuntimeStatuses: (statuses: Record<string, string>) => void;
    setPluginStates: (states: Record<string, PluginState>) => void;
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
            runtimeStatuses: {},
            pluginStates: {},
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
            setRuntimeStatuses: (runtimeStatuses) => set({ runtimeStatuses }),
            setPluginStates: (pluginStates) => set({ pluginStates }),
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
                if (state) usePluginStore.setState({ hydrated: true });
            },
        },
    ),
);

export function isPluginEffectivelyEnabled(pluginId: string, fallbackEnabled?: boolean) {
    const state = usePluginStore.getState();
    const serverState = state.pluginStates[pluginId];
    if (serverState) return serverState.effectiveEnabled;
    if (pluginId in state.runtimeStatuses) return state.runtimeStatuses[pluginId] === "enabled";
    if (fallbackEnabled !== undefined) return fallbackEnabled;
    return Boolean(state.installations.find((item) => item.manifest.id === pluginId)?.enabled);
}
