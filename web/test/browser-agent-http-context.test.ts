import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("HTTP context can start the browser host and upload a Worker startup failure without randomUUID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "browser-agent-http-"));
    const root = new URL("../src/", import.meta.url);
    const stubs = join(dir, "stubs.ts");
    const failurePath = join(dir, "failures.ts");
    const hostPath = join(dir, "host.ts");
    writeFileSync(
        stubs,
        `
        const session = { userId: "http-user", scope: "http-user", signal: new AbortController().signal };
        export const captureUserSession = () => session;
        export const assertCurrentUserSession = () => {};
        export const listBrowserAgentRuns = async () => ["run"];
        export const requestBrowserAgentStep = async () => ({});
        export const recordDiagnosticEvent = () => {};
        export const localForageStorageForScope = () => ({ getItem: async () => null, setItem: async () => {} });
        export const uploaded = [];
        export const http = { post: async (_path, body) => {
            uploaded.push(...body.events);
            return { acceptedEventIds: body.events.map(event => event.eventId) };
        }};
    `,
    );
    const rewrite = (source: string) =>
        source
            .replaceAll('"@/lib/user-scope"', JSON.stringify(stubs))
            .replaceAll('"@/lib/client-id"', JSON.stringify(fileURLToPath(new URL("lib/client-id.ts", root))))
            .replaceAll('"@/services/api/browser-agent"', JSON.stringify(stubs))
            .replaceAll('"@/lib/localforage-storage"', JSON.stringify(stubs))
            .replaceAll('"@/services/api/request"', JSON.stringify(stubs))
            .replaceAll('"./client-diagnostics"', JSON.stringify(stubs))
            .replaceAll('"./browser-agent-failure-queue"', JSON.stringify(fileURLToPath(new URL("services/diagnostics/browser-agent-failure-queue.ts", root))))
            .replaceAll('"@/services/diagnostics/browser-agent-failures"', JSON.stringify(failurePath))
            .replaceAll("import.meta.env.VITE_BUILD_COMMIT", '"dev"');
    writeFileSync(failurePath, rewrite(readFileSync(new URL("services/diagnostics/browser-agent-failures.ts", root), "utf8")));
    writeFileSync(hostPath, rewrite(readFileSync(new URL("services/agent/browser-agent-host.ts", root), "utf8")));
    const originals = new Map(["crypto", "Worker", "window"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const nativeCrypto = globalThis.crypto;
    let stopHost: (() => void) | undefined;
    let stopUpload: (() => void) | undefined;
    try {
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto) } });
        Object.defineProperty(globalThis, "window", { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
        Object.defineProperty(globalThis, "Worker", {
            configurable: true,
            value: class {
                constructor() {
                    throw new Error("Worker unavailable");
                }
            },
        });
        const failures = await import(failurePath);
        const host = await import(hostPath);
        const transport = await import(stubs);
        stopUpload = failures.startBrowserAgentFailureUpload();
        stopHost = host.startBrowserAgentHost();
        for (let i = 0; i < 20 && !transport.uploaded.length; i++) await new Promise((resolve) => setTimeout(resolve, 0));
        expect(transport.uploaded).toHaveLength(1);
        expect(transport.uploaded[0].code).toBe("worker_load_failed");
        expect(transport.uploaded[0].eventId).toMatch(/^event-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    } finally {
        stopHost?.();
        stopUpload?.();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        rmSync(dir, { recursive: true, force: true });
    }
});
