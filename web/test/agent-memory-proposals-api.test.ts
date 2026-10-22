import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate transport without module mocks leaking to unrelated API tests.
const dir = mkdtempSync(join(tmpdir(), "memory-proposal-api-"));
const requestPath = join(dir, "request.ts");
writeFileSync(
    requestPath,
    `export const calls = []; export const http = {
    get: async (...args) => { calls.push(["get", ...args]); return {}; },
    post: async (...args) => { calls.push(["post", ...args]); return {}; }
}; export const compactApiParams = (value) => value;`,
);
writeFileSync(join(dir, "memories.ts"), readFileSync(new URL("../src/services/api/agent-memories.ts", import.meta.url), "utf8").replace('"./request"', JSON.stringify(requestPath)));
const api: typeof import("../src/services/api/agent-memories") = await import(join(dir, "memories.ts"));
const transport = await import(requestPath);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("proposal approval and restoration send the viewed versions and encoded IDs", async () => {
    transport.calls.length = 0;
    await api.decideAgentMemoryProposal("proposal/id", "approve", 7);
    await api.restoreAgentMemoryRevision("revision/id", 3);
    expect(transport.calls).toEqual([
        ["post", "/agent/memories/proposals/proposal%2Fid/decide", { decision: "approve", version: 7 }, { timeout: 15_000 }],
        ["post", "/agent/memories/revisions/revision%2Fid/restore", { version: 3 }, { timeout: 15_000 }],
    ]);
});

test("proposal and revision reads preserve cancellation", async () => {
    transport.calls.length = 0;
    const signal = new AbortController().signal;
    await Promise.all([api.listAgentMemoryProposals(signal), api.listAgentMemoryRevisions(signal)]);
    expect(transport.calls).toEqual([
        ["get", "/agent/memories/proposals", { signal, timeout: 15_000 }],
        ["get", "/agent/memories/revisions", { signal, timeout: 15_000 }],
    ]);
});
