import { expect, test } from "bun:test";
import fs from "node:fs/promises";

import { LocalRuntimeClientError } from "../src/services/local-runtime-session";

const privateCanary = "runtime-private-canary";

test("Runtime status projects only exact public module descriptors", async () => {
    const module = await import("../src/services/local-runtime").catch(() => ({}));
    const readStatus = (
        module as {
            readLocalRuntimeStatus?: (client: RuntimeTransport) => Promise<unknown>;
        }
    ).readLocalRuntimeStatus;
    expect(typeof readStatus).toBe("function");
    if (!readStatus) return;

    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const client: RuntimeTransport = {
        async request(path, init) {
            requests.push({ path, init });
            return jsonResponse({
                ok: true,
                runtime: { id: "framefield-local-runtime", version: "0.1.0", apiVersion: 2 },
                modules: [
                    {
                        id: "canvas-agent",
                        displayName: "Canvas Agent",
                        apiVersion: 1,
                        scopes: ["canvas:connect"],
                    },
                    {
                        id: "dreamina",
                        displayName: "Dreamina CLI",
                        apiVersion: 1,
                        scopes: ["dreamina:status", "dreamina:login", "dreamina:logout", "dreamina:models", "dreamina:generate"],
                    },
                ],
            });
        },
    };

    const status = await readStatus(client);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: "/runtime/status", init: { method: "GET" } });
    expect(status).toEqual({
        runtime: { id: "framefield-local-runtime", version: "0.1.0", apiVersion: 2 },
        modules: [
            { id: "canvas-agent", displayName: "Canvas Agent", apiVersion: 1, scopes: ["canvas:connect"] },
            { id: "dreamina", displayName: "Dreamina CLI", apiVersion: 1, scopes: ["dreamina:status", "dreamina:login", "dreamina:logout", "dreamina:models", "dreamina:generate"] },
        ],
    });
    expect(JSON.stringify(status)).not.toContain("ownerId");
    expect(JSON.stringify(status)).not.toContain("token");
});

test("Runtime status rejects sensitive or contradictory response fields without echoing them", async () => {
    const module = await import("../src/services/local-runtime").catch(() => ({}));
    const readStatus = (
        module as {
            readLocalRuntimeStatus?: (client: RuntimeTransport) => Promise<unknown>;
        }
    ).readLocalRuntimeStatus;
    expect(typeof readStatus).toBe("function");
    if (!readStatus) return;

    const fixtures = [
        {
            ok: true,
            runtime: { id: "framefield-local-runtime", version: "0.1.0", apiVersion: 2, ownerId: privateCanary },
            modules: [],
        },
        {
            ok: true,
            runtime: { id: "framefield-local-runtime", version: "0.1.0", apiVersion: 2 },
            modules: [
                { id: "dreamina", displayName: "Dreamina CLI", apiVersion: 1, scopes: ["dreamina:status"] },
                { id: "dreamina", displayName: "Dreamina CLI", apiVersion: 1, scopes: ["dreamina:status"] },
            ],
        },
        {
            ok: false,
            code: "private_error",
            message: privateCanary,
        },
    ];

    for (const [index, body] of fixtures.entries()) {
        let caught: unknown;
        try {
            await readStatus({ request: async () => jsonResponse(body, index === 2 ? 500 : 200) });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(String(caught)).not.toContain(privateCanary);
    }
});

test("Runtime store automatically connects and reads descriptors without storing endpoint or bearer data", async () => {
    const module = await import("../src/stores/use-local-runtime-store").catch(() => ({}));
    const createStore = (
        module as {
            createLocalRuntimeStore?: (dependencies: unknown) => RuntimeStore;
        }
    ).createLocalRuntimeStore;
    expect(typeof createStore).toBe("function");
    if (!createStore) return;

    let statusRequests = 0;
    const client = {
        async connect() {
            return {
                state: "connected" as const,
                runtimeVersion: 2,
                session: {
                    sessionId: "public-session-handle",
                    keyId: "k".repeat(43),
                    scopes: ["runtime:status"],
                    expiresAt: "2026-08-10T00:10:00.000Z",
                },
            };
        },
        async request() {
            statusRequests++;
            return runtimeStatusResponse();
        },
    };
    const store = createStore({ client, timeoutMs: 1_000 });

    await store.getState().connect();
    const connected = store.getState();
    expect(connected.connection).toBe("connected");
    expect(connected.modules.map((item) => item.id)).toEqual(["canvas-agent", "dreamina"]);
    expect(statusRequests).toBe(1);
    expect("endpoint" in connected).toBe(false);
    expect("token" in connected).toBe(false);
    expect("session" in connected).toBe(false);
});

test("Runtime store replaces a stale signed session after Runtime restart before publishing connected", async () => {
    const module = await import("../src/stores/use-local-runtime-store");
    let connects = 0;
    let revocations = 0;
    let statusReads = 0;
    const store = module.createLocalRuntimeStore({
        client: {
            async connect() {
                connects += 1;
                return {
                    state: "connected" as const,
                    runtimeVersion: 2,
                    session: { sessionId: `session-${connects}`, keyId: "k".repeat(43), scopes: ["runtime:status"], expiresAt: "2099-01-01T00:00:00.000Z" },
                };
            },
            revokeLocalSession() {
                revocations += 1;
            },
            async request() {
                statusReads += 1;
                if (statusReads === 1) throw new LocalRuntimeClientError("session_required", "stale", 401);
                return runtimeStatusResponse();
            },
        },
        timeoutMs: 1_000,
    });

    await store.getState().connect();

    expect({ connects, revocations, statusReads }).toEqual({ connects: 2, revocations: 1, statusReads: 2 });
    expect(store.getState()).toMatchObject({ connection: "connected", connecting: false, error: "" });
    expect(store.getState().modules.map((item) => item.id)).toEqual(["canvas-agent", "dreamina"]);
});

test("Runtime store exposes an actionable reconnect message without origin or authorization terminology", async () => {
    const module = await import("../src/stores/use-local-runtime-store");
    const store = module.createLocalRuntimeStore({
        client: {
            connect: async () => ({ state: "origin_not_trusted" as const, runtimeVersion: 2 }),
            request: async () => {
                throw new Error("must not read Runtime status");
            },
        },
        timeoutMs: 1_000,
    });

    await store.getState().connect();

    expect(store.getState()).toMatchObject({
        connection: "origin_not_trusted",
        connecting: false,
        error: "domain:the-local-connection-needs-to-be-re-established",
    });
    expect(store.getState().error).not.toMatch(/来源|Origin|授权|Runtime/i);
});

test("Runtime store ignores an older connection result after a newer request succeeds", async () => {
    const module = await import("../src/stores/use-local-runtime-store").catch(() => ({}));
    const createStore = (
        module as {
            createLocalRuntimeStore?: (dependencies: unknown) => RuntimeStore;
        }
    ).createLocalRuntimeStore;
    expect(typeof createStore).toBe("function");
    if (!createStore) return;

    let resolveFirst!: (value: { state: "origin_not_trusted"; runtimeVersion: number }) => void;
    const first = new Promise<{ state: "origin_not_trusted"; runtimeVersion: number }>((resolve) => {
        resolveFirst = resolve;
    });
    let calls = 0;
    const store = createStore({
        client: {
            connect: async () =>
                calls++ === 0
                    ? await first
                    : {
                          state: "connected" as const,
                          runtimeVersion: 2,
                          session: {
                              sessionId: "public-session-handle",
                              keyId: "k".repeat(43),
                              scopes: ["runtime:status"],
                              expiresAt: "2026-08-10T00:10:00.000Z",
                          },
                      },
            request: async () => runtimeStatusResponse(),
        },
        timeoutMs: 1_000,
    });

    const stale = store.getState().connect();
    await Promise.resolve();
    await store.getState().connect();
    resolveFirst({ state: "origin_not_trusted", runtimeVersion: 2 });
    await stale;

    expect(store.getState().connection).toBe("connected");
    expect(store.getState().runtime?.id).toBe("framefield-local-runtime");
});

test("Runtime store does not dispatch an already-cancelled connection", async () => {
    const module = await import("../src/stores/use-local-runtime-store");
    let connectCalls = 0;
    const store = module.createLocalRuntimeStore({
        client: {
            connect: async () => {
                connectCalls++;
                throw new DOMException("aborted", "AbortError");
            },
            request: async () => runtimeStatusResponse(),
        },
        timeoutMs: 1_000,
    });
    const controller = new AbortController();
    controller.abort();

    await store.getState().connect(controller.signal);

    expect(connectCalls).toBe(0);
    expect(store.getState()).toMatchObject({ connection: "idle", connecting: false, error: "" });
});

test("Runtime store exposes a bounded timeout instead of hanging", async () => {
    const module = await import("../src/stores/use-local-runtime-store");
    const store = module.createLocalRuntimeStore({
        client: {
            connect: async (signal?: AbortSignal) =>
                await new Promise((_resolve, reject) => {
                    signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
                }),
            request: async () => runtimeStatusResponse(),
        },
        timeoutMs: 5,
    });

    await store.getState().connect();

    expect(store.getState()).toMatchObject({
        connection: "unreachable",
        connecting: false,
        error: "domain:local-service-connection-timed-out",
    });
});

test("the application root starts local Runtime discovery before provider catalogs bootstrap", async () => {
    const source = await fs.readFile(new URL("../src/components/layout/client-root-init.tsx", import.meta.url), "utf8");
    expect(source).toContain("useLocalRuntimeBootstrap");
    expect(source.indexOf("useLocalRuntimeBootstrap()")).toBeLessThan(source.indexOf("useLocalDreaminaModelBootstrap()"));
});

test("Runtime bootstrap schedules one connect and aborts it on cleanup", async () => {
    const module = (await import("../src/stores/use-local-runtime-store")) as {
        startLocalRuntimeBootstrap?: (connect: (signal?: AbortSignal) => Promise<void>, schedule: (run: () => void) => () => void) => () => void;
    };
    expect(typeof module.startLocalRuntimeBootstrap).toBe("function");
    if (!module.startLocalRuntimeBootstrap) return;

    let scheduled: (() => void) | undefined;
    let cancelled = 0;
    const signals: AbortSignal[] = [];
    const cleanup = module.startLocalRuntimeBootstrap(
        async (signal) => {
            if (signal) signals.push(signal);
        },
        (run) => {
            scheduled = run;
            return () => {
                cancelled += 1;
            };
        },
    );
    expect(signals).toHaveLength(0);
    scheduled?.();
    scheduled?.();
    expect(signals).toHaveLength(1);
    cleanup();
    expect({ cancelled, aborted: signals[0]?.aborted }).toEqual({ cancelled: 1, aborted: true });
});

type RuntimeTransport = {
    request(path: string, init?: RequestInit): Promise<Response>;
};

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
}

function runtimeStatusResponse() {
    return jsonResponse({
        ok: true,
        runtime: { id: "framefield-local-runtime", version: "0.1.0", apiVersion: 2 },
        modules: [
            { id: "canvas-agent", displayName: "Canvas Agent", apiVersion: 1, scopes: ["canvas:connect"] },
            {
                id: "dreamina",
                displayName: "Dreamina CLI",
                apiVersion: 1,
                scopes: ["dreamina:status", "dreamina:login", "dreamina:logout"],
            },
        ],
    });
}

type RuntimeStore = {
    getState(): {
        connection: string;
        connecting: boolean;
        runtime: null | { id: string };
        modules: Array<{ id: string }>;
        connect(): Promise<void>;
    };
};
