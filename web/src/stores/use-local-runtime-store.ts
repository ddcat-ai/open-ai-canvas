import { useEffect } from "react";
import { create } from "zustand";

import { readLocalRuntimeStatus, type LocalRuntimeModuleDescriptor, type LocalRuntimeStatus, type LocalRuntimeTransport } from "@/services/local-runtime";
import { LocalRuntimeClientError, LocalRuntimeSessionClient, type LocalRuntimeConnection } from "@/services/local-runtime-session";

export type LocalRuntimeConnectionState = "idle" | "connecting" | "connected" | "origin_not_trusted" | "unreachable" | "incompatible" | "runtime_error";

type LocalRuntimeSessionTransport = LocalRuntimeTransport & {
    connect(signal?: AbortSignal): Promise<LocalRuntimeConnection>;
    revokeLocalSession?(): void;
};

type LocalRuntimeStore = {
    connection: LocalRuntimeConnectionState;
    connecting: boolean;
    runtime: LocalRuntimeStatus["runtime"] | null;
    modules: LocalRuntimeModuleDescriptor[];
    error: string;
    connect(signal?: AbortSignal): Promise<void>;
};

type LocalRuntimeStoreDependencies = {
    client?: LocalRuntimeSessionTransport;
    timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;
let browserClient: LocalRuntimeSessionClient | undefined;

export function getLocalRuntimeSessionClient() {
    browserClient ??= new LocalRuntimeSessionClient();
    return browserClient;
}

export function createLocalRuntimeStore(dependencies: LocalRuntimeStoreDependencies = {}) {
    const client = () => dependencies.client ?? getLocalRuntimeSessionClient();
    let revision = 0;
    let activeController: AbortController | undefined;

    return create<LocalRuntimeStore>((set, get) => ({
        connection: "idle",
        connecting: false,
        runtime: null,
        modules: [],
        error: "",
        connect: async (signal) => {
            if (signal?.aborted) return;
            const requestRevision = ++revision;
            activeController?.abort();
            const controller = new AbortController();
            activeController = controller;
            let timedOut = false;
            const cancel = () => controller.abort();
            if (signal?.aborted) controller.abort();
            else signal?.addEventListener("abort", cancel, { once: true });
            const timer = setTimeout(
                () => {
                    timedOut = true;
                    controller.abort();
                },
                Math.max(1, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            );

            const previous = get();
            set({
                connection: previous.connection === "connected" ? "connected" : "connecting",
                connecting: true,
                error: "",
            });
            try {
                const result = await client().connect(controller.signal);
                if (requestRevision !== revision) return;
                if (result.state === "origin_not_trusted") {
                    set({
                        connection: "origin_not_trusted",
                        connecting: false,
                        runtime: null,
                        modules: [],
                        error: "本机连接需要重新建立",
                    });
                    return;
                }

                let status: LocalRuntimeStatus;
                try {
                    status = await readLocalRuntimeStatus(client(), controller.signal);
                } catch (error) {
                    if (!(error instanceof LocalRuntimeClientError) || (error.code !== "session_required" && error.code !== "scope_denied")) throw error;
                    client().revokeLocalSession?.();
                    const reconnected = await client().connect(controller.signal);
                    if (reconnected.state !== "connected") throw error;
                    status = await readLocalRuntimeStatus(client(), controller.signal);
                }
                if (requestRevision !== revision) return;
                set({
                    connection: "connected",
                    connecting: false,
                    runtime: status.runtime,
                    modules: status.modules,
                    error: "",
                });
            } catch (error) {
                if (requestRevision !== revision) return;
                if (signal?.aborted || (controller.signal.aborted && !timedOut)) {
                    set({
                        connection: previous.connection,
                        connecting: false,
                        runtime: previous.runtime,
                        modules: previous.modules,
                        error: previous.error,
                    });
                    return;
                }
                const failure = connectionFailure(error, timedOut);
                if (get().connection === "connected") {
                    set({ connecting: false, error: failure.error });
                } else {
                    set({
                        connection: failure.connection,
                        connecting: false,
                        runtime: null,
                        modules: [],
                        error: failure.error,
                    });
                }
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener("abort", cancel);
                if (activeController === controller) activeController = undefined;
            }
        },
    }));
}

export const useLocalRuntimeStore = createLocalRuntimeStore();

export function startLocalRuntimeBootstrap(
    connect: (signal?: AbortSignal) => Promise<void>,
    schedule: (run: () => void) => () => void = (run) => {
        const timer = window.setTimeout(run, 0);
        return () => window.clearTimeout(timer);
    },
) {
    const controller = new AbortController();
    let started = false;
    const cancelScheduled = schedule(() => {
        if (started) return;
        started = true;
        void connect(controller.signal);
    });
    return () => {
        cancelScheduled();
        controller.abort();
    };
}

export function useLocalRuntimeBootstrap(enabled = true) {
    const connect = useLocalRuntimeStore((state) => state.connect);
    useEffect(() => {
        if (!enabled) return;
        return startLocalRuntimeBootstrap(connect);
    }, [connect, enabled]);
}

function connectionFailure(error: unknown, timedOut: boolean) {
    if (timedOut) {
        return { connection: "unreachable" as const, error: "本机服务连接超时" };
    }
    if (error instanceof LocalRuntimeClientError) {
        if (error.code === "origin_not_trusted") {
            return { connection: "origin_not_trusted" as const, error: "本机连接需要重新建立" };
        }
        if (["browser_key_invalid", "challenge_invalid", "origin_invalid", "runtime_incompatible", "runtime_response_invalid", "signature_invalid", "webcrypto_unavailable"].includes(error.code)) {
            return { connection: "incompatible" as const, error: error.message };
        }
        return { connection: "runtime_error" as const, error: error.message };
    }
    return { connection: "unreachable" as const, error: "未发现本机服务，请确认本机服务已启用" };
}
