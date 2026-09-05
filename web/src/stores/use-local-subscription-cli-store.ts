import { useEffect } from "react";
import { create } from "zustand";

import { getSubscriptionCliStatus, type SubscriptionCliModel, type SubscriptionCliStatus } from "@/services/local-subscription-cli";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";

type State = {
    state: "idle" | "loading" | "ready" | "error";
    status?: SubscriptionCliStatus;
    models: SubscriptionCliModel[];
    sync(signal?: AbortSignal): Promise<void>;
};

export const useLocalSubscriptionCliStore = create<State>((set) => ({
    state: "idle",
    models: [],
    async sync(signal) {
        const runtime = useLocalRuntimeStore.getState();
        const available = runtime.connection === "connected" && runtime.modules.some((module) => module.id === "subscription-cli" && module.scopes.includes("subscription:status"));
        if (!available) {
            set({ state: "idle", status: undefined, models: [] });
            return;
        }
        set({ state: "loading" });
        try {
            const status = await getSubscriptionCliStatus(getLocalRuntimeSessionClient(), signal);
            if (!signal?.aborted) set({ state: "ready", status, models: status.models });
        } catch {
            if (!signal?.aborted) set({ state: "error", status: undefined, models: [] });
        }
    },
}));

export function useLocalSubscriptionCliBootstrap() {
    const connection = useLocalRuntimeStore((state) => state.connection);
    const modules = useLocalRuntimeStore((state) => state.modules);
    const sync = useLocalSubscriptionCliStore((state) => state.sync);
    useEffect(() => {
        const controller = new AbortController();
        void sync(controller.signal);
        return () => controller.abort();
    }, [connection, modules, sync]);
}
