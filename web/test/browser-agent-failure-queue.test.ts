import { expect, test } from "bun:test";
import { acknowledgedFailureQueue, restoreFailureQueue, type BrowserAgentFailureEvent } from "../src/services/diagnostics/browser-agent-failure-queue";

const event = (id: string): BrowserAgentFailureEvent => ({ eventId: id, code: "worker_load_failed", phase: "startup", buildCommit: "dev", occurredAt: new Date().toISOString(), frames: [] });
test("partial ACK removes only server-confirmed event IDs", () => {
    expect(acknowledgedFailureQueue([event("one"), event("two")], ["two"]).map((e) => e.eventId)).toEqual(["one"]);
});
test("unacknowledged deleted-run logs cannot block later batches", () => {
    expect(acknowledgedFailureQueue([event("old"), event("new")], [], Date.now(), ["old"]).map((e) => e.eventId)).toEqual(["new", "old"]);
});
test("restored queue strips arbitrary payloads and rejects URLs or invalid metadata", () => {
    const restored = restoreFailureQueue(
        JSON.stringify([
            { ...event("one"), message: "secret", stack: "secret", frames: [{ file: "https://private/key.js" }] },
            { ...event("two"), runId: "https://private/key" },
        ]),
    );
    expect(restored).toHaveLength(1);
    expect(JSON.stringify(restored)).not.toContain("secret");
    expect(restored[0].frames).toEqual([]);
    expect(restoreFailureQueue("broken")).toEqual([]);
});
test("expired and future entries are removed", () => {
    expect(
        acknowledgedFailureQueue(
            [
                { ...event("one"), occurredAt: new Date(Date.now() - 86_400_001).toISOString() },
                { ...event("two"), occurredAt: new Date(Date.now() + 600_000).toISOString() },
            ],
            [],
        ),
    ).toEqual([]);
});
