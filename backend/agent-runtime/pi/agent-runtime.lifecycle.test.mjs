import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAgentServer } from "../../../yingce-agent/server.mjs";
import { RunDirectories } from "../../../yingce-agent/run-directories.mjs";
import { SessionAdmission } from "../../../yingce-agent/session-admission.mjs";

const token = "test-".repeat(8);
const runtime = fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url));

async function until(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("condition did not become true");
}

async function startService(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "agent-lifecycle-test-"));
  const service = await createAgentServer({ token, runtimePath: runtime, tempRoot: join(directory, "runs"), maxSessions: 1, maxQueue: 1, waitTimeout: 100, bodyTimeout: 100, killGrace: 50, ...options });
  await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${service.server.address().port}`;
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...service, url, directory };
}

test("real runtime directories are reclaimed after normal exit, HTTP cancellation, and SIGKILL", async t => {
  for (const mode of ["normal", "cancel", "kill"]) {
    await t.test(mode, async t => {
      const service = await startService(t);
      let entered = false;
      const bridge = createServer(async (request, response) => {
        for await (const chunk of request) {}
        response.setHeader("content-type", "application/json");
        if (request.url === "/model") {
          entered = true;
          if (mode !== "normal") return;
          response.end(JSON.stringify({ text: "completed" }));
        } else {
          response.end("{}");
        }
      });
      await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
      t.after(async () => { bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve)); });
      const controller = new AbortController();
      const response = await fetch(`${service.url}/v1/runs`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ bridgeURL: `http://127.0.0.1:${bridge.address().port}`, bridgeToken: "local-test", prompt: "test", systemPrompt: "test", tools: [], model: { id: "test-model", contextWindow: 8192, maxTokens: 1024 } }),
      });
      const result = response.text().catch(error => error);
      await until(() => entered);
      if (mode === "cancel") controller.abort();
      if (mode === "kill") {
        const [name] = await readdir(service.directories.root);
        const owner = JSON.parse(await readFile(join(service.directories.root, name, ".yingce-run.json"), "utf8"));
        process.kill(owner.childPID, "SIGKILL");
      }
      const output = await result;
      if (mode === "normal") assert.match(output, /"settled"/);
      if (mode === "kill") assert.match(output, /runtime_error/);
      await until(async () => service.gate.active === 0 && (await readdir(service.directories.root)).length === 0);
    });
  }
});

test("cancelled runtime ignoring SIGTERM is killed and its directory is reclaimed", async t => {
  const directory = await mkdtemp(join(tmpdir(), "agent-stubborn-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fake = join(directory, "runtime.mjs");
  await writeFile(fake, `
import { writeFileSync } from "node:fs";
import { join } from "node:path";
process.on("SIGTERM", () => {});
process.stdin.resume();
writeFileSync(join(process.env.YINGCE_AGENT_RUN_DIR, "ready"), "ready");
process.stdout.write('{"event":"ready"}\\n');
process.stdout.write("x".repeat(8 * 1024 * 1024));
setInterval(() => {}, 1000);
`);
  const service = await startService(t, { runtimePath: fake });
  const controller = new AbortController();
  const response = await fetch(`${service.url}/v1/runs`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}", signal: controller.signal });
  // Keep the client unread so cancellation must also unwind stdout backpressure.
  const reader = response.body.getReader();
  await until(async () => {
    const [name] = await readdir(service.directories.root);
    return name && readFile(join(service.directories.root, name, "ready")).then(() => true, () => false);
  });
  controller.abort();
  await reader.cancel().catch(() => {});
  await until(async () => service.gate.active === 0 && (await readdir(service.directories.root)).length === 0);
});

function incompleteRequest(url) {
  let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const request = httpRequest(`${url}/v1/runs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-length": "100" } }, res => {
    res.resume();
    res.once("end", () => resolveResponse(res.statusCode));
  });
  request.on("error", () => resolveResponse(499));
  request.flushHeaders();
  return { request, response };
}

test("HTTP admission bounds the queue before reading bodies and expires slow reads", async t => {
  const service = await startService(t, { bodyTimeout: 1000, waitTimeout: 80 });
  const release = await service.gate.acquire(new AbortController().signal);
  const queued = incompleteRequest(service.url);
  t.after(() => queued.request.destroy());
  await until(() => service.gate.waiters.length === 1);
  const denied = incompleteRequest(service.url);
  t.after(() => denied.request.destroy());
  assert.equal(await denied.response, 429, "queue-full response must not wait for a body");
  assert.equal(await queued.response, 503, "queue deadline must not wait for a body");
  release();
  assert.equal(service.gate.waiters.length, 0);
  const slow = incompleteRequest(service.url);
  t.after(() => slow.request.destroy());
  assert.equal(await slow.response, 408);
  await until(() => service.gate.active === 0);
});

test("queue cancellation and limit reductions do not leak permits", async () => {
  const gate = new SessionAdmission({ limit: 2, maxQueue: 2, waitTimeout: 1000 });
  const first = await gate.acquire(new AbortController().signal);
  const second = await gate.acquire(new AbortController().signal);
  gate.setLimit(1);
  const controller = new AbortController();
  const cancelled = gate.acquire(controller.signal);
  controller.abort();
  await assert.rejects(cancelled, error => error.status === 499);
  const waiting = gate.acquire(new AbortController().signal);
  first();
  assert.equal(gate.active, 1);
  assert.equal(gate.waiters.length, 1);
  second();
  const last = await waiting;
  assert.equal(gate.active, 1);
  last();
  last();
  assert.equal(gate.active, 0);
  gate.close();
});

test("deployment session cap bounds stored administrator limits", async t => {
  const service = await startService(t, { maxSessions: 30, sessionCap: 2 });
  assert.equal(service.gate.limit, 2);
  const response = await fetch(`${service.url}/v1/limit`, {
    method: "PUT", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ maxSessions: 30 }),
  });
  assert.equal(response.status, 200);
  const applied = await response.json();
  assert.equal(applied.requestedLimit, 30);
  assert.equal(applied.limit, 2);
  assert.equal(applied.sessionCap, 2);
  const health = await (await fetch(`${service.url}/healthz`)).json();
  assert.equal(health.limit, 2);
  assert.equal(health.sessionCap, 2);
});

test("orphan sweeper removes only expired owned directories and preserves active runs and symlinks", async t => {
  const directory = await mkdtemp(join(tmpdir(), "agent-sweep-test-"));
  const manager = await new RunDirectories({ root: join(directory, "runs"), orphanTTL: 100 }).initialize();
  t.after(async () => { manager.close(); await rm(directory, { recursive: true, force: true }); });
  const active = await manager.create();
  const owner = { version: 1, parentPID: process.pid, childPID: 0, createdAt: Date.now() - 1000 };
  const mark = (path, value = owner) => writeFile(join(path, ".yingce-run.json"), JSON.stringify(value), { mode: 0o600 });
  await mark(active.path);
  for (const name of ["run-orphan", "run-live", "run-unknown", "run-linkedmarker"]) await mkdir(join(manager.root, name), { mode: 0o700 });
  await mark(join(manager.root, "run-orphan"));
  await mark(join(manager.root, "run-live"), { ...owner, childPID: process.pid });
  const outside = join(directory, "outside");
  await mkdir(outside, { mode: 0o700 });
  await mark(outside);
  await symlink(outside, join(manager.root, "run-symlink"));
  await symlink(join(outside, ".yingce-run.json"), join(manager.root, "run-linkedmarker", ".yingce-run.json"));
  await manager.sweep();
  const remaining = await readdir(manager.root);
  assert.ok(!remaining.includes("run-orphan"));
  for (const name of ["run-live", "run-unknown", "run-symlink", "run-linkedmarker"]) assert.ok(remaining.includes(name), name);
  await readFile(join(outside, ".yingce-run.json"));
  await readFile(join(active.path, ".yingce-run.json"));
  await active.cleanup();
});

test("runtime refuses missing or symlinked parent-owned directories", async t => {
  const directory = await mkdtemp(join(tmpdir(), "agent-directory-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const linked = join(directory, "linked");
  await symlink(directory, linked);
  for (const runDir of [undefined, linked]) {
    const child = spawn(process.execPath, [runtime], {
      env: { PATH: process.env.PATH, NODE_ENV: "production", PI_OFFLINE: "1", HOME: directory, ...(runDir ? { YINGCE_AGENT_RUN_DIR: runDir } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume();
    const exited = new Promise(resolve => child.once("close", resolve));
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stdin.end(JSON.stringify({ bridgeURL: "http://127.0.0.1:1", bridgeToken: "test", model: { id: "test" }, prompt: "test", runDir: directory }));
    const code = await exited;
    clearTimeout(timeout);
    assert.equal(code, 1);
    assert.match(output, /temporary directory/);
  }
});
