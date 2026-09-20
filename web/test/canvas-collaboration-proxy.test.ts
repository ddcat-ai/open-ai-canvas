import { expect, test } from "bun:test";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("the real Vite proxy forwards collaboration WebSocket upgrades and messages", async () => {
    const path = "/api/canvas-projects/proxy-test/collaboration/ws";
    let origin = "";
    const upstream = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, server) {
            origin = request.headers.get("Origin") || "";
            if (new URL(request.url).pathname === path && server.upgrade(request)) return;
            return new Response("not found", { status: 404 });
        },
        websocket: {
            message(socket, message) {
                socket.send(message);
            },
        },
    });
    let vite: ChildProcess | undefined;
    let exited: Promise<unknown> | undefined;
    let socket: WebSocket | undefined;
    try {
        // Vite's CLI runs on Node; Bun 1.3.9 lacks socket APIs used by its WS proxy.
        vite = fork(fileURLToPath(new URL("./fixtures/canvas-proxy-server.mjs", import.meta.url)), [], {
            execPath: "node",
            execArgv: [],
            env: { ...process.env, VITE_API_PROXY_TARGET: `http://127.0.0.1:${upstream.port}` },
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            serialization: "json",
        });
        let stderr = "";
        vite.stderr!.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
        exited = once(vite, "exit").catch(() => undefined);
        let startupTimer: ReturnType<typeof setTimeout> | undefined;
        const [port] = await Promise.race([
            once(vite, "message"),
            exited.then(() => {
                throw new Error(`Vite proxy exited before readiness: ${stderr}`);
            }),
            new Promise<never>((_, reject) => {
                startupTimer = setTimeout(() => reject(new Error(`Vite proxy startup timed out: ${stderr}`)), 5000);
            }),
        ]).finally(() => clearTimeout(startupTimer));
        if (typeof port !== "number" || port <= 0) throw new Error("missing Vite test port");
        socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        const echo = await new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("collaboration proxy upgrade timed out")), 3000);
            socket!.onopen = () => socket!.send("committed-delta");
            socket!.onmessage = (event) => {
                clearTimeout(timer);
                resolve(String(event.data));
            };
            socket!.onerror = () => {
                clearTimeout(timer);
                reject(new Error("collaboration proxy upgrade failed"));
            };
        });
        expect(echo).toBe("committed-delta");
        expect(origin).toBe(`http://127.0.0.1:${upstream.port}`);
    } finally {
        socket?.close();
        upstream.stop(true);
        if (vite) {
            const killTimer = setTimeout(() => vite!.kill("SIGKILL"), 1000);
            vite.kill("SIGTERM");
            try {
                await exited;
            } finally {
                clearTimeout(killTimer);
            }
        }
    }
}, 15_000);
