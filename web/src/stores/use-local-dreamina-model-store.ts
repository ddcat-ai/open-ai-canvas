import { useEffect } from "react";
import { create } from "zustand";

import { getDreaminaModelCatalogSnapshotWithSessionRecovery, type DreaminaLocalModel } from "@/services/local-dreamina-model-catalog";
import { getLocalRuntimeSessionClient, useLocalRuntimeStore } from "@/stores/use-local-runtime-store";
import { t } from "@/i18n";

type CatalogSnapshot = Awaited<ReturnType<typeof getDreaminaModelCatalogSnapshotWithSessionRecovery>>;
type RuntimeCatalogState = { connection: string; modules: Array<{ id: string; scopes: string[] }> };
type Dependencies = {
    getRuntimeState(): RuntimeCatalogState;
    getClient(): Parameters<typeof getDreaminaModelCatalogSnapshotWithSessionRecovery>[0];
    loadSnapshot(client: Parameters<typeof getDreaminaModelCatalogSnapshotWithSessionRecovery>[0], signal: AbortSignal): Promise<CatalogSnapshot>;
    requestTimeoutMs?: number;
};
type State = {
    state: "idle" | "loading" | "ready" | "error";
    models: DreaminaLocalModel[];
    cacheScope?: string;
    sync(signal?: AbortSignal): Promise<void>;
    ensureReady(signal?: AbortSignal): Promise<DreaminaLocalModel[]>;
};

export const dreaminaModelCacheScopeKey = ({ accountBinding, sessionEpoch }: { accountBinding: string; sessionEpoch: string | number }) => `${accountBinding}:${sessionEpoch}`;

const DEFAULT_CATALOG_TIMEOUT_MS = 8_000;

export function createLocalDreaminaModelStore(dependencies: Dependencies) {
    let requestRevision = 0;
    let activeRequest: { revision: number; controller: AbortController; promise: Promise<DreaminaLocalModel[]> } | null = null;
    return create<State>((set, get) => {
        const load = (force: boolean, signal?: AbortSignal) => {
            const runtime = dependencies.getRuntimeState();
            const available = runtime.connection === "connected" && runtime.modules.some((module) => module.id === "dreamina" && module.scopes.includes("dreamina:models"));
            if (!available) {
                requestRevision++;
                activeRequest?.controller.abort();
                activeRequest = null;
                set({ state: "idle", models: [], cacheScope: undefined });
                return Promise.reject(new Error(t("domain:the-dreamina-local-model-catalog-is-not-ready-yet")));
            }
            const current = get();
            if (!force && current.state === "ready" && current.models.length) return Promise.resolve(current.models);
            if (force && activeRequest) {
                requestRevision++;
                activeRequest.controller.abort();
                activeRequest = null;
            }
            if (!activeRequest) {
                set({ state: "loading" });
                const revision = ++requestRevision;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), Math.max(1, dependencies.requestTimeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS));
                const promise = dependencies
                    .loadSnapshot(dependencies.getClient(), controller.signal)
                    .then((snapshot) => {
                        if (revision === requestRevision) set({ state: "ready", models: snapshot.models, cacheScope: dreaminaModelCacheScopeKey(snapshot) });
                        return snapshot.models;
                    })
                    .catch((error) => {
                        if (revision === requestRevision) set({ state: "error", models: [], cacheScope: undefined });
                        throw error;
                    })
                    .finally(() => {
                        clearTimeout(timer);
                        if (activeRequest?.revision === revision) activeRequest = null;
                    });
                activeRequest = { revision, controller, promise };
            }
            return waitForCatalog(activeRequest.promise, signal);
        };
        return {
            state: "idle",
            models: [],
            cacheScope: undefined,
            async sync(signal) {
                try {
                    await load(true, signal);
                } catch {
                    // 页面引导读取失败只投影 store 状态；生成入口的 ensureReady 会明确失败。
                }
            },
            ensureReady(signal) {
                return load(false, signal);
            },
        };
    });
}

function waitForCatalog<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
}

export const useLocalDreaminaModelStore = createLocalDreaminaModelStore({
    getRuntimeState: () => useLocalRuntimeStore.getState(),
    getClient: getLocalRuntimeSessionClient,
    loadSnapshot: (client, signal) => getDreaminaModelCatalogSnapshotWithSessionRecovery(client, signal),
});

export function useLocalDreaminaModelBootstrap() {
    const connection = useLocalRuntimeStore((state) => state.connection);
    const modules = useLocalRuntimeStore((state) => state.modules);
    const sync = useLocalDreaminaModelStore((state) => state.sync);
    useEffect(() => {
        const controller = new AbortController();
        void sync(controller.signal);
        return () => controller.abort();
    }, [connection, modules, sync]);
}
