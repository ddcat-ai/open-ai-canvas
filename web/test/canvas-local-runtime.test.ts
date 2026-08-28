import { expect, test } from "bun:test";

test("Canvas consumes signed fetch SSE without bearer data in the URL or headers", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection").catch(() => ({}));
    const consume = (
        module as {
            consumeLocalRuntimeEventStream?: (client: RuntimeTransport, path: string, options: { lastEventId?: string; onEvent(event: RuntimeEvent): void }) => Promise<void>;
        }
    ).consumeLocalRuntimeEventStream;
    expect(typeof consume).toBe("function");
    if (!consume) return;

    const calls: Array<{ path: string; headers: Headers; method: string }> = [];
    const events: RuntimeEvent[] = [];
    await consume(
        {
            async request(path, init = {}) {
                calls.push({ path, headers: new Headers(init.headers), method: String(init.method || "GET") });
                return sseResponse(['id: 7\nevent: hello\ndata: {"ok":true}\n\n', "id: 8\nevent: agent_log\ndata: first\ndata: second\n\n"]);
            },
        },
        "/events?clientId=client-1",
        {
            lastEventId: "6",
            onEvent: (event) => events.push(event),
        },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ path: "/events?clientId=client-1", method: "GET" });
    expect(calls[0].headers.get("last-event-id")).toBe("6");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].headers.has("x-canvas-agent-token")).toBe(false);
    expect(calls[0].path).not.toContain("token");
    expect(events).toEqual([
        { type: "hello", data: '{"ok":true}', id: "7" },
        { type: "agent_log", data: "first\nsecond", id: "8" },
    ]);
});

test("Canvas SSE rejects oversized events and pre-cancelled requests", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    let calls = 0;
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
        module.consumeLocalRuntimeEventStream(
            {
                request: async () => {
                    calls++;
                    return sseResponse([]);
                },
            },
            "/events?clientId=client-1",
            { signal: cancelled.signal, onEvent: () => undefined },
        ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);

    await expect(
        module.consumeLocalRuntimeEventStream(
            {
                request: async () => sseResponse([`event: agent_log\ndata: ${"x".repeat(300 * 1024)}\n\n`]),
            },
            "/events?clientId=client-1",
            { onEvent: () => undefined },
        ),
    ).rejects.toMatchObject({ code: "canvas_event_too_large" });
});

test("Canvas SSE accepts one large transport chunk containing many bounded events", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    const chunk = Array.from({ length: 3_000 }, (_, index) => `id: ${index}\nevent: agent_log\ndata: ${"x".repeat(80)}\n\n`).join("");
    let events = 0;

    await module.consumeLocalRuntimeEventStream(
        {
            request: async () => sseResponse([chunk]),
        },
        "/events?clientId=client-1",
        {
            onEvent: () => {
                events++;
            },
        },
    );

    expect(events).toBe(3_000);
});

test("Canvas Agent UI store contains no Runtime endpoint, bearer, or session fields", async () => {
    const { useCanvasAgentStore } = await import("../src/stores/canvas/use-canvas-agent-store");
    const state = useCanvasAgentStore.getState();

    expect("url" in state).toBe(false);
    expect("token" in state).toBe(false);
    expect("endpoint" in state).toBe(false);
    expect("session" in state).toBe(false);
});

test("Canvas Agent reconnect intent persists while transient disconnects preserve the active conversation", async () => {
    const module = await import("../src/stores/canvas/use-canvas-agent-store").catch(() => ({}));
    const connectionStartingPatch = (
        module as {
            canvasAgentConnectionStartingPatch?: () => Record<string, unknown>;
        }
    ).canvasAgentConnectionStartingPatch;
    const transientDisconnectPatch = (
        module as {
            canvasAgentTransientDisconnectPatch?: (activity: string, connectError: string) => Record<string, unknown>;
        }
    ).canvasAgentTransientDisconnectPatch;
    const writeEnabled = (
        module as {
            writeCanvasAgentEnabledPreference?: (enabled: boolean, storage: { setItem(key: string, value: string): void }) => void;
        }
    ).writeCanvasAgentEnabledPreference;
    const readEnabled = (
        module as {
            readCanvasAgentEnabledPreference?: (storage: { getItem(key: string): string | null }) => boolean;
        }
    ).readCanvasAgentEnabledPreference;

    expect(typeof connectionStartingPatch).toBe("function");
    expect(typeof transientDisconnectPatch).toBe("function");
    expect(typeof writeEnabled).toBe("function");
    expect(typeof readEnabled).toBe("function");
    if (!connectionStartingPatch || !transientDisconnectPatch || !writeEnabled || !readEnabled) return;

    const durable = {
        messages: [{ id: "message-1", role: "assistant", text: "kept" }],
        threads: [{ id: "thread-1", preview: "kept" }],
        activeThreadId: "thread-1",
        workspacePath: "D:/workspace",
        pendingTool: { requestId: "tool-1", name: "canvas_get_state" },
    };
    const starting = { ...durable, ...connectionStartingPatch() };
    expect(starting).toMatchObject({ enabled: true, connected: false, activity: "连接中", ...durable });

    const reconnecting = { ...starting, ...transientDisconnectPatch("正在重连", "连接已断开") };
    expect(reconnecting).toMatchObject({ enabled: true, connected: false, activity: "正在重连", connectError: "连接已断开", ...durable });

    const values = new Map<string, string>();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    };
    writeEnabled(true, storage);
    expect(readEnabled(storage)).toBe(true);
    writeEnabled(false, storage);
    expect(readEnabled(storage)).toBe(false);
});

test("Canvas Agent status shows reconnecting instead of a stale connection failure", async () => {
    const module = await import("../src/stores/canvas/use-canvas-agent-store").catch(() => ({}));
    const statusText = (
        module as {
            canvasAgentConnectionStatusText?: (state: { enabled: boolean; connected: boolean; activity: string; connectError: string }) => string;
        }
    ).canvasAgentConnectionStatusText;
    expect(typeof statusText).toBe("function");
    if (!statusText) return;

    expect(statusText({ enabled: true, connected: false, activity: "正在重连", connectError: "连接已断开" })).toBe("正在重连");
    expect(statusText({ enabled: true, connected: false, activity: "连接失败", connectError: "首次连接失败" })).toBe("连接失败");
});

test("Canvas connection reuses the shared Runtime store and requires the canvas module", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    const prepare = (
        module as {
            prepareCanvasRuntimeConnection?: (store: RuntimeStore, signal?: AbortSignal) => Promise<void>;
        }
    ).prepareCanvasRuntimeConnection;
    expect(typeof prepare).toBe("function");
    if (!prepare) return;

    let connectCalls = 0;
    const state = {
        connection: "idle",
        modules: [] as Array<{ id: string }>,
        async connect() {
            connectCalls++;
            state.connection = "connected";
            state.modules = [{ id: "canvas-agent" }, { id: "dreamina" }];
        },
    };
    await prepare({ getState: () => state });

    expect(connectCalls).toBe(1);
    expect(state.connection).toBe("connected");

    await prepare({ getState: () => state });
    expect(connectCalls).toBe(2);

    const missingState = {
        connection: "connected",
        modules: [{ id: "dreamina" }],
        error: "",
        async connect() {
            return;
        },
    };
    await expect(prepare({ getState: () => missingState })).rejects.toMatchObject({ code: "canvas_module_unavailable" });

    const failedRefreshState = {
        connection: "connected",
        modules: [{ id: "canvas-agent" }],
        error: "",
        async connect() {
            failedRefreshState.error = "本机运行时连接超时";
        },
    };
    await expect(prepare({ getState: () => failedRefreshState })).rejects.toMatchObject({ code: "canvas_runtime_unavailable" });
});

test("Canvas launch mode auto-connects after rejected legacy deep-link secrets are removed", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    const shouldAutoConnect = (
        module as {
            shouldAutoConnectCanvasRuntime?: (params: URLSearchParams) => boolean;
        }
    ).shouldAutoConnectCanvasRuntime;
    expect(typeof shouldAutoConnect).toBe("function");
    if (!shouldAutoConnect) return;

    expect(shouldAutoConnect(new URLSearchParams("mode=new"))).toBe(true);
    expect(shouldAutoConnect(new URLSearchParams("mode=recent"))).toBe(true);
    expect(shouldAutoConnect(new URLSearchParams("mode=choose"))).toBe(true);
    expect(shouldAutoConnect(new URLSearchParams("agentUrl=http://127.0.0.1:17371"))).toBe(false);
});

test("Canvas local Agent setup generates exact-origin commands for Unix and Windows", async () => {
    const module = await import("../src/lib/canvas/local-agent-setup");
    const unix = module.buildLocalAgentSetupCommands("https://ddcat.pronhubcn.com", "unix");
    const windows = module.buildLocalAgentSetupCommands("https://ddcat.pronhubcn.com", "windows");

    expect(unix.install).toContain("git clone https://github.com/ddcat-ai/open-ai-canvas.git");
    expect(unix.start).toContain("FRAMEFIELD_TRUSTED_WEB_ORIGINS='https://ddcat.pronhubcn.com'");
    expect(unix.start).toContain("node dist/index.js");
    expect(windows.start).toContain("$env:FRAMEFIELD_TRUSTED_WEB_ORIGINS='https://ddcat.pronhubcn.com'");
    expect(windows.start).toContain("node .\\dist\\index.js");
    expect(module.detectLocalAgentSetupPlatform("Windows NT 10.0")).toBe("windows");
    expect(module.detectLocalAgentSetupPlatform("Macintosh Intel Mac OS X")).toBe("unix");
});

test("Canvas local Agent tutorial replaces the conversation only while disconnected", async () => {
    const source = await Bun.file(new URL("../src/components/canvas/canvas-local-agent-panel.tsx", import.meta.url)).text();
    expect(source).toContain('!connected ? (\n                <AgentConnectView');
    expect(source).toContain("连接成功后，这里会自动恢复原对话");
    expect(source).toContain("当前支持范围");
});

test("Canvas reconnect wait resolves quietly when component cleanup aborts", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    const waitForReconnect = (
        module as {
            waitForCanvasRuntimeReconnect?: (signal: AbortSignal, delayMs?: number) => Promise<void>;
        }
    ).waitForCanvasRuntimeReconnect;
    expect(typeof waitForReconnect).toBe("function");
    if (!waitForReconnect) return;

    const controller = new AbortController();
    const waiting = waitForReconnect(controller.signal, 60_000);
    controller.abort();

    await expect(waiting).resolves.toBeUndefined();
});

test("Canvas state sync reports a stable error without exposing Runtime response text", async () => {
    const module = await import("../src/lib/canvas/local-runtime-connection");
    const postState = (
        module as {
            postCanvasRuntimeState?: (client: RuntimeTransport, clientId: string, snapshot: unknown) => Promise<void>;
        }
    ).postCanvasRuntimeState;
    expect(typeof postState).toBe("function");
    if (!postState) return;

    const secretResponse = "runtime-secret-response-body";
    const calls: Array<{ path: string; headers: Headers; body: string }> = [];
    let thrown: unknown;
    try {
        await postState(
            {
                async request(path, init = {}) {
                    calls.push({
                        path,
                        headers: new Headers(init.headers),
                        body: String(init.body || ""),
                    });
                    return new Response(secretResponse, { status: 500 });
                },
            },
            "client/1",
            { nodes: [], connections: [] },
        );
    } catch (error) {
        thrown = error;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/canvas/state?clientId=client%2F1");
    expect(calls[0].headers.get("content-type")).toBe("application/json");
    expect(calls[0].headers.has("authorization")).toBe(false);
    expect(calls[0].headers.has("x-canvas-agent-token")).toBe(false);
    expect(calls[0].body).toBe('{"nodes":[],"connections":[]}');
    expect(thrown).toMatchObject({
        code: "canvas_state_sync_failed",
        message: "画布状态同步失败",
    });
    expect(JSON.stringify(thrown)).not.toContain(secretResponse);
});

type RuntimeTransport = {
    request(path: string, init?: RequestInit): Promise<Response>;
};

type RuntimeEvent = {
    type: string;
    data: string;
    id?: string;
};

function sseResponse(chunks: string[]) {
    const encoder = new TextEncoder();
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
                controller.close();
            },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
    );
}

type RuntimeStore = {
    getState(): {
        connection: string;
        modules: Array<{ id: string }>;
        error?: string;
        connect(signal?: AbortSignal): Promise<void>;
    };
};
