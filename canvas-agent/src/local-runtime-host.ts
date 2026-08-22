import path from "node:path";

import { createServer, type Server } from "node:http";

import {
    CONFIG_DIR,
    LOCAL_RUNTIME_DEFAULT_PORT,
    VERSION,
    ensureRuntimeOwnerId,
    loadConfig,
    saveConfig,
    type LocalRuntimeConfig,
} from "./config.js";
import { createLocalRuntimeApp, type LocalRuntimeModule } from "./local-runtime.js";
import { LocalRuntimeSessionManager } from "./local-runtime-session.js";
import { createCanvasAgentHttpModule } from "./modules/canvas-agent-http.js";
import { createDreaminaHttpModule } from "./modules/dreamina-http.js";

export type StartLocalRuntimeOptions = {
    config?: LocalRuntimeConfig;
    modules?: readonly LocalRuntimeModule[];
    port?: number;
    log?: (line: string) => void;
    persistConfig?: (config: LocalRuntimeConfig) => void;
};

export function createDefaultLocalRuntimeModules(config: LocalRuntimeConfig): LocalRuntimeModule[] {
    return [
        createCanvasAgentHttpModule(config),
        createDreaminaHttpModule({
            ownerId: ensureRuntimeOwnerId(config),
            configDir: CONFIG_DIR,
            referenceRoots: () => [
                path.join(CONFIG_DIR, "codex-workspaces"),
                ...Object.values(config.canvases ?? {}).map((canvas) => canvas.workspacePath),
            ],
        }),
    ];
}

export function startLocalRuntime(options: StartLocalRuntimeOptions = {}) {
    const config = options.config ?? loadConfig(true);
    const persistConfig = options.persistConfig ?? saveConfig;
    const requestedPort = options.port ?? (
        Number(process.env.PORT)
        || Number(new URL(config.url).port)
        || LOCAL_RUNTIME_DEFAULT_PORT
    );
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
        throw new Error("Local Runtime port is invalid");
    }
    const endpoint = requestedPort === 0
        ? config.url
        : `http://127.0.0.1:${requestedPort}`;
    const authority = requestedPort === 0 ? "127.0.0.1:0" : `127.0.0.1:${requestedPort}`;
    const modules = [...(options.modules ?? createDefaultLocalRuntimeModules(config))];
    const sessions = new LocalRuntimeSessionManager({
        endpoint,
        trustedOrigins: config.trustedWebOrigins,
        registrations: config.browserRegistrations,
        persistRegistrations: () => persistConfig(config),
        onSessionRevoked: (sessionId) => {
            for (const module of modules) module.onRuntimeSessionRevoked?.(sessionId);
        },
    });
    const app = createLocalRuntimeApp({
        authority,
        endpoint,
        version: VERSION,
        sessionManager: sessions,
        modules,
        legacyMasterToken: config.token,
        legacyOrigins: config.origins ?? [],
    });
    const server = createServer(app);
    const log = options.log ?? console.log;
    let modulesDisposed = false;
    const disposeModules = async () => {
        if (modulesDisposed) return;
        modulesDisposed = true;
        const errors: unknown[] = [];
        for (const module of modules) {
            try {
                await module.dispose?.();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length) throw new AggregateError(errors, "Local Runtime module disposal failed");
    };
    const ready = (async () => {
        try {
            for (const module of modules) await module.start?.();
            server.listen(requestedPort, "127.0.0.1");
            await listening(server);
            log("Framefield Local Runtime");
            log("Runtime is listening on 127.0.0.1");
            log("Codex MCP: codex mcp add yingce -- npx -y @ddcat666/open-ai-canvas-agent mcp");
        } catch (startupError) {
            sessions.dispose();
            const cleanupErrors: unknown[] = [];
            try { await closeServer(server); } catch (error) { cleanupErrors.push(error); }
            try { await disposeModules(); } catch (error) { cleanupErrors.push(error); }
            if (cleanupErrors.length) {
                throw new AggregateError([startupError, ...cleanupErrors], "Local Runtime startup failed");
            }
            throw startupError;
        }
    })();
    let closePromise: Promise<void> | undefined;
    const close = () => {
        closePromise ??= (async () => {
            try { await ready; } catch { /* Startup error remains observable through ready. */ }
            sessions.dispose();
            const errors: unknown[] = [];
            try { await closeServer(server); } catch (error) { errors.push(error); }
            try { await disposeModules(); } catch (error) { errors.push(error); }
            if (errors.length) throw new AggregateError(errors, "Local Runtime shutdown failed");
        })();
        return closePromise;
    };
    return { app, server, sessions, ready, close };
}

function listening(server: Server) {
    if (server.listening) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
}

function closeServer(server: Server) {
    if (!server.listening) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}
