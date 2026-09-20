import { expect, test } from "bun:test";
import { createServer } from "vite";
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
    const previous = process.env.VITE_API_PROXY_TARGET;
    process.env.VITE_API_PROXY_TARGET = `http://127.0.0.1:${upstream.port}`;
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    let socket: WebSocket | undefined;
    try {
        vite = await createServer({
            root: fileURLToPath(new URL("../", import.meta.url)),
            configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
            envFile: false,
            // A parallel proxy test must not replace the running app's optimized dependencies.
            cacheDir: fileURLToPath(new URL("../../.local/cache/canvas-proxy-test-vite", import.meta.url)),
            logLevel: "silent",
            server: { host: "127.0.0.1", port: 0, watch: null },
            optimizeDeps: { noDiscovery: true, include: [] },
        });
        await vite.listen();
        const address = vite.httpServer!.address();
        if (!address || typeof address === "string") throw new Error("missing Vite test port");
        socket = new WebSocket(`ws://127.0.0.1:${address.port}${path}`);
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
        await vite?.close();
        if (previous === undefined) delete process.env.VITE_API_PROXY_TARGET;
        else process.env.VITE_API_PROXY_TARGET = previous;
    }
}, 10_000);
