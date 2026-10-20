import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("native compaction receives continuing agreements and restores its summary for later turns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-compaction-test-"));
  const agreement = "以后我发产品图时，按墨西哥站做 7 张 1:1 套图；我补充站点时只替换站点。";
  const override = "之后默认改成 5 张，其他约定继续；上一款产品已完成，新产品不要沿用它的图片。";
  const summary = "持续约定：收到新产品图时做电商套图；默认墨西哥站、5 张、1:1；单独指定站点只覆盖站点。上一款已完成，不续跑，不沿用旧产品事实或像素。约定只适用于套图，不约束其他话题。";
  const session = SessionManager.create(directory, directory);
  const appendUser = content => session.appendMessage({ role: "user", content, timestamp: Date.now() });
  const appendAssistant = text => session.appendMessage({
    role: "assistant", api: "openai-completions", provider: "yingce", model: "test-model",
    content: [{ type: "text", text }], stopReason: "stop", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  appendUser(agreement);
  appendAssistant("已理解这些后续处理约定。");
  appendUser(override);
  appendAssistant("已将默认数量改为 5 张，旧产品任务已完成。");
  appendUser("核对上一款结果：" + "图片已交付。".repeat(160));
  appendAssistant("核对完成。");
  session.appendCustomEntry("canvas-model-step", { runId: "compacting", stepId: "compact-step", purpose: "compaction" });
  let snapshot = [session.getHeader(), ...session.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n";
  const modelRequests = [];
  const events = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    if (req.url === "/model") {
      modelRequests.push(body);
      // Fixed responses exercise transport and native history restoration,
      // not the model's ability to infer an agreement from natural language.
      res.end(JSON.stringify({ text: body.purpose === "compaction" ? summary : "本轮已收到。" }));
    } else if (req.url === "/event") {
      events.push(body);
      if (body.sessionJSONL) snapshot = body.sessionJSONL;
      res.end('{"ok":true}');
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  async function runRuntime(request) {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url))], {
      cwd: directory, stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const exited = new Promise((resolve, reject) => { child.on("close", resolve); child.on("error", reject); });
    child.stdin.end(JSON.stringify({
      bridgeURL: `http://127.0.0.1:${server.address().port}`, bridgeToken: "test",
      systemPrompt: "你是首页创作 Agent。", sessionJSONL: snapshot,
      model: { id: "test-model", contextWindow: 128000, maxTokens: 8192 },
      compaction: { enabled: true, reserveTokens: 1024, keepRecentTokens: 128 },
      ...request,
    }));
    const timeout = setTimeout(() => child.kill(), 20_000);
    const code = await exited.finally(() => clearTimeout(timeout));
    assert.equal(code, 0, output);
    assert.ok(output.includes('"event":"settled"'), output);
    assert.ok(!output.includes('"event":"runtime_error"'), output);
  }

  try {
    await runRuntime({
      runId: "compacting", turnId: "turn-2", resumeFromCheckpoint: true,
      prompt: "美国站", turnContext: JSON.stringify({ attachments: [{ resourceId: "new-product", role: "product" }] }),
    });
    const compactions = modelRequests.filter(request => request.purpose === "compaction");
    assert.equal(compactions.length, 1);
    assert.equal(compactions[0].stepId, "compact-step", "resuming compaction must reuse the billed step identity");
    const compressedHistory = JSON.stringify(compactions[0].messages);
    assert.ok(compressedHistory.includes(agreement), "the summary request must receive the original continuing agreement");
    assert.ok(compressedHistory.includes(override), "the summary request must receive later partial overrides");
    for (const rule of ["适用条件", "单次要求", "持续约定", "局部覆盖", "撤销", "换题", "已完成任务", "换产品", "审批"]) {
      assert.ok(compactions[0].systemPrompt.includes(rule), `native compaction missed semantic preservation rule: ${rule}`);
    }
    const completed = events.find(event => event.type === "compaction_end" && event.result);
    assert.ok(completed?.sessionJSONL, "the compaction entry and snapshot must be persisted together");
    const entries = completed.sessionJSONL.split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(entries.some(entry => entry.type === "compaction" && entry.summary.includes(summary)));
    let dialogues = modelRequests.filter(request => request.purpose === "dialogue");
    assert.equal(dialogues.length, 1);
    assert.ok(dialogues[0].messages.some(message => message.role === "user"
      && JSON.stringify(message.content).includes("<summary>")
      && JSON.stringify(message.content).includes(summary)));
    assert.ok(dialogues[0].messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("美国站")));
    assert.ok(!dialogues[0].messages.some(message => message.role === "user" && JSON.stringify(message.content).includes(agreement)),
      "compacted raw history must not be appended again beside the native summary");

    await runRuntime({
      runId: "new-topic", turnId: "turn-3", prompt: "先暂停套图，帮我写一封邀请函",
      turnContext: JSON.stringify({ attachments: [] }),
    });
    dialogues = modelRequests.filter(request => request.purpose === "dialogue");
    assert.equal(dialogues.length, 2);
    assert.equal(modelRequests.filter(request => request.purpose === "compaction").length, 1);
    const restored = dialogues[1].messages;
    assert.ok(restored.some(message => message.role === "user"
      && JSON.stringify(message.content).includes("<summary>")
      && JSON.stringify(message.content).includes(summary)),
      "a later process must restore the persisted summary");
    assert.ok(restored.some(message => message.role === "user" && JSON.stringify(message.content).includes("美国站")));
    assert.ok(restored.some(message => message.role === "user" && JSON.stringify(message.content).includes("先暂停套图，帮我写一封邀请函")),
      "the newest topic change must reach the model alongside the continuing agreement");
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
