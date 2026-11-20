import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const runtime = fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url));
const initialUsage = { input: 1000, output: 100, cacheRead: 5000, cacheWrite: 1000, totalTokens: 7100 };

async function runRuntime(request, onModel) {
  const directory = await mkdtemp(join(tmpdir(), "agent-compaction-test-"));
  const modelRequests = [];
  const bridgeEvents = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw);
      res.setHeader("content-type", "application/json");
      if (req.url === "/model") {
        modelRequests.push(payload);
        const result = onModel(payload, modelRequests);
        if (result.error) res.statusCode = 413;
        res.end(JSON.stringify(result));
      } else if (req.url === "/tool") {
        res.end(JSON.stringify({ content: JSON.stringify({ result: "READABLE_SOURCE ".repeat(500) }) }));
      } else {
        bridgeEvents.push(payload);
        res.end(JSON.stringify({ ok: true }));
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const child = spawn(process.execPath, [runtime], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, NODE_ENV: "production", PI_OFFLINE: "1", YINGCE_AGENT_RUN_DIR: directory, HOME: directory, TMPDIR: directory } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdin.end(JSON.stringify({
    bridgeURL: `http://127.0.0.1:${server.address().port}`, bridgeToken: "test",
    prompt: "Read the source and summarize the decisions.", systemPrompt: "Governed test agent.",
    model: { id: "test-model", contextWindow: 8192, maxTokens: 1024 },
    compaction: { enabled: true, reserveTokens: 2048, keepRecentTokens: 512 },
    tools: [{ name: "read_feedback", executionMode: "sequential", description: "Read feedback", parameters: { type: "object", properties: {} } }],
    ...request,
  }));
  let timer;
  try {
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`runtime timed out: ${stderr || stdout}`)), 30000); }),
    ]);
    assert.equal(code, 0, stderr || stdout);
    const output = stdout.split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(output.some((event) => event.event === "settled"), stdout);
    assert.ok(!output.some((event) => event.event === "runtime_error"), stdout);
    const sessionJSONL = bridgeEvents.filter((event) => event.type === "session_snapshot").at(-1)?.sessionJSONL;
    assert.ok(sessionJSONL, "session must be saved through the governed bridge");
    return { modelRequests, bridgeEvents, sessionJSONL, entries: sessionJSONL.split("\n").filter(Boolean).map(JSON.parse) };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await exited;
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("Pi compacts using upstream token usage and resumes the saved summary", async () => {
  let conversations = 0;
  const first = await runRuntime({}, (payload) => {
    if (payload.purpose === "compaction") {
      assert.equal(payload.tools.length, 0);
      return { text: "The source was read. DECISION_TO_RETAIN: use the approved design.", usage: { input: 4000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 4100 } };
    }
    conversations++;
    if (conversations === 1) return { toolCalls: [{ id: "read-1", name: "read_feedback", arguments: {} }], usage: initialUsage };
    return { text: "Complete.", usage: { input: 800, output: 100, cacheRead: 500, cacheWrite: 0, totalTokens: 1400 } };
  });
  const start = first.bridgeEvents.find((event) => event.type === "compaction_start");
  assert.equal(start?.reason, "threshold", "real provider usage must trigger Pi compaction");
  assert.ok(first.entries.some((entry) => entry.type === "compaction" && entry.summary.includes("DECISION_TO_RETAIN")));
  const initialAssistant = first.entries.find((entry) => entry.message?.role === "assistant");
  assert.deepEqual(initialAssistant.message.usage, { ...initialUsage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const resumed = await runRuntime({ sessionJSONL: first.sessionJSONL, prompt: "Continue with the retained decision." }, () => ({ text: "Continued.", usage: { input: 1400, output: 100, cacheRead: 500, cacheWrite: 0, totalTokens: 2000 } }));
  assert.equal(resumed.modelRequests.length, 1);
  const transcript = JSON.stringify(resumed.modelRequests[0].messages);
  assert.match(transcript, /DECISION_TO_RETAIN/);
  assert.match(transcript, /READABLE_SOURCE/, "Pi must preserve the recent tool receipt alongside the summary");
  assert.equal(resumed.entries.filter((entry) => entry.type === "compaction").length, first.entries.filter((entry) => entry.type === "compaction").length);
});

test("Pi context overflow recovery does not retain the recovered runtime error", async () => {
  let conversations = 0;
  const result = await runRuntime({ model: { id: "test-model", contextWindow: 32000, maxTokens: 1024 } }, (payload) => {
    if (payload.purpose === "compaction") return { text: "Source read; finish the answer using the verified decision.", usage: { input: 1500, output: 100, totalTokens: 1600 } };
    conversations++;
    if (conversations === 1) return { toolCalls: [{ id: "read-1", name: "read_feedback", arguments: {} }], usage: { input: 500, output: 100, totalTokens: 600 } };
    if (conversations === 2) return { error: "This request exceeds the context window." };
    return { text: "Recovered successfully.", usage: { input: 900, output: 100, totalTokens: 1000 } };
  });
  assert.equal(conversations, 3);
  assert.ok(result.bridgeEvents.some((event) => event.type === "compaction_start" && event.reason === "overflow"));
  assert.ok(result.entries.some((entry) => Array.isArray(entry.message?.content) && entry.message.content.some((part) => part.text === "Recovered successfully.")));
});
