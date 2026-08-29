import type { Express } from "express";

import { CanvasSession } from "./canvas-session.js";
import { CONFIG_DIR, type LocalRuntimeConfig } from "./config.js";
import { createLocalRuntimeApp } from "./local-runtime.js";
import { startLocalRuntime } from "./local-runtime-host.js";
import { LocalRuntimeSessionManager } from "./local-runtime-session.js";
import {
    createCanvasAgentHttpModule,
    type CanvasAgentSession,
} from "./modules/canvas-agent-http.js";
import {
    createDreaminaHttpModule,
    type DreaminaHttpModuleOptions,
} from "./modules/dreamina-http.js";
import { createPortraitClearanceHttpModule } from "./modules/portrait-clearance-http.js";

export type CanvasAgentHttpDependencies = Pick<DreaminaHttpModuleOptions, "dreamina">;

type CanvasAgentHttpOptions = {
    config: LocalRuntimeConfig;
    session: CanvasAgentSession;
    dependencies: CanvasAgentHttpDependencies;
};

export function startHttpServer(options?: CanvasAgentHttpOptions): ReturnType<typeof startLocalRuntime> | Express {
    if (!options) return startLocalRuntime();
    return createHttpApp(options.config, options.session, options.dependencies);
}

export function createHttpApp(
    config: LocalRuntimeConfig,
    session: CanvasAgentSession = new CanvasSession(),
    dependencies: CanvasAgentHttpDependencies = {},
): Express {
    const endpoint = config.url;
    const manager = new LocalRuntimeSessionManager({
        endpoint,
        trustedOrigins: config.trustedWebOrigins,
        registrations: config.browserRegistrations,
    });
    return createLocalRuntimeApp({
        authority: new URL(endpoint).host,
        endpoint,
        version: "0.1.0",
        sessionManager: manager,
        modules: [
            createCanvasAgentHttpModule(config, session),
            createDreaminaHttpModule({ ownerId: config.ownerId!, ...dependencies }),
            createPortraitClearanceHttpModule({ ownerId: config.ownerId!, configDir: CONFIG_DIR }),
        ],
        legacyMasterToken: config.token,
        legacyOrigins: config.origins ?? [],
    });
}

export { createLocalRuntimeApp, startLocalRuntime };
