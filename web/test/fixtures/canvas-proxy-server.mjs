import { createServer } from "vite";
import { fileURLToPath } from "node:url";

let vite;
async function stop() {
    await vite?.close();
    process.exit(0);
}
process.once("SIGTERM", stop);
process.once("disconnect", stop);

vite = await createServer({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    envFile: false,
    // A parallel proxy test must not replace the running app's optimized dependencies.
    cacheDir: fileURLToPath(new URL("../../../.local/cache/canvas-proxy-test-vite", import.meta.url)),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
});
await vite.listen();
const address = vite.httpServer.address();
if (!address || typeof address === "string") throw new Error("missing Vite test port");
process.send(address.port);
