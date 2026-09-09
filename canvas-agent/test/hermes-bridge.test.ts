import assert from "node:assert/strict";
import test from "node:test";
import { HermesBridgeClient, HermesBridgeError } from "../src/hermes-bridge.js";

test("Hermes Bridge uses isolated session endpoints", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
        calls.push({ url: String(input), method: init?.method });
        return new Response(JSON.stringify(init?.method === "POST" && String(input).endsWith("/turns") ? { accepted: true } : { id: "s1", status: "active" }), { status: 200 });
    };
    const client = new HermesBridgeClient("https://bridge.example/", fetchImpl);
    await client.createSession({ prompt: "拆分剧本" });
    await client.submitTurn("s1", { prompt: "继续" });
    await client.cancel("s1");
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
        "POST https://bridge.example/agent/sessions",
        "POST https://bridge.example/agent/sessions/s1/turns",
        "POST https://bridge.example/agent/sessions/s1/cancel",
    ]);
});

test("Hermes Bridge reports HTTP failures without retrying turns", async () => {
    let calls = 0;
    const client = new HermesBridgeClient("https://bridge.example", async () => { calls += 1; return new Response(JSON.stringify({ message: "failed" }), { status: 500 }); });
    await assert.rejects(() => client.submitTurn("s1", { prompt: "继续" }), (error: unknown) => error instanceof HermesBridgeError && error.status === 500 && error.message === "failed");
    assert.equal(calls, 1);
});
