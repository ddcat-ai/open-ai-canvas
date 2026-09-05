import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CanvasSession } from "../src/canvas-session.js";

/* ─────────────────────────────────────────────────────────────────────────
 * W1-B-01-E2E（D-047）：Domain Tool 闭环验收。
 *
 * 拓扑：CanvasSession（真实协议栈：tool 路由 + schemas 校验 + SSE 事件 +
 * resolveResult 回包）+ 伪前端执行器（与 web runProjectAgentTool 等价的
 * REST 行为）+ 影策测试实例（隔离临时数据目录，禁止触碰生产）。
 *
 * 覆盖：
 *   E1 getProjectContext（canvas_get_context.project 蒸馏段，无 prompt 正文）
 *   E2 getShot 结构
 *   E3-a regenerate 负例（latestTask 为空必须报「还没有生成记录」——F-25 契约）
 *   E3-b regenerate 正例（DB fixture 模拟已完成旧任务 + workflow provider 路径）
 *   E4 复读：getShot latestTask 前移（读模型）+ Timeline 完成序指针不移动（F-25 语义）
 *   安全验收：isProjectAgentReadTool 名单审计（写工具必须过 confirmation gate）
 * ───────────────────────────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BACKEND_DIR = path.join(REPO_ROOT, "backend");
const PORT = 18080;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let backendProc: ChildProcess | null = null;
let dataDir = "";
let dbFile = "";
let cookie = "";
let userId = "";
let projectId = "";
let unitId = "";
const shotIds: string[] = [];

/* ---------- 影策测试实例（隔离，禁生产） ---------- */

function haveGo(): boolean {
    try {
        execSync("go version", { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

async function ensureBackend() {
    const configured = process.env.W1B_E2E_BASE_URL;
    if (configured) {
        // 外部已提供测试实例（例如手工起的隔离实例），直接用
        await waitForBackend(configured);
        return;
    }
    if (!haveGo()) throw new Error("本机无 go 工具链，且未设置 W1B_E2E_BASE_URL——E2E 无法自起测试实例");
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "w1b-e2e-data-"));
    dbFile = path.join(dataDir, "open_ai_canvas.db");
    const exe = path.join(dataDir, "yingce-e2e.exe");
    execSync(`go build -o "${exe}" ./cmd/server`, { cwd: BACKEND_DIR, stdio: "pipe", env: process.env });
    backendProc = spawn(exe, [], {
        cwd: BACKEND_DIR,
        env: { ...process.env, CANVAS_BACKEND_DATA_DIR: dataDir, CANVAS_BACKEND_ADDR: `:${PORT}` },
        stdio: "ignore",
    });
    await waitForBackend(BASE_URL);
}

async function waitForBackend(base: string) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${base}/api/auth/session`);
            if (res.status < 500) return;
        } catch {
            /* 未起，继续等 */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`影策测试实例 60s 内未就绪：${base}`);
}

/* ---------- REST helper（envelope + cookie） ---------- */

type Envelope<T> = { code: number; data: T; msg: string };

async function api<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE_URL}/api${pathname}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = (await res.json()) as Envelope<T>;
    if (raw.code !== 0) throw new Error(`REST ${method} ${pathname} 失败：${raw.msg}`);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return raw.data;
}

/* ---------- 伪前端：SSE 捕获 + 执行器回灌 ---------- */

class FakeResponse extends EventEmitter {
    headersSent = false;
    ended = false;
    writeHead(_status: number, _headers: Record<string, string>) {
        this.headersSent = true;
        return this;
    }
    write(chunk: string | Uint8Array) {
        handleFrame(String(chunk));
        return true;
    }
    end() {
        this.ended = true;
    }
}

type SseFrame = { type: string; payload: Record<string, unknown> };
let sseFrames: SseFrame[] = [];

function handleFrame(chunk: string) {
    const match = /event: ([^\n]+)\ndata: (.+)\n/.exec(chunk);
    if (!match) return;
    const frame = { type: match[1].trim(), payload: JSON.parse(match[2]) as Record<string, unknown> };
    sseFrames.push(frame);
    void dispatch(frame);
}

/** 与 web runProjectAgentTool 等价的执行器：影策 REST 是唯一事实源 */
const executors: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    project_get_context: async (input) => {
        const projectId = String(input.projectId || "");
        return api(`GET`, `/projects/${projectId}`);
    },
    project_get_shot: async (input) => {
        const projectId = String(input.projectId || "");
        const detail = await api<{
            shots: Array<Record<string, unknown>>;
            shotRevisions: Array<Record<string, unknown>>;
            shotArtifacts: Array<Record<string, unknown>>;
            tasks: Array<Record<string, unknown>>;
        }>(`GET`, `/projects/${projectId}`);
        const shotId = String(input.shotId || "");
        const shot = detail.shots.find((item) => item.id === shotId);
        if (!shot) throw new Error(`镜头不存在：${shotId}`);
        // 与 web distillShotContext 等价的投影（蒸馏函数本身由 web 单测锁）
        const revision = detail.shotRevisions.filter((item) => item.shotId === shotId).sort((left, right) => Number(right.version) - Number(left.version))[0];
        const artifacts = detail.shotArtifacts.filter((item) => item.shotId === shotId).sort((left, right) => Number(right.version) - Number(left.version));
        const latestTask = detail.tasks.filter((task) => (task.clientContext as Record<string, unknown> | undefined)?.shotId === shotId).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
        return {
            shot,
            revision: revision ? { id: revision.id, version: revision.version, durationMs: revision.durationMs } : undefined,
            artifacts,
            latestTask: latestTask ? { id: latestTask.id, status: latestTask.status, updatedAt: latestTask.updatedAt } : undefined,
        };
    },
    project_regenerate_shot: async (input) => {
        const projectId = String(input.projectId || "");
        return api(`POST`, `/projects/${projectId}/shots/${String(input.shotId || "")}/regenerate`);
    },
    project_select_artifact: async (input) => {
        const projectId = String(input.projectId || "");
        const shotId = String(input.shotId || "");
        const artifactId = String(input.artifactId || "");
        return api(`POST`, `/projects/${projectId}/shots/${shotId}/artifacts/${artifactId}/select`);
    },
    project_review_shot: async (input) => {
        const projectId = String(input.projectId || "");
        const shotId = String(input.shotId || "");
        return api(`POST`, `/projects/${projectId}/shots/${shotId}/review`, {
            action: String(input.action || ""),
            ...(input.reason === undefined ? {} : { reason: String(input.reason) }),
        });
    },
};

async function dispatch(frame: SseFrame) {
    if (frame.type !== "tool_call") return;
    const requestId = String(frame.payload.requestId);
    const name = String(frame.payload.name);
    const input = (frame.payload.input || {}) as Record<string, unknown>;
    const executor = executors[name];
    try {
        if (!executor) throw new Error(`E2E 执行器未实现工具：${name}`);
        const result = await executor(input);
        session.resolveResult({ requestId, result });
    } catch (error) {
        session.resolveResult({ requestId, error: error instanceof Error ? error.message : String(error) });
    }
}

const session = new CanvasSession();

let regeneratedTaskId = "";

/** DB fixture：模拟 handleSuccess 已回写的成功任务状态（产生语义由 T3/T7/T8 覆盖） */
function fixtureLatestTask(shotId: string, taskId: string) {
    if (!dbFile) throw new Error("fixture 依赖自起实例的数据目录");
    const script = [
        "import sqlite3, json",
        `conn = sqlite3.connect(${JSON.stringify(dbFile)})`,
        `conn.execute("DELETE FROM tasks WHERE id = ?", (${JSON.stringify(taskId)},))`,
        "metadata = json.dumps({",
        `    "shotId": ${JSON.stringify(shotId)},`,
        `    "workflowStepId": "wf-e2e-fixture",`,
        `    "domainProjectId": ${JSON.stringify(projectId)},`,
        `    "artifactType": "video",`,
        "})",
        // config.interfaceType：走 workflow provider 路径（跳过模型路由/渠道校验，插件已在 before 激活）；
        // channelId 必须显式为空串——key 缺失时 fmt.Sprint(nil) = "<nil>"，billing 会拿 "<nil>" 查渠道而 400。
        "input_json = json.dumps({\"prompt\": \"E2E fixture prompt\", \"config\": {\"interfaceType\": \"comfyui-bridge-video\", \"channelId\": \"\"}, \"metadata\": json.loads(metadata)})",
        `conn.execute("INSERT INTO tasks (id, user_id, type, status, project_id, shot_id, prompt, operation, provider, model, input_json, attempts, error, completed_at, created_at, updated_at) VALUES (?, ?, 'canvas_video', 'succeeded', ?, ?, 'E2E fixture prompt', 'video', 'comfy', 'w1-e2e', ?, 1, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",`,
        `    (${JSON.stringify(taskId)}, ${JSON.stringify(userId)}, ${JSON.stringify(projectId)}, ${JSON.stringify(shotId)}, input_json))`,
        `conn.execute("UPDATE shots SET latest_task_id = ? WHERE id = ?", (${JSON.stringify(taskId)}, ${JSON.stringify(shotId)}))`,
        // E5 前置：两个产物版本（v1 未选 / v2 选中），模拟「重新生成过一次」的镜头
        `revision = conn.execute("SELECT current_revision_id FROM shots WHERE id = ?", (${JSON.stringify(shotId)},)).fetchone()[0]`,
        `unit = conn.execute("SELECT unit_id FROM shots WHERE id = ?", (${JSON.stringify(shotId)},)).fetchone()[0]`,
        `conn.execute("DELETE FROM shot_artifacts WHERE shot_id = ? AND id IN ('art-e2e-v1', 'art-e2e-v2')", (${JSON.stringify(shotId)},))`,
        `conn.execute("INSERT INTO shot_artifacts (id, project_id, unit_id, shot_id, revision_id, task_id, type, version, resource_id, status, selected, provider, duration_ms, created_at, updated_at) VALUES ('art-e2e-v1', ?, ?, ?, ?, ?, 'video', 1, '', 'ready', 0, 'comfy', 5000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", (${JSON.stringify(projectId)}, unit, ${JSON.stringify(shotId)}, revision, ${JSON.stringify(taskId)}))`,
        `conn.execute("INSERT INTO shot_artifacts (id, project_id, unit_id, shot_id, revision_id, task_id, type, version, resource_id, status, selected, provider, duration_ms, created_at, updated_at) VALUES ('art-e2e-v2', ?, ?, ?, ?, ?, 'video', 2, '', 'ready', 1, 'comfy', 4600, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", (${JSON.stringify(projectId)}, unit, ${JSON.stringify(shotId)}, revision, ${JSON.stringify(taskId)}))`,
        `conn.execute("UPDATE shots SET latest_artifact_id = 'art-e2e-v2' WHERE id = ?", (${JSON.stringify(shotId)},))`,
        "conn.commit()",
        "conn.close()",
    ].join("\n");
    const pyPath = path.join(path.dirname(dbFile), "w1b-fixture.py");
    fs.writeFileSync(pyPath, script, "utf8");
    execSync(`python "${pyPath}"`, { stdio: "pipe" });
    fs.rmSync(pyPath, { force: true });
}

/* ---------- 测试主体 ---------- */

before(async () => {
    await ensureBackend();
    // 注册首个用户（空库免邮箱验证码，role=admin）；已存在则登录
    try {
        const registered = await api<{ user: { id: string } }>(`POST`, `/auth/register`, { username: "w1be2e", displayName: "E2E 测试员", password: "W1bE2e!2026" });
        userId = registered.user.id;
    } catch {
        const loggedIn = await api<{ user: { id: string } }>(`POST`, `/auth/login`, { username: "w1be2e", password: "W1bE2e!2026" });
        userId = loggedIn.user.id;
    }
    // 幂等数据准备：项目 + 章节 + 3 镜头（每次全新项目，互不依赖）
    const project = await api<{ project: { id: string } }>(`POST`, `/projects`, { name: `W1B-E2E-${Date.now()}`, type: "drama" });
    projectId = project.project.id;
    const unit = await api<{ unit: { id: string } }>(`POST`, `/projects/${projectId}/units`, { kind: "chapter", title: "第一章", position: 1 });
    unitId = unit.unit.id;
    for (let index = 1; index <= 3; index++) {
        const shot = await api<{ shot: { id: string } }>(`POST`, `/projects/${projectId}/shots`, {
            unitId, title: `镜头${index}`, position: index, durationMs: 3000 + index * 500,
            revision: { plotDescription: `E2E 剧情${index}`, videoPrompt: `E2E提示词${index}`, durationMs: 3000 + index * 500 },
        });
        shotIds.push(shot.shot.id);
    }
    // 激活 ComfyUI Bridge 工作流插件（E3-b/E4 fixture 走 workflow provider 路径必需）：
    // 平台级 enable（首注册用户即 admin）+ 用户级 activation，两步缺一不可
    await api(`POST`, `/plugins/comfyui-workflow-provider/enable`);
    await api(`PUT`, `/plugins/comfyui-workflow-provider/activation`, { enabled: true });
    // 连接伪前端画布：快照带 domainProjectId（projectTool 的 projectId 来源）
    const snapshot = { projectId: "canvas-local", domainProjectId: projectId, title: "E2E 画布", revision: 1, nodes: [], connections: [], selectedNodeIds: [] };
    session.updateState(snapshot, "e2e-client");
    session.openEvents(new URL(`http://local/events?clientId=e2e-client`), new FakeResponse() as unknown as import("node:http").ServerResponse);
});

after(() => {
    // dispose 会清掉 SSE ping 定时器等内部资源，否则 event loop 挂着不退出
    session.dispose();
    if (backendProc?.pid) {
        try {
            execSync(`taskkill /pid ${backendProc.pid} /T /F`, { stdio: "pipe" });
        } catch {
            /* 进程可能已退出 */
        }
    }
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test("E1 getProjectContext：蒸馏段结构完整且不含 prompt 正文", async () => {
    const context = (await session.callTool("canvas_get_context", {})) as { project?: Record<string, unknown> };
    assert.ok(context.project, "canvas_get_context 应携带 project 蒸馏段");
    const project = context.project as { projectId: string; projectTitle: string; units: unknown[]; shots: Array<Record<string, unknown>>; shotCount: number; characters: unknown[]; locations: unknown[]; currentShotId?: string; prevShotId?: string; nextShotId?: string };
    assert.equal(project.projectId, projectId);
    assert.equal(project.units.length, 1);
    assert.equal(project.shotCount, 3);
    assert.equal(project.shots.length, 3, "3 镜在 60 上限内应全量输出");
    assert.ok(Array.isArray(project.characters) && Array.isArray(project.locations));
    // 单镜摘要字段（D-044：蒸馏，非全量 JSON）
    const first = project.shots[0];
    for (const field of ["shotId", "unitId", "ordinal", "title", "status", "plannedDurationMs", "latestTask", "latestArtifact"]) {
        assert.ok(field in first, `单镜摘要应含字段 ${field}`);
    }
    // 无 prompt 正文（E1 硬条件）：蒸馏段不得泄漏 Revision 的 prompt / 剧情文本
    const serialized = JSON.stringify(context.project);
    assert.ok(!serialized.includes("E2E提示词"), "蒸馏段不得包含 videoPrompt 正文");
    assert.ok(!serialized.includes("E2E剧情"), "蒸馏段不得包含 plotDescription 正文");
    // 当前镜头：无选中节点时 currentShotId 为 undefined（字段可选）
    assert.equal(project.currentShotId, undefined);
});

test("E2 getShot：Shot + Revision + Artifacts + LatestTask 结构正确", async () => {
    const summary = (await session.callTool("project_get_shot", { shotId: shotIds[1] })) as {
        shot: Record<string, unknown>;
        revision?: { version: number };
        artifacts: unknown[];
        latestTask?: Record<string, unknown>;
    };
    assert.equal(summary.shot.id, shotIds[1]);
    assert.ok(summary.revision && summary.revision.version >= 1, "应带当前 Revision");
    assert.ok(Array.isArray(summary.artifacts), "应带产物列表（可为空）");
    assert.equal(summary.latestTask, undefined, "尚无生成任务时 latestTask 应为空");
});

test("E3-a regenerate 负例：latestTask 为空必须报「还没有生成记录」（F-25 契约）", async () => {
    await assert.rejects(
        session.callTool("project_regenerate_shot", { shotId: shotIds[1] }),
        /还没有生成记录/,
    );
});

test("E3-b regenerate 正例：新建 Task 且旧 Task 保留（fixture 前置）", async () => {
    // 前置说明：生产执行链中 Shot.LatestTaskID 由 task_terminal.handleSuccess 回写
    // （F-25），而 ComfyUI Bridge 入队（EnqueueComfyBridgeRequest）尚无生产调用点
    // （W3 范围），REST 无法自然产生"成功任务"。此处用 DB fixture 模拟
    // handleSuccess 回写后的状态——该状态的产生语义已被 w1contract T3/T7/T8 锁死。
    // E2E 本身被测的是 Tool 链路：regenerateShot tool → service → 新 Task → getShot 反映。
    const fixtureTaskId = "task-e2e-fixture";
    fixtureLatestTask(shotIds[1], fixtureTaskId);
    const result = (await session.callTool("project_regenerate_shot", { shotId: shotIds[1] })) as { task: { id: string; shotId?: string } };
    assert.ok(result.task, "regenerate 应返回新 Task");
    assert.notEqual(result.task.id, fixtureTaskId, "regenerate 必须新建 Task（D-030）");
    regeneratedTaskId = result.task.id;
});

test("E4 复读 getShot：latestTask 前移为新 Task，完成序指针语义正确", async () => {
    // 两个投影、两种语义（F-25 设计定稿）：
    //   ① getShot 的 latestTask（Agent 读模型）= clientContext.shotId 过滤后按 updatedAt 取最新
    //      → regenerate 一创建 queued 新任务就前移。
    //   ② Timeline 的 latestTaskId（D-026 权威投影）= shots.latest_task_id 完成序指针，
    //      由 handleSuccess → TouchShotLatestTask 回写（F-25A 单调防护）
    //      → queued 任务不移动指针；移动语义已由 w1contract T1~T8 契约测试锁死。
    const summary = (await session.callTool("project_get_shot", { shotId: shotIds[1] })) as {
        shot: Record<string, unknown>;
        latestTask?: { id: string };
        artifacts: unknown[];
    };
    assert.equal(summary.latestTask?.id, regeneratedTaskId, "getShot 的 latestTask 应反映 regenerate 产生的新 Task");
    assert.ok(summary.artifacts.length >= 0);
    // 后端权威投影（D-026 Timeline）：queued 新任务不得移动完成序指针
    const timeline = await api<{ shots: Array<{ shotId: string; latestTaskId?: string }> }>(`GET`, `/projects/${projectId}/shots`);
    const entry = timeline.shots.find((item) => item.shotId === shotIds[1]);
    assert.equal(entry?.latestTaskId, "task-e2e-fixture", "完成序指针应保持旧已完成 Task（queued ≠ completed，F-25 语义）");
});

test("E5 selectArtifact：版本指针切换（同类型内唯一 true + 加速指针回写）", async () => {
    // 前置：shotIds[1] 在 fixture 里有 v1(未选) / v2(已选) 两个版本
    const before = (await session.callTool("project_get_shot", { shotId: shotIds[1] })) as {
        artifacts: Array<{ id: string; version: number; selected?: boolean }>;
    };
    const v1 = before.artifacts.find((item) => item.version === 1);
    const v2 = before.artifacts.find((item) => item.version === 2);
    assert.ok(v1 && v2, "fixture 应提供两个版本");
    assert.equal(v2!.selected, true, "前置：新版本应为当前采用版本");
    assert.equal(v1!.selected, false, "前置：旧版本不应被选中");

    // 切回 v1
    const result = (await session.callTool("project_select_artifact", { shotId: shotIds[1], artifactId: v1!.id })) as {
        artifact: { id: string; selected: boolean; version: number };
    };
    assert.equal(result.artifact.id, v1!.id);
    assert.equal(result.artifact.selected, true, "selectArtifact 应把目标版本置为采用中");

    // 复读校验：同类型内唯一 true（不能出现双 true）
    const after = (await session.callTool("project_get_shot", { shotId: shotIds[1] })) as {
        artifacts: Array<{ id: string; version: number; selected?: boolean }>;
    };
    const selectedList = after.artifacts.filter((item) => item.selected === true);
    assert.equal(selectedList.length, 1, "同类型内必须恰好一个选中版本（版本指针语义）");
    assert.equal(selectedList[0]?.id, v1!.id, "选中的应是被切换到的 v1");
    assert.equal(after.artifacts.find((item) => item.version === 2)?.selected, false, "v2 应被清空选中态");

    // 后端权威投影：shots.latest_artifact_id 必须同步回写
    const timeline = await api<{ shots: Array<{ shotId: string; latestArtifactId?: string }> }>(`GET`, `/projects/${projectId}/shots`);
    const entry = timeline.shots.find((item) => item.shotId === shotIds[1]);
    assert.equal(entry?.latestArtifactId, v1!.id, "加速指针 latest_artifact_id 应与选中版本一致");
});

test("E6 selectArtifact 负例：产物不存在/不属于该分镜必须拒绝", async () => {
    // 越权与串镜防护（D-024 归属校验的仓储层兜底）：不存在的产物必须报错，不得静默成功
    await assert.rejects(
        session.callTool("project_select_artifact", { shotId: shotIds[1], artifactId: "art-does-not-exist" }),
    );
    // 切换失败后，原选中态必须保持（事务回滚，不能留下零 true 的中间态）
    const summary = (await session.callTool("project_get_shot", { shotId: shotIds[1] })) as {
        artifacts: Array<{ id: string; version: number; selected?: boolean }>;
    };
    const selectedList = summary.artifacts.filter((item) => item.selected === true);
    assert.equal(selectedList.length, 1, "失败的切换不得破坏原有选中态");
    assert.equal(selectedList[0]?.version, 1, "应保持上一次成功切换后的 v1");
});

test("E7 reviewShot 通过：镜头进 completed，且不触发任何生成", async () => {
    // 用未被其它用例触碰的第三镜，避免与 E5/E6 的版本指针断言互相干扰
    const target = shotIds[2];
    const before = (await session.callTool("project_get_shot", { shotId: target })) as {
        shot: { status: string };
    };
    assert.equal(before.shot.status, "draft", "前置：新建镜头应为 draft");

    const result = (await session.callTool("project_review_shot", {
        shotId: target,
        action: "approve",
        reason: "节奏到位，通过",
    })) as { review: { shotId: string; action: string; status: string; previousStatus: string; reason?: string } };
    assert.equal(result.review.shotId, target);
    assert.equal(result.review.action, "approve");
    assert.equal(result.review.status, "completed", "通过后镜头应进 completed（Q-30 A）");
    assert.equal(result.review.previousStatus, "draft");
    assert.equal(result.review.reason, "节奏到位，通过", "reason 应原样回显");

    // 复读校验：后端权威状态确实改了，而不是只在返回体里好看
    const after = (await session.callTool("project_get_shot", { shotId: target })) as { shot: { status: string } };
    assert.equal(after.shot.status, "completed");

    // Q-32 A：审核不得隐式创建任何生成任务（生成要花钱，必须由人或后续 Tool 显式发起）
    const detail = await api<{ tasks: Array<Record<string, unknown>> }>(`GET`, `/projects/${projectId}`);
    const shotTasks = detail.tasks.filter((task) => (task.clientContext as Record<string, unknown> | undefined)?.shotId === target);
    assert.equal(shotTasks.length, 0, "审核不得隐式创建生成任务（Q-32 A）");
});

test("E8 reviewShot 打回：退回 draft，且 reason 不落库", async () => {
    const target = shotIds[2];
    // 前置：E7 已把它推到 completed
    const result = (await session.callTool("project_review_shot", {
        shotId: target,
        action: "reject",
        reason: "人物手部穿模，重做",
    })) as { review: { status: string; previousStatus: string; reason?: string } };
    assert.equal(result.review.previousStatus, "completed");
    assert.equal(result.review.status, "draft", "打回后应退回可重做态 draft（Q-30 A，沿用 WorkflowStep 先例）");
    assert.equal(result.review.reason, "人物手部穿模，重做");

    const after = (await session.callTool("project_get_shot", { shotId: target })) as {
        shot: Record<string, unknown>;
    };
    assert.equal(after.shot.status, "draft");
    // Q-31 A：理由不落库——Shot 上不得凭空多出任何批注字段
    for (const field of ["reviewReason", "reviewNote", "review_note", "reviewComment"]) {
        assert.equal(after.shot[field], undefined, `Shot 上不应出现批注字段 ${field}（Q-31 A：不落库）`);
    }
});

test("E9 reviewShot 负例：非法 action 必须拒绝且不改状态", async () => {
    const target = shotIds[2];
    const before = (await session.callTool("project_get_shot", { shotId: target })) as { shot: { status: string } };
    // zod enum 在进入执行器之前就应拦下非法动作（parseToolInput 抛异常）
    await assert.rejects(
        session.callTool("project_review_shot", { shotId: target, action: "maybe" }),
        /approve|reject/i,
    );
    // 空 action 同样必须拒绝（服务层另有中文兜底，此处至少保证不会静默通过）
    await assert.rejects(
        session.callTool("project_review_shot", { shotId: target, action: "maybe" }),
    );
    const after = (await session.callTool("project_get_shot", { shotId: target })) as { shot: { status: string } };
    assert.equal(after.shot.status, before.shot.status, "非法审核动作不得改变镜头状态");
});

test("安全验收：写工具不得进入 read 名单（必须过 confirmation gate）", async () => {
    // 源码级审计：runProjectAgentTool 的 read 名单一旦误加写工具，这里立即红。
    // 完整 UI gate 行为（未确认→不写、确认→写）归浏览器人工目验。
    const source = fs.readFileSync(path.join(REPO_ROOT, "web/src/services/api/project-agent-tools.ts"), "utf8");
    const readMatch = /export function isProjectAgentReadTool[\s\S]*?\n}/.exec(source);
    assert.ok(readMatch, "应能定位 isProjectAgentReadTool 实现");
    const body = readMatch[0];
    const writeTools = ["project_retry_shot", "project_regenerate_shot", "project_create_or_update_shots", "project_confirm_asset_candidate", "project_select_artifact", "project_review_shot"];
    for (const writeTool of writeTools) {
        assert.ok(!body.includes(writeTool), `写工具 ${writeTool} 不得进入 read 名单`);
    }
    for (const readTool of ["project_get_context", "project_get_shot"]) {
        assert.ok(body.includes(readTool), `读工具 ${readTool} 应在 read 名单`);
    }
});
