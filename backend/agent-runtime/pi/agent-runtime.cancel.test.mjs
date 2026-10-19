import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

for (const parentStatus of ["cancelled", "failed"]) test(`${parentStatus} parent closes pending tool pairs without replaying generation, then accepts a new prompt`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-cancel-test-"));
  const session = SessionManager.create(directory, directory);
  session.appendMessage({ role: "user", content: "旧需求：生成四张图片", timestamp: Date.now() });
  session.appendCustomEntry("canvas-model-step", { runId: "parent", stepId: "step-1", purpose: "dialogue" });
  session.appendMessage({
    role: "assistant", api: "openai-completions", provider: "yingce", model: "test-model", stopReason: "toolUse", timestamp: Date.now(),
    content: [1, 2].map(id => ({ type: "toolCall", id: `image-${id}`, name: "generate_media", arguments: {} })),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  session.appendMessage({ role: "toolResult", toolCallId: "image-1", toolName: "generate_media", content: [{ type: "text", text: "等待审批" }], details: { paused: true }, isError: true, timestamp: Date.now() });
  const inputSession = [session.getHeader(), ...session.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n";
  const calls = [];
  let modelCalls = 0;
  let snapshot = "";
  let modelPayload;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    if (req.url === "/tool") {
      calls.push(body);
      res.end(JSON.stringify({ content: JSON.stringify({ phase: parentStatus, text: "上一轮已结束，核对真实任务，不重发旧操作" }), isError: true }));
    } else if (req.url === "/model") {
      modelCalls++;
      modelPayload = body;
      res.end(JSON.stringify({ text: "好的，按新需求改成蓝色背景。" }));
    } else {
      if (body.type === "session_snapshot") snapshot = body.sessionJSONL;
      res.end('{"ok":true}');
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url))], { cwd: directory, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const exited = new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    child.stdin.end(JSON.stringify({
      bridgeURL: `http://127.0.0.1:${server.address().port}`, bridgeToken: "test", runId: "next", [`${parentStatus}ParentRunId`]: "parent",
      sessionJSONL: inputSession, prompt: "新需求：改成蓝色背景", systemPrompt: "只回答本轮新要求",
      model: { id: "test-model", contextWindow: 128000, maxTokens: 8192 },
      tools: [{ name: "generate_media", executionMode: "sequential", parameters: { type: "object", properties: {} } }],
    }));
    const timeout = setTimeout(() => child.kill(), 20_000);
    const code = await exited.finally(() => clearTimeout(timeout));
    assert.equal(code, 0, output);
    assert.equal(modelCalls, 1);
    assert.deepEqual(calls.map(call => [call.callId, call.recoverOnly, call.parentRunId]), [["image-1", true, "parent"], ["image-2", true, "parent"]]);
    assert.ok(JSON.stringify(modelPayload).includes("新需求：改成蓝色背景"));
    const entries = snapshot.split("\n").filter(Boolean).map(JSON.parse);
    const results = entries.filter(entry => entry.message?.role === "toolResult" && entry.message.content.some(part => part.text?.includes(parentStatus)));
    assert.equal(results.length, 2);
    assert.ok(!output.includes('"event":"runtime_error"'), output);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
