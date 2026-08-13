import { useEffect } from "react";
import { create } from "zustand";

import { getDreaminaModelCatalogSnapshotWithSessionRecovery, type DreaminaLocalModel } from "@/services/local-dreamina-model-catalog";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";

type State = { state: "idle" | "loading" | "ready" | "error"; models: DreaminaLocalModel[]; cacheScope?: string; sync(signal?: AbortSignal): Promise<void> };

export const dreaminaModelCacheScopeKey = ({ accountBinding, sessionEpoch }: { accountBinding: string; sessionEpoch: string | number }) => `${accountBinding}:${sessionEpoch}`;

export const useLocalDreaminaModelStore = create<State>((set, get) => ({
    state: "idle", models: [], cacheScope: undefined,
    async sync(signal) {
        const runtime = useLocalRuntimeStore.getState();
        const available = runtime.connection === "connected" && runtime.modules.some((module) => module.id === "dreamina" && module.scopes.includes("dreamina:models"));
        if (!available) { set({ state: "idle", models: [], cacheScope: undefined }); return; }
        const client = getLocalRuntimeSessionClient();
        try {
            const snapshot = await getDreaminaModelCatalogSnapshotWithSessionRecovery(client, signal);
            const cacheScope = dreaminaModelCacheScopeKey(snapshot);
            set({ state: "ready", models: snapshot.models, cacheScope });
        } catch {
            if (!signal?.aborted) set({ state: "error", models: [], cacheScope: undefined });
        }
    },
}));

export function useLocalDreaminaModelBootstrap() {
    const connection = useLocalRuntimeStore((state) => state.connection);
    const modules = useLocalRuntimeStore((state) => state.modules);
    const sync = useLocalDreaminaModelStore((state) => state.sync);
    useEffect(() => { const controller = new AbortController(); void sync(controller.signal); return () => controller.abort(); }, [connection, modules, sync]);
}
