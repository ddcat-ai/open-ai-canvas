import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const token = "test-token-abcdefghijklmnopqrstuvwxyz-123456";

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function health(port) {
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/healthz`, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

test("a completed POST body followed by client disconnect stops the runtime and releases its slot", { timeout: 8000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "yingce-agent-disconnect-"));
  const runtime = join(directory, "runtime.mjs");
  const pidFile = join(directory, "child.pid");
  writeFileSync(runtime, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nprocess.stdout.write('{"event":"started"}\\n');\nsetInterval(() => {}, 1000);\n`);
  const server = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env: { ...process.env, YINGCE_AGENT_TOKEN: token, YINGCE_AGENT_HOST: "127.0.0.1", YINGCE_AGENT_RUNTIME: runtime, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let port;
    let output = "";
    server.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/YINGCE_AGENT_READY (\d+)/); if (match) port = Number(match[1]); });
    await waitFor(() => port, "server port");
    const response = await new Promise((resolve, reject) => {
      const client = request(`http://127.0.0.1:${port}/v1/runs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } }, resolve);
      client.on("error", reject);
      client.end("{}");
    });
    await waitFor(() => existsSync(pidFile), "runtime child");
    assert.equal((await health(port)).active, 1);
    const childPID = Number(readFileSync(pidFile, "utf8"));
    response.destroy();
    await waitFor(async () => (await health(port)).active === 0, "released slot");
    await waitFor(() => { try { process.kill(childPID, 0); return false; } catch { return true; } }, "child exit");
    writeFileSync(runtime, 'process.stdout.write(\'{"event":"settled"}\\n\');\n');
    const completed = await new Promise((resolve, reject) => {
      const client = request(`http://127.0.0.1:${port}/v1/runs`, { method: "POST", headers: { authorization: `Bearer ${token}` } }, (result) => {
        let body = "";
        result.on("data", (chunk) => { body += chunk; });
        result.on("end", () => resolve(body));
      });
      client.on("error", reject);
      client.end("{}");
    });
    assert.match(completed, /settled/);
    await waitFor(async () => (await health(port)).active === 0, "normal completion release");
    assert.equal((await health(port)).active, 0);
  } finally {
    server.kill("SIGTERM");
    if (existsSync(pidFile)) {
      try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL"); } catch {}
    }
  }
});
