#!/usr/bin/env node
// Pi Worker 拉取驱动（RFC #943 完整架构的执行面）。
//
// 循环：claim 领取一个运行 → /runs/:id/bridge/request 取执行信封 → 把信封喂给
// agent-runtime/pi/agent-runtime.mjs 的 stdin → 心跳续租（15s）→ runtime 退出
// 后按退出码回交（正常=release；异常=fail 上报）。模型步、工具、事件全部由
// runtime 进程直连后端 /internal-agent/runs/:id/bridge 子路由，执行器仍在 Go
// 侧治理（权限/审批/计费/画布写入），worker 不落任何业务决策。
//
// 环境变量：
//   CANVAS_AGENT_BACKEND_URL    后端地址（含 /internal-agent 挂载），默认本机 8080
//   CANVAS_AGENT_INTERNAL_TOKEN ≥32 字符内部 token（Worker 身份级调用）
//   CANVAS_AGENT_WORKER_ID / CANVAS_AGENT_WORKER_TOKEN  Worker 身份（实例槽位 :0）
//   CANVAS_AGENT_WORKER_USER_ID 可选，把领取限制到单租户
//   CANVAS_AGENT_RUNTIME_PATH   /path/to/agent-runtime/pi/agent-runtime.mjs
//
// 生命周期约定：claim 拿到一次性 run grant（含 epoch fencing）；续租失败或
// claim 拒绝（agent_lease_lost）都让本轮 runtime 立即停止，绝不带着旧 epoch
// 继续——Go 侧 403 是围栏，不是可重试错误。

import { spawn } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const BACKEND = (process.env.CANVAS_AGENT_BACKEND_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const INTERNAL_TOKEN = process.env.CANVAS_AGENT_INTERNAL_TOKEN || "";
const WORKER_ID = process.env.CANVAS_AGENT_WORKER_ID || "";
const WORKER_TOKEN = process.env.CANVAS_AGENT_WORKER_TOKEN || "";
const WORKER_USER_ID = process.env.CANVAS_AGENT_WORKER_USER_ID || "";
const RUNTIME_PATH = process.env.CANVAS_AGENT_RUNTIME_PATH || "";
const OWNER = `${WORKER_ID}:0`;

const WIRE = {
  "X-Agent-Protocol-Version": "canvas-pi-wire/v4",
  "X-Pi-SDK-Version": "0.87.1",
  "X-Pi-Session-Format": "3",
};

function assertConfigured() {
  const missing = [
    [INTERNAL_TOKEN, 32, "CANVAS_AGENT_INTERNAL_TOKEN"],
    [WORKER_ID, 1, "CANVAS_AGENT_WORKER_ID"],
    [WORKER_TOKEN, 32, "CANVAS_AGENT_WORKER_TOKEN"],
  ].filter(([value, minWidth]) => !value || value.length < minWidth);
  if (!RUNTIME_PATH) missing.push([RUNTIME_PATH, 1, "CANVAS_AGENT_RUNTIME_PATH"]);
  if (missing.length > 0) {
    console.error(`[pi-worker] missing configuration: ${missing.map(([, , name]) => name).join(", ")}`);
    process.exit(2);
  }
}

async function call(path, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(BACKEND + path, {
    method,
    headers: { "content-type": "application/json", ...WIRE, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
  return { status: response.status, body: parsed };
}

async function claim() {
  const response = await call("/internal-agent/claim", {
    method: "POST",
    headers: {
      authorization: `Bearer ${WORKER_TOKEN}`,
      "X-Agent-Identity": WORKER_ID,
    },
    body: { owner: OWNER },
  });
  if (response.status !== 200) return null;
  const run = response.body?.data?.run;
  if (!run) return null;
  return {
    runID: run.runId,
    userID: run.userId,
    epoch: run.leaseEpoch,
    grant: response.body.data.runAuthorization,
  };
}

function runHeaders(ticket) {
  return {
    authorization: `Bearer ${ticket.grant}`,
    "X-Agent-Identity": WORKER_ID,
    "X-Agent-Worker-ID": OWNER,
    "X-Agent-User-ID": ticket.userID,
    "X-Agent-Session-Epoch": String(ticket.epoch),
  };
}

function startHeartbeat(ticket, exitSignal) {
  const timer = setInterval(async () => {
    try {
      const response = await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/renew`, {
        method: "POST",
        headers: runHeaders(ticket),
      });
      if (response.status !== 200) {
        console.error(`[pi-worker] renewal lost for ${ticket.runID} (HTTP ${response.status}); stopping runtime`);
        exitSignal.send("lease-lost");
      }
    } catch (error) {
      console.error(`[pi-worker] renewal request failed for ${ticket.runID}: ${error}`);
    }
  }, 15_000);
  return () => clearInterval(timer);
}

async function runOne(ticket) {
  const envelopeResponse = await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/bridge/request`, {
    method: "POST",
    headers: runHeaders(ticket),
  });
  if (envelopeResponse.status !== 200) {
    // 领取成功但执行信封读不出来（状态损坏等）：上报失败并让运行回到池里。
    await failRun(ticket, `bridge envelope unavailable (HTTP ${envelopeResponse.status})`);
    return;
  }
  await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/phase`, {
    method: "POST",
    headers: runHeaders(ticket),
    body: { phase: "advancing" },
  });

  const stopHeartbeat = startHeartbeat(ticket, { send: () => {} });
  let leaseLost = false;
  const child = spawn(process.execPath, [RUNTIME_PATH], {
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env },
  });
  const heartbeat = startHeartbeat(ticket, { send: () => { leaseLost = true; child.kill("SIGKILL"); } });
  child.stdin.write(JSON.stringify(envelopeResponse.body?.data ?? {}));
  child.stdin.end();
  const code = await new Promise((resolve) => child.on("exit", (value) => resolve(value ?? -1)));
  stopHeartbeat();
  heartbeat();

  if (leaseLost) {
    console.error(`[pi-worker] ${ticket.runID}: lease lost, runtime stopped (worker crashed or renewed failed)`);
    return;
  }
  if (code === 0) {
    // 正常退出：runtime 已通过 /event 提交收尾；把租约收回基线并释放。
    await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/release`, {
      method: "POST", headers: runHeaders(ticket), body: {},
    });
    return;
  }
  await failRun(ticket, `agent runtime exited with code ${code}`);
}

async function failRun(ticket, reason) {
  try {
    await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/fail`, {
      method: "POST",
      headers: runHeaders(ticket),
      body: { reason: `Pi worker 上报：${reason}` },
    });
  } catch (error) {
    console.error(`[pi-worker] fail report failed for ${ticket.runID}: ${error}`);
  }
  try {
    await call(`/internal-agent/runs/${encodeURIComponent(ticket.runID)}/release`, {
      method: "POST", headers: runHeaders(ticket), body: {},
    });
  } catch (error) {
    console.error(`[pi-worker] release failed for ${ticket.runID}: ${error}`);
  }
}

async function main() {
  assertConfigured();
  console.log(`[pi-worker] started with identity ${WORKER_ID}; polling ${BACKEND}/internal-agent/claim`);
  for (;;) {
    let ticket = null;
    try {
      ticket = await claim();
    } catch (error) {
      console.error(`[pi-worker] claim poll failed: ${error}`);
    }
    if (!ticket) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    console.log(`[pi-worker] claimed run ${ticket.runID} (epoch ${ticket.epoch})`);
    try {
      await runOne(ticket);
    } catch (error) {
      console.error(`[pi-worker] run ${ticket.runID} crashed the driver loop: ${error}`);
    }
  }
}

main().catch((error) => {
  console.error(`[pi-worker] fatal: ${error}`);
  process.exit(1);
});
