import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname } from "node:path";

const token = process.env.YINGCE_AGENT_TOKEN || "";
let maxSessions = positiveInt(process.env.MAX_CONCURRENT_SESSIONS, 30, 64);
const memoryMB = positiveInt(process.env.NODE_MAX_OLD_SPACE_SIZE, 512, 8192);
const runtimePath = process.env.YINGCE_AGENT_RUNTIME || "/app/agent-runtime/agent-runtime.mjs";
const port = Number(process.env.PORT || 8081);
const host = process.env.YINGCE_AGENT_HOST || "0.0.0.0";
const bodyLimit = 32 * 1024 * 1024;

if (token.length < 32) {
  console.error("YINGCE_AGENT_TOKEN must contain at least 32 characters");
  process.exit(1);
}

let active = 0;
const waiters = [];

function positiveInt(raw, fallback, max) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function authorized(request) {
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function acquire(request) {
  if (active < maxSessions) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    waiters.push(waiter);
    const abort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("Agent request cancelled while queued"));
    };
    if (request.aborted || request.destroyed) abort();
    else request.once("aborted", abort);
  });
}

function admitWaiters() {
  while (waiters.length > 0 && active < maxSessions) {
    active += 1;
    waiters.shift().resolve();
  }
}

function release() {
  if (waiters.length > 0 && active <= maxSessions) {
    waiters.shift().resolve();
    admitWaiters();
    return;
  }
  active = Math.max(0, active - 1);
  admitWaiters();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > bodyLimit) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function writeRuntimeError(response, message) {
  if (!response.headersSent) {
    response.writeHead(200, { "content-type": "application/x-ndjson" });
  }
  response.end(`${JSON.stringify({ event: "runtime_error", message })}\n`);
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length }));
    return;
  }
  if (request.method === "PUT" && request.url === "/v1/limit") {
    if (!authorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const body = JSON.parse((await readBody(request)).toString("utf8"));
      const next = positiveInt(body.maxSessions, 0, 64);
      if (!next) throw new Error("maxSessions must be an integer from 1 to 64");
      maxSessions = next;
      admitWaiters();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, active, limit: maxSessions, queued: waiters.length }));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid limit" }));
    }
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/runs") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  if (!authorized(request)) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  let body;
  try {
    body = await readBody(request);
    JSON.parse(body.toString("utf8"));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid request" }));
    return;
  }
  try {
    await acquire(request);
  } catch (error) {
    response.writeHead(499, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "cancelled" }));
    return;
  }

  const child = spawn(process.execPath, [`--max-old-space-size=${memoryMB}`, runtimePath], {
    cwd: dirname(runtimePath),
    env: {
      PATH: process.env.PATH || "",
      NODE_ENV: "production",
      PI_OFFLINE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    release();
  };
  let sawRuntimeError = false;
  const stop = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  };
  request.on("aborted", stop);
  response.on("close", () => {
    if (!response.writableEnded) stop();
  });
  response.writeHead(200, { "content-type": "application/x-ndjson" });
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    if (text.includes('"runtime_error"') || text.includes('"bridge_error"')) sawRuntimeError = true;
    response.write(chunk);
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.on("error", (error) => {
    writeRuntimeError(response, error.message);
    finish();
  });
  child.on("close", (code) => {
    if (!response.writableEnded) {
      if (code && !sawRuntimeError) {
        response.write(`${JSON.stringify({ event: "runtime_error", message: `Agent runtime exited with code ${code}` })}\n`);
      }
      response.end();
    }
    finish();
  });
  child.stdin.end(body);
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.listen(port, host, () => {
  const address = server.address();
  console.log(`YINGCE_AGENT_READY ${address.port}`);
});
