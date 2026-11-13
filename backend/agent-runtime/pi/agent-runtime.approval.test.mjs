import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function runScenario(scenario) {
  const directory = await mkdtemp(join(tmpdir(), "agent-approval-test-"));
  let modelCalls = 0;
  let toolCalls = 0;
  let sessionJSONL = "";
  const modelMessages = [];
  const signatureScenario = scenario.startsWith("signature-");
  const signature = " opaque+/=\nGemini signature ";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    if (req.url === "/model") {
      modelCalls++;
      modelMessages.push(payload.messages);
      if (signatureScenario) {
        const parallel = scenario === "signature-parallel";
        const count = parallel ? 1 : 2;
        if (modelCalls <= count) {
          const call = (id, signed) => ({ id, name: "generate_media", arguments: {}, ...(signed ? { thoughtSignature: signature + id } : {}) });
          res.end(JSON.stringify({ toolCalls: parallel
            ? [call("media-1", true), call("media-2", false)]
            : [call(`media-${modelCalls}`, true)] }));
        } else {
          res.end(JSON.stringify({ text: "done", reasoning: "complete raw reasoning", reasoningPassback: '{"wire":"chat-completion"}' }));
        }
      } else if (scenario === "model-pause") {
        res.end(JSON.stringify({ pause: true, reason: "awaiting_approval" }));
      } else if (scenario === "model-error") {
        res.statusCode = 422;
        res.end(JSON.stringify({ error: "invalid model request" }));
      } else if (scenario === "tool-pause") {
        res.end(JSON.stringify({ toolCalls: [{
          id: "media-1", name: "generate_media", arguments: {},
          thoughtSignature: " opaque+/=\nGemini signature ",
        }] }));
      } else {
        res.end(JSON.stringify({ text: "测试回复" }));
      }
    } else if (req.url === "/tool") {
      toolCalls++;
      res.end(JSON.stringify(signatureScenario ? { content: "{}" }
        : { pause: true, approvalId: "approval-1", content: "操作正在等待用户审批。" }));
    } else if (req.url === "/event") {
      if (payload.type === "session_snapshot") sessionJSONL = payload.sessionJSONL;
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const request = {
      bridgeURL: `http://127.0.0.1:${server.address().port}`,
      bridgeToken: "test",
      prompt: "生成一个镜头", systemPrompt: "你是测试 Agent。",
      model: { id: "test-model", contextWindow: 128000, maxTokens: 8192 },
      tools: [{ name: "generate_media", executionMode: "sequential", parameters: {
        type: "object", properties: {},
      } }],
    };
    const child = spawn(process.execPath, [fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url))], {
      cwd: directory, stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH, NODE_ENV: "production", PI_OFFLINE: "1", YINGCE_AGENT_RUN_DIR: directory, HOME: directory, TMPDIR: directory },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exited = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    child.stdin.end(JSON.stringify(request));
    let timeout;
    const code = await Promise.race([
      exited,
      new Promise((_, reject) => { timeout = setTimeout(() => {
        child.kill(); reject(new Error(`runtime timed out: ${stderr || stdout}`));
      }, 30000); }),
    ]).finally(async () => {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    });
    assert.equal(modelCalls, signatureScenario ? (scenario === "signature-parallel" ? 2 : 3) : 1);
    assert.equal(toolCalls, signatureScenario ? 2 : (scenario === "tool-pause" ? 1 : 0));
    const events = stdout.split("\n").filter(Boolean).map(JSON.parse);
    if (scenario === "model-error") {
      assert.equal(code, 1, stderr || stdout);
      assert.ok(events.some((event) => event.event === "runtime_error" && event.message === "invalid model request"), stdout);
      assert.ok(!events.some((event) => event.event === "settled" || event.event === "approval_wait"), stdout);
      return;
    }
    assert.equal(code, 0, stderr || stdout);
    assert.ok(events.some((event) => event.event === "settled"), stdout);
    assert.ok(!events.some((event) => event.event === "runtime_error"), stdout);
    assert.equal(events.some((event) => event.event === "approval_wait"), !signatureScenario && scenario !== "normal");
    // The parent removes the working copy; the callback snapshot is durable.
    assert.ok(sessionJSONL, "runtime must deliver its session snapshot");
    if (scenario === "model-pause") {
      const entries = sessionJSONL.split("\n").filter(Boolean).map(JSON.parse);
      assert.ok(!entries.some((entry) => entry.message?.role === "toolResult"));
    }
    if (signatureScenario) {
      const calls = modelMessages.at(-1).flatMap((message) => message.content ?? [])
        .filter((part) => part.type === "toolCall");
      assert.deepEqual(calls.map((call) => call.id), ["media-1", "media-2"]);
      assert.equal(calls[0].thoughtSignature, signature + "media-1");
      assert.equal(calls[1].thoughtSignature, scenario === "signature-parallel" ? undefined : signature + "media-2");
      const entries = sessionJSONL.split("\n").filter(Boolean).map(JSON.parse);
      const reasoning = entries.flatMap((entry) => entry.message?.content ?? [])
        .find((part) => part.type === "thinking");
      assert.equal(reasoning?.thinking, "complete raw reasoning");
      assert.equal(reasoning?.thinkingSignature, '{"wire":"chat-completion"}');
    }
    if (scenario === "tool-pause") {
      const entries = sessionJSONL.split("\n").filter(Boolean).map(JSON.parse);
      const call = entries.flatMap((entry) => entry.message?.content ?? [])
        .find((part) => part.type === "toolCall" && part.id === "media-1");
      assert.equal(call?.thoughtSignature, " opaque+/=\nGemini signature ");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("model approval pause settles without another model or tool request", () => runScenario("model-pause"));
test("tool approval pause still settles without another model request", () => runScenario("tool-pause"));
test("unrelated model errors remain runtime failures", () => runScenario("model-error"));
test("normal model responses still settle", () => runScenario("normal"));
test("Gemini sequential signatures survive runtime model continuations", () => runScenario("signature-sequential"));
test("Gemini parallel signatures preserve order and unsigned calls", () => runScenario("signature-parallel"));
