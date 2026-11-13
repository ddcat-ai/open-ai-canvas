import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RunDirectories } from "./run-directories.mjs";
import { AdmissionError, SessionAdmission } from "./session-admission.mjs";

function positiveInt(raw, fallback, max) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function readBody(request, limit, timeout, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const finish = (error, body) => {
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", end);
      request.off("error", failed);
      signal.removeEventListener("abort", abort);
      request.pause();
      if (error) reject(error);
      else resolve(body);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) finish(new AdmissionError(413, "Agent request body too large"));
      else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks));
    const failed = error => finish(error);
    const abort = () => finish(new AdmissionError(499, "Agent request cancelled"));
    const timer = setTimeout(() => finish(new AdmissionError(408, "Agent request body timed out")), timeout);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    request.on("data", data);
    request.once("end", end);
    request.once("error", failed);
    request.resume();
  });
}

function sendError(response, error) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.end(`${JSON.stringify({ event: "runtime_error", message: error.message })}\n`);
    return;
  }
  response.writeHead(error.status || 500, {
    "content-type": "application/json",
    connection: "close",
    ...(error.status === 429 || error.status === 503 ? { "retry-after": "5" } : {}),
  });
  response.end(JSON.stringify({ error: error.message }));
}

export async function createAgentServer(options = {}) {
  const serviceToken = options.token ?? process.env.YINGCE_AGENT_TOKEN ?? "";
  if (serviceToken.length < 32) throw new Error("YINGCE_AGENT_TOKEN must contain at least 32 characters");
  const runtimePath = options.runtimePath ?? process.env.YINGCE_AGENT_RUNTIME ?? "/app/agent-runtime/agent-runtime.mjs";
  const memoryMB = positiveInt(options.memoryMB ?? process.env.NODE_MAX_OLD_SPACE_SIZE, 512, 8192);
  const sessionCap = Number(options.sessionCap ?? process.env.YINGCE_AGENT_SESSION_CAP ?? 64);
  if (!Number.isInteger(sessionCap) || sessionCap < 1 || sessionCap > 64) throw new Error("YINGCE_AGENT_SESSION_CAP must be an integer from 1 to 64");
  const bodyTimeout = options.bodyTimeout ?? positiveInt(process.env.YINGCE_AGENT_BODY_TIMEOUT_SECONDS, 30, 300) * 1000;
  const killGrace = options.killGrace ?? positiveInt(process.env.YINGCE_AGENT_KILL_GRACE_SECONDS, 5, 60) * 1000;
  const directories = await new RunDirectories({
    root: options.tempRoot,
    orphanTTL: options.orphanTTL ?? positiveInt(process.env.YINGCE_AGENT_ORPHAN_TTL_SECONDS, 86400, 604800) * 1000,
  }).initialize();
  const gate = new SessionAdmission({
    limit: Math.min(positiveInt(options.maxSessions ?? process.env.MAX_CONCURRENT_SESSIONS, 8, 64), sessionCap),
    maxQueue: positiveInt(options.maxQueue ?? process.env.YINGCE_AGENT_MAX_QUEUE, 64, 1024),
    waitTimeout: options.waitTimeout ?? positiveInt(process.env.YINGCE_AGENT_QUEUE_TIMEOUT_SECONDS, 60, 600) * 1000,
  });
  const requests = new Set();
  const cleanups = new Set();
  const authorized = request => {
    const actual = Buffer.from(request.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${serviceToken}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  async function execute(body, response, signal) {
    const directory = await directories.create();
    let child;
    let killTimer;
    let exited;
    try {
      if (signal.aborted) throw new AdmissionError(499, "Agent request cancelled");
      child = spawn(process.execPath, [`--max-old-space-size=${memoryMB}`, runtimePath], {
        cwd: dirname(runtimePath),
        env: {
          PATH: process.env.PATH || "", NODE_ENV: "production", PI_OFFLINE: "1",
          YINGCE_AGENT_RUN_DIR: directory.path,
          HOME: directory.path, TMPDIR: directory.path,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stop = () => {
        // A disconnected slow client must not leave stdout paused and delay close/cleanup.
        child.stdout.unpipe(response);
        child.stdout.resume();
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill("SIGTERM");
        killTimer ||= setTimeout(() => child.kill("SIGKILL"), killGrace);
        killTimer.unref();
      };
      signal.addEventListener("abort", stop, { once: true });
      let childError;
      let sawRuntimeError = false;
      let outputTail = "";
      child.on("error", error => { childError = error; });
      child.stdin.on("error", error => { childError ||= error; stop(); });
      exited = new Promise(resolve => child.once("close", (code, exitSignal) => resolve({ code, exitSignal })));
      try {
        if (child.pid) await directory.childStarted(child.pid);
        if (signal.aborted) stop();
        if (!response.destroyed) {
          response.writeHead(200, { "content-type": "application/x-ndjson" });
          response.flushHeaders();
        }
        child.stdout.on("data", chunk => {
          const text = outputTail + chunk.toString("utf8");
          sawRuntimeError ||= text.includes('"runtime_error"') || text.includes('"bridge_error"');
          outputTail = text.slice(-32);
        });
        // pipe pauses the child when the HTTP client is slow; stderr also respects backpressure.
        child.stdout.pipe(response, { end: false });
        child.stderr.pipe(process.stderr, { end: false });
        child.stdin.end(body);
        const result = await exited;
        if (childError) throw childError;
        if (result.code !== 0 && !signal.aborted && !sawRuntimeError) throw new Error(`Agent runtime exited ${result.exitSignal || `with code ${result.code}`}`);
        if (!response.destroyed) response.end();
      } finally {
        signal.removeEventListener("abort", stop);
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.stdout.unpipe(response);
        child.stdout.resume();
        child.stderr.resume();
        child.kill("SIGKILL");
        await exited;
      }
      clearTimeout(killTimer);
      child?.stdin.destroy();
      child?.stdout.destroy();
      child?.stderr.destroy();
      await directory.cleanup();
    }
  }

  const server = createServer(async (request, response) => {
    request.pause();
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: !gate.closed, active: gate.active, limit: gate.limit, sessionCap, queued: gate.waiters.length, queueLimit: gate.maxQueue }));
      return;
    }
    if (!authorized(request)) {
      sendError(response, new AdmissionError(401, "unauthorized"));
      return;
    }
    const controller = new AbortController();
    requests.add(controller);
    const abort = () => controller.abort();
    response.once("close", abort);
    let release;
    try {
      if (request.method === "PUT" && request.url === "/v1/limit") {
        const body = JSON.parse((await readBody(request, 1024, bodyTimeout, controller.signal)).toString("utf8"));
        const next = positiveInt(body.maxSessions, 0, 64);
        if (!next) throw new AdmissionError(400, "maxSessions must be an integer from 1 to 64");
        gate.setLimit(Math.min(next, sessionCap));
        if (next > sessionCap) console.warn(`Agent requested concurrency ${next} is bounded by deployment cap ${sessionCap}`);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, active: gate.active, requestedLimit: next, limit: gate.limit, sessionCap, queued: gate.waiters.length }));
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/runs") throw new AdmissionError(404, "not found");
      // A queued request holds only the bounded HTTP stream, never a 32 MiB body.
      release = await gate.acquire(controller.signal);
      const body = await readBody(request, 32 * 1024 * 1024, bodyTimeout, controller.signal);
      JSON.parse(body.toString("utf8"));
      const execution = execute(body, response, controller.signal);
      cleanups.add(execution);
      try { await execution; } finally { cleanups.delete(execution); }
    } catch (error) {
      sendError(response, error instanceof SyntaxError ? new AdmissionError(400, "invalid JSON request") : error);
      if (!(error instanceof AdmissionError) && !(error instanceof SyntaxError) && !controller.signal.aborted) console.error("Agent request failed", error);
    } finally {
      release?.();
      response.off("close", abort);
      requests.delete(controller);
    }
  });
  // Reading an admitted body has its own deadline; queued bodies remain paused.
  server.requestTimeout = 0;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 1200;
  server.timeout = 0;

  let closing;
  const close = () => closing ||= (async () => {
    gate.close();
    directories.close();
    for (const controller of requests) controller.abort();
    server.closeAllConnections();
    await Promise.allSettled([...cleanups]);
    await new Promise(resolve => server.close(resolve));
  })();
  return { server, close, gate, directories };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const service = await createAgentServer();
    service.server.listen(Number(process.env.PORT || 8081), "0.0.0.0", () => {
      console.log(`YINGCE_AGENT_READY ${service.server.address().port}`);
    });
    for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
      service.close().then(() => { process.exitCode = 0; }, error => {
        console.error("Agent shutdown failed", error);
        process.exitCode = 1;
      });
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
